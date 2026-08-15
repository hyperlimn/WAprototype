import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Gateway } from "../server/mcp/mcpGateway.js";
import { ExperimentStore, ExperimentDefinitionError } from "../server/laboratory/experimentStore.js";
import { LaboratoryGateway } from "../server/laboratory/laboratoryGateway.js";
import { buildLaboratoryMcpServer } from "../server/laboratory/laboratoryMcpServer.js";
import { VeilAccessError, VeilPolicy } from "../server/laboratory/veilPolicy.js";
import { veilFilter } from "../server/laboratory/veilFiltering.js";
import { freezeReconstruction, loadAndValidateFrozenArtifact, validateComparisonAgainstFrozen, validateFrozenSourceRun, writeComparisonResult } from "../server/laboratory/revealChamber.js";
import { CLEAN_ROOM_VEIL_PROFILE_VERSION, DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION, LABORATORY_SCHEMA_VERSION, PRESENT_MOMENT_VEIL_PROFILE_VERSION, REVEAL_CHAMBER_VERSION, VEIL_PROFILE_VERSION, type ExperimentDefinition } from "../src/laboratory/experimentTypes.js";

const experiment: ExperimentDefinition = { schemaVersion: LABORATORY_SCHEMA_VERSION, id: "archaeology-001", revision: "archaeology-001/1", universe: "U0-000001",
  observer: "lab-archaeology-001-a", promptVersion: "test/1", profile: { version: VEIL_PROFILE_VERSION,
    history: { enabled: true, minimumAccessibleTick: 250_000 }, currentState: true, checkpoints: true, events: true,
    entities: true, relationships: true, ancestry: false, coordinates: true, energy: true, relationshipMetrics: true,
    regions: true, similarity: true, anomalyDetection: true, comparison: true, observerMemory: false, bookmarks: false,
    discloseExperimentalContext: false } };
const chamberExperiment: ExperimentDefinition = { ...experiment, id: "archaeology-002", revision: "archaeology-002/1",
  observer: "lab-archaeology-002-a", promptVersion: "blind/1", prompt: "Blind reconstruction", chamber: {
    version: REVEAL_CHAMBER_VERSION, freeze: { artifactKind: "blind-reconstruction", outputSchemaVersion: "archaeological-reconstruction/1" },
    reveal: { observer: "lab-archaeology-002-comparison", promptVersion: "reveal/1", prompt: "Compare",
      outputSchemaVersion: "archaeological-reveal-comparison/1", profile: { ...experiment.profile,
        history: { enabled: true, minimumAccessibleTick: 0 }, ancestry: true } } } };
const deepExperiment: ExperimentDefinition = { ...chamberExperiment, id: "archaeology-003", revision: "archaeology-003/1",
  observer: "lab-archaeology-003-a", profile: { ...experiment.profile, version: DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION,
    ancestry: true, similarity: false, historicalInscriptions: { mode: "redact", retainStructuralLineage: true }, entityIdentifiers: "opaque" } };
const cleanRoomExperiment: ExperimentDefinition = { ...deepExperiment, id: "archaeology-004", revision: "archaeology-004/1",
  observer: "lab-archaeology-004-a", profile: { ...deepExperiment.profile, version: CLEAN_ROOM_VEIL_PROFILE_VERSION,
    relationshipIdentifiers: "opaque", cleanRoomHistory: { eventIdentifiers: "opaque", paginationCursors: "opaque",
      redactCumulativeBookkeeping: true } } };
const presentMomentExperiment: ExperimentDefinition = { ...cleanRoomExperiment, id: "archaeology-005", revision: "archaeology-005/1",
  observer: "lab-archaeology-005-a", profile: { ...deepExperiment.profile, version: PRESENT_MOMENT_VEIL_PROFILE_VERSION,
    history: { enabled: false, minimumAccessibleTick: 250_000 }, relationshipIdentifiers: "opaque",
    identityPresentation: "non-order-preserving", presentMoment: true, checkpoints: false, events: false,
    similarity: false, changes: false, catalogs: false } };

class FixtureGateway implements Gateway {
  calls: Array<{ pathname: string; params: Record<string, unknown> }> = [];
  async get(pathname: string, params: Record<string, unknown> = {}): Promise<any> {
    this.calls.push({ pathname, params });
    if (pathname === "/api/universes") return { resultCount: 2, results: [{ seed: "U0-000001", firstTick: 0 }, { seed: "other", firstTick: 0 }] };
    if (pathname === "/api/history") { const results = [{ tick: 200_000, sequence: 1, description: "hidden" }, { tick: 260_000, sequence: 2, description: "visible" }]
      .filter((item) => (typeof params.sinceTick !== "number" || item.tick >= params.sinceTick) && (typeof params.untilTick !== "number" || item.tick <= params.untilTick));
      return { seed: "U0-000001", query: params, resultCount: results.length, results }; }
    if (pathname === "/api/checkpoints") return { seed: "U0-000001", results: [{ tick: 200_000 }, { tick: 275_000 }], resultCount: 2 };
    if (pathname.startsWith("/api/checkpoint/")) return { seed: "U0-000001", checkpoint: { tick: Number(pathname.split("/").at(-1)), snapshot: {} } };
    if (pathname === "/api/perception/orient") return { source: { seed: "U0-000001", tick: 400_000 }, derived: { identity: { seed: "U0-000001", tick: 400_000, population: 2 }, attentionSuggestions: [] }, memoryRange: { firstTick: 0 } };
    if (pathname === "/api/perception/inspect" || pathname === "/api/perception/context") return { source: { seed: "U0-000001", tick: 400_000 }, currentProperties: {
      id: 7, birthTick: 1_200, age: 398_800, origin: "reproduction", parentEntityIds: [1, 2], x: 4, y: 8, energy: 9,
      currentRelationshipIds: ["r-now"] }, history: [{ tick: 2_000 }, { tick: 280_000 }] };
    if (pathname === "/api/perception/anomalies") return { source: { seed: "U0-000001", tick: 400_000 }, results: [] };
    throw new Error(`unexpected ${pathname}`);
  }
  async post(): Promise<any> { throw new Error("write reached authoritative gateway"); }
  async patch(): Promise<any> { throw new Error("write reached authoritative gateway"); }
}

