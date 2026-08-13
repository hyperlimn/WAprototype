import type { OccurrenceRecord, QuerySnapshot } from "../query/queryTypes.js";

export const MEMORY_SCHEMA_VERSION = "protouniverse-memory/1";
export type MemoryMode = "complete" | "condensed";

export interface MemoryIdentity { seed: string; simulationVersion: string; interfaceVersion: string }

export interface PersistedEvent extends OccurrenceRecord, MemoryIdentity {
  eventKey: string;
  recordedAt: string;
  notable: boolean;
  notableReasons: string[];
}

export interface SegmentMetadata {
  file: string;
  index: number;
  startTick: number;
  endTick: number;
  eventCount: number;
  bytes: number;
}

export interface CheckpointMetadata {
  file: string;
  tick: number;
  eventSequence: number | null;
  bytes: number;
  createdAt: string;
}

export interface UniverseManifest {
  memorySchemaVersion: typeof MEMORY_SCHEMA_VERSION;
  seed: string;
  simulationVersionsSeen: string[];
  firstTick: number | null;
  latestTick: number | null;
  memoryMode: MemoryMode;
  eventCount: number;
  checkpointCount: number;
  segmentCount: number;
  createdAt: string;
  lastUpdatedAt: string;
  segments: SegmentMetadata[];
  checkpoints: CheckpointMetadata[];
  condensedThroughTick: number | null;
  occurrenceTypesSeen: string[];
}

export interface StoredCheckpoint extends MemoryIdentity {
  memorySchemaVersion: typeof MEMORY_SCHEMA_VERSION;
  tick: number;
  eventSequence: number | null;
  recordedAt: string;
  snapshot: QuerySnapshot;
}

export interface NumericAggregate { min: number | null; max: number | null; mean: number | null; count: number }

export interface EraSummary {
  memorySchemaVersion: typeof MEMORY_SCHEMA_VERSION;
  seed: string;
  startTick: number;
  endTick: number;
  eventCounts: Record<string, number>;
  births: number;
  relationshipFormations: number;
  relationshipDestructions: number;
  ruptures: number;
  dimensionalTransitions: number;
  populationChange: number;
  coherence: NumericAggregate;
  synergy: NumericAggregate;
  notableEvents: Array<{ eventKey: string; tick: number; type: string; reasons: string[] }>;
  majorCheckpointReferences: string[];
  sourceSegmentReferences: string[];
  createdAt: string;
}

export interface HistoryQuery {
  sinceTick?: number; untilTick?: number; type?: string; entityId?: number; relationshipId?: string; limit: number;
}

export interface MemoryStatus {
  enabled: boolean; mode: MemoryMode; memorySchemaVersion: string; seed: string | null;
  persistedEventCount: number; latestPersistedTick: number | null; checkpointCount: number;
  segmentCount: number; activeSegmentSize: number; diskBytes: number; recentCacheCount: number;
}
