import type { CanonicalSnapshot, Heartbeat } from "./types.js";

export const MAX_BRIDGE_EVENTS = 1_000;

export class StateStore {
  heartbeat: Heartbeat | null = null;
  snapshot: CanonicalSnapshot | null = null;
  lastBrowserUpdateAt: number | null = null;
  lastSnapshotDurationMs: number | null = null;
  readonly events: unknown[] = [];

  updateHeartbeat(value: Heartbeat): void {
    this.heartbeat = value;
    this.lastBrowserUpdateAt = Date.now();
  }
  updateSnapshot(value: CanonicalSnapshot, durationMs?: number): void {
    this.snapshot = value;
    this.lastSnapshotDurationMs = typeof durationMs === "number" ? durationMs : null;
    this.lastBrowserUpdateAt = Date.now();
  }
  addEvents(values: unknown[]): void {
    this.events.push(...values);
    if (this.events.length > MAX_BRIDGE_EVENTS) this.events.splice(0, this.events.length - MAX_BRIDGE_EVENTS);
    this.lastBrowserUpdateAt = Date.now();
  }
}
