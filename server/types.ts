export const INTERFACE_VERSION = "protouniverse-machine-interface/1";

export interface Heartbeat {
  interfaceVersion: string;
  simulationVersion: string;
  seed: string;
  currentTick: number;
  entityCount: number;
}

export interface CanonicalSnapshot {
  metadata: Record<string, unknown> & { simulationVersion?: string; seed?: string; currentTick?: number; entityCount?: number };
  entities?: Array<Record<string, unknown> & { id: number }>;
  relationships?: Array<Record<string, unknown> & { id: string }>;
  recentOccurrences?: unknown[];
  [key: string]: unknown;
}
