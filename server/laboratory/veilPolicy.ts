import type { ExperimentDefinition, ExperimentalContext } from "../../src/laboratory/experimentTypes.js";
import { createHash } from "node:crypto";

export class VeilAccessError extends Error {
  readonly classification = "inaccessible";
  constructor(message: string) { super(message); }
}

export class VeilPolicy {
  readonly context: ExperimentalContext;
  private readonly entityIdMask: number;
  private readonly eventIdMask: number;
  private readonly cursorByPresented = new Map<string, string>();
  private readonly entityIdByPresented = new Map<string, number>();
  private readonly relationshipIdByPresented = new Map<string, string>();
  constructor(readonly experiment: ExperimentDefinition) {
    this.context = { experimentId: experiment.id, experimentRevision: experiment.revision, profileVersion: experiment.profile.version, restricted: true };
    this.entityIdMask = Number.parseInt(createHash("sha256").update(`${experiment.id}|${experiment.universe}|veil-entity-id`).digest("hex").slice(0, 8), 16) >>> 0;
    this.eventIdMask = Number.parseInt(createHash("sha256").update(`${experiment.id}|${experiment.universe}|veil-event-id`).digest("hex").slice(0, 8), 16) >>> 0;
  }
  get cutoff(): number | undefined { return this.experiment.profile.history.minimumAccessibleTick; }
  assertUniverse(value: unknown): void {
    if (value !== undefined && value !== null && value !== this.experiment.universe)
      throw new VeilAccessError(this.experiment.profile.discloseExperimentalContext
        ? "The requested universe is inaccessible under the current observation profile." : "The requested universe is inaccessible.");
  }
  assertTick(tick: unknown, category = "Historical data"): void {
    if (typeof tick === "number" && this.cutoff !== undefined && tick < this.cutoff)
      throw new VeilAccessError(this.experiment.profile.discloseExperimentalContext
        ? `${category} before tick ${this.cutoff} is not accessible under the current observation profile.`
        : `${category} outside the accessible range is inaccessible.`);
  }
  assertFeature(enabled: boolean, category: string): void {
    if (!enabled) throw new VeilAccessError(this.experiment.profile.discloseExperimentalContext
      ? `${category} is not accessible under the current observation profile.` : `${category} is inaccessible.`);
  }
  presentEntityId(value: unknown): unknown {
    if (this.experiment.profile.entityIdentifiers !== "opaque" || !Number.isInteger(value) || (value as number) < 0) return value;
    if (this.experiment.profile.identityPresentation === "non-order-preserving") {
      const presented = `entity-${createHash("sha256").update(`${this.experiment.id}|${this.experiment.universe}|entity|${value}`).digest("hex").slice(0, 16)}`;
      this.entityIdByPresented.set(presented, value as number); return presented;
    }
    const presented = ((((value as number) >>> 0) ^ this.entityIdMask) >>> 0);
    return `entity-${presented.toString(16).padStart(8, "0")}`;
  }
  resolveEntityId(value: unknown): unknown {
    if (this.experiment.profile.entityIdentifiers !== "opaque") return value;
    if (this.experiment.profile.identityPresentation === "non-order-preserving") {
      if (typeof value !== "string" || !/^entity-[0-9a-f]{16}$/.test(value) || !this.entityIdByPresented.has(value))
        throw new VeilAccessError("The requested entity identifier is inaccessible.");
      return this.entityIdByPresented.get(value);
    }
    if (typeof value !== "string" || !/^entity-[0-9a-f]{8}$/.test(value)) throw new VeilAccessError("The requested entity identifier is inaccessible.");
    return ((Number.parseInt(value.slice(7), 16) ^ this.entityIdMask) >>> 0);
  }
  presentRelationshipId(value: unknown): unknown {
    if (this.experiment.profile.relationshipIdentifiers !== "opaque" || typeof value !== "string") return value;
    if (this.experiment.profile.identityPresentation === "non-order-preserving") {
      const presented = `relationship-${createHash("sha256").update(`${this.experiment.id}|${this.experiment.universe}|relationship|${value}`).digest("hex").slice(0, 16)}`;
      this.relationshipIdByPresented.set(presented, value); return presented;
    }
    const match = value.match(/^(\d+):(\d+)$/); if (!match) return undefined;
    return `relationship-${String(this.presentEntityId(Number(match[1]))).slice(7)}-${String(this.presentEntityId(Number(match[2]))).slice(7)}`;
  }
  resolveRelationshipId(value: unknown): unknown {
    if (this.experiment.profile.relationshipIdentifiers !== "opaque") return value;
    if (this.experiment.profile.identityPresentation === "non-order-preserving") {
      if (typeof value !== "string" || !/^relationship-[0-9a-f]{16}$/.test(value) || !this.relationshipIdByPresented.has(value))
        throw new VeilAccessError("The requested relationship identifier is inaccessible.");
      return this.relationshipIdByPresented.get(value);
    }
    if (typeof value !== "string" || !/^relationship-[0-9a-f]{8}-[0-9a-f]{8}$/.test(value))
      throw new VeilAccessError("The requested relationship identifier is inaccessible.");
    const [, first, second] = value.split("-");
    return `${this.resolveEntityId(`entity-${first}`)}:${this.resolveEntityId(`entity-${second}`)}`;
  }
  presentEventId(value: unknown): unknown {
    if (!this.experiment.profile.cleanRoomHistory || !Number.isInteger(value) || (value as number) < 0) return value;
    const presented = ((((value as number) >>> 0) ^ this.eventIdMask) >>> 0);
    return `event-${presented.toString(16).padStart(8, "0")}`;
  }
  resolveEventId(value: unknown): unknown {
    if (!this.experiment.profile.cleanRoomHistory) return value;
    if (typeof value !== "string" || !/^event-[0-9a-f]{8}$/.test(value)) throw new VeilAccessError("The requested event identifier is inaccessible.");
    return ((Number.parseInt(value.slice(6), 16) ^ this.eventIdMask) >>> 0);
  }
  presentCursor(value: unknown): unknown {
    if (!this.experiment.profile.cleanRoomHistory || typeof value !== "string") return value;
    const presented = `cursor-${createHash("sha256").update(`${this.experiment.id}|${value}`).digest("hex").slice(0, 24)}`;
    this.cursorByPresented.set(presented, value); return presented;
  }
  resolveCursor(value: unknown): unknown {
    if (!this.experiment.profile.cleanRoomHistory || value === undefined) return value;
    if (typeof value !== "string" || !this.cursorByPresented.has(value)) throw new VeilAccessError("The requested pagination position is inaccessible.");
    return this.cursorByPresented.get(value);
  }
}
