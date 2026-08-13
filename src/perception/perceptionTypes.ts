import type { OccurrenceRecord, QuerySnapshot } from "../query/queryTypes.js";

export const PERCEPTION_SCHEMA_VERSION = "protouniverse-perception/1";
export const PERCEPTION_FEATURE_VERSION = "protouniverse-perception-features/1";

export interface PerceptionSource {
  seed: string; simulationVersion: string | null; tick: number | null; mode: "live" | "archived";
  authoritative: "canonical-snapshot" | "checkpoint" | "archive-events";
}

export interface ObservedUniverse {
  source: PerceptionSource;
  snapshot: QuerySnapshot | null;
  events: OccurrenceRecord[];
  memoryRange: { firstTick: number | null; latestTick: number | null };
}

export interface Explainability {
  classification: "derived" | "inferred";
  method: string;
  baseline: string;
  limitation?: string;
}

export interface AnomalyResult {
  kind: "entity" | "relationship" | "event-burst";
  identifier: string | number;
  anomalyScore: number;
  category: string;
  reason: string;
  supportingMetrics: Record<string, number | string | null>;
  comparisonBaseline: Record<string, number | string | null>;
  explainability: Explainability;
}

export interface AttentionSuggestion {
  kind: string;
  identifier?: string | number;
  region?: { x: number; y: number; radius: number };
  score: number;
  reason: string;
  supportingMetrics: Record<string, unknown>;
  suggestedNextPerceptionOperation: string;
  explainability: Explainability;
}

export interface PerceptionEnvelope<T> {
  perceptionSchemaVersion: typeof PERCEPTION_SCHEMA_VERSION;
  source: PerceptionSource;
  authoritative: Record<string, unknown>;
  derived: T;
}
