import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalSnapshot } from "../types.js";
import type { OccurrenceRecord } from "../../src/query/queryTypes.js";
import { MEMORY_SCHEMA_VERSION, type CheckpointMetadata, type HistoryQuery, type MemoryIdentity,
  type MemoryStatus, type PersistedEvent, type SegmentMetadata, type StoredCheckpoint, type UniverseManifest } from "../../src/memory/memoryTypes.js";
import type { MemoryPolicy } from "../../src/memory/memoryPolicy.js";
import { classifyNotability } from "./notability.js";
import { buildEraSummaries } from "./condensedMemory.js";

const safeSeed = (seed: string): string => seed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
const segmentName = (index: number): string => `events-${String(index).padStart(6, "0")}.jsonl`;
const checkpointName = (tick: number): string => `checkpoint-${String(tick).padStart(12, "0")}.json`;

const freshManifest = (identity: MemoryIdentity, mode: MemoryPolicy["mode"], now: string): UniverseManifest => ({
  memorySchemaVersion: MEMORY_SCHEMA_VERSION, seed: identity.seed, simulationVersionsSeen: [identity.simulationVersion],
  firstTick: null, latestTick: null, memoryMode: mode, eventCount: 0, checkpointCount: 0, segmentCount: 0,
  createdAt: now, lastUpdatedAt: now, segments: [], checkpoints: [], condensedThroughTick: null,
  occurrenceTypesSeen: [],
});

const atomicJson = async (file: string, value: unknown): Promise<void> => {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
};

export class MemoryStore {
  private identity: MemoryIdentity | null = null;
  private manifest: UniverseManifest | null = null;
  private universeDir: string | null = null;
  private operation: Promise<void> = Promise.resolve();
  private recentKeys = new Set<string>();
  private readonly recentKeyOrder: string[] = [];
  private readonly segmentCache = new Map<string, { signature: string; parsed: { events: PersistedEvent[]; malformed: number } }>();
  private static readonly SEGMENT_CACHE_LIMIT = 4;

  constructor(readonly root: string, readonly policy: MemoryPolicy) {}

  get activeSeed(): string | null { return this.identity?.seed ?? null; }

  setIdentity(identity: MemoryIdentity): Promise<void> {
    return this.enqueue(async () => this.activate(identity));
  }

  ingestEvents(events: readonly OccurrenceRecord[], identity: MemoryIdentity): Promise<void> {
    return this.enqueue(async () => {
      await this.activate(identity);
      for (const event of events) await this.persistEvent(event);
      await this.persistManifest();
      if (this.policy.mode === "condensed") {
        await buildEraSummaries(this.requireDir(), this.requireManifest(), this.policy);
        await this.persistManifest();
      }
    });
  }

  ingestSnapshot(snapshot: CanonicalSnapshot, identity: MemoryIdentity): Promise<void> {
    return this.enqueue(async () => {
      await this.activate(identity);
      const tick = snapshot.metadata.currentTick;
      if (typeof tick !== "number" || tick < this.policy.checkpointIntervalTicks) return;
      const boundary = Math.floor(tick / this.policy.checkpointIntervalTicks);
      const alreadyCovered = this.requireManifest().checkpoints.some((checkpoint) =>
        Math.floor(checkpoint.tick / this.policy.checkpointIntervalTicks) === boundary);
      if (alreadyCovered) return;
      const recordedAt = new Date().toISOString();
      const eventSequence = snapshot.recentOccurrences?.at(-1)?.sequence ?? null;
      const stored: StoredCheckpoint = { memorySchemaVersion: MEMORY_SCHEMA_VERSION, ...identity, tick, eventSequence,
        recordedAt, snapshot };
      const file = path.join(this.requireDir(), "checkpoints", checkpointName(tick));
      await atomicJson(file, stored);
      const bytes = (await stat(file)).size;
      const metadata: CheckpointMetadata = { file: `checkpoints/${checkpointName(tick)}`, tick, eventSequence, bytes, createdAt: recordedAt };
      const manifest = this.requireManifest();
      manifest.checkpoints.push(metadata);
      manifest.checkpoints.sort((a, b) => a.tick - b.tick);
      manifest.checkpointCount = manifest.checkpoints.length;
      manifest.latestTick = Math.max(manifest.latestTick ?? tick, tick);
      await this.persistManifest();
    });
  }

