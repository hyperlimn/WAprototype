export const LABORATORY_SCHEMA_VERSION = "protouniverse-laboratory-experiment/1";
export const VEIL_PROFILE_VERSION = "protouniverse-veil/1";
export const DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION = "protouniverse-veil/2";
export const CLEAN_ROOM_VEIL_PROFILE_VERSION = "protouniverse-veil/3";
export const PRESENT_MOMENT_VEIL_PROFILE_VERSION = "protouniverse-veil/4";
export const REVEAL_CHAMBER_VERSION = "protouniverse-reveal-comparison-chamber/1";

export type VeilProfileVersion = typeof VEIL_PROFILE_VERSION | typeof DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION | typeof CLEAN_ROOM_VEIL_PROFILE_VERSION | typeof PRESENT_MOMENT_VEIL_PROFILE_VERSION;

export interface VeilProfile {
  version: VeilProfileVersion;
  history: { enabled: boolean; minimumAccessibleTick?: number };
  currentState: boolean;
  checkpoints: boolean;
  events: boolean;
  entities: boolean;
  relationships: boolean;
  ancestry: boolean;
  coordinates: boolean;
  energy: boolean;
  relationshipMetrics: boolean;
  regions: boolean;
  similarity: boolean;
  anomalyDetection: boolean;
  comparison: boolean;
  observerMemory: boolean;
  bookmarks: boolean;
  discloseExperimentalContext: boolean;
  historicalInscriptions?: {
    mode: "redact";
    retainStructuralLineage: boolean;
  };
  entityIdentifiers?: "opaque";
  relationshipIdentifiers?: "opaque";
  cleanRoomHistory?: {
    eventIdentifiers: "opaque";
    paginationCursors: "opaque";
    redactCumulativeBookkeeping: true;
  };
  identityPresentation?: "non-order-preserving";
  presentMoment?: true;
  changes?: boolean;
  catalogs?: boolean;
  humanView?: boolean;
  /** Default false. Law Evolution is a separate epistemic capability. */
  lawEvolution?: boolean;
}

export interface ExperimentDefinition {
  schemaVersion: typeof LABORATORY_SCHEMA_VERSION;
  id: string;
  revision: string;
  universe: string;
  observer: string;
  promptVersion: string;
  prompt?: string;
  profile: VeilProfile;
  chamber?: {
    version: typeof REVEAL_CHAMBER_VERSION;
    freeze: { artifactKind: string; outputSchemaVersion: string };
    reveal: { observer: string; promptVersion: string; prompt: string; outputSchemaVersion: string; profile: VeilProfile };
  };
  description?: string;
  scientificQuestion?: string;
}

export interface ExperimentalContext {
  experimentId: string;
  experimentRevision: string;
  profileVersion: string;
  restricted: true;
}
