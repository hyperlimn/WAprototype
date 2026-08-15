import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { COMMAND_REGISTRY, formatRegistryHelp } from "../src/operator/commandRegistry.js";
import { OperatorManager, validateOperatorArguments } from "../server/operator/operatorManager.js";
import { ServiceSupervisor, SUPERVISOR_HOST, type SupervisorDependencies } from "../server/supervisor/serviceSupervisor.js";
import { createServer } from "node:http";
import { corsHeaders } from "../server/cors.js";
import type { SaveStateStore } from "../server/save-state/saveStateStore.js";
import { requestOperatorJson } from "../src/ui/operatorApi.js";
import { reverifyRepoProcess, staleRepoProcesses, terminateWindowsProcessTree, verifyRepoProcess, type RuntimeProcess } from "../server/supervisor/processOwnership.js";

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

test("same-repo runtime discovery classifies known entry points and ignores unrelated Node/Codex", () => {
  const root = process.cwd(), q = (suffix: string) => `node.exe "${path.join(root, suffix)}"`;
  const records: RuntimeProcess[] = [
    { pid: process.pid, parentPid: 1, commandLine: q("server/supervisor/supervisorIndex.ts") },
    { pid: 101, parentPid: 1, commandLine: q("server/index.ts") },
    { pid: 102, parentPid: 1, commandLine: q("node_modules/vite/bin/vite.js") },
    { pid: 103, parentPid: 1, commandLine: q("server/supervisor/supervisorIndex.ts") },
    { pid: 104, parentPid: 1, commandLine: "node.exe C:\\other-repo\\server\\index.ts" },
    { pid: 105, parentPid: 1, commandLine: `codex.exe ${q("server/index.ts")}` },
  ];
  assert.equal(verifyRepoProcess(root, records[1])?.kind, "bridge-api"); assert.equal(verifyRepoProcess(root, records[2])?.kind, "frontend");
  assert.deepEqual(staleRepoProcesses(root, records, new Set([process.pid])).map((item) => [item.pid, item.kind]),
    [[101, "bridge-api"], [102, "frontend"], [103, "supervisor"]]);
  assert.equal(verifyRepoProcess(root, records[4]), null); assert.equal(verifyRepoProcess(root, records[5]), null);
});