class DeepArchaeologyFixtureGateway implements Gateway {
  async get(pathname: string, params: Record<string, unknown> = {}): Promise<any> {
    const entity = { id: 42, creationIndex: 41, fingerprint: "historical-fingerprint", origin: "reproduction", birthTick: 1_200,
      parentRelationshipId: "r-parent", parentEntityIds: [3, 7], x: 10, y: 20, vx: 0.5, vy: -0.25, energy: 8,
      age: 398_800, neighborCount: 4, strongestBond: 0.7, strongestRelationship: 0.6, currentRelationshipIds: ["r-now"] };
    const relationship = { id: "r-now", parentAId: 42, parentBId: 50, creationTick: 5_000, age: 395_000,
      spatialActive: true, influenceActive: true, bondStrength: 0.7, relationshipStrength: 0.6, x: 11, y: 19,
      coherence: 0.8, localRelationshipDensity: 0.4, synergy: 0.5, localFieldPotential: 0.3,
      reproductionCount: 9, lastReproductionTick: 200_000, nextEligibleTick: 410_000 };
    if (pathname === "/api/universes") return { resultCount: 1, results: [{ seed: "U0-000001", firstTick: 0,
      eventCount: 900, checkpointCount: 40, segmentCount: 8, population: 2 }] };
    if (pathname === "/api/perception/orient") return { source: { seed: "U0-000001", tick: 400_000 }, authoritative: {
      recentEventCount: 200, persistedEventCount: 9_000 }, derived: { identity: { seed: "U0-000001", tick: 400_000,
      population: 2, relationshipCount: 1 }, activity: { recentBirths: 12, recentRuptures: 2 }, structure: {
      mostConnectedEntities: [entity], oldestEntities: [entity], highestCoherence: [relationship] },
      attentionSuggestions: [{ kind: "entity", identifier: 42, score: 1, reason: "age and persistence" }] } };
    if (pathname === "/api/perception/inspect" || pathname === "/api/perception/context") return { source: { seed: "U0-000001", tick: 400_000 },
      summary: "reproduction entity born at tick 1200", currentProperties: params.kind === "relationship" ? relationship : entity,
      localContext: { entities: [entity], relationships: [relationship] }, lineage: { entity, parents: [{ ...entity, id: 3,
        parentEntityIds: null }], ancestryAvailable: true }, historicalContext: [{ tick: 200_000, type: "reproduction" }] };
    if (pathname === "/api/perception/anomalies") return { source: { seed: "U0-000001", tick: 400_000 }, results: [
      { kind: "entity", identifier: 42, category: "extreme-age", reason: "age is unusual", supportingMetrics: { age: 398_800 } },
      { kind: "entity", identifier: 42, category: "extreme-energy", reason: "energy is unusual", supportingMetrics: { energy: 8 } }] };
    if (pathname === "/api/perception/similar") return { matches: [{ object: { kind: "entity", id: 42 }, similarityScore: 0.99,
      sharedFeatures: ["age", "origin"], features: [{ name: "age", target: 1, candidate: 1, difference: 0 }] }] };
    if (pathname === "/api/perception/compare") return { kind: "entity-comparison", sharedCharacteristics: ["origin:reproduction"],
      largestDifferences: [{ metric: "age", a: 10, b: 20, delta: 10 }, { metric: "energy", a: 5, b: 8, delta: 3 }] };
    if (pathname === "/api/perception/changes") return { changes: [{ metric: "births", before: 2, after: 9, delta: 7 },
      { metric: "averageCoherence", before: 0.5, after: 0.8, delta: 0.3 }], newEntities: [42] };
    if (pathname === "/api/history") return { seed: "U0-000001", resultCount: 2, results: [
      { tick: 200_000, sequence: 1, type: "reproduction", description: "hidden event" },
      { tick: 260_000, sequence: 2, type: "reproduction", description: "reproduction created entity 42", x: 10, y: 20 }] };
    if (pathname === "/api/checkpoints") return { seed: "U0-000001", resultCount: 1, results: [{ tick: 275_000,
      eventCount: 600, checkpointCount: 20, snapshot: { metadata: { currentTick: 275_000, reproductionBirths: 70 }, entities: [entity], relationships: [relationship] } }] };
    if (pathname.startsWith("/api/checkpoint/")) return { seed: "U0-000001", checkpoint: { tick: 275_000,
      snapshot: { metadata: { currentTick: 275_000, totalReproductionEvents: 70 }, entities: [entity], relationships: [relationship] } } };
    throw new Error(`unexpected ${pathname}`);
  }
  async post(): Promise<any> { throw new Error("write reached deep fixture"); }
  async patch(): Promise<any> { throw new Error("write reached deep fixture"); }
}

class CleanRoomFixtureGateway implements Gateway {
  calls: Array<{ pathname: string; params: Record<string, unknown> }> = [];
  private readonly entity = { id: 42, creationIndex: 41, fingerprint: "historical-fingerprint", origin: "reproduction", birthTick: 1_200,
    parentRelationshipId: "3:7", parentEntityIds: [3, 7], x: 10, y: 20, vx: 0.5, vy: -0.25, energy: 8, age: 398_800,
    neighborCount: 4, strongestBond: 0.7, strongestRelationship: 0.6, currentRelationshipIds: ["42:50"] };
  private readonly relationship = { id: "42:50", parentAId: 42, parentBId: 50, creationTick: 5_000, age: 395_000,
    spatialActive: true, influenceActive: true, bondStrength: 0.7, relationshipStrength: 0.6, x: 11, y: 19,
    coherence: 0.8, localRelationshipDensity: 0.4, synergy: 0.5, localFieldPotential: 0.3,
    reproductionCount: 9, ruptureCount: 2, firstTickAboveCreationThreshold: 249_989 };
  async get(pathname: string, params: Record<string, unknown> = {}): Promise<any> {
    this.calls.push({ pathname, params: { ...params } });
    if (pathname === "/api/universes") return { resultCount: 1, warnings: [{ error: "2 malformed earlier records" }],
      results: [{ seed: "U0-000001", firstTick: 0, eventCount: 9_000, checkpointCount: 40, segmentCount: 8, population: 2 }] };
    if (pathname === "/api/perception/orient") return { source: { seed: "U0-000001", tick: 400_000 }, authoritative: {
      recentEventCount: 200, persistedEventCount: 9_000 }, derived: { identity: { seed: "U0-000001", tick: 400_000,
      population: 2, relationshipCount: 1 }, activity: { recentBirths: 12, recentRuptures: 2, dimensionalTransitions: 40 },
      structure: { mostConnectedEntities: [this.entity], highestCoherence: [this.relationship] }, attentionSuggestions: [] } };
    if (pathname === "/api/perception/inspect" || pathname === "/api/perception/context") return { source: { seed: "U0-000001", tick: 400_000 },
      summary: "2 events already occurred", currentProperties: params.kind === "relationship" ? this.relationship : this.entity,
      lineage: { entity: this.entity, parents: [{ ...this.entity, id: 3, parentEntityIds: null }], ancestryAvailable: true },
      localContext: { entities: [this.entity], relationships: [this.relationship] } };
    if (pathname === "/api/perception/anomalies") return { results: [{ kind: "entity", identifier: 42,
      category: "extreme-energy", reason: "energy is unusual", supportingMetrics: { energy: 8 } }] };
    if (pathname === "/api/perception/compare") return { kind: "relationship-comparison", targets: ["42:50", "3:7"],
      largestDifferences: [{ metric: "coherence", a: 0.5, b: 0.8, delta: 0.3 }, { metric: "age", a: 3, b: 8, delta: 5 }] };
    if (pathname === "/api/perception/changes") return { changes: [{ metric: "births", before: 2, after: 9, delta: 7 },
      { metric: "averageCoherence", before: 0.5, after: 0.8, delta: 0.3 }], newEntities: [42], newRelationships: ["42:50"] };
    if (pathname === "/api/history") {
      if (params.cursor === "authority-page-2") return { seed: "U0-000001", query: { ...params, offset: 2 }, resultCount: 1,
        results: [{ tick: 250_002, sequence: 3952, type: "dimensional-transition", description: "relationship 42:50 transitioned", relationshipId: "42:50" }],
        nextCursor: null, hasMore: false, malformedRecordCount: 7 };
      return { seed: "U0-000001", query: { ...params, offset: 3_950 }, resultCount: 2, results: [
        { tick: 200_000, sequence: 3_000, type: "rupture", description: "hidden" },
        { tick: 250_000, sequence: 3_950, type: "dimensional-transition", description: "relationship 42:50 transitioned", relationshipId: "42:50" },
        { tick: 250_001, sequence: 3_951, type: "rupture", description: "2 events already occurred", relationshipId: "42:50" }],
        nextCursor: "authority-page-2", hasMore: true, malformedRecordCount: 7 };
    }
    const snapshot = { metadata: { currentTick: 250_055, eventSequence: 3_952 }, state: { population: 308,
      currentRelationshipCount: 874, reproductionBirthCount: 38, totalReproductionEvents: 38, countByOrigin: { initial: 20, reproduction: 38 } },
      relationshipsSummary: { total: 874 }, reproductionSummary: { totalReproductionEvents: 38 },
      ruptureSummary: { totalRuptureEvents: 2, rupturesLast10000Ticks: 2 }, ruptureCascadeSummary: { ruptureBurstCount: 2 },
      recentOccurrences: [{ tick: 249_999, sequence: 3_949 }], entities: [this.entity], relationships: [this.relationship] };
    if (pathname === "/api/checkpoints") return { seed: "U0-000001", resultCount: 1, results: [{ tick: 250_055,
      eventSequence: 3_952, eventCount: 3_953, snapshot }] };
    if (pathname.startsWith("/api/checkpoint/")) return { seed: "U0-000001", checkpoint: { tick: 250_055, snapshot } };
    throw new Error(`unexpected ${pathname}`);
  }
  async post(): Promise<any> { throw new Error("write reached clean-room fixture"); }
  async patch(): Promise<any> { throw new Error("write reached clean-room fixture"); }
}

