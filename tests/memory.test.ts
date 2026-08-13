import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MemoryPolicy } from "../src/memory/memoryPolicy.js";
import type { OccurrenceRecord } from "../src/query/queryTypes.js";
import type { CanonicalSnapshot } from "../server/types.js";
import { MemoryStore } from "../server/memory/memoryStore.js";
import { listUniverses } from "../server/memory/universeCatalog.js";
import { resolveUniverse } from "../server/memory/archiveSelection.js";
import { findNearestCheckpoint, listCheckpoints, queryHistoryPage } from "../server/memory/archiveQueries.js";
import type { EntityRecord, RelationshipRecord } from "../src/query/queryTypes.js";
import { orientUniverse } from "../src/perception/orientation.js";
import { inspectTarget } from "../src/perception/inspection.js";
import { findAnomalies } from "../src/perception/anomalyDetection.js";
import { findSimilarEntity } from "../src/perception/similarity.js";
import { compareEntities, compareUniverses } from "../src/perception/comparison.js";
import { detectChanges } from "../src/perception/changeDetection.js";
import { ObserverStore } from "../server/perception/observerStore.js";

const identity = { seed: "test-seed", simulationVersion: "u0.6", interfaceVersion: "protouniverse-machine-interface/5" };
const complete: MemoryPolicy = { mode: "complete", checkpointIntervalTicks: 25_000, segmentMaxEvents: 2,
  recentDetailTicks: 100_000, condensedEraTicks: 100_000 };
const event = (sequence: number, tick: number, type = "rupture", extra: Partial<OccurrenceRecord> = {}): OccurrenceRecord => ({
  sequence, tick, type, description: `${type}-${sequence}`, x: sequence, y: tick, ...extra,
});
const snapshot = (tick: number): CanonicalSnapshot => ({ metadata: { currentTick: tick, seed: identity.seed, simulationVersion: identity.simulationVersion },
  entities: [], relationships: [], recentOccurrences: [] });

const entity = (id: number, overrides: Partial<EntityRecord> = {}): EntityRecord => ({ id, creationIndex: id, fingerprint: `e${id}`, origin: id < 2 ? "initial" : "reproduction",
  birthTick: id * 10, parentRelationshipId: id < 2 ? null : "r0", parentEntityIds: id < 2 ? null : [0, 1], alpha: 1, beta: 1, gamma: 1,
  x: id * 10, y: id * 5, vx: id, vy: id / 2, energy: id + 1, age: 100 - id, neighborCount: id,
  strongestRelationship: id / 10, strongestBond: id / 20, currentRelationshipIds: id < 2 ? ["r0"] : [], ...overrides });
const relationship = (id: string, overrides: Partial<RelationshipRecord> = {}): RelationshipRecord => ({ id, fingerprint: id, parentAId: 0, parentBId: 1,
  creationTick: 10, age: 90, spatialActive: true, influenceActive: true, bondStrength: .8, relationshipStrength: .9,
  x: 5, y: 2.5, coherence: .9, localRelationshipDensity: 2, synergy: .6, localFieldPotential: .2, ruptureQualified: false, ...overrides });
const richSnapshot = (tick = 100): CanonicalSnapshot => ({ ...snapshot(tick), entities: [entity(0), entity(1), entity(2), entity(3, { neighborCount: 100, energy: 50 })],
  relationships: [relationship("r0"), relationship("r1", { parentAId: 2, parentBId: 3, x: 25, y: 12, coherence: .2, synergy: .05, localRelationshipDensity: 20 })] });

async function fixture(policy = complete): Promise<{ root: string; store: MemoryStore; close: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-memory-"));
  const store = new MemoryStore(root, policy); await store.setIdentity(identity);
  return { root, store, close: () => rm(root, { recursive: true, force: true }) };
}

test("complete mode deduplicates events, rolls segments, filters history, and updates manifest", async () => {
  const value = await fixture();
  try {
    const events = [event(1, 100, "reproduction", { entityId: 7, relationshipId: "r1", parentEntityIds: [1, 2] }),
      event(2, 200, "rupture", { relationshipId: "r2" }), event(3, 300, "relationship-formed", { entityId: 7, relationshipId: "r3" })];
    await value.store.ingestEvents(events, identity); await value.store.ingestEvents([events[0]], identity);
    const status = await value.store.status(0);
    assert.equal(status.mode, "complete"); assert.equal(status.persistedEventCount, 3); assert.equal(status.segmentCount, 2);
    assert.deepEqual((await value.store.queryHistory({ sinceTick: 150, untilTick: 250, limit: 10 })).results.map((item) => item.sequence), [2]);
    assert.deepEqual((await value.store.queryHistory({ type: "reproduction", limit: 10 })).results.map((item) => item.sequence), [1]);
    assert.equal((await value.store.queryHistory({ entityId: 7, limit: 10 })).results.length, 2);
    assert.equal((await value.store.queryHistory({ relationshipId: "r2", limit: 10 })).results.length, 1);
    const manifest = JSON.parse(await readFile(path.join(value.root, "universes", identity.seed, "manifest.json"), "utf8"));
    assert.equal(manifest.eventCount, 3); assert.equal(manifest.segmentCount, 2); assert.equal(manifest.latestTick, 300);
  } finally { await value.close(); }
});

