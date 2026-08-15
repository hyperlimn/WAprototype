import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  ObserverLoop,
  buildCodexCommand,
  parseArguments,
  validateObserver,
} from "../scripts/observer-loop.mjs";
import { buildLaboratoryCodexCommand } from "../scripts/lab-command.mjs";
import { createEmptyLaboratoryWorkspace, removeLaboratoryWorkspace } from "../scripts/lab-isolation.mjs";

const quietOutput = () => new Writable({ write(_chunk, _encoding, callback) { callback(); } });

function fakeChild(exitCode = 0, onStart = () => {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
    final(callback) {
      onStart(child);
      queueMicrotask(() => {
        child.exitCode = exitCode;
        child.emit("exit", exitCode, null);
      });
      callback();
    },
  });
  child.exitCode = null;
  child.killed = false;
  return child;
}

function hangingChild(onStart = () => {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
    final(callback) { onStart(child); callback(); },
  });
  child.exitCode = null;
  child.killed = false;
  return child;
}

async function temporaryWorkspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "observer-loop-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("parses defaults and interval configuration", () => {
  const defaults = parseArguments([]);
  assert.equal(defaults.observer, "codex-first-entry");
  assert.equal(defaults.intervalSeconds, 300);
  assert.equal(defaults.expeditionTimeoutSeconds, 3600);
  assert.equal(defaults.search, false);

  const configured = parseArguments(["--observer", "machine.2", "--interval", "0.25", "--expedition-timeout", "12.5", "--max-cycles", "3", "--search", "enabled"]);
  assert.equal(configured.observer, "machine.2");
  assert.equal(configured.intervalSeconds, 0.25);
  assert.equal(configured.maxCycles, 3);
  assert.equal(configured.expeditionTimeoutSeconds, 12.5);
  assert.equal(configured.search, true);
});

test("validates observer identities", () => {
  assert.equal(validateObserver("codex-first_entry.2"), "codex-first_entry.2");
  assert.throws(() => validateObserver("bad observer"), /observer must contain/);
  assert.throws(() => parseArguments(["--interval", "0"]), /intervalSeconds/);
  assert.throws(() => parseArguments(["--expedition-timeout", "0"]), /expeditionTimeoutSeconds/);
});