  async queryHistory(query: HistoryQuery): Promise<{ resultCount: number; truncated: boolean; results: PersistedEvent[]; malformedRecordCount: number }> {
    await this.operation;
    const manifest = this.manifest;
    if (!manifest || !this.universeDir) return { resultCount: 0, truncated: false, results: [], malformedRecordCount: 0 };
    const results: PersistedEvent[] = [];
    let malformedRecordCount = 0, truncated = false;
    const segments = manifest.segments.filter((segment) =>
      (query.sinceTick === undefined || segment.endTick >= query.sinceTick)
      && (query.untilTick === undefined || segment.startTick <= query.untilTick));
    for (const segment of [...segments].reverse()) {
      const parsed = await this.readSegment(segment);
      malformedRecordCount += parsed.malformed;
      for (let index = parsed.events.length - 1; index >= 0; index--) {
        const event = parsed.events[index];
        if ((query.sinceTick !== undefined && event.tick < query.sinceTick)
          || (query.untilTick !== undefined && event.tick > query.untilTick)
          || (query.type !== undefined && event.type !== query.type)
          || (query.entityId !== undefined && event.entityId !== query.entityId && !event.parentEntityIds?.includes(query.entityId))
          || (query.relationshipId !== undefined && event.relationshipId !== query.relationshipId)) continue;
        if (results.length < query.limit) results.push(event);
        else { truncated = true; break; }
      }
      if (truncated) break;
    }
    results.sort((a, b) => b.tick - a.tick || b.sequence - a.sequence);
    return { resultCount: results.length, truncated, results, malformedRecordCount };
  }

  async historySummary(sinceTick?: number, untilTick?: number): Promise<Record<string, unknown>> {
    await this.operation;
    const eventCounts: Record<string, number> = {}; let eventCount = 0, malformedRecordCount = 0;
    for (const segment of (this.manifest?.segments ?? []).filter((item) =>
      (sinceTick === undefined || item.endTick >= sinceTick) && (untilTick === undefined || item.startTick <= untilTick))) {
      const parsed = await this.readSegment(segment); malformedRecordCount += parsed.malformed;
      for (const event of parsed.events) {
        if ((sinceTick !== undefined && event.tick < sinceTick) || (untilTick !== undefined && event.tick > untilTick)) continue;
        eventCount++; eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      }
    }
    const eras = await this.readEraSummaries(sinceTick, untilTick);
    return { seed: this.identity?.seed ?? null, sinceTick: sinceTick ?? null, untilTick: untilTick ?? null,
      eventCount, eventCounts, condensedEras: eras, malformedRecordCount };
  }

  async checkpoints(): Promise<CheckpointMetadata[]> { await this.operation; return [...(this.manifest?.checkpoints ?? [])]; }

  async checkpoint(tick: number): Promise<StoredCheckpoint | null> {
    await this.operation;
    const metadata = this.manifest?.checkpoints.find((item) => item.tick === tick);
    if (!metadata || !this.universeDir) return null;
    try { return JSON.parse(await readFile(path.join(this.universeDir, metadata.file), "utf8")) as StoredCheckpoint; }
    catch { return null; }
  }

  async status(recentCacheCount: number): Promise<MemoryStatus> {
    await this.operation;
    const manifest = this.manifest;
    const diskBytes = manifest ? manifest.segments.reduce((sum, item) => sum + item.bytes, 0)
      + manifest.checkpoints.reduce((sum, item) => sum + item.bytes, 0) : 0;
    return { enabled: true, mode: this.policy.mode, memorySchemaVersion: MEMORY_SCHEMA_VERSION,
      seed: manifest?.seed ?? null, persistedEventCount: manifest?.eventCount ?? 0,
      latestPersistedTick: manifest?.latestTick ?? null, checkpointCount: manifest?.checkpointCount ?? 0,
      segmentCount: manifest?.segmentCount ?? 0, activeSegmentSize: manifest?.segments.at(-1)?.eventCount ?? 0,
      diskBytes, recentCacheCount };
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.operation.then(action);
    this.operation = next.catch((error) => console.error("ProtoUniverse memory operation failed", error));
    return this.operation;
  }

