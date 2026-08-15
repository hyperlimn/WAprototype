import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ChildProcess, spawn } from "node:child_process";
import { COMMAND_REGISTRY, formatRegistryHelp } from "../src/operator/commandRegistry.js";
import { OperatorManager, validateOperatorArguments } from "../server/operator/operatorManager.js";
import { ServiceSupervisor, SUPERVISOR_HOST, type SupervisorDependencies } from "../server/supervisor/serviceSupervisor.js";
import { createServer } from "node:http";
import { corsHeaders } from "../server/cors.js";
import type { SaveStateStore } from "../server/save-state/saveStateStore.js";

class FakeChild extends EventEmitter { stdout = new PassThrough(); stderr = new PassThrough(); pid = 1234; exitCode: number | null = null; kill() { return true; } }

test("CLI help and GUI consume the same registry and help is process-free", async () => {
  const helpSource = await readFile(path.resolve("scripts/help.ts"), "utf8"), guiSource = await readFile(path.resolve("src/ui/operatorConsole.ts"), "utf8");
  assert.match(helpSource, /formatRegistryHelp/); assert.match(guiSource, /formatRegistryHelp/); assert.match(formatRegistryHelp(), /Save current universe/);
  assert.match(guiSource, /\[starting\]/); assert.match(guiSource, /service\.bridge-api\.restart/); assert.match(guiSource, /renderRuns/);
  let spawned = 0; const manager = new OperatorManager(process.cwd(), (() => { spawned++; return new FakeChild() as unknown as ChildProcess; }) as typeof spawn);
  assert.throws(() => manager.start("help", {}), /not an approved executable/); assert.equal(spawned, 0);
});

test("allowlist and typed argument validation reject arbitrary commands and injection", () => {
  assert.throws(() => validateOperatorArguments("observer.once", { shell: "rm -rf" }), /Unsupported/);
  assert.throws(() => validateOperatorArguments("observer.once", { observer: "x; powershell" }), /Invalid observer/);
  assert.throws(() => validateOperatorArguments("lab.blind", { experiment: "../secret" }), /Invalid experiment/);
  const manager = new OperatorManager(); assert.throws(() => manager.start("powershell", {}), /not an approved/);
  assert.ok(COMMAND_REGISTRY.every((command) => !/shell|powershell|cmd|git\s/.test(command.cli)));
});

test("approved actions use existing scripts, stream status, and stop only owned runs", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [], children: FakeChild[] = [], stopped: ChildProcess[] = [];
  const fakeSpawn = ((command: string, args: readonly string[]) => { calls.push({ command, args }); const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess; }) as typeof spawn;
  const manager = new OperatorManager(process.cwd(), fakeSpawn, async (child) => { stopped.push(child); });
  const save = manager.start("universe.save", {}); assert.match(calls[0].args.join(" "), /universe-save\.mjs/);
  children[0].stdout.write("Saved U0 at tick 42\nPath: save.json\nSHA-256: abc\n"); children[0].emit("exit", 0, null);
  const savedRun = manager.list().find((run) => run.id === save.id); assert.equal(savedRun?.status, "completed"); assert.match(savedRun?.output ?? "", /tick 42[\s\S]*Path:[\s\S]*SHA-256/);
  const once = manager.start("observer.once", { observer: "gui-observer" }); assert.match(calls[1].args.join(" "), /observer-loop\.mjs --once/);
  const loop = manager.start("observer.loop", { observer: "gui-observer", interval: 5 }); assert.match(calls[2].args.join(" "), /observer-loop\.mjs/);
  const blind = manager.start("lab.blind", { experiment: "archaeology-005" }); assert.match(calls[3].args.join(" "), /lab-once\.mjs --experiment archaeology-005/);
  const reveal = manager.start("lab.reveal", { experiment: "archaeology-005" }); assert.match(calls[4].args.join(" "), /lab-reveal\.mjs --experiment archaeology-005/);
  await assert.rejects(() => manager.stop("not-owned"), /No stoppable GUI-owned/); await manager.stop(loop.id); assert.equal(stopped.length, 1);
  assert.ok([once, blind, reveal].every((run) => run.stoppable));
});

