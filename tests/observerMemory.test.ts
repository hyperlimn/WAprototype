import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ObserverMemoryStore, ObserverMemoryNotFoundError } from "../server/observer-memory/observerMemoryStore.js";
import { ObserverMemoryValidationError } from "../server/observer-memory/observerMemoryValidation.js";
import { MemoryStore } from "../server/memory/memoryStore.js";
import { StateStore } from "../server/stateStore.js";
import { PerceptionService } from "../server/perception/perceptionService.js";
import type { MemoryPolicy } from "../src/memory/memoryPolicy.js";
import type { CanonicalSnapshot } from "../server/types.js";

const policy: MemoryPolicy = { mode: "complete", checkpointIntervalTicks: 100, segmentMaxEvents: 100, recentDetailTicks: 1000, condensedEraTicks: 1000 };
const snapshot = (seed: string, tick: number): CanonicalSnapshot => ({ metadata: { seed, currentTick: tick, simulationVersion: "test" }, entities: [], relationships: [], recentOccurrences: [] });

test("observer memory persists across store restart with epistemic metadata and references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-memory-"));
  try {
    const first = new ObserverMemoryStore(root);
    const created = await first.remember({ observer: "codex-first-entry", universe: "universe-a", kind: "hypothesis", content: "Bond density may precede rupture.", universeTick: 80,
      references: [{ kind: "event", tick: 75, sequence: 3, evidenceRole: "supports", note: "A relevant rupture" }] });
    assert.equal(created.epistemic.authority, "observer-authored"); assert.equal(created.epistemic.authoritativeUniverseTruth, false);
    const restarted = new ObserverMemoryStore(root), recalled = await restarted.recall("codex-first-entry", "universe-a");
    assert.equal(recalled.entries[0].id, created.id); assert.equal(recalled.entries[0].references[0].evidenceRole, "supports");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("observer and universe scopes are isolated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-isolation-"));
  try {
    const store = new ObserverMemoryStore(root);
    await store.remember({ observer: "alpha", universe: "u1", kind: "observation", content: "alpha/u1" });
    await store.remember({ observer: "beta", universe: "u1", kind: "observation", content: "beta/u1" });
    await store.remember({ observer: "alpha", universe: "u2", kind: "observation", content: "alpha/u2" });
    assert.deepEqual((await store.recall("alpha", "u1")).entries.map((entry) => entry.content), ["alpha/u1"]);
    assert.deepEqual((await store.recall("beta", "u1")).entries.map((entry) => entry.content), ["beta/u1"]);
    assert.deepEqual((await store.recall("alpha", "u2")).entries.map((entry) => entry.content), ["alpha/u2"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("inquiries can be revised, resolved, filtered, and retain provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-inquiry-"));
  try {
    const store = new ObserverMemoryStore(root), question = await store.remember({ observer: "alpha", universe: "u1", kind: "question", content: "Why did r1 rupture?" });
    const updated = await store.update("alpha", "u1", question.id, { content: "Did coherence loss precede r1 rupture?", status: "resolved", resolution: "Checkpoint evidence did not establish ordering.", note: "Narrowed and closed." });
    assert.equal(updated.status, "resolved"); assert.ok(updated.resolvedAt); assert.equal(updated.revisions[0].previousContent, "Why did r1 rupture?");
    assert.equal((await store.recall("alpha", "u1", { kind: "question", status: "resolved" })).resultCount, 1);
    await assert.rejects(() => store.update("alpha", "u1", "missing", { status: "resolved" }), ObserverMemoryNotFoundError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("orient returns bounded prior continuity then records the current visit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-orient-"));
  try {
    const memory = new MemoryStore(root, policy), observerMemory = new ObserverMemoryStore(path.join(root, "observer-memory")), state = new StateStore();
    state.updateSnapshot(snapshot("u1", 200)); await memory.setIdentity({ seed: "u1", simulationVersion: "test", interfaceVersion: "test" });
    await observerMemory.remember({ observer: "alpha", universe: "u1", kind: "investigation", content: "Track relationship r1." });
    await observerMemory.visit("alpha", "u1", 100);
    const service = new PerceptionService(state, memory, observerMemory), oriented = await service.orient("u1", "alpha") as any;
    assert.equal(oriented.observerContinuity.lastVisitedTick, 100); assert.equal(oriented.observerContinuity.whereYouLeftOff.length, 1);
    const after = await observerMemory.continuity("alpha", "u1"); assert.equal(after?.lastVisitedTick, 200); assert.equal(after?.visitCount, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed observer memory input is rejected without cross-scope path access", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-invalid-"));
  try {
    const store = new ObserverMemoryStore(root);
    await assert.rejects(() => store.remember({ observer: "../escape", universe: "u1", kind: "question", content: "x" }), ObserverMemoryValidationError);
    await assert.rejects(() => store.remember({ observer: "alpha", universe: "u1", kind: "question", content: "" }), ObserverMemoryValidationError);
    await assert.rejects(() => store.remember({ observer: "alpha", universe: "u1", kind: "question", content: "x", references: [{ kind: "event", tick: -1 }] }), ObserverMemoryValidationError);
  } finally { await rm(root, { recursive: true, force: true }); }
});
