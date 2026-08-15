export const LAW_PARAMETER_REGISTRY_VERSION = "law-parameter-registry/1";

export type LawParameterId = "base-force" | "damping" | "influence-scale" | "field-force" | "higher-order-force";
export type LawParameterOperation = "add" | "multiply";

export interface LawParameterDescriptor {
  id: LawParameterId;
  system: string;
  baseValue: number;
  units: string;
  min: number;
  max: number;
  maximumChangePerEpoch: number;
  operation: LawParameterOperation;
  composition: "ordered-clamped";
  determinism: string;
  description: string;
}

export const LAW_PARAMETER_REGISTRY: readonly LawParameterDescriptor[] = Object.freeze([
  { id: "base-force", system: "base-physics", baseValue: 0.0018, units: "velocity/tick", min: 0.0012, max: 0.0024,
    maximumChangePerEpoch: 0.03, operation: "multiply", composition: "ordered-clamped", determinism: "Applied before canonical pair accumulation.", description: "Base pair interaction force." },
  { id: "damping", system: "base-physics", baseValue: 0.992, units: "ratio/tick", min: 0.989, max: 0.995,
    maximumChangePerEpoch: 0.0004, operation: "add", composition: "ordered-clamped", determinism: "Applied once per entity per completed physics step.", description: "Velocity retention after base interaction." },
  { id: "influence-scale", system: "influence-physics", baseValue: 0.012, units: "modulation scale", min: 0.008, max: 0.016,
    maximumChangePerEpoch: 0.03, operation: "multiply", composition: "ordered-clamped", determinism: "Applied in existing relationship order.", description: "Strength of influence-active relationship modulation." },
  { id: "field-force", system: "relationship-field", baseValue: 0.004, units: "acceleration/potential-gradient", min: 0.0025, max: 0.0055,
    maximumChangePerEpoch: 0.04, operation: "multiply", composition: "ordered-clamped", determinism: "Applied in existing spatial relationship order.", description: "Response to the relationship field gradient." },
  { id: "higher-order-force", system: "higher-order-physics", baseValue: 0.000035, units: "velocity/tick", min: 0.00002, max: 0.00005,
    maximumChangePerEpoch: 0.04, operation: "multiply", composition: "ordered-clamped", determinism: "Applied in existing higher-order pair order.", description: "Force between compatible relationship entities." },
]);

export type EffectiveLawParameters = Record<LawParameterId, number>;
export const baseLawParameters = (): EffectiveLawParameters => Object.fromEntries(
  LAW_PARAMETER_REGISTRY.map((item) => [item.id, item.baseValue]),
) as EffectiveLawParameters;
export const lawParameter = (id: LawParameterId): LawParameterDescriptor => LAW_PARAMETER_REGISTRY.find((item) => item.id === id)!;

export function applyParameterMutation(current: number, descriptor: LawParameterDescriptor, polarity: -1 | 1, magnitude: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(magnitude) || magnitude < 0 || magnitude > descriptor.maximumChangePerEpoch)
    throw new Error("Invalid Law Evolution parameter mutation");
  const changed = descriptor.operation === "add" ? current + polarity * magnitude : current * (1 + polarity * magnitude);
  return Math.min(descriptor.max, Math.max(descriptor.min, changed));
}