test("constructs a sandboxed, non-interactive Codex command", () => {
  const options = parseArguments(["--model", "test-model", "--search", "enabled", "--cwd", "."]);
  const command = buildCodexCommand(options, "win32");
  assert.equal(command.command, "codex.exe");
  assert.deepEqual(command.args.slice(0, 3), ["--search", "exec", "--ephemeral"]);
  assert.ok(!command.args.includes("--sandbox"));
  assert.ok(command.args.includes("--approve-for-me"));
  assert.ok(command.args.includes("--search"));
  assert.ok(!command.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(command.args.at(-1), "-");
});

test("constructs an isolated laboratory Codex command without an invalid normal-MCP override", () => {
  const command = buildLaboratoryCodexCommand({ id: "archaeology-001" }, "C:\\empty-stage", "C:\\instrument", "win32");
  assert.equal(command.command, "codex.exe");
  assert.ok(command.args.includes("--ignore-user-config"));
  assert.ok(command.args.includes("--ignore-rules"));
  assert.ok(command.args.includes("--skip-git-repo-check"));
  assert.deepEqual(command.args.slice(0, 4), ["--ask-for-approval", "never", "--sandbox", "read-only"]);
  for (const feature of ["shell_tool", "shell_snapshot", "apps", "browser_use", "computer_use", "view_image", "plugins", "skill_search"])
    assert.ok(command.args.some((value, index) => value === feature && command.args[index - 1] === "--disable"));
  assert.ok(!command.args.some((value, index) => value === "code_mode_host" && command.args[index - 1] === "--disable"),
    "code_mode_host must remain available to route the explicitly configured MCP tools");
  assert.ok(command.args.some((value) => value === "mcp_servers.protouniverse-lab.command=\"npm.cmd\""));
  assert.ok(command.args.some((value) => value.includes("mcp_servers.protouniverse-lab.args=") && value.includes("archaeology-001")));
  assert.ok(command.args.some((value) => value.includes("mcp_servers.protouniverse-lab.cwd=") && value.includes("instrument")));
  assert.equal(command.args[command.args.indexOf("--cd") + 1], "C:\\empty-stage");
  assert.ok(!command.args.some((value) => value.startsWith("mcp_servers.protouniverse.")));
  assert.ok(!command.args.includes("--approve-for-me"));
  assert.ok(!command.args.includes("--search"));
});

test("constructs reveal chamber command with phase, schema, and exact-output capture", () => {
  const command = buildLaboratoryCodexCommand({ id: "archaeology-002" }, "C:\\empty", "C:\\instrument", "win32",
    { phase: "reveal", outputSchemaFile: "C:\\schema.json", lastMessageFile: "C:\\last.json" });
  const mcpArgs = command.args.find((value) => value.startsWith("mcp_servers.protouniverse-lab.args="));
  assert.match(mcpArgs, /archaeology-002/); assert.match(mcpArgs, /reveal/);
  assert.equal(command.args[command.args.indexOf("--output-schema") + 1], "C:\\schema.json");
  assert.equal(command.args[command.args.indexOf("--output-last-message") + 1], "C:\\last.json");
});

test("laboratory stage is empty, contains no backstage paths, and is removed", async () => {
  const stage = await createEmptyLaboratoryWorkspace();
  const forbidden = ["README.md", "package.json", "src", "server", "data", ".git", "archaeology-001.json"];
  assert.deepEqual(await fs.readdir(stage), []);
  for (const name of forbidden) await assert.rejects(fs.access(path.join(stage, name)), { code: "ENOENT" });
  await removeLaboratoryWorkspace(stage);
  await assert.rejects(fs.access(stage), { code: "ENOENT" });
});

test("maxCycles serializes cycles and creates operational logs", async (t) => {
  const workingDirectory = await temporaryWorkspace(t);
  let active = 0;
  let maximumActive = 0;
  let spawnCount = 0;
  const loop = new ObserverLoop(
    parseArguments(["--cwd", workingDirectory, "--interval", "0.001", "--max-cycles", "3"]),
    {
      spawn: () => fakeChild(0, () => {
        spawnCount += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        queueMicrotask(() => { active -= 1; });
      }),
      delay: async () => true,
      output: quietOutput(),
      errorOutput: quietOutput(),
    },
  );
  await loop.run();
  assert.equal(spawnCount, 3);
  assert.equal(maximumActive, 1);

  const logDirectory = path.join(workingDirectory, "data", "observer-runs", "codex-first-entry");
  const files = await fs.readdir(logDirectory);
  assert.equal(files.filter((file) => file.endsWith(".json")).length, 3);
  assert.equal(files.filter((file) => file.endsWith(".log")).length, 3);
  const metadata = JSON.parse(await fs.readFile(path.join(logDirectory, files.find((file) => file.endsWith(".json"))), "utf8"));
  assert.equal(metadata.authoritativeUniverseState, false);
  assert.equal(metadata.observerMemoryEntry, false);
});

test("a failed cycle is logged and later cycles retry normally", async (t) => {
  const workingDirectory = await temporaryWorkspace(t);
  const exits = [7, 0];
  const loop = new ObserverLoop(
    parseArguments(["--cwd", workingDirectory, "--interval", "0.001", "--max-cycles", "2"]),
    {
      spawn: () => fakeChild(exits.shift()),
      delay: async () => true,
      output: quietOutput(),
      errorOutput: quietOutput(),
    },
  );
  await loop.run();
  const logDirectory = path.join(workingDirectory, "data", "observer-runs", "codex-first-entry");
  const metadataFiles = (await fs.readdir(logDirectory)).filter((file) => file.endsWith(".json")).sort();
  const records = await Promise.all(metadataFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(logDirectory, file), "utf8"))));
  assert.deepEqual(records.map((record) => record.succeeded), [false, true]);
});