  private async activate(identity: MemoryIdentity): Promise<void> {
    if (this.identity && this.identity.seed === identity.seed && this.identity.simulationVersion === identity.simulationVersion) return;
    this.identity = identity;
    this.universeDir = path.join(this.root, "universes", safeSeed(identity.seed));
    await mkdir(path.join(this.universeDir, "events"), { recursive: true });
    await mkdir(path.join(this.universeDir, "checkpoints"), { recursive: true });
    await mkdir(path.join(this.universeDir, "summaries"), { recursive: true });
    const manifestFile = path.join(this.universeDir, "manifest.json");
    try {
      const candidate = JSON.parse(await readFile(manifestFile, "utf8")) as UniverseManifest;
      this.manifest = candidate.memorySchemaVersion === MEMORY_SCHEMA_VERSION && candidate.seed === identity.seed
        ? candidate : freshManifest(identity, this.policy.mode, new Date().toISOString());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Cannot safely open memory manifest ${manifestFile}`, { cause: error });
      this.manifest = freshManifest(identity, this.policy.mode, new Date().toISOString());
    }
    this.manifest.memoryMode = this.policy.mode;
    this.manifest.occurrenceTypesSeen ??= [];
    if (!this.manifest.simulationVersionsSeen.includes(identity.simulationVersion)) this.manifest.simulationVersionsSeen.push(identity.simulationVersion);
    this.recentKeys.clear(); this.recentKeyOrder.length = 0; this.segmentCache.clear();
    const active = this.manifest.segments.at(-1);
    if (active) {
      const recovered = await this.readSegment(active);
      if (recovered.events.length) {
        active.eventCount = recovered.events.length;
        active.startTick = Math.min(...recovered.events.map((event) => event.tick));
        active.endTick = Math.max(...recovered.events.map((event) => event.tick));
        try { active.bytes = (await stat(path.join(this.requireDir(), active.file))).size; } catch { /* Preserve last known size. */ }
        for (const event of recovered.events) if (!this.manifest.occurrenceTypesSeen.includes(event.type)) this.manifest.occurrenceTypesSeen.push(event.type);
        for (const event of recovered.events.slice(-2_000)) this.rememberKey(event.eventKey);
      }
    }
    this.manifest.eventCount = this.manifest.segments.reduce((sum, segment) => sum + segment.eventCount, 0);
    this.manifest.segmentCount = this.manifest.segments.length;
    this.manifest.checkpointCount = this.manifest.checkpoints.length;
    const observedTicks = [...this.manifest.segments.flatMap((segment) => [segment.startTick, segment.endTick]),
      ...this.manifest.checkpoints.map((checkpoint) => checkpoint.tick)];
    this.manifest.firstTick = observedTicks.length ? Math.min(...observedTicks) : null;
    this.manifest.latestTick = observedTicks.length ? Math.max(...observedTicks) : null;
    await this.persistManifest();
  }

  private async persistEvent(event: OccurrenceRecord): Promise<void> {
    const identity = this.identity!;
    const eventKey = `${identity.seed}|${identity.simulationVersion}|${event.tick}|${event.sequence}|${event.type}`;
    if (this.recentKeys.has(eventKey) || await this.existsOnDisk(eventKey, event.tick)) return;
    const manifest = this.requireManifest();
    let segment = manifest.segments.at(-1);
    if (!segment || segment.eventCount >= this.policy.segmentMaxEvents) {
      const index = (segment?.index ?? 0) + 1;
      segment = { file: `events/${segmentName(index)}`, index, startTick: event.tick, endTick: event.tick, eventCount: 0, bytes: 0 };
      manifest.segments.push(segment); manifest.segmentCount = manifest.segments.length;
    }
    const firstType = !manifest.occurrenceTypesSeen.includes(event.type);
    const notableReasons = classifyNotability(event, firstType);
    const persisted: PersistedEvent = { ...event, ...identity, eventKey, recordedAt: new Date().toISOString(),
      notable: notableReasons.length > 0, notableReasons };
    const line = `${JSON.stringify(persisted)}\n`;
    await appendFile(path.join(this.requireDir(), segment.file), line, "utf8");
    this.segmentCache.delete(segment.file);
    segment.eventCount++; segment.startTick = Math.min(segment.startTick, event.tick); segment.endTick = Math.max(segment.endTick, event.tick);
    segment.bytes += Buffer.byteLength(line);
    manifest.eventCount++; manifest.firstTick = Math.min(manifest.firstTick ?? event.tick, event.tick);
    manifest.latestTick = Math.max(manifest.latestTick ?? event.tick, event.tick);
    if (firstType) manifest.occurrenceTypesSeen.push(event.type);
    this.rememberKey(eventKey);
  }

  private async existsOnDisk(key: string, tick: number): Promise<boolean> {
    for (const segment of this.requireManifest().segments.filter((item) => item.startTick <= tick && item.endTick >= tick)) {
      if ((await this.readSegment(segment)).events.some((event) => event.eventKey === key)) return true;
    }
    return false;
  }

  private async readSegment(segment: SegmentMetadata): Promise<{ events: PersistedEvent[]; malformed: number }> {
    const signature = `${segment.bytes}:${segment.eventCount}`;
    const cached = this.segmentCache.get(segment.file);
    if (cached?.signature === signature) {
      this.segmentCache.delete(segment.file); this.segmentCache.set(segment.file, cached);
      return cached.parsed;
    }
    try {
      const lines = (await readFile(path.join(this.requireDir(), segment.file), "utf8")).split(/\r?\n/).filter(Boolean);
      const events: PersistedEvent[] = []; let malformed = 0;
      for (const line of lines) {
        try {
          const value = JSON.parse(line) as Partial<PersistedEvent>;
          if (typeof value.eventKey !== "string" || typeof value.tick !== "number" || typeof value.sequence !== "number" || typeof value.type !== "string") malformed++;
          else events.push(value as PersistedEvent);
        } catch { malformed++; }
      }
      const parsed = { events, malformed };
      this.segmentCache.set(segment.file, { signature, parsed });
      while (this.segmentCache.size > MemoryStore.SEGMENT_CACHE_LIMIT) this.segmentCache.delete(this.segmentCache.keys().next().value!);
      return parsed;
    } catch { return { events: [], malformed: 1 }; }
  }

  private async readEraSummaries(sinceTick?: number, untilTick?: number): Promise<unknown[]> {
    if (!this.universeDir) return [];
    try {
      const files = (await readdir(path.join(this.universeDir, "summaries"))).filter((file) => file.endsWith(".json"));
      const summaries: unknown[] = [];
      for (const file of files) {
        try {
          const value = JSON.parse(await readFile(path.join(this.universeDir, "summaries", file), "utf8")) as { startTick: number; endTick: number };
          if ((sinceTick === undefined || value.endTick >= sinceTick) && (untilTick === undefined || value.startTick <= untilTick)) summaries.push(value);
        } catch { /* A malformed summary never prevents archive queries. */ }
      }
      return summaries;
    } catch { return []; }
  }

  private rememberKey(key: string): void {
    this.recentKeys.add(key); this.recentKeyOrder.push(key);
    if (this.recentKeyOrder.length > 2_000) this.recentKeys.delete(this.recentKeyOrder.shift()!);
  }
  private requireManifest(): UniverseManifest { if (!this.manifest) throw new Error("Memory identity is unavailable"); return this.manifest; }
  private requireDir(): string { if (!this.universeDir) throw new Error("Memory identity is unavailable"); return this.universeDir; }
  private async persistManifest(): Promise<void> {
    const manifest = this.requireManifest(); manifest.lastUpdatedAt = new Date().toISOString();
    await atomicJson(path.join(this.requireDir(), "manifest.json"), manifest);
  }
}
