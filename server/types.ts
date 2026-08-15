import type { EntityRecord, OccurrenceRecord, QuerySnapshot, RelationshipRecord } from "../src/query/queryTypes.js";
import type { RuntimeProvenance } from "../src/simulation/saveState.js";

export const INTERFACE_VERSION = "protouniverse-machine-interface/5";

export interface Heartbeat {
  interfaceVersion: string;
  simulationVersion: string;
  seed: string;
  currentTick: number;
  entityCount: number;
  runtime?: RuntimeProvenance;
  saveStateSchemaVersion?: string;
}

export interface CanonicalSnapshot extends QuerySnapshot {
  metadata: QuerySnapshot["metadata"] & { simulationVersion?: string; seed?: string; entityCount?: number };
  entities?: EntityRecord[];
  relationships?: RelationshipRecord[];
  recentOccurrences?: OccurrenceRecord[];
}