test("an expedition timeout cleans up its owned tree, logs distinctly, and the loop recovers without overlap", async (t) => {
  const workingDirectory = await temporaryWorkspace(t);
  let spawnCount = 0;
  let active = 0;
  let maximumActive = 0;
  let terminateCount = 0;
  let fireTimeout;
  const stderrChunks = [];
  const loop = new ObserverLoop(
    parseArguments(["--cwd", workingDirectory, "--interval", "0.001", "--expedition-timeout", "10", "--max-cycles", "2"]),
    {
      spawn: () => {
        spawnCount += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (spawnCount === 2) return fakeChild(0, () => { active -= 1; });
        return hangingChild(() => queueMicrotask(() => fireTimeout()));
      },
      setTimeout: (callback) => { fireTimeout = callback; return 1; },
      clearTimeout: () => {},
      terminate: async (child) => {
        terminateCount += 1;
        child.killed = true;
        child.exitCode = 137;
        active -= 1;
        child.emit("exit", 137, null);
      },
      delay: async () => true,
      output: quietOutput(),
      errorOutput: new Writable({ write(chunk, _encoding, callback) { stderrChunks.push(String(chunk)); callback(); } }),
    },
  );
  await loop.run();
  assert.equal(spawnCount, 2);
  assert.equal(terminateCount, 1);
  assert.equal(maximumActive, 1);
  assert.match(stderrChunks.join(""), /expedition timeout after 10s/);

  const logDirectory = path.join(workingDirectory, "data", "observer-runs", "codex-first-entry");
  const records = await Promise.all((await fs.readdir(logDirectory)).filter((file) => file.endsWith(".json")).sort()
    .map(async (file) => JSON.parse(await fs.readFile(path.join(logDirectory, file), "utf8"))));
  assert.deepEqual(records.map((record) => record.completion), ["expedition-timeout", "codex-exit"]);
  assert.deepEqual(records.map((record) => record.succeeded), [false, true]);
  assert.equal(records[0].timedOut, true);
});

test("stop aborts the inter-cycle wait and prevents another cycle", async (t) => {
  const workingDirectory = await temporaryWorkspace(t);
  let enteredWait;
  const waiting = new Promise((resolve) => { enteredWait = resolve; });
  const loop = new ObserverLoop(
    parseArguments(["--cwd", workingDirectory, "--interval", "10", "--max-cycles", "2"]),
    {
      spawn: () => fakeChild(0),
      delay: (_milliseconds, signal) => new Promise((resolve) => {
        enteredWait();
        signal.addEventListener("abort", () => resolve(false), { once: true });
      }),
      output: quietOutput(),
      errorOutput: quietOutput(),
    },
  );
  const run = loop.run();
  await waiting;
  loop.stop("test stop");
  await run;
  assert.equal(loop.cycleNumber, 1);
});

test("stop terminates an active Codex child and waits for its exit", async (t) => {
  const workingDirectory = await temporaryWorkspace(t);
  let childStarted;
  const started = new Promise((resolve) => { childStarted = resolve; });
  let activeChild;
  let terminateCount = 0;
  const loop = new ObserverLoop(
    parseArguments(["--cwd", workingDirectory, "--max-cycles", "1"]),
    {
      spawn: () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new Writable({
          write(_chunk, _encoding, callback) { callback(); },
          final(callback) { childStarted(); callback(); },
        });
        child.exitCode = null;
        child.killed = false;
        activeChild = child;
        return child;
      },
      terminate: async (child) => {
        terminateCount += 1;
        child.killed = true;
        child.exitCode = 130;
        await new Promise((resolve) => setImmediate(resolve));
        child.emit("exit", 130, null);
      },
      output: quietOutput(),
      errorOutput: quietOutput(),
    },
  );
  const run = loop.run();
  await started;
  loop.stop("test active stop");
  assert.equal(terminateCount, 1);
  await run;
  assert.equal(activeChild.killed, true);
  assert.equal(terminateCount, 1);
  const logDirectory = path.join(workingDirectory, "data", "observer-runs", "codex-first-entry");
  const metadataFile = (await fs.readdir(logDirectory)).find((file) => file.endsWith(".json"));
  const metadata = JSON.parse(await fs.readFile(path.join(logDirectory, metadataFile), "utf8"));
  assert.equal(metadata.timedOut, false);
  assert.equal(metadata.completion, "codex-exit");
});