test("Restart Everything removes only reverified same-repo stale processes and proves a single stack", async () => {
  const root = process.cwd(), open = new Set<number>(), children = new Map<ChildProcess, number>(); let pid = 4000, resumeStarted = false;
  const stale = new Map<number, RuntimeProcess>([
    [5101, { pid: 5101, parentPid: 1, commandLine: `node.exe "${path.join(root, "server/index.ts")}"` }],
    [5102, { pid: 5102, parentPid: 1, commandLine: `node.exe "${path.join(root, "node_modules/vite/bin/vite.js")}"` }],
    [5103, { pid: 5103, parentPid: 1, commandLine: `node.exe "${path.join(root, "server/supervisor/supervisorIndex.ts")}"` }],
    [5199, { pid: 5199, parentPid: 1, commandLine: "node.exe C:\\unrelated\\worker.js" }],
  ]); const terminated: number[] = [];
  const saved = { id: "save-000000000888", universe: "U0-hardening", tick: 888, path: path.join(root, "tmp-save.json"), checksum: { value: "hash" } };
  const dependencies: SupervisorDependencies = {
    spawn: ((_command, rawArgs, rawOptions) => { const args = rawArgs as readonly string[], options = rawOptions as { env: NodeJS.ProcessEnv };
      const child = new FakeChild(); child.pid = ++pid; const port = args.some((arg) => arg.endsWith("index.ts")) ? 8787 : 5173;
      open.add(port); children.set(child as unknown as ChildProcess, port); if (options.env.PROTOUNIVERSE_RESUME_SAVE) resumeStarted = true; return child as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async (port) => open.has(port), delay: async () => {},
    terminate: async (child) => { const port = children.get(child)!; open.delete(port); (child as unknown as FakeChild).exitCode = 0; (child as unknown as FakeChild).emit("exit", 0); },
    listProcesses: async () => [...stale.values()], terminateProcessTree: async (target) => { terminated.push(target); stale.delete(target); },
    request: async (url) => url.endsWith("/api/save-state") ? response(saved) : url.endsWith("/api/health") ? response({ service: "bridge-api", ready: true })
      : url.endsWith("/api/operator/stop-all") ? response({ stopped: [] }) : response(resumeStarted
        ? { connected: true, seed: saved.universe, currentTick: 889, runtime: { mode: "resumed", sourceSaveTick: saved.tick } }
        : { connected: true, seed: saved.universe, currentTick: saved.tick, runtime: { mode: "fresh" } }),
  };
  const supervisor = new ServiceSupervisor(root, dependencies); await supervisor.startInitialStack(); const started = supervisor.beginRestartAll("runtime.restart-all");
  for (let attempt = 0; attempt < 100 && supervisor.list().find((run) => run.id === started.id)?.status === "running"; attempt++) await new Promise((resolve) => setImmediate(resolve));
  const run = supervisor.list().find((item) => item.id === started.id)!; assert.equal(run.status, "completed");
  assert.deepEqual(terminated.sort(), [5101, 5102, 5103]); assert.ok(stale.has(5199)); assert.match(run.output, /Scanning for stale[\s\S]*Single-instance verification passed/);
});

test("stale cleanup rejects PID reuse when command identity changes", async () => {
  const root = process.cwd(), original = verifyRepoProcess(root, { pid: 7001, parentPid: 1, commandLine: `node.exe "${path.join(root, "server/index.ts")}"` })!;
  assert.ok(reverifyRepoProcess(root, original, { ...original }));
  assert.equal(reverifyRepoProcess(root, original, { pid: 7001, parentPid: 1, commandLine: "node.exe C:\\unrelated\\server\\index.ts" }), null);
  assert.equal(reverifyRepoProcess(root, original, { ...original, commandLine: `node.exe "${path.join(root, "node_modules/vite/bin/vite.js")}"` }), null);
});

test("Windows process-tree cleanup removes a verified isolated duplicate and leaves an unrelated child alive", { skip: process.platform !== "win32" }, async () => {
  const duplicate = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", path.join(process.cwd(), "server/index.ts")], { windowsHide: true });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "C:\\isolated-unrelated\\worker.js"], { windowsHide: true });
  try {
    assert.ok(duplicate.pid && unrelated.pid); const duplicateRecord = { pid: duplicate.pid, parentPid: process.pid, commandLine: duplicate.spawnargs.join(" ") };
    const unrelatedRecord = { pid: unrelated.pid, parentPid: process.pid, commandLine: unrelated.spawnargs.join(" ") };
    assert.equal(verifyRepoProcess(process.cwd(), duplicateRecord)?.kind, "bridge-api"); assert.equal(verifyRepoProcess(process.cwd(), unrelatedRecord), null);
    const exited = new Promise<void>((resolve) => duplicate.once("exit", () => resolve())); await terminateWindowsProcessTree(duplicate.pid); await exited;
    assert.equal(unrelated.exitCode, null);
  } finally {
    if (duplicate.exitCode === null) duplicate.kill(); if (unrelated.exitCode === null) unrelated.kill();
  }
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
    request: async (url) => { events.push(`request:${url}`); if (url.endsWith("/api/health")) return response({ service: "bridge-api", ready: true });
      if (url.endsWith("/api/save-state")) return response(save);
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
    isPortOpen: async (port) => open.has(port), terminate: async () => { stopped++; }, delay: async () => {},
    request: async (url) => url.endsWith("/api/health") ? response({ service: "bridge-api", ready: true }) : url === "http://127.0.0.1:5173/" ? response({}) : response({ message: "save failed" }, false) };
  const supervisor = new ServiceSupervisor(process.cwd(), dependencies); await supervisor.startInitialStack(); const run = supervisor.beginRestartAll("runtime.restart-all");
  for (let attempt = 0; attempt < 20 && supervisor.list().find((item) => item.id === run.id)?.status === "running"; attempt++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.list().find((item) => item.id === run.id)?.status, "failed"); assert.equal(stopped, 0);
});

test("initial managed stack requires semantic Bridge/API health and frontend HTTP readiness", async () => {
  let spawnCount = 0;
  const dependencies: SupervisorDependencies = {
    spawn: (() => { spawnCount++; return new FakeChild() as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async (port) => port === 8787 && spawnCount > 0,
    request: async (url) => url.endsWith("/api/health") ? response({ service: "bridge-api", ready: true }) : response({}), terminate: async () => {}, delay: async () => {},
  };
  await assert.rejects(() => new ServiceSupervisor(process.cwd(), dependencies).startInitialStack(), /Frontend \/ Vite did not become application-ready/);
});

test("an open Bridge/API port without semantic readiness is rejected", async () => {
  let spawned = false;
  const dependencies: SupervisorDependencies = {
    spawn: (() => { spawned = true; return new FakeChild() as unknown as ChildProcess; }) as typeof spawn,
    isPortOpen: async () => spawned,
    request: async () => response({ service: "bridge-api", ready: false }),
    terminate: async () => {}, delay: async () => {},
  };
  const supervisor = new ServiceSupervisor(process.cwd(), dependencies);
  await assert.rejects(() => supervisor.startInitialStack(), /Bridge \+ Operator API did not become application-ready/);
  assert.equal(supervisor.list()[0].status, "failed", "failed startup must not remain reported as running");
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
    request: async (url) => { if (url.endsWith("/api/health")) return response({ service: "bridge-api", ready: true });
      if (url.endsWith("/api/operator/stop-all")) return response({ stopped: [] });
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

test("selected-save deletion is ID-only, preserves other saves, and refuses the active resume source", async () => {
  const deleted:string[]=[], artifact={id:"save-000000000111",universe:"U0-delete",tick:111,createdAt:"2026-01-01T00:00:00.000Z",simulationVersion:"test",checksum:{algorithm:"sha256",value:"hash"},continuation:{}};
  const store={delete:async(universe:string,id:string)=>{deleted.push(`${universe}:${id}`);return{id,universe,tick:111,createdAt:artifact.createdAt,checksum:"hash",simulationVersion:"test",resumable:true,compatibility:"compatible",reason:null};},list:async()=>[],load:async()=>artifact,file:()=>"canonical"} as unknown as SaveStateStore;
  let activeSource:string|null=null;const dependencies:SupervisorDependencies={spawn:(()=>new FakeChild() as unknown as ChildProcess) as typeof spawn,isPortOpen:async()=>false,terminate:async()=>{},delay:async()=>{},
    request:async()=>response({connected:true,seed:artifact.universe,currentTick:900,runtime:activeSource?{mode:"resumed",sourceSaveId:activeSource}:{mode:"fresh"}})};
  const supervisor=new ServiceSupervisor(process.cwd(),dependencies,store);
  await assert.rejects(()=>supervisor.deleteSave("universe.delete-save","../secret.json"),/Invalid save-state ID/);assert.equal(deleted.length,0);
  const completed=await supervisor.deleteSave("universe.delete-save",artifact.id);assert.equal(completed.status,"completed");assert.deepEqual(deleted,[`${artifact.universe}:${artifact.id}`]);assert.match(completed.output,/Delete save-[\s\S]*Deleted save-[\s\S]*Save library refreshed/);
  activeSource=artifact.id;const refused=await supervisor.deleteSave("universe.delete-save",artifact.id);assert.equal(refused.status,"failed");assert.match(refused.output,/active runtime continuation source/);assert.equal(deleted.length,1);
});

test("Save Library exposes selectable copyable details, horizontal overflow, confirmation, and refresh-after-delete",async()=>{
  const [html,css,ui]=await Promise.all([readFile(path.resolve("index.html"),"utf8"),readFile(path.resolve("src/style.css"),"utf8"),readFile(path.resolve("src/ui/operatorConsole.ts"),"utf8")]);
  assert.match(html,/id="operatorSaveDetails"[^>]*tabindex="0"/);assert.match(html,/id="operatorCopySave"/);assert.match(html,/id="operatorDeleteSave"/);
  assert.match(css,/\.save-state-scroll[^}]*overflow-x: auto/);assert.match(css,/\.save-state-details[^}]*user-select: text/);assert.match(css,/white-space: pre/);
  assert.match(ui,/confirm\(`Delete \$\{save\.id\}/);assert.match(ui,/commandId: definition\.id, saveId: save\.id/);assert.match(ui,/await loadSaves\(\)/);assert.match(ui,/navigator\.clipboard\.writeText\(saveDetails\.textContent/);
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

test("GUI API errors distinguish transport, validation, and server failures", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new TypeError("connection refused"); }) as typeof fetch;
    await assert.rejects(() => requestOperatorJson("http://127.0.0.1:8790/api/supervisor", "/run", "supervisor"), /Supervisor transport unavailable: connection refused/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "save_schema_mismatch", message: "browser is v1; bridge is v2" }),
      { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    await assert.rejects(() => requestOperatorJson("http://127.0.0.1:8787/api/operator", "/run", "bridge"), /Bridge\/API 409: browser is v1; bridge is v2/);
    globalThis.fetch = (async () => new Response("not-json", { status: 502 })) as typeof fetch;
    await assert.rejects(() => requestOperatorJson("http://127.0.0.1:8790/api/supervisor", "/run", "supervisor"), /invalid HTTP 502 response/);
  } finally { globalThis.fetch = original; }
});

test("completed GUI save triggers an immediate Save-State Library refresh", async () => {
  const source = await readFile(path.resolve("src/ui/operatorConsole.ts"), "utf8");
  assert.match(source, /run\.commandId === "universe\.save" && run\.status === "completed"/);
  assert.match(source, /void loadSaves\(\)\.catch/);
});
