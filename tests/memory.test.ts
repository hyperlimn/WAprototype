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

const identity = { seed: "test-seed", simulationVersion: "u0.6", interfaceVersion: "protouniverse-machine-interface/4" };
const complete: MemoryPolicy = { mode: "complete", checkpointIntervalTicks: 25_000, segmentMaxEvents: 2,
  recentDetailTicks: 100_000, condensedEraTicks: 100_000 };
const event = (sequence: number, tick: number, type = "rupture", extra: Partial<OccurrenceRecord> = {}): OccurrenceRecord => ({
  sequence, tick, type, description: `${type}-${sequence}`, x: sequence, y: tick, ...extra,
});
const snapshot = (tick: number): CanonicalSnapshot => ({ metadata: { currentTick: tick, seed: identity.seed, simulationVersion: identity.simulationVersion },
  entities: [], relationships: [], recentOccurrences: [] });

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
          snapshot: { ...snapshot(150), recentOccurrences: [event(7, 100, "reproduction", { entityId: 4 }),
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
    assert.equal((await fetch("http://127.0.0.1:18787/api/history?sinceTick=bad")).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