class PresentMomentFixtureGateway implements Gateway {
  calls: string[] = [];
  private entity(id: number, parents: number[] | null = [2, 99]) { return { kind: "entity", id, creationIndex: id - 1,
    fingerprint: `created-${id}`, origin: id < 20 ? "founder" : "reproduction", birthTick: id * 100, age: 400_000 - id * 100,
    parentEntityIds: parents, parentRelationshipId: "2:99", x: id / 10, y: id / 20, vx: .5, vy: -.25, energy: 8,
    neighborCount: id === 42 ? 6 : 4, currentRelationshipIds: ["42:99", "2:42"], coherence: .8, localDensity: .4,
    activeDuration: 300_000, nextEligibleReproductionTick: 410_000, previousEnergy: 7 } }
  private relationship(id = "42:99") { return { kind: "relationship", id, parentAId: 42, parentBId: 99,
    creationTick: 5_000, age: 395_000, spatialActive: true, influenceActive: false, bondStrength: .7,
    relationshipStrength: .6, coherence: .8, synergy: .5, localRelationshipDensity: .4, localFieldPotential: .3,
    activeDuration: 200_000, spatialDuration: 100_000, ruptureCount: 2, firstThresholdCrossingTick: 4_900 } }
  async get(pathname: string, params: Record<string, unknown> = {}): Promise<any> {
    this.calls.push(pathname);
    if (["/api/history", "/api/checkpoints", "/api/perception/changes", "/api/perception/similar", "/api/universes"].includes(pathname)
      || pathname.startsWith("/api/checkpoint/")) throw new Error(`disabled faculty reached source: ${pathname}`);
    if (pathname === "/api/perception/orient") return { source: { mode: "live", seed: "U0-000001", tick: 425_000 },
      authoritative: { initialCount: 20, lastExternalArrivalTick: 200_000, arrivalCount: 30, currentPopulation: 3 },
      derived: { identity: { seed: "U0-000001", tick: 425_000, population: 3, relationshipCount: 2 },
        activity: { cumulativeBirths: 80 }, structure: { mostConnectedEntities: [this.entity(42), this.entity(2), this.entity(99)],
          highestCoherence: [this.relationship()] }, oldestEntities: [this.entity(2)], attentionSuggestions: [{ reason: "oldest entity" }] } };
    if (pathname === "/api/perception/inspect" || pathname === "/api/perception/context") {
      const current = params.kind === "relationship" ? this.relationship(String(params.id)) : params.kind === "region"
        ? { kind: "region", x: params.x, y: params.y, radius: params.radius, population: 3, localDensity: .4, averageEnergy: 8,
          connectedComponents: 1, currentRelationshipCount: 2, arrivalsLast1000Ticks: 3 }
        : this.entity(Number(params.id));
      return { source: { mode: "live", seed: "U0-000001", tick: 425_000 }, summary: "Founder born long ago",
        currentProperties: current, lineage: { entity: this.entity(42), parents: [this.entity(2, null), this.entity(99, null)], ancestryAvailable: true },
        localContext: { entities: [this.entity(2), this.entity(99), this.entity(42)], relationships: [this.relationship("2:42"), this.relationship()] },
        historicalContext: [{ tick: 1_000 }], largerScaleActivity: { totalTransitions: 30 }, similarObjects: [{ id: 1 }] };
    }
    if (pathname === "/api/perception/anomalies") return { source: { mode: "live", seed: "U0-000001", tick: 425_000 }, results: [
      { kind: "entity", identifier: 42, category: "extreme-age", reason: "oldest by age", supportingMetrics: { age: 420_800 } },
      { kind: "entity", identifier: 42, category: "extreme-energy", reason: "current energy is unusual", supportingMetrics: { energy: 8 } }] };
    if (pathname === "/api/perception/compare") return { source: { mode: "live", seed: "U0-000001", tick: 425_000 }, kind: `${params.kind}-comparison`,
      targets: [params.idA, params.idB], sharedCharacteristics: ["founder origin", "spatialActive"], largestDifferences: [
        { metric: "age", a: 4, b: 9, delta: 5 }, { metric: "energy", a: 5, b: 8, delta: 3 },
        { metric: "activeDuration", a: 10, b: 20, delta: 10 }, { metric: "transitionCount", a: 2, b: 7, delta: 5 },
        { metric: "coherence", a: .4, b: .8, delta: .4 }] };
    throw new Error(`unexpected ${pathname}`);
  }
  async post(): Promise<any> { throw new Error("write reached present-moment fixture"); }
  async patch(): Promise<any> { throw new Error("write reached present-moment fixture"); }
}

