import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deterministicStateHash } from "../src/simulation/deterministicStateHash.js";
import { orderedBonds, orderedEntities, orderedRelationships } from "../src/simulation/deterministicOrdering.js";
import { SIMULATION_LAW_SET_VERSION, SIMULATION_SYSTEM_ORDER } from "../src/simulation/systemManifest.js";
import { Universe } from "../src/simulation/universe.js";
import { WORLD_STATE_FIELDS } from "../src/simulation/worldStateClassification.js";
import { buildWorldSnapshot } from "../src/interface/worldSnapshot.js";
import { StateStore } from "../server/stateStore.js";

const advance = (universe: Universe, ticks: number): void => { for (let index = 0; index < ticks; index++) universe.step(); };

test("every current WorldState field has an explicit architectural classification", () => {
  const universe = new Universe("classification-test");
  assert.deepEqual(Object.keys(WORLD_STATE_FIELDS).sort(), Object.keys(universe.state).sort());
  assert.ok(Object.values(WORLD_STATE_FIELDS).every((field) => field.description.length > 0));
});

test("system-order manifest matches the instrumented hand-wired step order", async () => {
  assert.equal(SIMULATION_LAW_SET_VERSION, "u0.6/system-order-1");
  const source = await readFile(new URL("../src/simulation/universe.ts", import.meta.url), "utf8");
  // Structural guard: markers intentionally bind the manifest to the hand-wired scheduler.
  let previous = -1;
  for (const id of SIMULATION_SYSTEM_ORDER) {
    const position = source.indexOf(`this.profiler.record("${id}"`);
    assert.ok(position > previous, `${id} must occur in documented order`);
    previous = position;
  }
  const universe = new Universe("system-order-test"); universe.step();
  assert.deepEqual(Object.keys(universe.profiler.snapshot().phases), [...SIMULATION_SYSTEM_ORDER]);
});

test("canonical ordering helpers are stable without mutating inputs", () => {
  const universe = new Universe("ordering-test"); advance(universe, 100);
  const entities = [...universe.entities].reverse(), relationships = [...universe.relationshipLayer.entities.values()].reverse();
  const bonds = new Map([...universe.bonds.entries()].reverse());
  assert.deepEqual(orderedEntities(entities).map((item) => item.creationIndex), universe.entities.map((item) => item.creationIndex));
  assert.deepEqual(orderedRelationships(relationships).map((item) => item.id), [...relationships].map((item) => item.id).sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(orderedBonds(bonds).map(([id]) => id), [...bonds.keys()].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(entities, [...universe.entities].reverse());
});

test("snapshot semantics remain deterministic and interface code has no UI dependency", async () => {
  const universe = new Universe("snapshot-foundation"); advance(universe, 250);
  const first = buildWorldSnapshot(universe), second = buildWorldSnapshot(universe);
  assert.deepEqual(second, first);
  assert.equal(first.metadata.currentTick, universe.state.ticks);
  assert.equal(first.entities.length, universe.entities.length);
  assert.equal(first.relationships.length, universe.relationshipLayer.entities.size);
  const source = await readFile(new URL("../src/interface/worldSnapshot.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']\.\.\/ui\//, "structural guard: observation must not depend on UI");
});

test("observation metrics remain outside canonical snapshots and authoritative continuation", () => {
  const universe = new Universe("metrics-foundation"); universe.step();
  const continuation = universe.continuationState() as unknown as Record<string, unknown>;
  assert.equal("profiler" in continuation, false);
  const snapshot = buildWorldSnapshot(universe), before = structuredClone(snapshot);
  const store = new StateStore(), metrics = { buildDurationMs: 4.5, serializedBytes: 1234, entityCount: snapshot.entities.length, relationshipCount: snapshot.relationships.length };
  store.updateSnapshot(snapshot, metrics, universe.profiler.snapshot());
  assert.deepEqual(snapshot, before);
  assert.deepEqual(store.lastObservationMetrics, metrics);
  assert.equal((store.lastSimulationTimings as { sampleIntervalSteps: number }).sampleIntervalSteps, 60);
});

test("golden deterministic state hashes and save/resume replay remain stable", () => {
  const expected = new Map<number, string>([
    [0, "f79dcd854ef740aa7f6347c0271c96ecf8f6b83f5b67293871ac82d32dc0a613"],
    [25, "afbd4d26269960425cc676662c63d160156890719111e64b59d3f75dcf595f80"],
    [250, "1dba143384f28558bca53bd0d721ac8d562bf54a4b0b780403f43eb0b3ed8755"],
    [1000, "1c7d86ba1194b42f9cf5ebdddab4bee2b66ca2eeb9d08ed21df8b1e39b4195b9"],
  ]);
  const actual = new Map<number, string>();
  for (const tick of expected.keys()) {
    const universe = new Universe("architecture-golden"); advance(universe, tick);
    actual.set(tick, deterministicStateHash(universe.continuationState()));
  }
  assert.deepEqual(actual, expected, "intentional law changes must deliberately update documented golden hashes");
  const uninterrupted = new Universe("architecture-resume"); advance(uninterrupted, 250);
  const saved = uninterrupted.continuationState();
  const operationallyDifferent = structuredClone(saved); operationallyDifferent.runtime.mode = "resumed";
  assert.equal(deterministicStateHash(operationallyDifferent), deterministicStateHash(saved), "runtime provenance is not universe evolution");
  const resumed = new Universe(uninterrupted.seed, structuredClone(saved));
  advance(uninterrupted, 125); advance(resumed, 125);
  assert.equal(deterministicStateHash(resumed.continuationState()), deterministicStateHash(uninterrupted.continuationState()));
});