test("checkpoint boundaries deduplicate and canonical snapshots are never mutated", async () => {
  const value = await fixture();
  try {
    const observed = snapshot(25_100); const before = JSON.stringify(observed); Object.freeze(observed.metadata); Object.freeze(observed);
    await value.store.ingestSnapshot(observed, identity); await value.store.ingestSnapshot(observed, identity);
    assert.equal((await value.store.checkpoints()).length, 1); assert.equal(JSON.stringify(observed), before);
    await value.store.ingestSnapshot(snapshot(49_999), identity); assert.equal((await value.store.checkpoints()).length, 1);
    await value.store.ingestSnapshot(snapshot(50_001), identity); assert.equal((await value.store.checkpoints()).length, 2);
    assert.equal((await value.store.checkpoint(25_100))?.snapshot.metadata.currentTick, 25_100);
  } finally { await value.close(); }
});

test("condensed mode writes deterministic summaries while retaining provenance and archive segments", async () => {
  const policy: MemoryPolicy = { ...complete, mode: "condensed", recentDetailTicks: 100, condensedEraTicks: 100, segmentMaxEvents: 2 };
  const value = await fixture(policy);
  try {
    await value.store.ingestEvents([event(1, 10, "reproduction"), event(2, 20, "rupture"),
      event(3, 250, "relationship-formed"), event(4, 260, "rupture")], identity);
    const summary = await value.store.historySummary();
    const eras = summary.condensedEras as Array<{ sourceSegmentReferences: string[]; births: number; ruptures: number }>;
    assert.equal(eras.length, 1); assert.equal(eras[0].births, 1); assert.equal(eras[0].ruptures, 1);
    assert.deepEqual(eras[0].sourceSegmentReferences, ["events/events-000001.jsonl"]);
    assert.equal((await value.store.queryHistory({ limit: 10 })).results.length, 4, "condensation retains original archive");
  } finally { await value.close(); }
});

test("malformed persisted records fail safely", async () => {
  const value = await fixture();
  try {
    await value.store.ingestEvents([event(1, 10)], identity);
    const file = path.join(value.root, "universes", identity.seed, "events", "events-000001.jsonl");
    await writeFile(file, `${await readFile(file, "utf8")}{malformed}\n`, "utf8");
    const result = await value.store.queryHistory({ limit: 10 });
    assert.equal(result.results.length, 1); assert.equal(result.malformedRecordCount, 1);
  } finally { await value.close(); }
});

