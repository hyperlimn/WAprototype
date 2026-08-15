import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SaveStateStore } from "../server/save-state/saveStateStore.js";
import { Universe, SIMULATION_VERSION } from "../src/simulation/universe.js";
import { SAVE_STATE_SCHEMA_VERSION } from "../src/simulation/saveState.js";

const advance = (universe: Universe, ticks: number) => { for (let i = 0; i < ticks; i++) universe.step(); };
const meaningful = (universe: Universe) => universe.continuationState();

test("save and resume restores the complete continuation surface and deterministic future", () => {
  const uninterrupted = new Universe("save-determinism"); advance(uninterrupted, 950);
  const saved = uninterrupted.continuationState(), serialized = JSON.stringify(saved);
  assert.equal(saved.tick, 950); assert.equal(saved.state.ticks, 950); assert.equal(saved.entities.length, uninterrupted.entities.length);
  assert.deepEqual(saved.relationships, [...uninterrupted.relationshipLayer.entities.values()].sort((a, b) => a.id.localeCompare(b.id)));
  assert.ok(Number.isInteger(saved.randomState)); assert.ok(Array.isArray(saved.relationshipCandidates)); assert.ok(Array.isArray(saved.reproductionBirthTicks));
  const resumed = new Universe(saved.universe, JSON.parse(serialized)); assert.deepEqual(meaningful(resumed), saved);
  advance(uninterrupted, 125); advance(resumed, 125);
  assert.deepEqual(meaningful(resumed), meaningful(uninterrupted), "save/resume crosses the tick-1000 external arrival identically");
});

test("write-once artifacts validate checksum, remain unchanged on load/resume, and reject duplicates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-save-")); const store = new SaveStateStore(root);
  try {
    const universe = new Universe("artifact-test"); advance(universe, 25); const created = await store.create(universe.continuationState());
    const before = await readFile(created.file, "utf8"), loaded = await store.load(created.file); new Universe(loaded.universe, loaded.continuation);
    assert.equal(await readFile(created.file, "utf8"), before); await assert.rejects(() => store.create(universe.continuationState()), /not overwritten/);
    const malformed = path.join(root, "malformed.json"); await writeFile(malformed, JSON.stringify({ schemaVersion: SAVE_STATE_SCHEMA_VERSION }), "utf8");
    await assert.rejects(() => store.load(malformed), /Malformed/);
    const incompatible = JSON.parse(before); incompatible.continuation.simulationVersion = `${SIMULATION_VERSION}-other`;
    const bad = path.join(root, "incompatible.json"); await writeFile(bad, JSON.stringify(incompatible), "utf8");
    await assert.rejects(() => store.load(bad), /incompatible|checksum/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("save-state library is newest-first and marks corrupt artifacts unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-save-list-")), store = new SaveStateStore(root);
  try {
    const universe = new Universe("library-test"); advance(universe, 10); await store.create(universe.continuationState());
    advance(universe, 10); await store.create(universe.continuationState());
    const corrupt = store.file("library-test", "save-corrupt"); await writeFile(corrupt, "{not-json", "utf8");
    const saves = await store.list("library-test"); assert.deepEqual(saves.map((save) => save.id), ["save-000000000020", "save-000000000010", "save-corrupt"]);
    assert.ok(saves[0].resumable); assert.equal(saves[0].tick, 20); assert.equal(saves[0].checksum?.length, 64);
    assert.equal(saves[2].resumable, false); assert.equal(saves[2].compatibility, "invalid"); assert.equal(saves[2].checksum, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
