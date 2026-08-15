import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ChildProcess, spawn } from "node:child_process";
import { COMMAND_REGISTRY, formatRegistryHelp } from "../src/operator/commandRegistry.js";
import { OperatorManager, validateOperatorArguments } from "../server/operator/operatorManager.js";

class FakeChild extends EventEmitter { stdout = new PassThrough(); stderr = new PassThrough(); pid = 1234; exitCode: number | null = null; kill() { return true; } }

test("CLI help and GUI consume the same registry and help is process-free", async () => {
  const helpSource = await readFile(path.resolve("scripts/help.ts"), "utf8"), guiSource = await readFile(path.resolve("src/ui/operatorConsole.ts"), "utf8");
  assert.match(helpSource, /formatRegistryHelp/); assert.match(guiSource, /formatRegistryHelp/); assert.match(formatRegistryHelp(), /Save current universe/);
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
  children[0].stdout.write("saved tick 42\n"); children[0].emit("exit", 0, null); assert.equal(manager.list().find((run) => run.id === save.id)?.status, "completed");
  const once = manager.start("observer.once", { observer: "gui-observer" }); assert.match(calls[1].args.join(" "), /observer-loop\.mjs --once/);
  const loop = manager.start("observer.loop", { observer: "gui-observer", interval: 5 }); assert.match(calls[2].args.join(" "), /observer-loop\.mjs/);
  const blind = manager.start("lab.blind", { experiment: "archaeology-005" }); assert.match(calls[3].args.join(" "), /lab-once\.mjs --experiment archaeology-005/);
  const reveal = manager.start("lab.reveal", { experiment: "archaeology-005" }); assert.match(calls[4].args.join(" "), /lab-reveal\.mjs --experiment archaeology-005/);
  await assert.rejects(() => manager.stop("not-owned"), /No stoppable GUI-owned/); await manager.stop(loop.id); assert.equal(stopped.length, 1);
  assert.ok([once, blind, reveal].every((run) => run.stoppable));
});
