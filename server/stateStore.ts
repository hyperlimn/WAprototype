import type { CanonicalSnapshot, Heartbeat } from "./types.js";
import type { EntityRecord, OccurrenceRecord, QueryIndexes, RelationshipRecord } from "../src/query/queryTypes.js";

export const MAX_BRIDGE_EVENTS = 1_000;

export class StateStore {
  heartbeat: Heartbeat | null = null;
  snapshot: CanonicalSnapshot | null = null;
  lastBrowserUpdateAt: number | null = null;
  lastSnapshotDurationMs: number | null = null;
  lastObservationMetrics: { buildDurationMs: number; serializedBytes: number; entityCount: number; relationshipCount: number } | null = null;
  lastSimulationTimings: unknown = null;
  readonly events: OccurrenceRecord[] = [];
  entityById = new Map<number, EntityRecord>();
  relationshipById = new Map<string, RelationshipRecord>();
  relationshipsByParent = new Map<number, RelationshipRecord[]>();

  updateHeartbeat(value: Heartbeat): void {
    this.heartbeat = value;
    this.lastBrowserUpdateAt = Date.now();
  }
  updateSnapshot(value: CanonicalSnapshot, metrics?: { buildDurationMs: number; serializedBytes: number; entityCount: number; relationshipCount: number }, simulationTimings?: unknown): void {
    const previousTick = this.snapshot?.metadata.currentTick;
    if (typeof previousTick === "number" && typeof value.metadata.currentTick === "number" && value.metadata.currentTick < previousTick) {
      this.events.length = 0;
    }
    this.snapshot = value;
    this.entityById = new Map((value.entities ?? []).map((entity) => [entity.id, entity]));
    this.relationshipById = new Map((value.relationships ?? []).map((relationship) => [relationship.id, relationship]));
    this.relationshipsByParent = new Map();
    for (const relationship of value.relationships ?? []) {
      for (const parentId of [relationship.parentAId, relationship.parentBId]) {
        const items = this.relationshipsByParent.get(parentId) ?? [];
        items.push(relationship);
        this.relationshipsByParent.set(parentId, items);
      }
    }
    this.lastObservationMetrics = metrics ?? null;
    this.lastSimulationTimings = simulationTimings ?? null;
    this.lastSnapshotDurationMs = metrics?.buildDurationMs ?? null;
    this.lastBrowserUpdateAt = Date.now();
    this.addEvents(value.recentOccurrences ?? []);
  }
  addEvents(values: OccurrenceRecord[]): void {
    for (const value of values) {
      const duplicate = this.events.some((existing) => existing.sequence === value.sequence && existing.tick === value.tick
        && existing.type === value.type && existing.description === value.description);
      if (!duplicate) this.events.push(value);
    }
    this.events.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    if (this.events.length > MAX_BRIDGE_EVENTS) this.events.splice(0, this.events.length - MAX_BRIDGE_EVENTS);
    this.lastBrowserUpdateAt = Date.now();
  }
  get indexes(): QueryIndexes {
    return { entityById: this.entityById, relationshipById: this.relationshipById,
      relationshipsByParent: this.relationshipsByParent };
  }
}
