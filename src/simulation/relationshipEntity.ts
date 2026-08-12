import type { Entity } from "./entity";

export interface RelationshipEntity {
  readonly id: string;
  readonly fingerprint: string;
  readonly parentAId: number;
  readonly parentBId: number;
  readonly creationTick: number;
  readonly spatialDuration: number;
  readonly influenceDuration: number;
  age: number;
  spatialActive: boolean;
  influenceActive: boolean;
  bondStrength: number;
  relationshipStrength: number;
  x: number;
  y: number;
  distance: number;
  orientation: number;
  relativeVx: number;
  relativeVy: number;
  internalEnergy: number;
  distanceChangeEma: number;
  coherence: number;
  localRelationshipDensity: number;
  synergy: number;
  fieldSourceStrength: number;
  localFieldPotential: number;
  localFieldGradientMagnitude: number;
  reproductionEligible: boolean;
  nextEligibleTick: number;
  reproductionCount: number;
  lastReproductionTick: number | null;
  ruptureQualified: boolean;
  ruptureCount: number;
  lastRuptureTick: number | null;
}

const fnv1a = (text: string, salt: number): number => {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/** A deterministic 256-bit-style identity made from canonical parent order. */
export function deriveRelationshipFingerprint(a: Entity, b: Entity): string {
  const [first, second] = a.fingerprint < b.fingerprint
    ? [a.fingerprint, b.fingerprint]
    : [b.fingerprint, a.fingerprint];
  const canonical = `${first}:${second}`;
  let result = "";
  for (let stream = 0; stream < 8; stream++) {
    result += fnv1a(canonical, Math.imul(stream + 1, 0x9e3779b1)).toString(16).padStart(8, "0");
  }
  return result;
}
