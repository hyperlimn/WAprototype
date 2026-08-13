export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 500;

export interface EntityRecord {
  id: number; creationIndex: number; fingerprint: string; origin: string; birthTick: number;
  parentRelationshipId: string | null; parentEntityIds: readonly [number, number] | null;
  alpha: number | null; beta: number | null; gamma: number | null;
  x: number | null; y: number | null; vx: number | null; vy: number | null;
  energy: number | null; age: number | null; neighborCount: number;
  strongestRelationship: number | null; strongestBond: number | null; currentRelationshipIds: string[];
}

export interface RelationshipRecord {
  id: string; fingerprint: string; parentAId: number; parentBId: number; creationTick: number;
  age: number | null; spatialActive: boolean; influenceActive: boolean;
  bondStrength: number | null; relationshipStrength: number | null;
  x: number | null; y: number | null; coherence: number | null; localRelationshipDensity: number;
  synergy: number | null; localFieldPotential: number | null; ruptureQualified: boolean;
  [key: string]: unknown;
}

export interface OccurrenceRecord {
  sequence: number; tick: number; type: string; description: string;
  entityId?: number; relationshipId?: string; parentEntityIds?: readonly [number, number];
  x: number | null; y: number | null; [key: string]: unknown;
}

export interface QuerySnapshot {
  metadata: { currentTick?: number; [key: string]: unknown };
  entities?: EntityRecord[];
  relationships?: RelationshipRecord[];
  reproductionSummary?: { recentReproductionEvents?: unknown[]; [key: string]: unknown };
  ruptureSummary?: { recentRuptureEvents?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface QueryIndexes {
  entityById: ReadonlyMap<number, EntityRecord>;
  relationshipById: ReadonlyMap<string, RelationshipRecord>;
  relationshipsByParent: ReadonlyMap<number, readonly RelationshipRecord[]>;
}

export interface QueryResponse<T, Q extends object = Record<string, unknown>> {
  interfaceVersion: string;
  currentTick: number | null;
  query: Q;
  resultCount: number;
  truncated: boolean;
  results: T;
}

export interface EntityQueryParams {
  origin?: string; minAge?: number; maxAge?: number; minEnergy?: number; minNeighbors?: number;
  minStrongestBond?: number; minStrongestRelationship?: number; relationshipId?: string;
  limit: number; sort: "age-desc" | "energy-desc" | "neighbors-desc" | "bond-desc" | "relationship-desc" | "id-asc";
}

export interface RelationshipQueryParams {
  minAge?: number; maxAge?: number; minBond?: number; minStrength?: number; minCoherence?: number;
  minDensity?: number; minSynergy?: number; spatialActive?: boolean; influenceActive?: boolean;
  dormant?: boolean; parentEntityId?: number; ruptureEligible?: boolean; limit: number;
  sort: "age-desc" | "bond-desc" | "coherence-desc" | "density-desc" | "synergy-desc" | "id-asc";
}

export const finite = (value: number | null | undefined): number => value ?? Number.NEGATIVE_INFINITY;
export const currentTick = (snapshot: QuerySnapshot): number | null =>
  typeof snapshot.metadata.currentTick === "number" ? snapshot.metadata.currentTick : null;
