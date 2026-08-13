import path from "node:path";
import type { StateStore } from "../stateStore.js";
import type { MemoryStore } from "../memory/memoryStore.js";
import { listUniverses, type ArchiveDescriptor } from "../memory/universeCatalog.js";
import { resolveUniverse } from "../memory/archiveSelection.js";
import { findNearestCheckpoint, getCheckpoint, queryHistoryPage } from "../memory/archiveQueries.js";
import type { ObservedUniverse } from "../../src/perception/perceptionTypes.js";
import { orientUniverse } from "../../src/perception/orientation.js";
import { inspectTarget, contextOf, type InspectionTarget } from "../../src/perception/inspection.js";
import { detectChanges } from "../../src/perception/changeDetection.js";
import { findAnomalies } from "../../src/perception/anomalyDetection.js";
import { findSimilarEntity, findSimilarRelationship, findSimilarRegions } from "../../src/perception/similarity.js";
import { compareEntities, compareRegions, compareRelationships, compareUniverses } from "../../src/perception/comparison.js";
import { queryRegion } from "../../src/query/spatialQueries.js";
import { ObserverStore } from "./observerStore.js";

export class PerceptionResourceNotFoundError extends Error { constructor(readonly resource: string, readonly id: string) { super(`${resource} ${id} was not found`); } }

export class PerceptionService {
  readonly observers: ObserverStore;
  constructor(readonly state: StateStore, readonly memory: MemoryStore) {
    this.observers = new ObserverStore(path.join(memory.root, "observers"));
  }

  async observe(seed?: string, checkpointTick?: number): Promise<{ observation: ObservedUniverse; archive: ArchiveDescriptor | null }> {
    const activeSeed = this.memory.activeSeed;
    if ((seed === undefined || seed === activeSeed) && checkpointTick === undefined && this.state.snapshot && activeSeed) {
      return { archive: null, observation: { source: { seed: activeSeed,
        simulationVersion: String(this.state.snapshot.metadata.simulationVersion ?? this.state.heartbeat?.simulationVersion ?? "unknown"),
        tick: typeof this.state.snapshot.metadata.currentTick === "number" ? this.state.snapshot.metadata.currentTick : null,
        mode: "live", authoritative: "canonical-snapshot" }, snapshot: this.state.snapshot, events: [...this.state.events],
        memoryRange: { firstTick: null, latestTick: typeof this.state.snapshot.metadata.currentTick === "number" ? this.state.snapshot.metadata.currentTick : null } } };
    }
    const archive = resolveUniverse(await listUniverses(this.memory.root), seed, activeSeed);
    const selected = checkpointTick === undefined
      ? await findNearestCheckpoint(archive, archive.manifest.latestTick ?? 0, "before")
      : await findNearestCheckpoint(archive, checkpointTick, "nearest");
    const history = await queryHistoryPage(archive, { limit: 200 });
    return { archive, observation: { source: { seed: archive.manifest.seed,
      simulationVersion: selected?.checkpoint.simulationVersion ?? archive.manifest.simulationVersionsSeen.at(-1) ?? null,
      tick: selected?.checkpoint.tick ?? archive.manifest.latestTick, mode: "archived",
      authoritative: selected ? "checkpoint" : "archive-events" }, snapshot: selected?.checkpoint.snapshot ?? null,
      events: history.results, memoryRange: { firstTick: archive.manifest.firstTick, latestTick: archive.manifest.latestTick } } };
  }

  async orient(seed?: string): Promise<unknown> { return orientUniverse((await this.observe(seed)).observation); }

  async inspect(seed: string | undefined, target: InspectionTarget, depth: number): Promise<Record<string, unknown>> {
    const selected = await this.observe(seed, target.kind === "checkpoint" ? target.tick : undefined);
    const result = inspectTarget(selected.observation, target, depth);
    if (!result) throw new PerceptionResourceNotFoundError(target.kind, target.id ?? String(target.tick ?? "target"));
    if (selected.archive && (target.kind === "entity" || target.kind === "relationship")) {
      const history = await queryHistoryPage(selected.archive, { limit: 25,
        entityId: target.kind === "entity" ? Number(target.id) : undefined,
        relationshipId: target.kind === "relationship" ? String(target.id) : undefined });
      result.historicalContext = { ...(result.historicalContext as object ?? {}), persistedEvents: history.results, hasMore: history.hasMore };
    }
    return result;
  }

  async context(seed: string | undefined, target: InspectionTarget): Promise<Record<string, unknown>> {
    const result = contextOf((await this.observe(seed)).observation, target);
    if (!result) throw new PerceptionResourceNotFoundError(target.kind, target.id ?? "target"); return result;
  }

  async changes(options: { seed?: string; compareSeed?: string; checkpoint?: number; sinceTick?: number; tick?: number }): Promise<Record<string, unknown>> {
    const current = await this.observe(options.seed, options.tick);
    let reference;
    if (options.compareSeed) reference = await this.observe(options.compareSeed, options.tick);
    else {
      if (!current.archive) {
        const archive = resolveUniverse(await listUniverses(this.memory.root), current.observation.source.seed, this.memory.activeSeed);
        const requested = options.checkpoint ?? options.sinceTick ?? Math.max(0, (current.observation.source.tick ?? 0) - 25_000);
        const selected = await findNearestCheckpoint(archive, requested, "before");
        if (!selected) throw new PerceptionResourceNotFoundError("checkpoint", String(requested));
        reference = { archive, observation: { ...current.observation, source: { ...current.observation.source, tick: selected.checkpoint.tick, mode: "archived" as const, authoritative: "checkpoint" as const }, snapshot: selected.checkpoint.snapshot, events: [] } };
      } else reference = await this.observe(options.seed, options.checkpoint ?? options.sinceTick ?? Math.max(0, (current.observation.source.tick ?? 0) - 25_000));
    }
    if (!current.observation.snapshot || !reference.observation.snapshot) throw new PerceptionResourceNotFoundError("snapshot", "comparison");
    return { source: current.observation.source, reference: reference.observation.source,
      derived: detectChanges(current.observation.snapshot, reference.observation.snapshot, current.observation.events, reference.observation.events) };
  }

