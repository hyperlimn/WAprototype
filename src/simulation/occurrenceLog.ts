export type OccurrenceType =
  | "external-arrival"
  | "reproduction"
  | "relationship-formed"
  | "relationship-destroyed"
  | "rupture"
  | "dimensional-transition"
  | "law-evolution";

export interface Occurrence {
  readonly sequence: number;
  readonly tick: number;
  readonly type: OccurrenceType;
  readonly description: string;
  readonly x: number;
  readonly y: number;
  readonly entityId?: number;
  readonly relationshipId?: string;
  readonly parentEntityIds?: readonly [number, number];
  readonly transition?: string;
  readonly rupture?: RuptureOccurrenceData;
  readonly lawEvolutionId?: string;
}

export interface RuptureOccurrenceData {
  readonly density: number;
  readonly internalEnergy: number;
  readonly bondStrengthAtTrigger: number;
  readonly densityThreshold: number;
  readonly internalEnergyThreshold: number;
  readonly minimumAge: number;
  readonly requiredBondStrength: number;
  readonly ruptureSensitivity: number;
  readonly repulsionMagnitude: number;
  readonly cooldown: number;
  readonly resultingBondStrength: number;
}

export const MAX_OCCURRENCES = 200;
export const EVENT_TRACE_DURATION_TICKS = 10_000;

export class OccurrenceLog {
  readonly records: Occurrence[] = [];
  private sequence = 0;

  continuationState(): { records: Occurrence[]; nextSequence: number } { return { records: structuredClone(this.records), nextSequence: this.sequence }; }
  restoreContinuationState(value: { records: Occurrence[]; nextSequence: number }): void {
    this.records.splice(0, this.records.length, ...structuredClone(value.records)); this.sequence = value.nextSequence;
  }

  add(record: Omit<Occurrence, "sequence">): void {
    this.records.push({ ...record, sequence: this.sequence++ });
    if (this.records.length > MAX_OCCURRENCES) {
      this.records.splice(0, this.records.length - MAX_OCCURRENCES);
    }
  }

  active(tick: number): Occurrence[] {
    const firstTick = tick - EVENT_TRACE_DURATION_TICKS + 1;
    return this.records.filter((record) => record.tick >= firstTick && record.tick <= tick);
  }
}
