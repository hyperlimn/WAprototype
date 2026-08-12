import type { FingerprintTraits } from "./fingerprint";

export type EntityOrigin = "initial" | "external arrival" | "reproduction";

export interface Entity extends FingerprintTraits {
  readonly creationIndex: number;
  readonly creationTimestamp: number;
  readonly origin: EntityOrigin;
  readonly birthTick: number;
  readonly parentRelationshipId: string | null;
  readonly parentEntityIds: readonly [number, number] | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number;
  neighborCount: number;
  strongestRelationship: number;
  strongestBond: number;
}