test("experiment definitions load persistently and malformed profiles are rejected", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lab-definitions-")); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "valid.json"), JSON.stringify({ ...experiment, id: "valid" }));
  assert.equal((await new ExperimentStore(directory).load("valid")).observer, experiment.observer);
  await writeFile(path.join(directory, "bad.json"), JSON.stringify({ ...experiment, id: "bad", profile: { history: { minimumAccessibleTick: -1 } } }));
  await assert.rejects(new ExperimentStore(directory).load("bad"), ExperimentDefinitionError);
  await assert.rejects(new ExperimentStore(directory).load("../escape"), ExperimentDefinitionError);
});

test("archaeology-002 definition loads while archaeology-001 remains without a chamber", async () => {
  const store = new ExperimentStore(path.resolve("data/laboratory/experiments"));
  const first = await store.load("archaeology-001"), second = await store.load("archaeology-002");
  assert.equal(first.chamber, undefined); assert.equal(second.observer, "lab-archaeology-002-a");
  assert.equal(second.profile.history.minimumAccessibleTick, 250_000);
  assert.equal(second.chamber?.reveal.profile.history.minimumAccessibleTick, 0);
  assert.equal(second.chamber?.reveal.profile.observerMemory, false); assert.equal(second.chamber?.reveal.profile.bookmarks, false);
});

test("archaeology-003 loads as a fresh deep-archaeology chamber without changing earlier definitions", async () => {
  const store = new ExperimentStore(path.resolve("data/laboratory/experiments"));
  const first = await store.load("archaeology-001"), second = await store.load("archaeology-002"), deep = await store.load("archaeology-003");
  assert.equal(first.profile.historicalInscriptions, undefined); assert.equal(second.profile.historicalInscriptions, undefined);
  assert.equal(deep.observer, "lab-archaeology-003-a"); assert.equal(deep.profile.version, DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION);
  assert.deepEqual(deep.profile.historicalInscriptions, { mode: "redact", retainStructuralLineage: true });
  assert.equal(deep.profile.entityIdentifiers, "opaque"); assert.equal(deep.chamber?.reveal.profile.entityIdentifiers, "opaque");
  assert.equal(deep.profile.history.minimumAccessibleTick, 250_000); assert.equal(deep.profile.similarity, false);
  assert.equal(deep.chamber?.reveal.profile.history.minimumAccessibleTick, 0);
  assert.match(deep.scientificQuestion ?? "", /present form.+historical inscriptions are removed/i);
});

test("archaeology-004 loads as an isolated clean-room chamber", async () => {
  const store = new ExperimentStore(path.resolve("data/laboratory/experiments"));
  const clean = await store.load("archaeology-004"), deep = await store.load("archaeology-003");
  assert.equal(clean.observer, "lab-archaeology-004-a"); assert.equal(clean.profile.version, CLEAN_ROOM_VEIL_PROFILE_VERSION);
  assert.equal(clean.profile.history.minimumAccessibleTick, 250_000); assert.equal(clean.profile.relationshipIdentifiers, "opaque");
  assert.deepEqual(clean.profile.cleanRoomHistory, { eventIdentifiers: "opaque", paginationCursors: "opaque", redactCumulativeBookkeeping: true });
  assert.match(clean.scientificQuestion ?? "", /explicit and indirect historical inscriptions/i);
  assert.equal(clean.chamber?.reveal.profile.history.minimumAccessibleTick, 0);
  assert.equal(clean.chamber?.reveal.profile.historicalInscriptions, undefined);
  assert.equal(deep.profile.version, DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION); assert.equal(deep.profile.cleanRoomHistory, undefined);
});

test("archaeology-005 loads as a present-moment chamber while earlier profiles remain unchanged", async () => {
  const store = new ExperimentStore(path.resolve("data/laboratory/experiments"));
  const definitions = await Promise.all([1, 2, 3, 4, 5].map((n) => store.load(`archaeology-00${n}`)));
  const present = definitions[4];
  assert.deepEqual(definitions.slice(0, 4).map((item) => item.profile.version),
    [VEIL_PROFILE_VERSION, VEIL_PROFILE_VERSION, DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION, CLEAN_ROOM_VEIL_PROFILE_VERSION]);
  assert.equal(present.observer, "lab-archaeology-005-a"); assert.equal(present.profile.version, PRESENT_MOMENT_VEIL_PROFILE_VERSION);
  assert.equal(present.profile.presentMoment, true); assert.equal(present.profile.history.enabled, false);
  assert.equal(present.profile.checkpoints, false); assert.equal(present.profile.events, false); assert.equal(present.profile.changes, false);
  assert.equal(present.profile.catalogs, false); assert.equal(present.profile.identityPresentation, "non-order-preserving");
  assert.match(present.scientificQuestion ?? "", /quantities.+observed.+instant/i);
  assert.equal(present.chamber?.reveal.profile.history.minimumAccessibleTick, 0);
});

test("Veil v4 rejects a present-moment profile with a historical faculty", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lab-present-definitions-")); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "bad.json"), JSON.stringify({ ...presentMomentExperiment, id: "bad",
    profile: { ...presentMomentExperiment.profile, history: { enabled: true, minimumAccessibleTick: 250_000 } } }));
  await assert.rejects(new ExperimentStore(directory).load("bad"), /Present Moment/);
});

test("Veil v2 rejects missing inscription policy and Veil v1 rejects accidental deep policy", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lab-deep-definitions-")); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "missing.json"), JSON.stringify({ ...deepExperiment, id: "missing",
    profile: { ...deepExperiment.profile, historicalInscriptions: undefined, entityIdentifiers: undefined } }));
  await writeFile(path.join(directory, "v1-deep.json"), JSON.stringify({ ...deepExperiment, id: "v1-deep",
    profile: { ...deepExperiment.profile, version: VEIL_PROFILE_VERSION } }));
  await assert.rejects(new ExperimentStore(directory).load("missing"), ExperimentDefinitionError);
  await assert.rejects(new ExperimentStore(directory).load("v1-deep"), ExperimentDefinitionError);
});