const response = (value: any, ok = true) => ({ ok, status: ok ? 200 : 409, json: async () => value });
test("loopback supervisor is allowlisted and never replaces an unmanaged bridge", async () => {
  assert.equal(SUPERVISOR_HOST, "127.0.0.1"); let spawned = 0;
  const dependencies: SupervisorDependencies = { spawn: (() => { spawned++; return new FakeChild() as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async () => true, request: async () => response({}), terminate: async () => {}, delay: async () => {} };
  const blocked = new ServiceSupervisor(process.cwd(), dependencies);
  await assert.rejects(() => blocked.startOrRestart("service.bridge-api.restart"), /unmanaged process/); assert.equal(spawned, 0);
  await assert.rejects(() => blocked.startOrRestart("powershell"), /not allowlisted/); assert.throws(() => blocked.beginRestartAll("cmd"), /not allowlisted/);
});

test("restart-all saves first, stops only owned services, resumes that save, and retains its log", async () => {
  const events: string[] = [], open = new Set<number>(), children = new Map<ChildProcess, number>(); let pid = 2000;
  const save = { id: "save-000000000777", universe: "U0-test", tick: 777, path: "data/universes/U0-test/save-states/save-000000000777.json",
    checksum: { algorithm: "sha256", value: "abc123" } }; const originalSave = JSON.stringify(save);
  const dependencies: SupervisorDependencies = {
    spawn: ((_command, rawArgs, rawOptions) => { const args = rawArgs as readonly string[]; const options = rawOptions as { env: NodeJS.ProcessEnv };
      const child = new FakeChild(); child.pid = ++pid; const port = args.some((arg) => arg.endsWith("index.ts")) ? 8787 : 5173;
      children.set(child as unknown as ChildProcess, port); open.add(port); events.push(`spawn:${port}:${options.env.PROTOUNIVERSE_RESUME_SAVE ?? "fresh"}`); return child as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async (port) => open.has(port),
    terminate: async (child) => { const port = children.get(child)!; events.push(`stop:${port}:${child.pid}`); open.delete(port); (child as unknown as FakeChild).exitCode = 0; (child as unknown as FakeChild).emit("exit", 0); },
    request: async (url) => { events.push(`request:${url}`); if (url.endsWith("/api/save-state")) return response(save);
      if (url.endsWith("/api/operator/stop-all")) return response({ stopped: ["owned-loop"] });
      return response({ connected: true, seed: save.universe, currentTick: save.tick + 1,
        runtime: { mode: "resumed", sourceSaveTick: save.tick } }); }, delay: async () => {},
  };
  const supervisor = new ServiceSupervisor(process.cwd(), dependencies); await supervisor.startInitialStack(); events.length = 0;
  const started = supervisor.beginRestartAll("runtime.restart-all");
  for (let attempt = 0; attempt < 100 && supervisor.list().find((run) => run.id === started.id)?.status === "running"; attempt++) await new Promise((resolve) => setImmediate(resolve));
  const finished = supervisor.list().find((run) => run.id === started.id)!; assert.equal(finished.status, "completed"); assert.equal(finished.reloadReady, true);
  assert.equal(events[0], "request:http://127.0.0.1:8787/api/save-state"); assert.ok(events.indexOf("request:http://127.0.0.1:8787/api/operator/stop-all") < events.findIndex((item) => item.startsWith("stop:")));
  assert.match(events.find((item) => item.startsWith("spawn:8787:")) ?? "", /save-000000000777\.json/); assert.equal(JSON.stringify(save), originalSave);
  assert.match(finished.output, /Saved U0-test at tick 777[\s\S]*Stopping Frontend[\s\S]*Resuming save-[\s\S]*Restart complete/);
  assert.equal(supervisor.list().find((run) => run.id === started.id)?.output, finished.output, "log survives client disconnection/reconnection");
});

test("failed save aborts restart before any owned PID is stopped", async () => {
  let stopped = 0; const open = new Set<number>();
  const dependencies: SupervisorDependencies = { spawn: ((_command, rawArgs) => { const args = rawArgs as readonly string[]; open.add(args.some((arg) => arg.endsWith("index.ts")) ? 8787 : 5173); return new FakeChild() as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async (port) => open.has(port), terminate: async () => { stopped++; }, delay: async () => {}, request: async () => response({ message: "save failed" }, false) };
  const supervisor = new ServiceSupervisor(process.cwd(), dependencies); await supervisor.startInitialStack(); const run = supervisor.beginRestartAll("runtime.restart-all");
  for (let attempt = 0; attempt < 20 && supervisor.list().find((item) => item.id === run.id)?.status === "running"; attempt++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.list().find((item) => item.id === run.id)?.status, "failed"); assert.equal(stopped, 0);
});

test("initial managed stack requires both Bridge/API and frontend health", async () => {
  let spawnCount = 0;
  const dependencies: SupervisorDependencies = {
    spawn: (() => { spawnCount++; return new FakeChild() as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async (port) => port === 8787 && spawnCount > 0,
    request: async () => response({}), terminate: async () => {}, delay: async () => {},
  };
  await assert.rejects(() => new ServiceSupervisor(process.cwd(), dependencies).startInitialStack(), /Port 5173 did not become healthy/);
});

test("selected-save resume resolves an ID internally, preserves the artifact, and retains its log", async () => {
  const events: string[] = [], open = new Set<number>(), children = new Map<ChildProcess, number>(); let pid = 3000, resumeStarted = false;
  const artifact = { id: "save-000000000321", universe: "U0-selected", tick: 321, createdAt: "2026-01-01T00:00:00.000Z",
    simulationVersion: "test", checksum: { algorithm: "sha256", value: "selectedhash" }, continuation: {} }; const frozen = JSON.stringify(artifact);
  const store = { file: (universe: string, id: string) => path.join("C:\\canonical", universe, `${id}.json`),
    load: async (id: string, universe: string) => { events.push(`load:${universe}:${id}`); return artifact; }, list: async () => [] } as unknown as SaveStateStore;
  const dependencies: SupervisorDependencies = {
    spawn: ((_command, rawArgs, rawOptions) => { const args = rawArgs as readonly string[], options = rawOptions as { env: NodeJS.ProcessEnv };
      const child = new FakeChild(); child.pid = ++pid; const port = args.some((arg) => arg.endsWith("index.ts")) ? 8787 : 5173;
      if (options.env.PROTOUNIVERSE_RESUME_SAVE) resumeStarted = true; children.set(child as unknown as ChildProcess, port); open.add(port); events.push(`spawn:${port}`); return child as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async (port) => open.has(port), delay: async () => {},
    terminate: async (child) => { const port = children.get(child)!; events.push(`stop:${port}:${child.pid}`); open.delete(port); (child as unknown as FakeChild).exitCode = 0; (child as unknown as FakeChild).emit("exit", 0); },
    request: async (url) => { if (url.endsWith("/api/operator/stop-all")) return response({ stopped: [] });
      return response(resumeStarted ? { connected: true, seed: artifact.universe, currentTick: 322,
        runtime: { mode: "resumed", sourceSaveId: artifact.id, sourceSaveTick: artifact.tick } } : { connected: true, seed: artifact.universe, currentTick: 900, runtime: { mode: "fresh" } }); },
  };
  const supervisor = new ServiceSupervisor(process.cwd(), dependencies, store); await supervisor.startInitialStack(); events.length = 0;
  assert.throws(() => supervisor.beginResumeSave("runtime.resume-save", "..\\secret.json"), /Invalid save-state ID/);
  const started = supervisor.beginResumeSave("runtime.resume-save", artifact.id);
  for (let attempt = 0; attempt < 100 && supervisor.list().find((run) => run.id === started.id)?.status === "running"; attempt++) await new Promise((resolve) => setImmediate(resolve));
  const finished = supervisor.list().find((run) => run.id === started.id)!; assert.equal(finished.status, "completed");
  assert.equal(events[0], `load:${artifact.universe}:${artifact.id}`); assert.ok(events.some((item) => item.startsWith("stop:5173:"))); assert.ok(events.some((item) => item.startsWith("stop:8787:")));
  assert.equal(JSON.stringify(artifact), frozen); assert.match(finished.output, /Loading save-000000000321[\s\S]*resumed from tick 321[\s\S]*Resume complete/);
  assert.equal(supervisor.list().find((run) => run.id === started.id)?.output, finished.output);
});

test("operator JSON preflight explicitly allows the Content-Type request header", async () => {
  const [bridgeSource, supervisorSource] = await Promise.all([readFile(path.resolve("server/index.ts"), "utf8"), readFile(path.resolve("server/supervisor/supervisorIndex.ts"), "utf8")]);
  assert.match(bridgeSource, /corsHeaders\("GET, POST, PATCH, OPTIONS"\)/); assert.match(supervisorSource, /corsHeaders\("GET, POST, OPTIONS"\)/);
  const server = createServer((_request, response) => { response.writeHead(204, corsHeaders("GET, POST, PATCH, OPTIONS")); response.end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/operator/run`, { method: "OPTIONS", headers: {
      Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
    } });
    assert.equal(response.status, 204); assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
