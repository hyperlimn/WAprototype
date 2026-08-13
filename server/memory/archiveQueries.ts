import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CheckpointMetadata, HistoryQuery, PersistedEvent, StoredCheckpoint } from "../../src/memory/memoryTypes.js";
import type { ArchiveDescriptor } from "./universeCatalog.js";
import { decodeHistoryCursor, encodeHistoryCursor, historyQueryFingerprint } from "./historyCursor.js";
import { QueryValidationError } from "../queryValidation.js";

export interface HistoryPage {
  seed: string; query: HistoryQuery; resultCount: number; results: PersistedEvent[];
  nextCursor: string | null; hasMore: boolean; malformedRecordCount: number;
}

const archiveFile = (archive: ArchiveDescriptor, relative: string): string => {
  const target = path.resolve(archive.directory, relative);
  const prefix = `${path.resolve(archive.directory)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error("Archive manifest contains an unsafe file reference");
  return target;
};

const matching = (event: PersistedEvent, query: Omit<HistoryQuery, "limit">): boolean =>
  (query.sinceTick === undefined || event.tick >= query.sinceTick)
  && (query.untilTick === undefined || event.tick <= query.untilTick)
  && (query.type === undefined || event.type === query.type)
  && (query.entityId === undefined || event.entityId === query.entityId || event.parentEntityIds?.includes(query.entityId) === true)
  && (query.relationshipId === undefined || event.relationshipId === query.relationshipId);

const parseEvent = (line: string): PersistedEvent | null => {
  try {
    const value = JSON.parse(line) as Partial<PersistedEvent>;
    return typeof value.eventKey === "string" && typeof value.tick === "number" && typeof value.sequence === "number"
      && typeof value.type === "string" ? value as PersistedEvent : null;
  } catch { return null; }
};

export async function queryHistoryPage(archive: ArchiveDescriptor, query: HistoryQuery, cursor?: string): Promise<HistoryPage> {
  const filters: Omit<HistoryQuery, "limit"> = { sinceTick: query.sinceTick, untilTick: query.untilTick, type: query.type,
    entityId: query.entityId, relationshipId: query.relationshipId };
  const decoded = cursor ? decodeHistoryCursor(cursor, archive.manifest.seed, filters) : null;
  const segments = archive.manifest.segments.filter((segment) =>
    (query.sinceTick === undefined || segment.endTick >= query.sinceTick)
    && (query.untilTick === undefined || segment.startTick <= query.untilTick)).sort((a, b) => b.index - a.index);
  const results: PersistedEvent[] = []; let malformedRecordCount = 0, started = decoded === null;
  let nextCursor: string | null = null;
  for (const segment of segments) {
    if (!started) {
      if (segment.index !== decoded!.segmentIndex) continue;
      started = true;
    }
    let lines: string[];
    try { lines = (await readFile(archiveFile(archive, segment.file), "utf8")).split(/\r?\n/); }
    catch { malformedRecordCount++; continue; }
    const initialPosition = decoded && segment.index === decoded.segmentIndex ? decoded.recordPosition : lines.length - 1;
    for (let position = Math.min(initialPosition, lines.length - 1); position >= 0; position--) {
      if (!lines[position]) continue;
      const event = parseEvent(lines[position]);
      if (!event) { malformedRecordCount++; continue; }
      if (!matching(event, filters)) continue;
      if (results.length < query.limit) results.push(event);
      else {
        nextCursor = encodeHistoryCursor({ seed: archive.manifest.seed, queryFingerprint: historyQueryFingerprint(filters),
          segmentIndex: segment.index, recordPosition: position });
        return { seed: archive.manifest.seed, query, resultCount: results.length, results, nextCursor,
          hasMore: true, malformedRecordCount };
      }
    }
  }
  if (decoded && !started) throw new QueryValidationError("cursor", cursor ?? null, "cursor segment no longer exists in this archive");
  return { seed: archive.manifest.seed, query, resultCount: results.length, results, nextCursor, hasMore: false, malformedRecordCount };
}

export function listCheckpoints(archive: ArchiveDescriptor, sinceTick?: number, untilTick?: number, limit = 100): CheckpointMetadata[] {
  return archive.manifest.checkpoints.filter((checkpoint) =>
    (sinceTick === undefined || checkpoint.tick >= sinceTick) && (untilTick === undefined || checkpoint.tick <= untilTick))
    .sort((a, b) => b.tick - a.tick).slice(0, limit);
}

export async function getCheckpoint(archive: ArchiveDescriptor, tick: number): Promise<StoredCheckpoint | null> {
  const metadata = archive.manifest.checkpoints.find((checkpoint) => checkpoint.tick === tick);
  if (!metadata) return null;
  try {
    const value = JSON.parse(await readFile(archiveFile(archive, metadata.file), "utf8")) as StoredCheckpoint;
    return value.tick === tick && value.seed === archive.manifest.seed ? value : null;
  } catch { return null; }
}

export async function findNearestCheckpoint(archive: ArchiveDescriptor, tick: number,
  direction: "before" | "after" | "nearest"): Promise<{ metadata: CheckpointMetadata; checkpoint: StoredCheckpoint } | null> {
  const checkpoints = archive.manifest.checkpoints;
  let candidates = direction === "before" ? checkpoints.filter((item) => item.tick <= tick)
    : direction === "after" ? checkpoints.filter((item) => item.tick >= tick) : checkpoints;
  candidates = [...candidates].sort((a, b) => direction === "before" ? b.tick - a.tick
    : direction === "after" ? a.tick - b.tick : Math.abs(a.tick - tick) - Math.abs(b.tick - tick) || a.tick - b.tick);
  for (const metadata of candidates) {
    const checkpoint = await getCheckpoint(archive, metadata.tick);
    if (checkpoint) return { metadata, checkpoint };
  }
  return null;
}

export function archiveStatus(archive: ArchiveDescriptor, recentCacheCount: number, activeSeed: string | null): Record<string, unknown> {
  const manifest = archive.manifest;
  return { enabled: true, archived: true, activeBridgeUniverse: manifest.seed === activeSeed, mode: manifest.memoryMode,
    memorySchemaVersion: manifest.memorySchemaVersion, seed: manifest.seed, persistedEventCount: manifest.eventCount,
    latestPersistedTick: manifest.latestTick, checkpointCount: manifest.checkpointCount, segmentCount: manifest.segmentCount,
    activeSegmentSize: manifest.segments.at(-1)?.eventCount ?? 0, diskBytes: archive.metadata.diskBytes,
    recentCacheCount: manifest.seed === activeSeed ? recentCacheCount : 0 };
}

export function universeSummary(archive: ArchiveDescriptor, activeSeed: string | null): Record<string, unknown> {
  const checkpoints = [...archive.manifest.checkpoints].sort((a, b) => a.tick - b.tick);
  return { seed: archive.manifest.seed, archived: true, activeBridgeUniverse: archive.manifest.seed === activeSeed,
    manifest: archive.metadata, tickSpan: { firstTick: archive.manifest.firstTick, latestTick: archive.manifest.latestTick },
    eventCount: archive.manifest.eventCount, checkpointCount: archive.manifest.checkpointCount,
    eventCountsByType: null, observedEventTypes: archive.manifest.occurrenceTypesSeen ?? [],
    earliestCheckpoint: checkpoints.at(0) ?? null, latestCheckpoint: checkpoints.at(-1) ?? null,
    availableSimulationVersions: archive.manifest.simulationVersionsSeen };
}

export async function summarizeArchiveHistory(archive: ArchiveDescriptor, sinceTick?: number, untilTick?: number): Promise<Record<string, unknown>> {
  const eventCounts: Record<string, number> = {}; let eventCount = 0, malformedRecordCount = 0;
  const segments = archive.manifest.segments.filter((segment) =>
    (sinceTick === undefined || segment.endTick >= sinceTick) && (untilTick === undefined || segment.startTick <= untilTick));
  for (const segment of segments) {
    let lines: string[];
    try { lines = (await readFile(archiveFile(archive, segment.file), "utf8")).split(/\r?\n/).filter(Boolean); }
    catch { malformedRecordCount++; continue; }
    for (const line of lines) {
      const event = parseEvent(line);
      if (!event) { malformedRecordCount++; continue; }
      if ((sinceTick !== undefined && event.tick < sinceTick) || (untilTick !== undefined && event.tick > untilTick)) continue;
      eventCount++; eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    }
  }
  return { seed: archive.manifest.seed, sinceTick: sinceTick ?? null, untilTick: untilTick ?? null,
    eventCount, eventCounts, malformedRecordCount };
}
