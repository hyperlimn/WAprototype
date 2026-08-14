export const LABORATORY_SCHEMA_VERSION = "protouniverse-laboratory-experiment/1";
export const VEIL_PROFILE_VERSION = "protouniverse-veil/1";

export interface VeilProfile {
  version: typeof VEIL_PROFILE_VERSION;
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
}

export interface ExperimentDefinition {
  schemaVersion: typeof LABORATORY_SCHEMA_VERSION;
  id: string;
  revision: string;
  universe: string;
  observer: string;
  promptVersion: string;
  profile: VeilProfile;
  description?: string;
}

export interface ExperimentalContext {
  experimentId: string;
  experimentRevision: string;
  profileVersion: string;
  restricted: true;
}
