import type { MorphologyGenome } from "./entityMorphology.js";

export type CloseupCameraPreset = "free" | "pole" | "equator";
export interface Vector3Value { readonly x: number; readonly y: number; readonly z: number }
export interface SymmetryCameraBasis {
  readonly axis: Vector3Value; readonly poleDirection: Vector3Value; readonly poleUp: Vector3Value;
  readonly equatorDirection: Vector3Value; readonly equatorUp: Vector3Value;
}
/** V2 topology is parameterized around canonical +Y; angularOffset selects a deterministic equatorial meridian. */
export function deriveSymmetryCameraBasis(genome: MorphologyGenome): Readonly<SymmetryCameraBasis> {
  return Object.freeze({
    axis: Object.freeze({ x: 0, y: 1, z: 0 }),
    poleDirection: Object.freeze({ x: 0, y: 1, z: 0 }), poleUp: Object.freeze({ x: 0, y: 0, z: 1 }),
    equatorDirection: Object.freeze({ x: Math.cos(genome.angularOffset), y: 0, z: Math.sin(genome.angularOffset) }),
    equatorUp: Object.freeze({ x: 0, y: 1, z: 0 }),
  });
}
