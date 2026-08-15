export const DIMENSION_MODES = ["composite", "spatial", "influence", "lineage", "frequency"] as const;
export type DimensionMode = typeof DIMENSION_MODES[number];
export interface DimensionalRelationship { spatialActive: boolean; influenceActive: boolean }

export interface RelationshipProjection {
  visible: boolean;
  alpha: number;
  lineWidth: number;
  color: readonly [number, number, number];
}

/** View-only projection policy. It reads universe state but never mutates it. */
export function projectRelationship(mode: DimensionMode, relationship: DimensionalRelationship): RelationshipProjection {
  if (mode === "spatial") return relationship.spatialActive
    ? { visible: true, alpha: .62, lineWidth: 1.15, color: [117, 192, 195] }
    : { visible: relationship.influenceActive, alpha: .07, lineWidth: .45, color: [151, 177, 183] };
  if (mode === "influence") return relationship.influenceActive
    ? { visible: true, alpha: .62, lineWidth: 1.15, color: [151, 177, 183] }
    : { visible: relationship.spatialActive, alpha: .07, lineWidth: .45, color: [117, 192, 195] };
  if (mode === "lineage") return {
    visible: relationship.spatialActive || relationship.influenceActive,
    alpha: .035, lineWidth: .4, color: [117, 143, 143],
  };
  if (mode === "frequency") return {
    visible: relationship.spatialActive || relationship.influenceActive,
    alpha: .02, lineWidth: .35, color: [117, 143, 143],
  };
  return { visible: false, alpha: 0, lineWidth: 0, color: [0, 0, 0] };
}

export function baseRelationOpacity(mode: DimensionMode): number {
  return mode === "composite" ? 1 : mode === "spatial" ? .35 : mode === "influence" ? .12 : mode === "lineage" ? .04 : .02;
}

export function higherOrderOpacity(mode: DimensionMode): number {
  return mode === "composite" ? 1 : mode === "spatial" ? .45 : mode === "influence" ? .18 : mode === "lineage" ? .05 : .02;
}

export function entityOpacity(mode: DimensionMode, participatesInLineage: boolean): number {
  return mode !== "lineage" || participatesInLineage ? .9 : .24;
}

export function frequencyVisual(currentOscillation: number): { radiusScale: number; lightOffset: number } {
  const bounded = Math.max(-1, Math.min(1, currentOscillation));
  return { radiusScale: 1 + bounded * .11, lightOffset: bounded * 6 };
}

export interface EntityProjectionInput { alpha: number; beta: number; gamma: number; currentOscillation: number; participatesInLineage: boolean }
export interface EntityProjection { hue: number; saturation: number; lightness: number; opacity: number; radiusScale: number }

/** Shared entity styling for both the browser canvas and deterministic rendered views. */
export function projectEntity(mode: DimensionMode, entity: EntityProjectionInput): EntityProjection {
  const frequency = mode === "frequency" ? frequencyVisual(entity.currentOscillation) : { radiusScale: 1, lightOffset: 0 };
  return { hue: 178 + entity.alpha * 36, saturation: 28 + entity.beta * 24,
    lightness: 58 + entity.gamma * 18 + frequency.lightOffset,
    opacity: entityOpacity(mode, entity.participatesInLineage), radiusScale: frequency.radiusScale };
}
