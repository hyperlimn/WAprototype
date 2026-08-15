const TWO_PI = Math.PI * 2;
export const SYMMETRY_ORDERS = [3, 4, 5, 6, 7, 8, 9, 10, 12] as const;
export const SYMMETRY_FAMILIES = ["axial", "radial", "spiral", "tessellated"] as const;
export const MOTIF_FAMILIES = ["petals", "rings", "nodes", "interlock"] as const;
export type SymmetryFamily = typeof SYMMETRY_FAMILIES[number];
export type MotifFamily = typeof MOTIF_FAMILIES[number];

export interface MorphologyGenome {
  primarySymmetry: number; secondarySymmetry: number; symmetryFamily: SymmetryFamily;
  primaryMotif: MotifFamily; secondaryMotif: MotifFamily; motifAmplitude: number; motifFrequency: number;
  angularOffset: number; motifPhase: number; ringCount: number; ridgeSharpness: number; depressionDepth: number;
  polarWeight: number; equatorialWeight: number; harmonicCount: number; harmonicStrength: number;
  microScale: number; microAmplitude: number; asymmetry: number; asymmetryPhase: number; surfaceSmoothness: number;
  baseHue: number; secondaryHueOffset: number; saturation: number; luminance: number; emissiveHue: number;
  patternContrast: number; emissiveIntensity: number; emissivePatternStrength: number;
  materialRoughness: number; metallicResponse: number; patternPhase: number;
}
export type EntityMorphology = MorphologyGenome;