test("deep archaeology removes inscriptions across faculties while preserving present form and lineage topology", async () => {
  const gateway = new LaboratoryGateway(new DeepArchaeologyFixtureGateway(), deepExperiment);
  const entity42 = String(gateway.policy.presentEntityId(42)), entity3 = gateway.policy.presentEntityId(3), entity7 = gateway.policy.presentEntityId(7);
  const orient = await gateway.get("/api/perception/orient");
  assert.equal(orient.source.tick, 400_000); assert.equal(orient.derived.identity.population, 2);
  assert.equal(orient.derived.structure.mostConnectedEntities[0].x, 10);
  assert.equal(orient.derived.structure.mostConnectedEntities[0].energy, 8);
  assert.equal(orient.derived.structure.oldestEntities, undefined); assert.equal(orient.derived.attentionSuggestions, undefined);
  assert.equal(orient.authoritative.recentEventCount, 200); assert.equal(orient.authoritative.persistedEventCount, undefined);

  const inspected = await gateway.get("/api/perception/inspect", { kind: "entity", id: entity42 });
  assert.deepEqual(inspected.currentProperties.parentEntityIds, [entity3, entity7]);
  assert.deepEqual(inspected.currentProperties.currentRelationshipIds, ["r-now"]);
  assert.equal(inspected.currentProperties.vx, 0.5); assert.equal(inspected.currentProperties.neighborCount, 4);
  assert.equal(inspected.currentProperties.birthTick, undefined); assert.equal(inspected.currentProperties.creationIndex, undefined);
  assert.equal(inspected.currentProperties.origin, undefined); assert.equal(inspected.currentProperties.fingerprint, undefined);
  assert.deepEqual(inspected.lineage.parents[0].parentEntityIds, null); assert.equal(inspected.currentProperties.id, entity42);
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "entity", id: "42" }), /identifier is inaccessible/);

  const relationship = await gateway.get("/api/perception/inspect", { kind: "relationship", id: "r-now" });
  assert.equal(relationship.currentProperties.coherence, 0.8); assert.equal(relationship.currentProperties.synergy, 0.5);
  assert.equal(relationship.currentProperties.spatialActive, true); assert.equal(relationship.currentProperties.creationTick, undefined);
  assert.equal(relationship.currentProperties.age, undefined); assert.equal(relationship.currentProperties.reproductionCount, undefined);

  const anomalies = await gateway.get("/api/perception/anomalies");
  assert.deepEqual(anomalies.results.map((item: any) => item.category), ["extreme-energy"]);
  const comparison = await gateway.get("/api/perception/compare", { kind: "entity", idA: entity42,
    idB: gateway.policy.presentEntityId(50) });
  assert.deepEqual(comparison.largestDifferences.map((item: any) => item.metric), ["energy"]);
  assert.deepEqual(comparison.sharedCharacteristics, []);
  const changes = await gateway.get("/api/perception/changes", { sinceTick: 250_000 });
  assert.deepEqual(changes.changes.map((item: any) => item.metric), ["averageCoherence"]);
  await assert.rejects(gateway.get("/api/perception/similar", { kind: "entity", id: "42" }), /Similarity analysis is inaccessible/);

  const history = await gateway.get("/api/history", { sinceTick: 0 });
  assert.deepEqual(history.results.map((item: any) => item.tick), [260_000]);
  assert.equal(history.results[0].description, undefined);
  const checkpoints = await gateway.get("/api/checkpoints", { sinceTick: 0 });
  assert.equal(checkpoints.results[0].snapshot.entities[0].x, 10);
  assert.equal(checkpoints.results[0].eventCount, undefined);
  assert.equal(checkpoints.results[0].snapshot.metadata.reproductionBirths, undefined);
  const checkpoint = await gateway.get("/api/checkpoint/275000");
  assert.equal(checkpoint.checkpoint.snapshot.relationships[0].localFieldPotential, 0.3);
  assert.equal(checkpoint.checkpoint.snapshot.metadata.totalReproductionEvents, undefined);
  const universes = await gateway.get("/api/universes");
  assert.equal(universes.results[0].population, 2); assert.equal(universes.results[0].checkpointCount, undefined);
});

test("deep archaeology MCP and resources expose structure without inscription backdoors", async () => {
  const server = buildLaboratoryMcpServer(deepExperiment, new DeepArchaeologyFixtureGateway());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "deep-archaeology-leakage-test", version: "1" }); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("orient") && names.includes("inspect") && names.includes("history") && names.includes("checkpoint"));
    assert.ok(!names.includes("remember") && !names.includes("recall_observer_memory") && !names.includes("mark_observed"));
    const entity42 = String(new VeilPolicy(deepExperiment).presentEntityId(42));
    const inspection = await client.callTool({ name: "inspect", arguments: { seed: "U0-000001", kind: "entity", id: entity42 } });
    const serialized = JSON.stringify(inspection);
    for (const inscription of ["birthTick", "creationTick", "creationIndex", "fingerprint", "reproductionCount", "origin:reproduction", "born at tick"])
      assert.ok(!serialized.includes(inscription), `MCP inspection leaked ${inscription}`);
    assert.match(serialized, /parentEntityIds/); assert.match(serialized, /currentRelationshipIds/); assert.match(serialized, /neighborCount/);
    const resource = await client.readResource({ uri: `protouniverse://universe/U0-000001/entity/${entity42}` });
    const resourceText = resource.contents.map((item: any) => item.text ?? "").join("\n");
    assert.ok(!/birthTick|creationIndex|historical-fingerprint|reproduction entity/i.test(resourceText));
    assert.match(resourceText, /parentResources/); assert.match(resourceText, /relationshipResources/);
  } finally { await client.close(); await server.close(); }
});

