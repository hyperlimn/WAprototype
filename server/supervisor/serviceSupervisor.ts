import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { SaveStateStore, type SaveStateSummary } from "../save-state/saveStateStore.js";

export const SUPERVISOR_HOST = "127.0.0.1";
export const SUPERVISOR_PORT = 8790;
export const MANAGED_SERVICES = Object.freeze([
  { id: "frontend", label: "Frontend / Vite", url: "http://127.0.0.1:5173", port: 5173, healthPath: "/" },
  { id: "bridge-api", label: "Bridge + Operator API", url: "http://127.0.0.1:8787", port: 8787, healthPath: "/api/health" },
] as const);
export type ManagedServiceId = typeof MANAGED_SERVICES[number]["id"];
export type SupervisorCommand = "service.bridge-api.restart" | "runtime.restart-all" | "runtime.resume-save";
export interface ServiceRun { id: string; commandId: SupervisorCommand; command: string; startedAt: string; finishedAt: string | null;
  status: "running" | "completed" | "failed"; output: string; pid: number | null; url: string; phase: string; reloadReady: boolean;
  save?: { id: string; universe: string; tick: number; path: string; checksum: string } }
export interface SupervisorDependencies {
  spawn: typeof spawn; isPortOpen(port: number): Promise<boolean>;
  request(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  terminate(child: ChildProcess): Promise<void>; delay(ms: number): Promise<void>;
}

const portOpen = (port: number): Promise<boolean> => new Promise((resolve) => { const socket = net.createConnection({ host: SUPERVISOR_HOST, port });
  socket.setTimeout(300); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("timeout", () => { socket.destroy(); resolve(false); }); socket.once("error", () => resolve(false)); });
const terminateOwned = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return; child.kill("SIGINT");
  await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 4_000))]);
  if (child.exitCode === null && child.pid) {
    if (process.platform === "win32") await new Promise<void>((resolve) => { const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }); killer.once("exit", () => resolve()); killer.once("error", () => resolve()); });
    else child.kill("SIGKILL");
  }
};
const defaults: SupervisorDependencies = { spawn, isPortOpen: portOpen, request: fetch as SupervisorDependencies["request"], terminate: terminateOwned,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export class ServiceSupervisor {
  private readonly children = new Map<ManagedServiceId, ChildProcess>();
  private readonly runs: ServiceRun[] = [];
  private restartActive = false;
  constructor(readonly root = process.cwd(), readonly dependencies: SupervisorDependencies = defaults,
    readonly saveStates = new SaveStateStore(path.join(root, "data", "universes"))) {}
  list(): readonly ServiceRun[] { return [...this.runs].reverse().map((run) => ({ ...run, save: run.save && { ...run.save } })); }
  status() { return { services: MANAGED_SERVICES.map((service) => ({ ...service, owned: this.isOwned(service.id), pid: this.children.get(service.id)?.pid ?? null })),
    lastRestart: [...this.runs].reverse().find((run) => run.commandId === "runtime.restart-all" || run.commandId === "runtime.resume-save") ?? null }; }
  private isOwned(id: ManagedServiceId): boolean { const child = this.children.get(id); return Boolean(child && child.exitCode === null); }
  private record(commandId: SupervisorCommand, command: string): ServiceRun { const run: ServiceRun = { id: randomUUID(), commandId, command,
      startedAt: new Date().toISOString(), finishedAt: null, status: "running", output: "", pid: null, url: "", phase: "starting", reloadReady: false };
    this.runs.push(run); while (this.runs.length > 30) this.runs.shift(); this.append(run, `$ ${command}\n`); return run; }
  private append(run: ServiceRun, text: string): void { run.output = `${run.output}${new Date().toISOString()} ${text}`.slice(-180_000); }
  private serviceCommand(id: ManagedServiceId): { command: string; args: string[] } {
    if (id === "bridge-api") return { command: process.execPath, args: [path.join(this.root, "node_modules", "tsx", "dist", "cli.mjs"), path.join(this.root, "server", "index.ts")] };
    return { command: process.execPath, args: [path.join(this.root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1"] };
  }
  private spawnService(id: ManagedServiceId, env: NodeJS.ProcessEnv, run: ServiceRun): ChildProcess {
    if (this.isOwned(id)) throw new Error(`${id} is already supervisor-owned`); const service = MANAGED_SERVICES.find((item) => item.id === id)!;
    const invocation = this.serviceCommand(id), options: SpawnOptions = { cwd: this.root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
    const child = this.dependencies.spawn(invocation.command, invocation.args, options); this.children.set(id, child); this.append(run, `Starting ${service.label}... PID ${child.pid ?? "pending"}\n`);
    child.stdout?.on("data", (chunk) => this.append(run, `[${id}] ${chunk}`)); child.stderr?.on("data", (chunk) => this.append(run, `[${id}:stderr] ${chunk}`));
    child.once("exit", (code) => { if (this.children.get(id) === child) this.children.delete(id); this.append(run, `[${id}:exit] ${code}\n`); }); return child;
  }
  private async stopService(id: ManagedServiceId, run: ServiceRun): Promise<void> { const child = this.children.get(id); if (!child || child.exitCode !== null) return;
    this.append(run, `Stopping ${MANAGED_SERVICES.find((item) => item.id === id)!.label}... PID ${child.pid}\n`); await this.dependencies.terminate(child); this.children.delete(id); }
  private async waitPort(port: number, expected: boolean, attempts = 80): Promise<void> { for (let index = 0; index < attempts; index++) {
      if (await this.dependencies.isPortOpen(port) === expected) return; await this.dependencies.delay(100); } throw new Error(`Port ${port} did not become ${expected ? "healthy" : "available"}`); }
  private async waitServiceHealthy(id: ManagedServiceId, attempts = 80): Promise<void> {
    const service = MANAGED_SERVICES.find((item) => item.id === id)!;
    for (let index = 0; index < attempts; index++) {
      try {
        if (await this.dependencies.isPortOpen(service.port)) {
          const response = await this.dependencies.request(`${service.url}${service.healthPath}`);
          if (response.ok) {
            if (id === "frontend") return;
            const body = await response.json();
            if (body?.service === "bridge-api" && body?.ready === true) return;
          }
        }
      } catch { /* Service may be between bind and application readiness. */ }
      await this.dependencies.delay(100);
    }
    throw new Error(`${service.label} did not become application-ready`);
  }
  async startInitialStack(): Promise<ServiceRun> { const run = this.record("service.bridge-api.restart", "npm run dev");
    for (const service of MANAGED_SERVICES) if (!this.isOwned(service.id) && await this.dependencies.isPortOpen(service.port)) throw new Error(`${service.label} port is occupied by an unmanaged process`);
    this.spawnService("bridge-api", process.env, run); await this.waitServiceHealthy("bridge-api"); this.spawnService("frontend", process.env, run); await this.waitServiceHealthy("frontend");
    run.status = "completed"; run.phase = "healthy"; run.finishedAt = new Date().toISOString(); this.append(run, "Runtime stack healthy\n"); return { ...run };
  }
  async startOrRestart(action: unknown): Promise<ServiceRun> { if (action !== "service.bridge-api.restart") throw new Error("Service action is not allowlisted");
    const run = this.record(action, "npm run dev:bridge"); if (this.isOwned("bridge-api")) await this.stopService("bridge-api", run);
    else if (await this.dependencies.isPortOpen(8787)) throw new Error("Bridge/API port 8787 is occupied by an unmanaged process; refusing to terminate or replace it");
    const child = this.spawnService("bridge-api", process.env, run); run.pid = child.pid ?? null; run.url = "http://127.0.0.1:8787"; await this.waitServiceHealthy("bridge-api");
    run.status = "completed"; run.phase = "healthy"; run.finishedAt = new Date().toISOString(); this.append(run, "Bridge + Operator API ready\n"); return { ...run };
  }
  beginRestartAll(action: unknown): ServiceRun { if (action !== "runtime.restart-all") throw new Error("Runtime action is not allowlisted");
    if (this.restartActive) throw new Error("Restart Everything is already running"); const run = this.record(action, "Restart Everything (save → stop → resume)");
    this.restartActive = true; void this.restartAll(run).finally(() => { this.restartActive = false; }); return { ...run };
  }
  async listSaveStates(): Promise<{ universe: string; saves: SaveStateSummary[] }> {
    const status = await this.requestJson("http://127.0.0.1:8787/api/status");
    if (!status.connected || typeof status.seed !== "string") throw new Error("No authoritative universe is connected");
    return { universe: status.seed, saves: await this.saveStates.list(status.seed) };
  }
  beginResumeSave(action: unknown, saveId: unknown): ServiceRun {
    if (action !== "runtime.resume-save") throw new Error("Runtime action is not allowlisted");
    if (typeof saveId !== "string" || !/^save-[a-zA-Z0-9._-]{1,100}$/.test(saveId)) throw new Error("Invalid save-state ID");
    if (saveId.includes("/") || saveId.includes("\\") || saveId.includes("..")) throw new Error("Invalid save-state ID");
    if (this.restartActive) throw new Error("A runtime replacement is already running");
    const run = this.record(action, `Resume ${saveId}`); this.restartActive = true;
    void this.resumeSelected(run, saveId).finally(() => { this.restartActive = false; }); return { ...run };
  }
  private async requestJson(url: string, init?: RequestInit): Promise<any> { const response = await this.dependencies.request(url, init); const value = await response.json();
    if (!response.ok) throw new Error(value.message ?? value.error ?? `HTTP ${response.status}`); return value; }
  private async restartAll(run: ServiceRun): Promise<void> {
    await this.replaceRuntime(run, { kind: "save-current" });
  }
  private async resumeSelected(run: ServiceRun, saveId: string): Promise<void> {
    await this.replaceRuntime(run, { kind: "existing-save", saveId });
  }
  private async replaceRuntime(run: ServiceRun, source: { kind: "save-current" } | { kind: "existing-save"; saveId: string }): Promise<void> {
    try {
      let selected: { id: string; universe: string; tick: number; path: string; checksum: string };
      if (source.kind === "save-current") {
        run.phase = "saving"; this.append(run, "Saving current universe before restart...\n");
        const saved = await this.requestJson("http://127.0.0.1:8787/api/save-state", { method: "POST" });
        selected = { id: saved.id, universe: saved.universe, tick: saved.tick, path: path.resolve(saved.path), checksum: saved.checksum.value };
        this.append(run, `Saved ${saved.universe} at tick ${saved.tick}\nSave: ${saved.id}\nPath: ${saved.path}\nSHA-256: ${saved.checksum.value}\n`);
      } else {
        run.phase = "validating";
        const current = await this.requestJson("http://127.0.0.1:8787/api/status");
        if (!current.connected || typeof current.seed !== "string") throw new Error("No authoritative universe is connected");
        const artifact = await this.saveStates.load(source.saveId, current.seed);
        selected = { id: artifact.id, universe: artifact.universe, tick: artifact.tick,
          path: this.saveStates.file(current.seed, source.saveId), checksum: artifact.checksum.value };
        this.append(run, `Validated ${artifact.id} for ${artifact.universe} at tick ${artifact.tick}\n`);
      }
      run.save = selected;
      run.phase = "stopping-jobs"; this.append(run, "Stopping GUI-owned operator jobs...\n");
      await this.requestJson("http://127.0.0.1:8787/api/operator/stop-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      run.phase = "stopping-services"; await this.stopService("frontend", run); await this.stopService("bridge-api", run);
      await this.waitPort(5173, false); await this.waitPort(8787, false);
      const resumeEnv = { ...process.env, PROTOUNIVERSE_RESUME_SAVE: selected.path, VITE_PROTOUNIVERSE_RESUME: "1" };
      run.phase = "starting-services"; this.append(run, `${source.kind === "save-current" ? "Resuming" : "Loading"} ${selected.id}...\n`);
      this.spawnService("bridge-api", resumeEnv, run); await this.waitServiceHealthy("bridge-api");
      this.spawnService("frontend", resumeEnv, run); await this.waitServiceHealthy("frontend");
      run.reloadReady = true; run.phase = "awaiting-browser";
      this.append(run, "Frontend and Bridge/API healthy; browser reload requested\n");
      for (let attempt = 0; attempt < 300; attempt++) {
        try {
          const status = await this.requestJson("http://127.0.0.1:8787/api/status");
          const sourceMatches = source.kind === "save-current" || status.runtime?.sourceSaveId === selected.id;
          if (status.connected && status.seed === selected.universe && status.runtime?.mode === "resumed"
            && sourceMatches && status.runtime?.sourceSaveTick === selected.tick && status.currentTick >= selected.tick) {
            run.status = "completed"; run.phase = "healthy"; run.finishedAt = new Date().toISOString();
            this.append(run, source.kind === "save-current"
              ? `Runtime healthy\nUniverse ${selected.universe} resumed at tick ${status.currentTick}\nRestart complete\n`
              : `Universe ${selected.universe} resumed from tick ${selected.tick}\nRuntime healthy\nResume complete\n`);
            return;
          }
        } catch { /* Browser reconnect is expected to lag service health. */ }
        await this.dependencies.delay(200);
      }
      throw new Error(source.kind === "save-current"
        ? "Authoritative resumed browser runtime did not become healthy"
        : "Authoritative resumed browser runtime did not match the selected save");
    } catch (error) {
      run.status = "failed"; run.phase = "failed"; run.finishedAt = new Date().toISOString();
      this.append(run, `[failed] ${error instanceof Error ? error.message : error}\n`);
    }
  }
}
