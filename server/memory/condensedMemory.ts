import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_SCHEMA_VERSION, type EraSummary, type NumericAggregate, type PersistedEvent, type UniverseManifest } from "../../src/memory/memoryTypes.js";
import type { MemoryPolicy } from "../../src/memory/memoryPolicy.js";

const numeric = (events: PersistedEvent[], key: "coherence" | "synergy"): NumericAggregate => {
  const values = events.map((event) => event[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? { min: Math.min(...values), max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length }
    : { min: null, max: null, mean: null, count: 0 };
};

const readEvents = async (universeDir: string, files: string[]): Promise<PersistedEvent[]> => {
  const events: PersistedEvent[] = [];
  for (const file of files) {
    try {
      for (const line of (await readFile(path.join(universeDir, file), "utf8")).split(/\r?\n/).filter(Boolean)) {
        try {
          const event = JSON.parse(line) as PersistedEvent;
          if (typeof event.eventKey === "string" && typeof event.tick === "number") events.push(event);
        } catch { /* Archive remains queryable even if one record is malformed. */ }
      }
    } catch { /* Missing source is represented by its retained provenance reference. */ }
  }
  return events;
};

export async function buildEraSummaries(universeDir: string, manifest: UniverseManifest, policy: MemoryPolicy): Promise<void> {
  const cutoff = (manifest.latestTick ?? 0) - policy.recentDetailTicks;
  if (cutoff < 0) return;
  const active = manifest.segments.at(-1);
  const eligible = manifest.segments.filter((segment) => segment.endTick <= cutoff
    && (segment !== active || segment.eventCount >= policy.segmentMaxEvents));
  const eras = new Map<number, typeof eligible>();
  for (const segment of eligible) {
    const firstEra = Math.floor(segment.startTick / policy.condensedEraTicks);
    const lastEra = Math.floor(segment.endTick / policy.condensedEraTicks);
    for (let era = firstEra; era <= lastEra; era++) {
      const values = eras.get(era) ?? []; values.push(segment); eras.set(era, values);
    }
  }
  for (const [era, segments] of eras) {
    const startTick = era * policy.condensedEraTicks;
    const endTick = startTick + policy.condensedEraTicks - 1;
    const name = `era-${String(startTick).padStart(12, "0")}-${String(endTick).padStart(12, "0")}.json`;
    const file = path.join(universeDir, "summaries", name);
    try { await readFile(file); continue; } catch { /* Build missing deterministic era summary. */ }
    const sourceSegmentReferences = segments.map((segment) => segment.file);
    const events = (await readEvents(universeDir, sourceSegmentReferences)).filter((event) => event.tick >= startTick && event.tick <= endTick);
    const eventCounts: Record<string, number> = {};
    for (const event of events) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    const births = eventCounts.reproduction ?? 0;
    const summary: EraSummary = {
      memorySchemaVersion: MEMORY_SCHEMA_VERSION, seed: manifest.seed, startTick, endTick, eventCounts, births,
      relationshipFormations: eventCounts["relationship-formed"] ?? 0,
      relationshipDestructions: eventCounts["relationship-destroyed"] ?? 0,
      ruptures: eventCounts.rupture ?? 0, dimensionalTransitions: eventCounts["dimensional-transition"] ?? 0,
      populationChange: births + (eventCounts["external-arrival"] ?? 0), coherence: numeric(events, "coherence"),
      synergy: numeric(events, "synergy"), notableEvents: events.filter((event) => event.notable)
        .map((event) => ({ eventKey: event.eventKey, tick: event.tick, type: event.type, reasons: event.notableReasons })),
      majorCheckpointReferences: manifest.checkpoints.filter((checkpoint) => checkpoint.tick >= startTick && checkpoint.tick <= endTick)
        .map((checkpoint) => checkpoint.file), sourceSegmentReferences, createdAt: new Date().toISOString(),
    };
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(summary, null, 2), "utf8"); await rename(temporary, file);
    manifest.condensedThroughTick = Math.max(manifest.condensedThroughTick ?? endTick, endTick);
  }
}