test("clean-room Veil closes event-order, cursor, relationship-id, and checkpoint bookkeeping leaks", async () => {
  const source = new CleanRoomFixtureGateway(), gateway = new LaboratoryGateway(source, cleanRoomExperiment), policy = gateway.policy;
  const history = await gateway.get("/api/history", { sinceTick: 0, limit: 2 });
  assert.deepEqual(history.results.map((item: any) => item.tick), [250_000, 250_001]);
  assert.ok(history.results.every((item: any) => /^event-[0-9a-f]{8}$/.test(item.sequence)));
  assert.ok(history.results.every((item: any) => /^relationship-[0-9a-f]{8}-[0-9a-f]{8}$/.test(item.relationshipId)));
  assert.ok(!JSON.stringify(history).includes("3950") && !JSON.stringify(history).includes("3951"));
  assert.match(history.nextCursor, /^cursor-[0-9a-f]{24}$/); assert.equal(history.query.offset, undefined);
  assert.equal(history.malformedRecordCount, undefined); assert.equal(history.resultCount, 2); assert.equal(history.hasMore, true);
  const next = await gateway.get("/api/history", { sinceTick: 250_000, cursor: history.nextCursor });
  assert.equal(next.results.length, 1); assert.match(next.results[0].sequence, /^event-[0-9a-f]{8}$/);
  assert.equal(source.calls.at(-1)?.params.cursor, "authority-page-2");
  await assert.rejects(gateway.get("/api/history", { cursor: "authority-page-2" }), /pagination position is inaccessible/);

  const checkpoint = await gateway.get("/api/checkpoint/250055");
  const snapshot = checkpoint.checkpoint.snapshot;
  assert.equal(snapshot.state.population, 308); assert.equal(snapshot.state.currentRelationshipCount, 874);
  assert.equal(snapshot.relationshipsSummary.total, 874); assert.equal(snapshot.entities[0].x, 10);
  assert.equal(snapshot.metadata.eventSequence, undefined); assert.equal(snapshot.state.reproductionBirthCount, undefined);
  assert.equal(snapshot.state.totalReproductionEvents, undefined); assert.equal(snapshot.state.countByOrigin, undefined);
  assert.equal(snapshot.reproductionSummary, undefined); assert.equal(snapshot.ruptureSummary, undefined);
  assert.equal(snapshot.ruptureCascadeSummary, undefined); assert.equal(snapshot.recentOccurrences, undefined);
  assert.equal(snapshot.relationships[0].ruptureCount, undefined); assert.equal(snapshot.relationships[0].firstTickAboveCreationThreshold, undefined);

  const relationshipId = String(policy.presentRelationshipId("42:50"));
  assert.match(relationshipId, /^relationship-[0-9a-f]{8}-[0-9a-f]{8}$/);
  const relationship = await gateway.get("/api/perception/inspect", { kind: "relationship", id: relationshipId });
  assert.equal(relationship.currentProperties.id, relationshipId); assert.equal(relationship.currentProperties.coherence, 0.8);
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "relationship", id: "42:50" }), /identifier is inaccessible/);
  const orient = await gateway.get("/api/perception/orient");
  assert.equal(orient.derived.identity.population, 2); assert.equal(orient.derived.structure.mostConnectedEntities[0].energy, 8);
  assert.equal(orient.derived.activity, undefined); assert.equal(orient.authoritative.recentEventCount, undefined);
  const changes = await gateway.get("/api/perception/changes", { sinceTick: 250_000 });
  assert.deepEqual(changes.changes.map((item: any) => item.metric), ["averageCoherence"]);
  assert.match(changes.newEntities[0], /^entity-[0-9a-f]{8}$/); assert.match(changes.newRelationships[0], /^relationship-/);
  const comparison = await gateway.get("/api/perception/compare", { kind: "relationship", idA: relationshipId,
    idB: policy.presentRelationshipId("3:7") });
  assert.deepEqual(comparison.largestDifferences.map((item: any) => item.metric), ["coherence"]);
  assert.ok(comparison.targets.every((item: string) => item.startsWith("relationship-")));
  const universes = await gateway.get("/api/universes");
  assert.equal(universes.results[0].population, 2); assert.equal(universes.results[0].eventCount, undefined);
  assert.equal(universes.warnings, undefined);
  await assert.rejects(gateway.get("/api/history", { untilTick: 249_999 }), /outside the accessible range/);
});

test("clean-room MCP keeps events and structural resources navigable only through opaque identities", async () => {
  const source = new CleanRoomFixtureGateway(), policy = new VeilPolicy(cleanRoomExperiment);
  const server = buildLaboratoryMcpServer(cleanRoomExperiment, source);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "clean-room-leakage-test", version: "1" }); await client.connect(clientTransport);
  try {
    const history = await client.callTool({ name: "history", arguments: { seed: "U0-000001", sinceTick: 250_000, limit: 2 } });
    const serialized = JSON.stringify(history);
    assert.ok(!/3950|3951|authority-page|eventSequence|ruptureCount|reproductionBirthCount/.test(serialized));
    assert.match(serialized, /event-[0-9a-f]{8}/); assert.match(serialized, /relationship-[0-9a-f]{8}-[0-9a-f]{8}/);
    const eventId = (history.structuredContent as any).results[0].sequence;
    const eventResource = await client.readResource({ uri: `protouniverse://universe/U0-000001/event/250000/${eventId}` });
    assert.match((eventResource.contents[0] as any).text, /event-[0-9a-f]{8}/);
    const relationshipId = String(policy.presentRelationshipId("42:50"));
    const relationshipResource = await client.readResource({ uri: `protouniverse://universe/U0-000001/relationship/${relationshipId}` });
    const relationshipText = (relationshipResource.contents[0] as any).text;
    assert.ok(!relationshipText.includes("42:50")); assert.match(relationshipText, /coherence/); assert.match(relationshipText, /parentResources/);
  } finally { await client.close(); await server.close(); }
});

test("present-moment Veil removes semantic history across every blind faculty while retaining form", async () => {
  const source = new PresentMomentFixtureGateway(), gateway = new LaboratoryGateway(source, presentMomentExperiment);
  const orient = await gateway.get("/api/perception/orient");
  const entities = orient.derived.structure.mostConnectedEntities;
  assert.equal(orient.source.tick, 425_000); assert.equal(orient.derived.identity.population, 3);
  assert.equal(entities[0].x, 4.2); assert.equal(entities[0].vx, .5); assert.equal(entities[0].energy, 8);
  assert.equal(entities[0].neighborCount, 6); assert.equal(orient.authoritative.currentPopulation, 3);
  assert.equal(orient.authoritative.initialCount, undefined); assert.equal(orient.derived.activity, undefined);

  const entityId = entities[0].id, parentIds = entities[0].parentEntityIds, relationshipId = entities[0].currentRelationshipIds[0];
  assert.match(entityId, /^entity-[0-9a-f]{16}$/); assert.ok(parentIds.every((id: string) => /^entity-[0-9a-f]{16}$/.test(id)));
  assert.match(relationshipId, /^relationship-[0-9a-f]{16}$/);
  const inspected = await gateway.get("/api/perception/inspect", { kind: "entity", id: entityId });
  assert.equal(inspected.currentProperties.energy, 8); assert.equal(inspected.currentProperties.birthTick, undefined);
  assert.deepEqual(inspected.currentProperties.parentEntityIds, [...inspected.currentProperties.parentEntityIds].sort());
  assert.equal(inspected.historicalContext, undefined); assert.equal(inspected.largerScaleActivity, undefined);
  assert.equal(inspected.lineage.parents.length, 2); assert.ok(inspected.lineage.parents.every((item: any) => item.birthTick === undefined));
  const relationship = await gateway.get("/api/perception/inspect", { kind: "relationship", id: relationshipId });
  assert.equal(relationship.currentProperties.spatialActive, true); assert.equal(relationship.currentProperties.influenceActive, false);
  assert.equal(relationship.currentProperties.coherence, .8); assert.equal(relationship.currentProperties.activeDuration, undefined);
  const region = await gateway.get("/api/perception/inspect", { kind: "region", x: 1, y: 2, radius: 20 });
  assert.equal(region.currentProperties.localDensity, .4); assert.equal(region.currentProperties.connectedComponents, 1);
  assert.equal(region.currentProperties.arrivalsLast1000Ticks, undefined);
  const anomalies = await gateway.get("/api/perception/anomalies");
  assert.deepEqual(anomalies.results.map((item: any) => item.category), ["extreme-energy"]);
  const compared = await gateway.get("/api/perception/compare", { kind: "entity", idA: entityId, idB: parentIds[0] });
  assert.deepEqual(compared.largestDifferences.map((item: any) => item.metric), ["energy", "coherence"]);
  assert.deepEqual(compared.sharedCharacteristics, ["spatialActive"]);

  for (const [pathName, params] of [["/api/history", {}], ["/api/checkpoints", {}], ["/api/checkpoint/250000", {}],
    ["/api/perception/changes", {}], ["/api/perception/similar", {}], ["/api/universes", {}]] as const)
    await assert.rejects(gateway.get(pathName, params), VeilAccessError);
  assert.ok(!source.calls.some((item) => ["/api/history", "/api/checkpoints", "/api/perception/changes", "/api/perception/similar", "/api/universes"].includes(item)));
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "checkpoint", tick: 250_000 }), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "event", tick: 250_000, sequence: 1 }), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "entity", id: "42" }), /identifier is inaccessible/);
});