const valid = (fingerprint: string): void => { if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Fingerprint must be 64 lowercase hexadecimal characters"); };
export function hashUnit(fingerprint: string, start: number, length = 2): number { valid(fingerprint); return parseInt(fingerprint.slice(start, start + length), 16) / (16 ** length - 1); }
export function hashSigned(fingerprint: string, start: number, length = 2): number { return hashUnit(fingerprint, start, length) * 2 - 1; }
export function hashInteger(fingerprint: string, start: number, minimum: number, maximum: number): number {
  return minimum + Math.min(maximum - minimum, Math.floor(hashUnit(fingerprint, start) * (maximum - minimum + 1)));
}
const range = (unit: number, minimum: number, maximum: number): number => minimum + unit * (maximum - minimum);
const pick = <T>(values: readonly T[], unit: number): T => values[Math.min(values.length - 1, Math.floor(unit * values.length))];

/** Morphology v2 genome: every property is selected by its own 8-bit fingerprint segment. */
export function deriveMorphologyGenome(fingerprint: string): Readonly<MorphologyGenome> {
  valid(fingerprint);
  return Object.freeze({
    primarySymmetry: pick(SYMMETRY_ORDERS, hashUnit(fingerprint, 0)), secondarySymmetry: pick(SYMMETRY_ORDERS, hashUnit(fingerprint, 2)),
    symmetryFamily: pick(SYMMETRY_FAMILIES, hashUnit(fingerprint, 4)), primaryMotif: pick(MOTIF_FAMILIES, hashUnit(fingerprint, 6)),
    secondaryMotif: pick(MOTIF_FAMILIES, hashUnit(fingerprint, 8)), motifAmplitude: range(hashUnit(fingerprint, 10), .035, .09),
    motifFrequency: hashInteger(fingerprint, 12, 1, 4), angularOffset: hashUnit(fingerprint, 14) * TWO_PI,
    motifPhase: hashUnit(fingerprint, 16) * TWO_PI, ringCount: hashInteger(fingerprint, 18, 3, 12),
    ridgeSharpness: range(hashUnit(fingerprint, 20), 2, 12), depressionDepth: range(hashUnit(fingerprint, 22), .008, .045),
    polarWeight: range(hashUnit(fingerprint, 24), .15, 1), equatorialWeight: range(hashUnit(fingerprint, 26), .15, 1),
    harmonicCount: hashInteger(fingerprint, 28, 2, 7), harmonicStrength: range(hashUnit(fingerprint, 30), .008, .035),
    microScale: hashInteger(fingerprint, 32, 2, 6), microAmplitude: range(hashUnit(fingerprint, 34), .003, .018),
    asymmetry: range(hashUnit(fingerprint, 36), 0, .012), asymmetryPhase: hashUnit(fingerprint, 38) * TWO_PI,
    surfaceSmoothness: range(hashUnit(fingerprint, 40), .45, .9), baseHue: range(hashUnit(fingerprint, 42), .45, .62),
    secondaryHueOffset: range(hashUnit(fingerprint, 44), .035, .13), saturation: range(hashUnit(fingerprint, 46), .18, .42),
    luminance: range(hashUnit(fingerprint, 48), .2, .36), emissiveHue: range(hashUnit(fingerprint, 50), .42, .64),
    patternContrast: range(hashUnit(fingerprint, 52), .08, .28), emissiveIntensity: range(hashUnit(fingerprint, 54), .03, .16),
    emissivePatternStrength: range(hashUnit(fingerprint, 56), .04, .22), materialRoughness: range(hashUnit(fingerprint, 58), .38, .82),
    metallicResponse: range(hashUnit(fingerprint, 60), .02, .24), patternPhase: hashUnit(fingerprint, 62) * TWO_PI,
  });
}
export const deriveEntityMorphology = deriveMorphologyGenome;

interface SurfacePoint { x: number; y: number; z: number; theta: number; phi: number; polar: number; equatorial: number }
export interface MorphologyFeature { readonly id: string; displacement(genome: MorphologyGenome, point: SurfacePoint): number }
const motifWave = (family: MotifFamily, longitude: number, latitude: number, phase: number): number => {
  if (family === "rings") return Math.cos(latitude + phase);
  if (family === "nodes") return Math.cos(longitude + phase) * Math.cos(latitude * 2 - phase);
  if (family === "interlock") return Math.sin(longitude + latitude + phase) * Math.sin(longitude - latitude - phase);
  return Math.cos(longitude + phase) * Math.sin(latitude);
};
const symmetryScaffold = (family: SymmetryFamily, p: SurfacePoint, g: MorphologyGenome): number => {
  if (family === "axial") return .65 + .35 * Math.abs(p.y);
  if (family === "radial") return .65 + .35 * p.equatorial;
  if (family === "spiral") return Math.cos(p.phi * g.primarySymmetry + p.theta * g.secondarySymmetry + g.angularOffset);
  return Math.cos(p.phi * g.primarySymmetry + g.angularOffset) * Math.cos(p.theta * g.secondarySymmetry);
};

/** Ordered macro/micro topology registry. Additional close-up scales can register further modules. */
export const MORPHOLOGY_FEATURES: readonly MorphologyFeature[] = Object.freeze([
  { id: "radial-petals", displacement: (g, p) => motifWave(g.primaryMotif, p.phi * g.primarySymmetry, p.theta * g.motifFrequency, g.motifPhase) * g.motifAmplitude * (.55 + .45 * symmetryScaffold(g.symmetryFamily, p, g)) },
  { id: "latitude-rings", displacement: (g, p) => Math.sin(p.theta * g.ringCount * 2 + g.angularOffset) * g.harmonicStrength * (.35 + g.equatorialWeight * p.equatorial) },
  { id: "longitudinal-ridges", displacement: (g, p) => Math.pow(Math.abs(Math.cos(p.phi * g.secondarySymmetry + g.angularOffset)), g.ridgeSharpness) * g.harmonicStrength },
  { id: "polar-rosettes", displacement: (g, p) => Math.cos(p.phi * g.primarySymmetry + g.motifPhase) * Math.pow(p.polar, 3) * g.harmonicStrength * g.polarWeight },
  { id: "repeating-depressions", displacement: (g, p) => -Math.pow(Math.max(0, motifWave(g.secondaryMotif, p.phi * g.secondarySymmetry, p.theta * g.ringCount, g.patternPhase)), 4) * g.depressionDepth },
  { id: "harmonic-interference", displacement: (g, p) => Math.sin(p.phi * g.primarySymmetry + p.theta * g.harmonicCount + g.motifPhase) * Math.sin(p.theta * g.secondarySymmetry - g.angularOffset) * g.microAmplitude },
  { id: "tessellated-microfield", displacement: (g, p) => Math.cos(p.phi * g.primarySymmetry * g.microScale + g.patternPhase) * Math.sin(p.theta * g.ringCount * g.microScale) * g.microAmplitude * .55 },
  { id: "restrained-asymmetry", displacement: (g, p) => (p.x * Math.cos(g.asymmetryPhase) + p.z * Math.sin(g.asymmetryPhase)) * g.asymmetry },
]);

const point = (x: number, y: number, z: number): SurfacePoint => {
  const theta = Math.acos(Math.max(-1, Math.min(1, y)));
  return { x, y, z, theta, phi: Math.atan2(z, x), polar: Math.abs(y), equatorial: Math.max(0, Math.sin(theta)) };
};
export function morphologyRadius(genome: MorphologyGenome, x: number, y: number, z: number): number {
  const sample = point(x, y, z), raw = MORPHOLOGY_FEATURES.reduce((sum, feature) => sum + feature.displacement(genome, sample), 1);
  const smoothed = 1 + (raw - 1) * (1.1 - genome.surfaceSmoothness * .35);
  return Math.max(.78, Math.min(1.22, smoothed));
}

/** Symmetry-aligned, deterministic material pattern sampled independently from displacement. */
export function sampleSurfacePattern(genome: MorphologyGenome, x: number, y: number, z: number): number {
  const p = point(x, y, z);
  const sectors = Math.cos(p.phi * genome.primarySymmetry + genome.patternPhase);
  const rings = Math.cos(p.theta * genome.ringCount * 2 + genome.angularOffset);
  const interference = Math.sin(p.phi * genome.secondarySymmetry - p.theta * genome.harmonicCount + genome.motifPhase);
  return Math.max(0, Math.min(1, .5 + sectors * .24 + rings * .17 + interference * .09));
}

export function closeupOscillationVisual(currentOscillation: number): { radialScale: number; emissiveScale: number } {
  const value = Math.max(-1, Math.min(1, currentOscillation)); return { radialScale: 1 + value * .006, emissiveScale: 1 + value * .08 };
}
