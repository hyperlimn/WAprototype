import type { RelationshipEntity } from "../simulation/relationshipEntity";
import { ruptureParameters } from "../simulation/rupture";
import type { Universe } from "../simulation/universe";

export type RuptureCondition = "bond" | "density" | "internal-energy" | "age" | "cooldown";

export interface DistributionSummary {
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

interface ConditionPasses {
  bond: boolean;
  density: boolean;
  internalEnergy: boolean;
  age: boolean;
  cooldown: boolean;
}

export interface RuptureNearMiss {
  relationshipId: string;
  parentIds: readonly [number, number];
  bondStrength: number;
  requiredBondStrength: number;
  density: number;
  densityThreshold: number;
  internalEnergy: number;
  internalEnergyThreshold: number;
  age: number;
  minimumAge: number;
  cooldownElapsed: boolean;
  cooldownRequired: number;
  ticksSinceLastRupture: number | null;
  lastRuptureTick: number | null;
  passes: ConditionPasses;
  totalConditionsPassed: number;
  normalizedCloseness: number;
  primaryBlockingCondition: RuptureCondition | "qualified";
}

const percentile = (sorted: readonly number[], fraction: number): number | null => {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * weight;
};

const distribution = (values: number[]): DistributionSummary => {
  if (!values.length) return { min: null, max: null, mean: null, p50: null, p90: null, p99: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0], max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), p99: percentile(sorted, 0.99),
  };
};

const ratio = (current: number, required: number): number => Math.min(1, current / required);

const diagnose = (relationship: RelationshipEntity, tick: number): RuptureNearMiss => {
  const thresholds = ruptureParameters(relationship.fingerprint);
  const ticksSinceLastRupture = relationship.lastRuptureTick === null
    ? null : tick - relationship.lastRuptureTick;
  const passes: ConditionPasses = {
    bond: relationship.bondStrength >= thresholds.requiredBondStrength,
    density: relationship.localRelationshipDensity >= thresholds.densityThreshold,
    internalEnergy: relationship.internalEnergy >= thresholds.internalEnergyThreshold,
    age: relationship.age >= thresholds.minimumAge,
    cooldown: ticksSinceLastRupture === null || ticksSinceLastRupture >= thresholds.cooldown,
  };
  const closeness: Record<RuptureCondition, number> = {
    bond: ratio(relationship.bondStrength, thresholds.requiredBondStrength),
    density: ratio(relationship.localRelationshipDensity, thresholds.densityThreshold),
    "internal-energy": ratio(relationship.internalEnergy, thresholds.internalEnergyThreshold),
    age: ratio(relationship.age, thresholds.minimumAge),
    cooldown: ticksSinceLastRupture === null ? 1 : ratio(ticksSinceLastRupture, thresholds.cooldown),
  };
  const conditions: RuptureCondition[] = ["bond", "density", "internal-energy", "age", "cooldown"];
  const passFor = (condition: RuptureCondition): boolean => condition === "internal-energy"
    ? passes.internalEnergy : passes[condition];
  const failed = conditions.filter((condition) => !passFor(condition));
  const primaryBlockingCondition = failed.length
    ? failed.reduce((worst, condition) => closeness[condition] < closeness[worst] ? condition : worst)
    : "qualified";
  return {
    relationshipId: relationship.id,
    parentIds: [relationship.parentAId, relationship.parentBId],
    bondStrength: relationship.bondStrength, requiredBondStrength: thresholds.requiredBondStrength,
    density: relationship.localRelationshipDensity, densityThreshold: thresholds.densityThreshold,
    internalEnergy: relationship.internalEnergy, internalEnergyThreshold: thresholds.internalEnergyThreshold,
    age: relationship.age, minimumAge: thresholds.minimumAge,
    cooldownElapsed: passes.cooldown, cooldownRequired: thresholds.cooldown,
    ticksSinceLastRupture, lastRuptureTick: relationship.lastRuptureTick, passes,
    totalConditionsPassed: conditions.filter(passFor).length,
    normalizedCloseness: conditions.reduce((sum, condition) => sum + closeness[condition], 0) / conditions.length,
    primaryBlockingCondition,
  };
};

export function buildRuptureDiagnostics(universe: Universe) {
  const relationships = [...universe.relationshipLayer.entities.values()];
  const candidates = relationships.map((relationship) => diagnose(relationship, universe.state.ticks));
  const pass = (candidate: RuptureNearMiss, condition: RuptureCondition): boolean => condition === "internal-energy"
    ? candidate.passes.internalEnergy : candidate.passes[condition];
  const conditions: RuptureCondition[] = ["bond", "density", "internal-energy", "age", "cooldown"];
  const onlyBlockedBy = (candidate: RuptureNearMiss, blocker: RuptureCondition): boolean =>
    !pass(candidate, blocker) && conditions.every((condition) => condition === blocker || pass(candidate, condition));
  const parameters = relationships.map((relationship) => ruptureParameters(relationship.fingerprint));
  return {
    conditionPassCounts: {
      bond: candidates.filter((candidate) => candidate.passes.bond).length,
      density: candidates.filter((candidate) => candidate.passes.density).length,
      internalEnergy: candidates.filter((candidate) => candidate.passes.internalEnergy).length,
      age: candidates.filter((candidate) => candidate.passes.age).length,
      cooldown: candidates.filter((candidate) => candidate.passes.cooldown).length,
      all: candidates.filter((candidate) => candidate.totalConditionsPassed === conditions.length).length,
    },
    singleBlockerCounts: {
      bond: candidates.filter((candidate) => onlyBlockedBy(candidate, "bond")).length,
      density: candidates.filter((candidate) => onlyBlockedBy(candidate, "density")).length,
      internalEnergy: candidates.filter((candidate) => onlyBlockedBy(candidate, "internal-energy")).length,
      age: candidates.filter((candidate) => onlyBlockedBy(candidate, "age")).length,
      cooldown: candidates.filter((candidate) => onlyBlockedBy(candidate, "cooldown")).length,
    },
    distributions: {
      measurements: {
        internalEnergy: distribution(relationships.map((relationship) => relationship.internalEnergy)),
        density: distribution(relationships.map((relationship) => relationship.localRelationshipDensity)),
        bondStrength: distribution(relationships.map((relationship) => relationship.bondStrength)),
        age: distribution(relationships.map((relationship) => relationship.age)),
      },
      thresholds: {
        density: distribution(parameters.map((value) => value.densityThreshold)),
        internalEnergy: distribution(parameters.map((value) => value.internalEnergyThreshold)),
        requiredBondStrength: distribution(parameters.map((value) => value.requiredBondStrength)),
        minimumAge: distribution(parameters.map((value) => value.minimumAge)),
        cooldown: distribution(parameters.map((value) => value.cooldown)),
      },
    },
    nearMissCandidates: candidates.sort((a, b) =>
      b.totalConditionsPassed - a.totalConditionsPassed
      || b.normalizedCloseness - a.normalizedCloseness
      || (a.relationshipId < b.relationshipId ? -1 : a.relationshipId > b.relationshipId ? 1 : 0)
    ).slice(0, 20),
  };
}
