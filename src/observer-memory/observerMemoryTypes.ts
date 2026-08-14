export const OBSERVER_MEMORY_SCHEMA_VERSION = "protouniverse-observer-memory/1";

export const OBSERVER_MEMORY_KINDS = ["observation", "investigation", "question", "hypothesis", "prediction", "revisit", "conclusion", "surprise"] as const;
export type ObserverMemoryKind = typeof OBSERVER_MEMORY_KINDS[number];
export type ObserverMemoryStatus = "open" | "resolved" | "superseded";

export interface UniverseReference {
  kind: "entity" | "relationship" | "event" | "checkpoint" | "region" | "history" | "uri";
  id?: string;
  tick?: number;
  sequence?: number;
  uri?: string;
  note?: string;
  evidenceRole?: "supports" | "contradicts" | "context" | "target";
}

export interface ObserverEpistemicMetadata {
  authority: "observer-authored";
  authoritativeUniverseTruth: false;
  classification: "observer-record";
  kind: ObserverMemoryKind;
  notice: string;
}

export interface ObserverMemoryRevision {
  revisedAt: string;
  previousContent?: string;
  note?: string;
  previousStatus?: ObserverMemoryStatus;
}

export interface ObserverMemoryEntry {
  id: string;
  kind: ObserverMemoryKind;
  content: string;
  status: ObserverMemoryStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolution?: string;
  universeTick?: number;
  tags: string[];
  references: UniverseReference[];
  epistemic: ObserverEpistemicMetadata;
  revisions: ObserverMemoryRevision[];
}

export interface ObserverUniverseMemory {
  schemaVersion: typeof OBSERVER_MEMORY_SCHEMA_VERSION;
  observer: string;
  universe: string;
  createdAt: string;
  updatedAt: string;
  visits: { count: number; firstVisitedAt: string | null; lastVisitedAt: string | null; lastVisitedTick: number | null };
  entries: ObserverMemoryEntry[];
}

export interface ObserverMemoryContinuity {
  observer: string;
  universe: string;
  lastVisitedAt: string | null;
  lastVisitedTick: number | null;
  visitCount: number;
  openInquiryCount: number;
  whereYouLeftOff: Array<Pick<ObserverMemoryEntry, "id" | "kind" | "content" | "status" | "updatedAt" | "universeTick" | "references" | "epistemic">>;
  deeperRecall: string;
}
