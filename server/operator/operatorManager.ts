import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { COMMAND_REGISTRY, commandById, formatCommand } from "../../src/operator/commandRegistry.js";

export type OperatorRunStatus = "running" | "completed" | "failed" | "stopped";
export interface OperatorRun { id: string; commandId: string; command: string; startedAt: string; finishedAt: string | null; status: OperatorRunStatus;
  exitCode: number | null; output: string; stoppable: boolean }
const IDENTITY = /^[a-zA-Z0-9._-]{1,80}$/;
const MAX_OUTPUT = 120_000, MAX_RUNS = 30;

export function validateOperatorArguments(commandId: string, supplied: unknown): Record<string, string | number> {
  const args = supplied && typeof supplied === "object" && !Array.isArray(supplied) ? supplied as Record<string, unknown> : {};
  const allowed = commandById(commandId)?.options.map((option) => option.name) ?? [];
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error("Unsupported operator argument");
  const result: Record<string, string | number> = {};
  if (commandId.startsWith("observer.")) {
    const observer = args.observer ?? "codex-first-entry"; if (typeof observer !== "string" || !IDENTITY.test(observer)) throw new Error("Invalid observer identity"); result.observer = observer;
    const timeout = Number(args.expeditionTimeout ?? 3600); if (!Number.isFinite(timeout) || timeout < 30 || timeout > 86_400) throw new Error("Invalid expedition timeout"); result.expeditionTimeout = timeout;
    if (commandId === "observer.loop") { const interval = Number(args.interval ?? 300); if (!Number.isFinite(interval) || interval < 1 || interval > 86_400) throw new Error("Invalid observer interval"); result.interval = interval; }
  } else if (commandId.startsWith("lab.")) {
    if (typeof args.experiment !== "string" || !IDENTITY.test(args.experiment)) throw new Error("Invalid experiment ID"); result.experiment = args.experiment;
  }
  return result;
}

export class OperatorManager {
  private readonly runs = new Map<string, OperatorRun & { child?: ChildProcess }>();
  constructor(readonly root = process.cwd(), readonly spawnImpl: typeof spawn = spawn,
    readonly terminateImpl: (child: ChildProcess) => Promise<void> = OperatorManager.terminate) {}
  private static async terminate(child: ChildProcess): Promise<void> {
    if (process.platform === "win32" && child.pid) await new Promise<void>((resolve) => { const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }); killer.once("exit", () => resolve()); killer.once("error", () => resolve()); });
    else if (child.pid) { try { process.kill(-child.pid, "SIGINT"); } catch { child.kill("SIGINT"); } }
  }
  catalog() { return COMMAND_REGISTRY; }
  list(): OperatorRun[] { return [...this.runs.values()].reverse().map(({ child: _child, ...run }) => ({ ...run })); }
  private executable(commandId: string, args: Record<string, string | number>): { command: string; args: string[] } {
    const node = process.execPath, script = (name: string) => path.join(this.root, "scripts", name);
    if (commandId === "universe.save") return { command: node, args: [script("universe-save.mjs")] };
    if (commandId === "observer.once" || commandId === "observer.loop") return { command: node, args: [script("observer-loop.mjs"), ...(commandId === "observer.once" ? ["--once"] : []),
      "--observer", String(args.observer), "--expedition-timeout", String(args.expeditionTimeout), ...(commandId === "observer.loop" ? ["--interval", String(args.interval)] : [])] };
    const tsx = path.join(this.root, "node_modules", "tsx", "dist", "cli.mjs");
    if (commandId === "lab.blind" || commandId === "lab.reveal") return { command: node, args: [tsx, script(commandId === "lab.blind" ? "lab-once.mjs" : "lab-reveal.mjs"), "--experiment", String(args.experiment)] };
    throw new Error("Command is not executable");
  }
  start(commandId: string, supplied: unknown): OperatorRun {
    const definition = commandById(commandId); if (!definition?.gui || commandId === "help") throw new Error("Command is not an approved executable action");
    const args = validateOperatorArguments(commandId, supplied), id = randomUUID(), invocation = this.executable(commandId, args);
    const run: OperatorRun & { child?: ChildProcess } = { id, commandId, command: formatCommand(definition, args), startedAt: new Date().toISOString(), finishedAt: null,
      status: "running", exitCode: null, output: "", stoppable: definition.longRunning };
    const append = (prefix: string, chunk: unknown) => { run.output = `${run.output}${new Date().toISOString()} ${prefix}${String(chunk)}`.slice(-MAX_OUTPUT); };
    const child = this.spawnImpl(invocation.command, invocation.args, { cwd: this.root, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    run.child = child; this.runs.set(id, run); while (this.runs.size > MAX_RUNS) this.runs.delete(this.runs.keys().next().value!);
    append("", `$ ${run.command}\n`); child.stdout?.on("data", (chunk) => append("", chunk)); child.stderr?.on("data", (chunk) => append("[stderr] ", chunk));
    child.once("error", (error) => { append("[launch] ", `${error.message}\n`); run.status = "failed"; run.finishedAt = new Date().toISOString(); });
    child.once("exit", (code, signal) => { run.exitCode = code; run.status = run.status === "stopped" ? "stopped" : code === 0 ? "completed" : "failed";
      run.finishedAt = new Date().toISOString(); append("", `[${run.status}] exit=${code ?? signal}\n`); delete run.child; });
    return this.public(run);
  }
  async stop(id: string): Promise<OperatorRun> {
    const run = this.runs.get(id); if (!run || !run.child || run.status !== "running" || !run.stoppable) throw new Error("No stoppable GUI-owned run with that ID");
    run.status = "stopped"; const child = run.child;
    await this.terminateImpl(child);
    return this.public(run);
  }
  async stopAll(): Promise<OperatorRun[]> {
    const stopped: OperatorRun[] = []; for (const run of this.runs.values()) {
      if (!run.child || run.status !== "running") continue;
      run.status = "stopped"; run.finishedAt = new Date().toISOString();
      run.output = `${run.output}${run.finishedAt} [stop requested by runtime supervisor]\n`.slice(-MAX_OUTPUT);
      await this.terminateImpl(run.child); stopped.push(this.public(run));
    } return stopped;
  }
  private public(run: OperatorRun & { child?: ChildProcess }): OperatorRun { const { child: _child, ...value } = run; return { ...value }; }
}
