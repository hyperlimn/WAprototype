#!/usr/bin/env node

import { spawn as nodeSpawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_OBSERVER = "codex-first-entry";
export const DEFAULT_INTERVAL_SECONDS = 300;
export const DEFAULT_EXPEDITION_TIMEOUT_SECONDS = 3600;
export const DEFAULT_MAX_LOGS = 100;

const OBSERVER_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkingDirectory = path.resolve(scriptDirectory, "..");

export function validateObserver(value) {
  if (typeof value !== "string" || !OBSERVER_PATTERN.test(value)) {
    throw new Error("observer must contain 1-80 letters, numbers, dots, underscores, or hyphens");
  }
  return value;
}

export function parsePositiveNumber(value, name, { integer = false, allowZero = false } = {}) {
  const parsed = Number(value);
  const validRange = allowZero ? parsed >= 0 : parsed > 0;
  if (!Number.isFinite(parsed) || !validRange || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"}${integer ? " integer" : " number"}`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    observer: DEFAULT_OBSERVER,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    expeditionTimeoutSeconds: DEFAULT_EXPEDITION_TIMEOUT_SECONDS,
    maxCycles: Infinity,
    codexModel: undefined,
    search: false,
    workingDirectory: defaultWorkingDirectory,
    promptFile: undefined,
    maxLogs: DEFAULT_MAX_LOGS,
  };

  const takeValue = (index, flag) => {
    if (index + 1 >= argv.length) throw new Error(`${flag} requires a value`);
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--once") options.maxCycles = 1;
    else if (flag === "--observer") options.observer = takeValue(index++, flag);
    else if (flag === "--interval" || flag === "--interval-seconds") options.intervalSeconds = takeValue(index++, flag);
    else if (flag === "--expedition-timeout") options.expeditionTimeoutSeconds = takeValue(index++, flag);
    else if (flag === "--max-cycles") options.maxCycles = takeValue(index++, flag);
    else if (flag === "--model" || flag === "--codex-model") options.codexModel = takeValue(index++, flag);
    else if (flag === "--search") {
      const candidate = argv[index + 1];
      if (candidate === "enabled" || candidate === "disabled") {
        options.search = candidate === "enabled";
        index += 1;
      } else options.search = true;
    }
    else if (flag === "--working-directory" || flag === "--cwd") options.workingDirectory = takeValue(index++, flag);
    else if (flag === "--prompt-file") options.promptFile = takeValue(index++, flag);
    else if (flag === "--max-logs") options.maxLogs = takeValue(index++, flag);
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown option: ${flag}`);
  }

  options.observer = validateObserver(options.observer);
  options.intervalSeconds = parsePositiveNumber(options.intervalSeconds, "intervalSeconds");
  options.expeditionTimeoutSeconds = parsePositiveNumber(options.expeditionTimeoutSeconds, "expeditionTimeoutSeconds");
  if (options.maxCycles !== Infinity) options.maxCycles = parsePositiveNumber(options.maxCycles, "maxCycles", { integer: true });
  options.maxLogs = parsePositiveNumber(options.maxLogs, "maxLogs", { integer: true });
  options.workingDirectory = path.resolve(options.workingDirectory);
  if (options.promptFile) options.promptFile = path.resolve(options.promptFile);
  return options;
}

export function buildPrompt(observer) {
  return `You are returning to ProtoUniverse as observer "${observer}".

Use the protouniverse MCP server. Begin with orient, explicitly passing observer "${observer}". Then recall the persistent Observer Memory for this same observer and universe.

Use that memory to understand where you left off, but do not assume old questions are still the most important. Continue your own self-guided inquiry into this evolving universe. Use any read-only ProtoUniverse faculties you find useful.

You may create, revise, resolve, or supersede your own observer-memory entries when useful. These observer-owned notebook operations are allowed; do not modify the universe itself, its laws, simulation code, runtime, archive, or authoritative history. Do not restart the universe, bridge, or MCP server. Do not mark observer position unless you independently determine there is a reason.

Follow your curiosity. Do not edit repository files, run unrelated shell commands, commit, push, or use cloud services beyond the installed Codex invocation itself. If ProtoUniverse or MCP is unavailable, report that concisely without attempting infrastructure changes.

When finished, leave concise, useful memory for your future self when warranted and produce a concise expedition report. Then exit cleanly.`;
}

export async function loadPrompt(options) {
  if (!options.promptFile) return buildPrompt(options.observer);
  const template = await fs.readFile(options.promptFile, "utf8");
  return template.replaceAll("{{observer}}", options.observer).replaceAll("<observer>", options.observer);
}

export function buildCodexCommand(options, platform = process.platform) {
  const command = platform === "win32" ? "codex.exe" : "codex";
  const args = [];
  if (options.search) args.push("--search");
  args.push("exec", "--ephemeral", "--color", "never", "--approve-for-me", "--cd", options.workingDirectory);
  if (options.codexModel) args.push("--model", options.codexModel);
  args.push("-");
  return { command, args };
}

export function createAbortableDelay(milliseconds, signal, timers = globalThis) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = timers.setTimeout(() => finish(true), milliseconds);
    const onAbort = () => finish(false);
    const finish = (completed) => {
      timers.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function terminateProcessTree(child, { graceMilliseconds = 5_000, spawnImpl = nodeSpawn } = {}) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawnImpl("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => killer.once("exit", resolve).once("error", resolve));
    return;
  }
  const signalTree = (signal) => {
    if (child.pid) {
      try { process.kill(-child.pid, signal); return; } catch {}
    }
    child.kill(signal);
  };
  signalTree("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, graceMilliseconds)),
  ]);
  if (child.exitCode === null) signalTree("SIGKILL");
}

async function rotateLogs(directory, maxLogs) {
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^cycle-.*\.(json|log)$/.test(entry.name))
    .map((entry) => entry.name);
  const cycleIds = [...new Set(entries.map((name) => name.replace(/\.(json|log)$/, "")))].sort().reverse();
  for (const cycleId of cycleIds.slice(maxLogs)) {
    await Promise.allSettled([fs.unlink(path.join(directory, `${cycleId}.json`)), fs.unlink(path.join(directory, `${cycleId}.log`))]);
  }
}

export class ObserverLoop {
  constructor(options, dependencies = {}) {
    this.options = options;
    this.spawn = dependencies.spawn ?? nodeSpawn;
    this.now = dependencies.now ?? (() => new Date());
    this.delay = dependencies.delay ?? createAbortableDelay;
    this.output = dependencies.output ?? process.stdout;
    this.errorOutput = dependencies.errorOutput ?? process.stderr;
    this.terminate = dependencies.terminate ?? terminateProcessTree;
    this.setTimeout = dependencies.setTimeout ?? globalThis.setTimeout;
    this.clearTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout;
    this.abortController = new AbortController();
    this.activeChild = null;
    this.cycleNumber = 0;
    this.termination = null;
  }

  terminateOwnedChild(child) {
    if (!child || child.exitCode !== null) return Promise.resolve();
    if (this.termination?.child === child) return this.termination.promise;
    const promise = Promise.resolve(this.terminate(child));
    this.termination = { child, promise };
    const clear = () => {
      if (this.termination?.child === child) this.termination = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  stop(reason = "shutdown requested") {
    if (this.abortController.signal.aborted) return;
    this.output.write(`\n[observer-loop] ${reason}; stopping cleanly...\n`);
    this.abortController.abort();
    if (this.activeChild) void this.terminateOwnedChild(this.activeChild);
  }

  async runCycle() {
    const cycle = ++this.cycleNumber;
    const startedAt = this.now();
    const logDirectory = path.join(this.options.workingDirectory, "data", "observer-runs", this.options.observer);
    await fs.mkdir(logDirectory, { recursive: true });
    const id = `cycle-${String(cycle).padStart(6, "0")}-${startedAt.toISOString().replaceAll(":", "-")}`;
    const logPath = path.join(logDirectory, `${id}.log`);
    const metadataPath = path.join(logDirectory, `${id}.json`);
    const stream = createWriteStream(logPath, { flags: "wx" });
    const prompt = await loadPrompt(this.options);
    const { command, args } = buildCodexCommand(this.options);

    this.output.write(`[observer-loop] cycle ${cycle} started ${startedAt.toISOString()} | observer=${this.options.observer}\n`);
    stream.write(`# ProtoUniverse observer expedition\n# cycle=${cycle} observer=${this.options.observer} startedAt=${startedAt.toISOString()}\n\n`);

    let exitCode = null;
    let signal = null;
    let launchError = null;
    let timedOut = false;
    try {
      const child = this.spawn(command, args, {
        cwd: this.options.workingDirectory,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      this.activeChild = child;
      child.stdout.on("data", (chunk) => { this.output.write(chunk); stream.write(chunk); });
      child.stderr.on("data", (chunk) => { this.errorOutput.write(chunk); stream.write(chunk); });
      const completion = new Promise((resolve) => {
        child.once("error", (error) => resolve({ error }));
        child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
      });
      child.stdin.end(prompt);
      let timeoutHandle;
      const timeout = new Promise((resolve) => {
        timeoutHandle = this.setTimeout(() => resolve({ timeout: true }), this.options.expeditionTimeoutSeconds * 1_000);
      });
      let result = await Promise.race([completion, timeout]);
      if (result.timeout) {
        timedOut = true;
        const timeoutMessage = `[observer-loop] cycle ${cycle} expedition timeout after ${this.options.expeditionTimeoutSeconds}s; terminating owned Codex process tree`;
        this.errorOutput.write(`${timeoutMessage}\n`);
        stream.write(`\n${timeoutMessage}\n`);
        await this.terminateOwnedChild(child);
        result = await completion;
      }
      this.clearTimeout(timeoutHandle);
      launchError = result.error ? String(result.error.stack ?? result.error) : null;
      exitCode = result.code ?? null;
      signal = result.signal ?? null;
    } catch (error) {
      launchError = String(error.stack ?? error);
      stream.write(`\n[observer-loop error]\n${launchError}\n`);
    } finally {
      this.activeChild = null;
    }

    const finishedAt = this.now();
    const succeeded = exitCode === 0 && !launchError && !timedOut;
    const metadata = {
      recordType: "operational-observer-loop-record",
      authoritativeUniverseState: false,
      observerMemoryEntry: false,
      cycle,
      observer: this.options.observer,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      exitCode,
      signal,
      succeeded,
      timedOut,
      completion: timedOut ? "expedition-timeout" : launchError ? "launch-error" : "codex-exit",
      expeditionTimeoutSeconds: this.options.expeditionTimeoutSeconds,
      error: launchError,
      command: { executable: command, args },
      logFile: path.basename(logPath),
    };
    await new Promise((resolve) => stream.end(resolve));
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await rotateLogs(logDirectory, this.options.maxLogs);
    this.output.write(`\n[observer-loop] cycle ${cycle} finished ${finishedAt.toISOString()} | completion=${metadata.completion} | Codex exit=${exitCode ?? signal ?? "launch-error"}\n`);
    return metadata;
  }

  async run() {
    let consecutiveFailures = 0;
    while (!this.abortController.signal.aborted && this.cycleNumber < this.options.maxCycles) {
      const result = await this.runCycle();
      consecutiveFailures = result.succeeded ? 0 : consecutiveFailures + 1;
      if (this.abortController.signal.aborted || this.cycleNumber >= this.options.maxCycles) break;
      const nextRun = new Date(this.now().getTime() + this.options.intervalSeconds * 1_000);
      this.output.write(`[observer-loop] next run ${nextRun.toISOString()} (in ${this.options.intervalSeconds}s) | consecutive failures=${consecutiveFailures}\n`);
      await this.delay(this.options.intervalSeconds * 1_000, this.abortController.signal);
    }
    this.output.write(`[observer-loop] stopped after ${this.cycleNumber} cycle(s)\n`);
  }
}

export function usage() {
  return `Usage: node scripts/observer-loop.mjs [options]

  --once                         Run one expedition and exit
  --observer <identity>          Default: ${DEFAULT_OBSERVER}
  --interval <seconds>           Delay after each completed cycle; default: ${DEFAULT_INTERVAL_SECONDS}
  --expedition-timeout <seconds> Maximum runtime per expedition; default: ${DEFAULT_EXPEDITION_TIMEOUT_SECONDS}
  --max-cycles <count>           Stop after this many cycles
  --model <model>                Override the configured Codex model
  --search [enabled|disabled]    Enable Codex web search; default: disabled
  --working-directory <path>     Codex working root and log root
  --prompt-file <path>           Custom prompt; {{observer}} is substituted
  --max-logs <count>             Retain this many cycle log pairs; default: ${DEFAULT_MAX_LOGS}
  --help                         Show this help`;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const loop = new ObserverLoop(options);
    const stop = (signal) => loop.stop(signal);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await loop.run();
  } catch (error) {
    process.stderr.write(`[observer-loop] ${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
