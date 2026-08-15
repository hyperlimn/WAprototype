export type ObservationFieldClass =
  | "present-structural"
  | "immutable-identity"
  | "historical-record"
  | "cumulative-history"
  | "provenance"
  | "observer-metadata"
  | "inferred-present";

export interface ObservationFieldDescriptor {
  path: string;
  classification: ObservationFieldClass;
  note: string;
}

/** Preparation for a future classified schema. It is not consumed by the Veil in v1. */
export const OBSERVATION_FIELD_CLASSIFICATION: readonly ObservationFieldDescriptor[] = Object.freeze([
  { path: "metadata.currentTick", classification: "observer-metadata", note: "Tick represented by this observation." },
  { path: "metadata.runtime", classification: "provenance", note: "Runtime fresh/resume provenance." },
  { path: "entities[].fingerprint", classification: "immutable-identity", note: "Stable entity identity material." },
  { path: "entities[].x|y|vx|vy|energy", classification: "present-structural", note: "Current entity state." },
  { path: "entities[].birthTick|origin|age", classification: "historical-record", note: "Entity history inscriptions." },
  { path: "entities[].neighborCount|strongestRelationship|strongestBond", classification: "inferred-present", note: "Derived from current structure." },
  { path: "relationships[].spatialActive|influenceActive|coherence|synergy", classification: "present-structural", note: "Current relationship state." },
  { path: "relationships[].creationTick|age|*Duration|lastRuptureTick", classification: "historical-record", note: "Relationship chronology." },
  { path: "population.*Count|worldState.*Created|worldState.*Destroyed", classification: "cumulative-history", note: "Cumulative historical bookkeeping." },
  { path: "*Summary|*Diagnostics", classification: "inferred-present", note: "Derived observational aggregates; individual fields may later receive finer labels." },
  { path: "recentOccurrences[]", classification: "historical-record", note: "Recorded event history." },
  { path: "laws.effectiveParameters", classification: "present-structural", note: "The currently effective authoritative law set." },
  { path: "laws.history[].genome", classification: "immutable-identity", note: "Immutable evolved-law identity; its source hash is provenance." },
  { path: "laws.history[].bornAtTick|vector", classification: "historical-record", note: "Law birth chronology and its historical derived measurements." },
  { path: "laws.history[].*Hash", classification: "provenance", note: "Canonical Law Evolution ancestry." },
  { path: "laws.evolvedLawCount", classification: "cumulative-history", note: "Number of prior law births." },
  { path: "metadata.lawEvolution.currentEpoch|nextBoundaryTick", classification: "observer-metadata", note: "Current law clock and next boundary." },
]);
