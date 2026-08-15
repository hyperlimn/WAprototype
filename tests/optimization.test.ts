import assert from "node:assert/strict";
import test from "node:test";
import { deterministicStateHash } from "../src/simulation/deterministicStateHash.js";
import { Universe } from "../src/simulation/universe.js";
import { buildWorldSnapshot } from "../src/interface/worldSnapshot.js";

const advance = (universe: Universe, ticks: number): void => { for (let index = 0; index < ticks; index++) universe.step(); };

test("Optimization v1 preserves the relationship-bearing fixed-seed continuation", () => {
  const universe = new Universe("optimization-v1-benchmark"); advance(universe, 5_000);
  assert.equal(universe.entities.length, 25);
  assert.equal(universe.relationshipLayer.entities.size, 2);
  assert.equal(deterministicStateHash(universe.continuationState()),
    "11ff2092cc52604cd43676fce8265c268ea5a437beeef9e6638498a707add967");
});

test("Optimization v1 caches and scratch work remain outside save-state continuation", () => {
  const uninterrupted = new Universe("optimization-v1-resume"); advance(uninterrupted, 1_100);
  const saved = uninterrupted.continuationState();
  assert.deepEqual(Object.keys(saved).sort(), ["bonds", "entities", "lawEvolution", "occurrences", "randomState", "relationshipCandidates",
    "relationships", "reproductionBirthTicks", "rupture", "runtime", "schemaVersion", "simulationVersion", "state", "tick", "universe"].sort());
  const resumed = new Universe(saved.universe, structuredClone(saved));
  advance(uninterrupted, 400); advance(resumed, 400);
  assert.equal(deterministicStateHash(resumed.continuationState()), deterministicStateHash(uninterrupted.continuationState()));
});

test("bounded snapshot selection matches the previous full-sort semantics", () => {
  const universe = new Universe("optimization-snapshot"); advance(universe, 5_000);
  const snapshot = buildWorldSnapshot(universe);
  const entities = [...universe.entities].sort((a, b) => a.creationIndex - b.creationIndex);
  const expectedEntities = new Map<number, typeof entities[number]>();
  const addEntities = (items: typeof entities): void => items.slice(0, 10).forEach((item) => expectedEntities.set(item.creationIndex, item));
  const entityTie = (a: typeof entities[number], b: typeof entities[number]) => a.creationIndex - b.creationIndex;
  const descending = <T>(select: (item: T) => number, tie: (a: T, b: T) => number) =>
    (a: T, b: T): number => select(b) - select(a) || tie(a, b);
  addEntities(entities); addEntities([...entities].sort((a, b) => b.creationIndex - a.creationIndex));
  addEntities([...entities].sort(descending((item) => item.energy, entityTie)));
  addEntities([...entities].sort(descending((item) => item.neighborCount, entityTie)));
  addEntities([...entities].sort(descending((item) => item.strongestBond, entityTie)));
  assert.deepEqual(snapshot.sampledEntities.map((item) => item.creationIndex), [...expectedEntities.keys()]);

  const relationships = [...universe.relationshipLayer.entities.values()];
  const expectedRelationships = new Map<string, typeof relationships[number]>();
  const addRelationships = (items: typeof relationships): void => items.slice(0, 10).forEach((item) => expectedRelationships.set(item.id, item));
  const relationshipTie = (a: typeof relationships[number], b: typeof relationships[number]) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  addRelationships([...relationships].sort(descending((item) => item.age, relationshipTie)));
  addRelationships([...relationships].sort(descending((item) => item.coherence, relationshipTie)));
  addRelationships([...relationships].sort(descending((item) => item.fieldSourceStrength, relationshipTie)));
  addRelationships([...relationships].sort(descending((item) => item.synergy, relationshipTie)));
  assert.deepEqual(snapshot.sampledRelationships.map((item) => item.id), [...expectedRelationships.keys()]);
});