test("present-moment identities are stable opaque hashes and visible ordering is not authority ordering", () => {
  const first = new VeilPolicy(presentMomentExperiment), second = new VeilPolicy(presentMomentExperiment);
  const authoritative = [2, 42, 99, 101];
  const visible = authoritative.map((id) => first.presentEntityId(id));
  assert.deepEqual(visible, authoritative.map((id) => second.presentEntityId(id)));
  assert.ok(visible.every((id) => /^entity-[0-9a-f]{16}$/.test(String(id))));
  assert.notDeepEqual(visible, [...visible].sort(), "visible lexical ordering must not reproduce authoritative creation ordering");
  const relationships = ["2:42", "42:99"].map((id) => first.presentRelationshipId(id));
  assert.ok(relationships.every((id) => /^relationship-[0-9a-f]{16}$/.test(String(id))));
  assert.ok(relationships.every((id) => !String(id).includes(":") && !/relationship-000000/.test(String(id))));
  assert.throws(() => first.resolveEntityId("entity-000000000000002a"), /identifier is inaccessible/);
  assert.throws(() => first.resolveRelationshipId("42:99"), /identifier is inaccessible/);
});

test("present-moment MCP exposes only current-form tools and resources", async () => {
  const server = buildLaboratoryMcpServer(presentMomentExperiment, new PresentMomentFixtureGateway());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "present-moment-aperture-test", version: "1" }); await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["anomalies", "compare", "context", "inspect", "orient"]);
    const inspect = tools.find((tool) => tool.name === "inspect")!;
    assert.deepEqual((inspect.inputSchema.properties!.kind as any).enum, ["entity", "relationship", "region"]);
    assert.ok(!/checkpoint|event/i.test(inspect.description ?? ""));
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((item) => item.uriTemplate).sort();
    assert.equal(templates.length, 3); assert.ok(templates.some((uri) => uri.includes("/entity/")));
    assert.ok(templates.some((uri) => uri.includes("/relationship/"))); assert.ok(templates.some((uri) => uri.includes("/region/")));
    assert.ok(!templates.some((uri) => /checkpoint|event|observer/.test(uri)));
    const orient = await client.callTool({ name: "orient", arguments: {} });
    const content = JSON.stringify(orient); assert.match(content, /neighborCount|energy|coherence/);
    assert.ok(!/initialCount|birthTick|origin|activeDuration|oldestEntities|lastExternalArrivalTick/.test(content));
    const entityId = (orient.structuredContent as any).derived.structure.mostConnectedEntities[0].id;
    const resource = await client.readResource({ uri: `protouniverse://universe/U0-000001/entity/${entityId}` });
    const resourceText = (resource.contents[0] as any).text;
    assert.match(resourceText, /parentResources|relationshipResources|localDensity/);
    assert.ok(!/birthTick|creationIndex|historicalContext|activeDuration|origin/.test(resourceText));
  } finally { await client.close(); await server.close(); }
});

test("Laboratory output schemas satisfy strict Structured Outputs object and value requirements", async () => {
  const schemaFiles = [
    "server/laboratory/schemas/archaeological-reconstruction.schema.json",
    "server/laboratory/schemas/archaeological-reveal-comparison.schema.json",
  ];
  const audit = (node: unknown, location: string): void => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const schema = node as Record<string, unknown>;
    if ("const" in schema || "enum" in schema) assert.ok("type" in schema, `${location} must declare a type`);
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, `${location} must reject additional properties`);
      const keys = Object.keys((schema.properties ?? {}) as Record<string, unknown>).sort();
      assert.deepEqual([...(schema.required as string[])].sort(), keys, `${location} must require every property`);
    }
    for (const [key, value] of Object.entries(schema)) audit(value, `${location}.${key}`);
  };
  for (const file of schemaFiles) {
    const schema = JSON.parse(await readFile(path.resolve(file), "utf8"));
    assert.equal(schema.type, "object");
    audit(schema, file);
  }
});

test("reconstruction freezes once, validates hash and source ordering, and comparison writes once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lab-chamber-")); t.after(() => rm(root, { recursive: true, force: true }));
  const results = path.join(root, "results"), runs = path.join(root, "runs"), runDirectory = path.join(runs, chamberExperiment.id);
  await mkdir(runDirectory, { recursive: true });
  const reconstruction = { schemaVersion: "archaeological-reconstruction/1", observedRange: { entryTick: 400_000, accessibleHistoryStart: 250_000, latestObservedTick: 401_000 },
    inferredChronology: [], hypotheses: [{ id: "h1", hypothesis: "A prior development", epistemicStatus: "inference", evidence: ["present clue"], reasoning: "clue implies development",
      estimatedTiming: "before 250000", confidence: 0.6, competingExplanations: ["alternative"], prediction: "earlier events show it" }], presentlyUnknowable: [] };
  const finishedAt = "2026-01-01T00:01:00.000Z", metadataFile = "run-1.json";
  await writeFile(path.join(runDirectory, metadataFile), JSON.stringify({ succeeded: true, experimentId: chamberExperiment.id,
    observer: chamberExperiment.observer, finishedAt }));
  const frozen = await freezeReconstruction(results, chamberExperiment, { runId: "run-1", transcriptFile: "run-1.log", metadataFile,
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt, universeTickAtEntry: 400_000, simulationVersion: "test", exactOutput: JSON.stringify(reconstruction), reconstruction });
  assert.equal((await loadAndValidateFrozenArtifact(results, chamberExperiment)).integrity.payloadSha256, frozen.integrity.payloadSha256);
  await validateFrozenSourceRun(runs, chamberExperiment, frozen);
  await assert.rejects(freezeReconstruction(results, chamberExperiment, { runId: "run-2", transcriptFile: "x", metadataFile,
    startedAt: finishedAt, finishedAt, universeTickAtEntry: null, simulationVersion: null, exactOutput: "{}", reconstruction: {} }), /EEXIST/);
  const comparison = { schemaVersion: "archaeological-reveal-comparison/1", frozenArtifactHash: frozen.integrity.payloadSha256,
    evaluations: [{ hypothesisId: "h1", originalHypothesis: "A prior development", originalConfidence: 0.6,
      originalEvidence: ["present clue"], originalReasoning: "clue implies development", originalEstimatedTiming: "before 250000",
      originalCompetingExplanations: ["alternative"], originalPrediction: "earlier events show it" }] };
  validateComparisonAgainstFrozen(frozen, comparison, "archaeological-reveal-comparison/1");
  assert.throws(() => validateComparisonAgainstFrozen(frozen, { ...comparison, evaluations: [{ ...comparison.evaluations[0],
    originalHypothesis: "reinterpreted" }] }, "archaeological-reveal-comparison/1"), /altered or omitted/);
  await writeComparisonResult(results, chamberExperiment, frozen, { runId: "reveal-1", startedAt: finishedAt, finishedAt, exactOutput: JSON.stringify(comparison), comparison });
  await assert.rejects(writeComparisonResult(results, chamberExperiment, frozen, { runId: "reveal-2", startedAt: finishedAt, finishedAt,
    exactOutput: "{}", comparison: {} }), /EEXIST/);
  const file = path.join(results, chamberExperiment.id, "blind-reconstruction.json"); await chmod(file, 0o666);
  const tampered = JSON.parse(await readFile(file, "utf8")); tampered.payload.observer = "changed"; await writeFile(file, JSON.stringify(tampered));
  await assert.rejects(loadAndValidateFrozenArtifact(results, chamberExperiment), /integrity validation failed/);
});