  async anomalies(seed?: string, kind?: string, limit = 10, region?: { x: number; y: number; radius: number }): Promise<Record<string, unknown>> {
    const observation = (await this.observe(seed)).observation;
    if (!observation.snapshot) throw new PerceptionResourceNotFoundError("snapshot", observation.source.seed);
    let results = findAnomalies(observation.snapshot, kind, region ? 100 : limit);
    if (region) results = results.filter((item) => {
      const object = item.kind === "entity" ? observation.snapshot!.entities?.find((value) => value.id === item.identifier)
        : observation.snapshot!.relationships?.find((value) => value.id === item.identifier);
      return object?.x !== null && object?.x !== undefined && object.y !== null && object.y !== undefined
        && Math.hypot(object.x - region.x, object.y - region.y) <= region.radius;
    }).slice(0, limit);
    return { source: observation.source, method: "median-MAD", region: region ?? null, results };
  }

  async similar(seed: string | undefined, kind: string, id: string | undefined, limit = 10, region?: { x: number; y: number; radius: number }): Promise<Record<string, unknown>> {
    const observation = (await this.observe(seed)).observation, snapshot = observation.snapshot;
    if (!snapshot) throw new PerceptionResourceNotFoundError("snapshot", observation.source.seed);
    if (kind === "entity") {
      const target = snapshot.entities?.find((item) => item.id === Number(id)); if (!target) throw new PerceptionResourceNotFoundError(kind, String(id));
      return findSimilarEntity(snapshot, target, limit);
    }
    if (kind === "relationship") {
      const target = snapshot.relationships?.find((item) => item.id === id); if (!target) throw new PerceptionResourceNotFoundError(kind, String(id));
      return findSimilarRelationship(snapshot, target, limit);
    }
    if (kind === "region" && region) return findSimilarRegions(snapshot, observation.events, region, limit);
    throw new PerceptionResourceNotFoundError(kind, String(id));
  }

  async compare(options: { seed?: string; compareSeed?: string; kind: string; idA?: string; idB?: string; tickA?: number; tickB?: number;
    regionA?: { x: number; y: number; radius: number }; regionB?: { x: number; y: number; radius: number } }): Promise<Record<string, unknown>> {
    const a = await this.observe(options.seed, options.tickA), b = options.compareSeed || options.kind === "universe" || options.kind === "checkpoint"
      ? await this.observe(options.compareSeed ?? options.seed, options.tickB) : a;
    if (!a.observation.snapshot || !b.observation.snapshot) throw new PerceptionResourceNotFoundError("snapshot", "comparison");
    if (options.kind === "universe" || options.kind === "checkpoint") return compareUniverses(a.observation.snapshot, b.observation.snapshot,
      [a.observation.source.simulationVersion, b.observation.source.simulationVersion]);
    if (options.kind === "entity") {
      const first = a.observation.snapshot.entities?.find((item) => item.id === Number(options.idA)), second = b.observation.snapshot.entities?.find((item) => item.id === Number(options.idB));
      if (!first || !second) throw new PerceptionResourceNotFoundError("entity", `${options.idA},${options.idB}`); return compareEntities(first, second);
    }
    if (options.kind === "relationship") {
      const first = a.observation.snapshot.relationships?.find((item) => item.id === options.idA), second = b.observation.snapshot.relationships?.find((item) => item.id === options.idB);
      if (!first || !second) throw new PerceptionResourceNotFoundError("relationship", `${options.idA},${options.idB}`); return compareRelationships(first, second);
    }
    if (options.kind === "region" && options.regionA && options.regionB) {
      const first = queryRegion(a.observation.snapshot, a.observation.events, { ...options.regionA, limit: 100 }, "perception-internal").results.metrics;
      const second = queryRegion(b.observation.snapshot, b.observation.events, { ...options.regionB, limit: 100 }, "perception-internal").results.metrics;
      return compareRegions(first, second);
    }
    throw new PerceptionResourceNotFoundError("comparison-kind", options.kind);
  }

  async sinceLast(observer: string, seed?: string): Promise<Record<string, unknown>> {
    const current = await this.observe(seed), bookmark = await this.observers.get(observer), tick = bookmark.lastOrientationTickBySeed[current.observation.source.seed];
    if (tick === undefined) return { observer, seed: current.observation.source.seed, previouslyObserved: false,
      message: "No prior observation bookmark exists.", currentTick: current.observation.source.tick };
    try { return { observer, seed: current.observation.source.seed, previouslyObserved: true, sinceTick: tick,
      changes: await this.changes({ seed: current.observation.source.seed, sinceTick: tick }) }; }
    catch (error) {
      if (!(error instanceof PerceptionResourceNotFoundError) || error.resource !== "checkpoint") throw error;
      const archive = resolveUniverse(await listUniverses(this.memory.root), current.observation.source.seed, this.memory.activeSeed);
      const history = await queryHistoryPage(archive, { sinceTick: tick, limit: 100 });
      const eventCounts: Record<string, number> = {};
      for (const event of history.results) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      return { observer, seed: current.observation.source.seed, previouslyObserved: true, sinceTick: tick,
        changes: { source: "archive-events", events: history.results, eventCounts, hasMore: history.hasMore,
          limitation: "No checkpoint at or before the bookmark was available; structural change could not be derived." } };
    }
  }
}
