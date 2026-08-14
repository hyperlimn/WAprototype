import type { VeilPolicy } from "./veilPolicy.js";

const HISTORICAL_KEYS = /^(age|birthTick|creationTick|origin|history|ruptureHistory|memoryRange|tickSpan|firstTick|earliestCheckpoint|persistedEventCount|eventCount|checkpointCount|segmentCount)$/i;
const ANCESTRY_KEYS = /^(parentEntityIds|parentRelationshipId|lineage|ancestry)$/i;
const AGE_FEATURE_KEY = /(?:^|_)(?:age|birth|creation|lineage|ancestry)(?:$|_)/i;

const hiddenUri = (value: string, cutoff: number | undefined): boolean => {
  if (cutoff === undefined) return false;
  const match = value.match(/\/(?:checkpoint|event)\/(\d+)(?:\/|$)/);
  return Boolean(match && Number(match[1]) < cutoff);
};

export function veilFilter(value: unknown, policy: VeilPolicy): unknown {
  const cutoff = policy.cutoff;
  const visit = (item: unknown, key = ""): unknown => {
    if (typeof item === "string") return hiddenUri(item, cutoff) ? undefined : item;
    if (Array.isArray(item)) return item.map((entry) => visit(entry)).filter((entry) => entry !== undefined);
    if (!item || typeof item !== "object") return item;
    const source = item as Record<string, unknown>;
    if (typeof source.tick === "number" && cutoff !== undefined && source.tick < cutoff) return undefined;
    const result: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(source)) {
      if ((cutoff !== undefined && (HISTORICAL_KEYS.test(childKey) || AGE_FEATURE_KEY.test(childKey))) || (!policy.experiment.profile.ancestry && ANCESTRY_KEYS.test(childKey))) continue;
      if (!policy.experiment.profile.coordinates && ["x", "y", "vx", "vy", "radius"].includes(childKey)) continue;
      if (!policy.experiment.profile.energy && childKey === "energy") continue;
      if (!policy.experiment.profile.relationshipMetrics && /^(bondStrength|relationshipStrength|strongestBond|strongestRelationship|coherence|synergy|localRelationshipDensity|localFieldPotential)$/.test(childKey)) continue;
      const filtered = visit(child, childKey);
      if (filtered !== undefined) result[childKey] = filtered;
    }
    return result;
  };
  return visit(value);
}