test("reveal refuses without a frozen artifact and reveal profile exposes pre-horizon history read-only", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lab-reveal-")); t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(loadAndValidateFrozenArtifact(root, chamberExperiment), /no valid frozen Phase 1 artifact/);
  const source = new FixtureGateway(), revealDefinition = { ...chamberExperiment, observer: chamberExperiment.chamber!.reveal.observer,
    profile: chamberExperiment.chamber!.reveal.profile };
  const gateway = new LaboratoryGateway(source, revealDefinition);
  const history = await gateway.get("/api/history", { sinceTick: 0, untilTick: 249_999 });
  assert.deepEqual(history.results.map((item: any) => item.tick), [200_000]);
  await assert.rejects(gateway.post("/api/perception/mark-observed", {}), VeilAccessError);
});

test("Veil enforces history, checkpoint, event, universe, memory, and bookmark access", async () => {
  const source = new FixtureGateway(), gateway = new LaboratoryGateway(source, experiment);
  const history = await gateway.get("/api/history", { sinceTick: 0 });
  assert.equal(source.calls.at(-1)?.params.sinceTick, 250_000); assert.deepEqual(history.results.map((item: any) => item.tick), [260_000]); assert.equal(history.resultCount, 1);
  await assert.rejects(gateway.get("/api/history", { untilTick: 249_999 }), (error: unknown) => error instanceof VeilAccessError
    && /inaccessible/.test(error.message) && !/250000|profile|experiment|Veil/i.test(error.message));
  await assert.rejects(gateway.get("/api/checkpoint/200000"), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "event", tick: 200_000, sequence: 1 }), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/orient", { seed: "other" }), VeilAccessError);
  await assert.rejects(gateway.get("/api/observer-memory", { observer: experiment.observer }), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/since-last", { observer: experiment.observer }), VeilAccessError);
  await assert.rejects(gateway.post("/api/perception/mark-observed", {}), VeilAccessError);
});

test("current state remains available without obvious temporal, ancestry, or hidden-link leakage", async () => {
  const source = new FixtureGateway(), gateway = new LaboratoryGateway(source, experiment);
  const orient = await gateway.get("/api/perception/orient", { observer: "codex-first-entry" });
  assert.equal(orient.derived.identity.tick, 400_000); assert.equal(orient.memoryRange, undefined);
  assert.deepEqual(source.calls.at(-1)?.params, { seed: "U0-000001" }, "orient does not inherit any observer continuity");
  const entity = await gateway.get("/api/perception/inspect", { kind: "entity", id: "7" });
  assert.equal(entity.currentProperties.id, 7); assert.equal(entity.currentProperties.x, 4); assert.equal(entity.currentProperties.energy, 9);
  assert.equal(entity.currentProperties.birthTick, undefined); assert.equal(entity.currentProperties.age, undefined);
  assert.equal(entity.currentProperties.parentEntityIds, undefined); assert.equal(entity.history, undefined);
  const filtered = veilFilter({ links: ["protouniverse://universe/U0-000001/event/1200/1", "protouniverse://universe/U0-000001/event/280000/2",
    "protouniverse://universe/U0-000001/checkpoint/1000"] }, gateway.policy) as any;
  assert.deepEqual(filtered.links, ["protouniverse://universe/U0-000001/event/280000/2"]);
});

test("laboratory MCP omits memory and bookmark faculties while current resources remain readable", async () => {
  const authoritative = new FixtureGateway(), server = buildLaboratoryMcpServer(experiment, authoritative);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); const client = new Client({ name: "lab-test", version: "1" }); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("orient") && names.includes("history"));
    for (const hidden of ["since_last", "mark_observed", "recall_observer_memory", "remember", "update_observer_memory"]) assert.ok(!names.includes(hidden));
    const orient = await client.callTool({ name: "orient", arguments: {} });
    assert.equal((orient.structuredContent as any).experimentalContext, undefined);
    const resource = await client.readResource({ uri: "protouniverse://universe/U0-000001/entity/7" });
    const value = JSON.parse((resource.contents[0] as any).text); assert.equal(value.authoritative.id, 7); assert.equal(value.authoritative.birthTick, undefined);
    const templates = await client.listResourceTemplates(); assert.ok(!templates.resourceTemplates.some((item) => item.uriTemplate.includes("observer")));
  } finally { await client.close(); await server.close(); }
});

test("reveal MCP adds only the immutable reconstruction faculty to the observational tool set", async () => {
  const frozen: any = { recordType: "protouniverse-frozen-experiment-artifact/1", immutable: true, frozenAt: new Date().toISOString(),
    payload: { reconstruction: { hypotheses: [] } }, integrity: { algorithm: "sha256", payloadSha256: "abc", writeMode: "exclusive-create" } };
  const reveal = { ...chamberExperiment, observer: chamberExperiment.chamber!.reveal.observer, profile: chamberExperiment.chamber!.reveal.profile };
  const server = buildLaboratoryMcpServer(reveal, new FixtureGateway(), { frozenArtifact: frozen });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "reveal-test", version: "1" }); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("frozen_reconstruction")); assert.ok(names.includes("history")); assert.ok(names.includes("orient"));
    assert.ok(!names.includes("remember") && !names.includes("mark_observed"));
    const result = await client.callTool({ name: "frozen_reconstruction", arguments: {} });
    assert.equal((result.structuredContent as any).integrity.payloadSha256, "abc");
  } finally { await client.close(); await server.close(); }
});