test("catalog lists multiple validated archives and isolates malformed manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-catalog-"));
  try {
    const first = new MemoryStore(root, complete), second = new MemoryStore(root, complete);
    const other = { ...identity, seed: "other-seed" };
    await first.ingestEvents([event(1, 10)], identity); await second.ingestEvents([event(2, 20)], other);
    const broken = path.join(root, "universes", "broken"); await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, "manifest.json"), "{broken", "utf8");
    const catalog = await listUniverses(root);
    assert.deepEqual(catalog.universes.map((item) => item.manifest.seed), ["other-seed", "test-seed"]);
    assert.equal(catalog.warnings.length, 1); assert.equal(resolveUniverse(catalog, "other-seed", null).manifest.eventCount, 1);
    assert.throws(() => resolveUniverse(catalog, "missing", "test-seed"));
    assert.equal(resolveUniverse(catalog, undefined, "test-seed").manifest.seed, "test-seed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cursor pages are continuous and reject malformed, filter-mismatched, and seed-mismatched cursors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-cursor-"));
  try {
    const store = new MemoryStore(root, complete);
    await store.ingestEvents(Array.from({ length: 7 }, (_, index) => event(index + 1, (index + 1) * 10,
      index % 2 ? "reproduction" : "rupture", { entityId: 5, relationshipId: "shared" })), identity);
    const archive = resolveUniverse(await listUniverses(root), identity.seed, null);
    const seen: number[] = []; let cursor: string | undefined;
    do {
      const page = await queryHistoryPage(archive, { limit: 2 }, cursor); seen.push(...page.results.map((item) => item.sequence));
      cursor = page.nextCursor ?? undefined;
      if (!page.hasMore) break;
    } while (true);
    assert.deepEqual(seen, [7, 6, 5, 4, 3, 2, 1]); assert.equal(new Set(seen).size, seen.length);
    const first = await queryHistoryPage(archive, { entityId: 5, limit: 2 });
    assert.ok(first.nextCursor); assert.equal((await queryHistoryPage(archive, { entityId: 5, limit: 2 }, first.nextCursor!)).results.length, 2);
    const relationship = await queryHistoryPage(archive, { relationshipId: "shared", limit: 3 });
    assert.equal(relationship.results.length, 3); assert.ok(relationship.nextCursor);
    await assert.rejects(() => queryHistoryPage(archive, { type: "rupture", limit: 2 }, first.nextCursor!));
    await assert.rejects(() => queryHistoryPage(archive, { limit: 2 }, "not-a-cursor"));
    const otherStore = new MemoryStore(root, complete), other = { ...identity, seed: "cursor-other" };
    await otherStore.ingestEvents([event(1, 1)], other);
    const otherArchive = resolveUniverse(await listUniverses(root), other.seed, null);
    await assert.rejects(() => queryHistoryPage(otherArchive, { entityId: 5, limit: 2 }, first.nextCursor!));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("checkpoint ranges and nearest directions navigate fossils deterministically", async () => {
  const value = await fixture();
  try {
    for (const tick of [25_100, 50_100, 75_100]) await value.store.ingestSnapshot(snapshot(tick), identity);
    const archive = resolveUniverse(await listUniverses(value.root), identity.seed, null);
    assert.deepEqual(listCheckpoints(archive, 30_000, 70_000, 10).map((item) => item.tick), [50_100]);
    assert.equal((await findNearestCheckpoint(archive, 60_000, "before"))?.metadata.tick, 50_100);
    assert.equal((await findNearestCheckpoint(archive, 60_000, "after"))?.metadata.tick, 75_100);
    assert.equal((await findNearestCheckpoint(archive, 60_000, "nearest"))?.metadata.tick, 50_100);
  } finally { await value.close(); }
});

test("orientation, attention, anomaly explanations, inspection, similarity, comparison, and changes are deterministic and non-mutating", () => {
  const observed = richSnapshot(), before = JSON.stringify(observed);
  const observation = { source: { seed: identity.seed, simulationVersion: identity.simulationVersion, tick: 100,
    mode: "live" as const, authoritative: "canonical-snapshot" as const }, snapshot: observed,
    events: [event(1, 90, "rupture", { relationshipId: "r0" })], memoryRange: { firstTick: 0, latestTick: 100 } };
  const oriented = orientUniverse(observation);
  const orientedDerived = oriented.derived as { identity: { liveOrArchived: string }; attentionSuggestions: unknown[] };
  assert.equal(orientedDerived.identity.liveOrArchived, "live");
  assert.ok(orientedDerived.attentionSuggestions.length > 0);
  const anomalies = findAnomalies(observed, undefined, 10);
  assert.ok(anomalies.length > 0); assert.equal(anomalies[0].explainability.method, "median-MAD");
  const entityInspection = inspectTarget(observation, { kind: "entity", id: "2" }, 2)!;
  assert.equal((entityInspection.target as { id: number }).id, 2); assert.ok(entityInspection.lineage);
  const relationshipInspection = inspectTarget(observation, { kind: "relationship", id: "r0" }, 2)!;
  assert.equal((relationshipInspection.target as { id: string }).id, "r0");
  const regionInspection = inspectTarget(observation, { kind: "region", x: 0, y: 0, radius: 100 }, 1)!;
  assert.match(String(regionInspection.summary), /region containing/);
  const similar = findSimilarEntity(observed, observed.entities![0], 3) as { matches: Array<{ similarityScore: number }> };
  assert.ok(similar.matches[0].similarityScore >= similar.matches.at(-1)!.similarityScore);
  assert.equal((compareEntities(observed.entities![0], observed.entities![1]) as { kind: string }).kind, "entity-comparison");
  const changed = detectChanges(observed, { ...snapshot(50), entities: observed.entities!.slice(0, 2), relationships: observed.relationships!.slice(0, 1) });
  assert.ok((changed.newEntities as number[]).includes(2));
  const cross = compareUniverses(observed, observed, ["u0.6", "u0.7"]) as { warnings: string[] };
  assert.equal(cross.warnings.length, 1); assert.equal(JSON.stringify(observed), before);
});

test("archived orientation uses latest checkpoint and observer bookmarks preserve since-last state", async () => {
  const value = await fixture();
  try {
    await value.store.ingestEvents([event(1, 25_000, "reproduction")], identity);
    await value.store.ingestSnapshot(richSnapshot(25_100), identity);
    const archive = resolveUniverse(await listUniverses(value.root), identity.seed, null);
    const latest = await findNearestCheckpoint(archive, 30_000, "before"); assert.ok(latest);
    const observation = { source: { seed: identity.seed, simulationVersion: identity.simulationVersion, tick: latest!.checkpoint.tick,
      mode: "archived" as const, authoritative: "checkpoint" as const }, snapshot: latest!.checkpoint.snapshot,
      events: (await queryHistoryPage(archive, { limit: 10 })).results, memoryRange: { firstTick: archive.manifest.firstTick, latestTick: archive.manifest.latestTick } };
    assert.equal((orientUniverse(observation).derived as { identity: { liveOrArchived: string } }).identity.liveOrArchived, "archived");
    const observers = new ObserverStore(path.join(value.root, "observers")); await observers.markObserved("machine-a", identity.seed, 20_000);
    assert.equal((await observers.get("machine-a")).lastOrientationTickBySeed[identity.seed], 20_000);
  } finally { await value.close(); }
});

test("history and memory HTTP routes query persisted bridge observations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-api-"));
  process.env.PROTOUNIVERSE_MEMORY_ROOT = root;
  process.env.PROTOUNIVERSE_BRIDGE_PORT = "18787";
  process.env.PROTOUNIVERSE_CHECKPOINT_INTERVAL_TICKS = "100";
  const { server } = await import("../server/index.js");
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket("ws://127.0.0.1:18787");
      socket.addEventListener("error", () => reject(new Error("verification websocket failed")));
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "heartbeat", ...identity, currentTick: 150, entityCount: 0 }));
        socket.send(JSON.stringify({ type: "snapshot", interfaceVersion: identity.interfaceVersion,
          snapshot: { ...richSnapshot(150), recentOccurrences: [event(7, 100, "reproduction", { entityId: 2 }),
            event(8, 110, "relationship-formed", { relationshipId: "api-other" }),
            event(9, 120, "rupture", { relationshipId: "api-r" })] } }));
        setTimeout(() => { socket.close(); resolve(); }, 100);
      });
    });
    let status: { persistedEventCount: number } = { persistedEventCount: 0 };
    for (let attempt = 0; attempt < 20 && status.persistedEventCount < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      status = await (await fetch("http://127.0.0.1:18787/api/memory/status")).json() as typeof status;
    }
    assert.equal(status.persistedEventCount, 3);
    const universes = await (await fetch("http://127.0.0.1:18787/api/universes")).json() as { resultCount: number };
    assert.equal(universes.resultCount, 1);
    assert.equal((await fetch("http://127.0.0.1:18787/api/universe/test-seed")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:18787/api/history?seed=missing&limit=5")).status, 404);
    const history = await (await fetch("http://127.0.0.1:18787/api/history?type=rupture&relationshipId=api-r&limit=5")).json() as { resultCount: number };
    assert.equal(history.resultCount, 1);
    const firstPage = await (await fetch("http://127.0.0.1:18787/api/history?seed=test-seed&limit=1")).json() as { nextCursor: string; results: Array<{ sequence: number }> };
    const secondPage = await (await fetch(`http://127.0.0.1:18787/api/history?seed=test-seed&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).json() as { results: Array<{ sequence: number }> };
    assert.deepEqual([firstPage.results[0].sequence, secondPage.results[0].sequence], [9, 8]);
    const checkpoints = await (await fetch("http://127.0.0.1:18787/api/checkpoints")).json() as { results: unknown[] };
    assert.equal(checkpoints.results.length, 1);
    assert.equal((await fetch("http://127.0.0.1:18787/api/checkpoint/nearest/140")).status, 200);
    const orient = await (await fetch("http://127.0.0.1:18787/api/perception/orient")).json() as { perceptionSchemaVersion: string; source: { mode: string } };
    assert.equal(orient.perceptionSchemaVersion, "protouniverse-perception/1"); assert.equal(orient.source.mode, "live");
    assert.equal((await fetch("http://127.0.0.1:18787/api/perception/inspect?kind=entity&id=2&depth=2")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:18787/api/perception/inspect?kind=unknown")).status, 400);
    assert.equal((await fetch("http://127.0.0.1:18787/api/perception/orient?seed=missing")).status, 404);
    const marked = await fetch("http://127.0.0.1:18787/api/perception/mark-observed", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observer: "integration-machine", seed: identity.seed, tick: 120 }) });
    assert.equal(marked.status, 200);
    const sinceLast = await (await fetch("http://127.0.0.1:18787/api/perception/since-last?observer=integration-machine&seed=test-seed")).json() as { previouslyObserved: boolean };
    assert.equal(sinceLast.previouslyObserved, true);
    assert.equal((await fetch("http://127.0.0.1:18787/api/history?sinceTick=bad")).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
