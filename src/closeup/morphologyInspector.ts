import type { MorphologyGenome } from "./entityMorphology.js";

export interface MorphologyInspectorEntry { readonly label: string; readonly value: string }
const decimal = (value: number, digits = 3): string => value.toFixed(digits);
export function morphologyInspectorEntries(genome: MorphologyGenome): readonly MorphologyInspectorEntry[] {
  return Object.freeze([
    { label: "Scaffold", value: genome.symmetryFamily }, { label: "Primary order", value: String(genome.primarySymmetry) },
    { label: "Secondary order", value: String(genome.secondarySymmetry) }, { label: "Primary motif", value: genome.primaryMotif },
    { label: "Secondary motif", value: genome.secondaryMotif }, { label: "Macro amplitude", value: decimal(genome.motifAmplitude) },
    { label: "Rings", value: String(genome.ringCount) }, { label: "Ridge sharpness", value: decimal(genome.ridgeSharpness, 2) },
    { label: "Depression depth", value: decimal(genome.depressionDepth) }, { label: "Harmonic strength", value: decimal(genome.harmonicStrength) },
    { label: "Micro scale", value: String(genome.microScale) }, { label: "Asymmetry", value: decimal(genome.asymmetry, 4) },
    { label: "Palette", value: `h${decimal(genome.baseHue)} · s${decimal(genome.saturation)}` },
    { label: "Emission", value: decimal(genome.emissiveIntensity) }, { label: "Roughness", value: decimal(genome.materialRoughness) },
    { label: "Metallic", value: decimal(genome.metallicResponse) },
  ]);
}
