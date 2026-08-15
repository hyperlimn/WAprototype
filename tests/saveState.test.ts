import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SaveStateStore } from "../server/save-state/saveStateStore.js";
import { Universe, SIMULATION_VERSION } from "../src/simulation/universe.js";
import { LEGACY_SAVE_STATE_SCHEMA_VERSION, SAVE_STATE_SCHEMA_VERSION, type LegacyUniverseContinuationState } from "../src/simulation/saveState.js";
import { continuationHash } from "../server/save-state/saveStateStore.js";
import { assertCompatibleSaveProtocol } from "../server/save-state/saveProtocol.js";

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
    const hybrid = JSON.parse(before); hybrid.schemaVersion = LEGACY_SAVE_STATE_SCHEMA_VERSION;
    hybrid.checksum.value = continuationHash(hybrid.continuation);
    const hybridFile = path.join(root, "hybrid.json"); await writeFile(hybridFile, JSON.stringify(hybrid), "utf8");
    await assert.rejects(() => store.load(hybridFile), /Malformed/);
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

test("delete removes only a canonical selected save and rejects path input", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"protouniverse-save-delete-")),store=new SaveStateStore(root);
  try{const universe=new Universe("delete-test");advance(universe,10);const first=await store.create(universe.continuationState());advance(universe,10);const second=await store.create(universe.continuationState());
    await assert.rejects(()=>store.delete("delete-test","../secret.json"),/Invalid save-state ID/);await assert.rejects(()=>store.delete("../other",second.artifact.id),/Invalid save-state identifier/);
    const directoryTarget=store.file("delete-test","save-directory");await mkdir(directoryTarget);await assert.rejects(()=>store.delete("delete-test","save-directory"),/canonical save-state directory/);await rm(directoryTarget,{recursive:true});
    const deleted=await store.delete("delete-test",second.artifact.id);assert.equal(deleted.id,second.artifact.id);await assert.rejects(()=>access(second.file));assert.equal(await readFile(first.file,"utf8"),JSON.stringify(first.artifact,null,2));
    assert.deepEqual((await store.list("delete-test")).map(item=>item.id),[first.artifact.id]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("legacy artifact remains internally coherent, migrates at runtime, and its next save is v2", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-legacy-workflow-")), store = new SaveStateStore(root);
  try {
    const universe = new Universe("legacy-workflow"); advance(universe, 40);
    const current = universe.continuationState();
    const { lawEvolution: _lawEvolution, ...withoutLaw } = current;
    const legacy: LegacyUniverseContinuationState = { ...withoutLaw, schemaVersion: LEGACY_SAVE_STATE_SCHEMA_VERSION };
    const id = "save-000000000040", file = store.file(legacy.universe, id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ schemaVersion: LEGACY_SAVE_STATE_SCHEMA_VERSION, id, universe: legacy.universe, tick: legacy.tick,
      createdAt: "2026-01-01T00:00:00.000Z", simulationVersion: legacy.simulationVersion,
      checksum: { algorithm: "sha256", value: continuationHash(legacy) }, continuation: legacy }, null, 2), "utf8");
    const loaded = await store.load(id, legacy.universe);
    assert.equal(loaded.schemaVersion, LEGACY_SAVE_STATE_SCHEMA_VERSION);
    assert.equal(loaded.continuation.schemaVersion, LEGACY_SAVE_STATE_SCHEMA_VERSION, "store must not return a v1-envelope/v2-payload hybrid");
    const resumed = new Universe(loaded.universe, loaded.continuation); advance(resumed, 1);
    const next = await store.create(resumed.continuationState());
    assert.equal(next.artifact.schemaVersion, SAVE_STATE_SCHEMA_VERSION); assert.equal(next.artifact.continuation.schemaVersion, SAVE_STATE_SCHEMA_VERSION);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("save protocol rejects browser/bridge schema skew before requesting serialization", () => {
  const heartbeat = { interfaceVersion: "protouniverse-machine-interface/5", simulationVersion: SIMULATION_VERSION,
    seed: "protocol-test", currentTick: 10, entityCount: 20, saveStateSchemaVersion: SAVE_STATE_SCHEMA_VERSION };
  assert.doesNotThrow(() => assertCompatibleSaveProtocol(heartbeat));
  assert.throws(() => assertCompatibleSaveProtocol({ ...heartbeat, saveStateSchemaVersion: LEGACY_SAVE_STATE_SCHEMA_VERSION }), /does not match/);
  assert.throws(() => assertCompatibleSaveProtocol({ ...heartbeat, saveStateSchemaVersion: undefined }), /unknown/);
});
