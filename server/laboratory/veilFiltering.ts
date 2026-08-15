import type { VeilPolicy } from "./veilPolicy.js";

const HISTORICAL_KEYS = /^(age|birthTick|creationTick|origin|history|ruptureHistory|memoryRange|tickSpan|firstTick|earliestCheckpoint|persistedEventCount|eventCount|checkpointCount|segmentCount)$/i;
const ANCESTRY_KEYS = /^(parentEntityIds|parentRelationshipId|lineage|ancestry)$/i;
const AGE_FEATURE_KEY = /(?:^|_)(?:age|birth|creation|lineage|ancestry)(?:$|_)/i;
const DEEP_INSCRIPTION_KEYS = /^(?:age|averageRelationshipAge|birthTick|creationTick|creationIndex|origin|fingerprint|oldestEntities|oldestRelationships|attentionSuggestions|reproductionCount|reproductionBirths|totalReproductionEvents|birthsLast10000Ticks|recentBirths|recentRelationshipFormations|lastReproductionTick|nextEligibleTick|eventSequence|createdAt|lastUpdatedAt|latestPersistedTick)$/i;
const DEEP_CUMULATIVE_KEYS = /^(?:(?:cumulative|total).*(?:event|birth|reproduction|formation|rupture)|(?:persisted)?eventCount|checkpointCount|segmentCount|activeSegmentSize)$/i;
const INSCRIPTION_TEXT = /\b(?:age|aged|birth|born|creation|created|founder|initial entity|external arrival|origin|reproduction)\b/i;
const CLEAN_ROOM_ALWAYS_HIDDEN = /^(?:activity|attentionSuggestions|recentEventCount|recentEventRate|recentRuptureCount|recentOccurrences|eventSequence|eventKey|malformedRecordCount|warnings|offset|pageIndex|startIndex|endIndex|countByOrigin|reproductionSummary|ruptureSummary|ruptureCascadeSummary|firstTickAboveCreationThreshold|ruptureCount)$/i;
const CLEAN_ROOM_HISTORY_TOKEN = /(?:event|occurrence|birth|reproduction|rupture|formation|destruction|transition|arrival|checkpoint|segment|origin)/i;
const CLEAN_ROOM_COUNTER_TOKEN = /(?:count|total|number|offset|index)$/i;
const CLEAN_ROOM_HISTORY_TEXT = /\b\d+\s+(?:events?|occurrences?|births?|ruptures?|formations?|destructions?|transitions?)\s+(?:before|previously|already)\b/i;
const PRESENT_MOMENT_ALWAYS_HIDDEN = /^(?:activity|change|attentionSuggestions|similarObjects|historicalContext|largerScaleActivity|suggestedNextInspections|recordedAt|basePopulationCap)$/i;
const PRESENT_MOMENT_HISTORICAL_TOKEN = /^(?:initial|founder|external|age|duration|elapsed|persistence|previous|prior|recent|oldest|newest|first|last|latest|start|end|birth|reproduction|arrival|creation|formation|destruction|transition|rupture|event|occurrence|checkpoint|archive|history|origin|fingerprint|sequence|eligible|cooldown|threshold)$/i;
const PRESENT_TEXT_FIELDS = /^(?:summary|method|reason|baseline|limitation|description)$/i;

const semanticTokens = (key: string): string[] => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/).filter(Boolean);
const historicalSemanticKey = (key: string): boolean => semanticTokens(key).some((token) =>
  PRESENT_MOMENT_HISTORICAL_TOKEN.test(token.replace(/\d.*$/, "")));

const taintedDerivedObject = (source: Record<string, unknown>): boolean => {
  const category = typeof source.category === "string" ? source.category : "";
  const metric = typeof source.metric === "string" ? source.metric : "";
  const name = typeof source.name === "string" ? source.name : "";
  const labels = `${category} ${metric} ${name}`.replace(/([a-z])([A-Z])/g, "$1-$2");
  return /(?:^|[-_\s])(?:age|births?|creation|origin|reproduction)(?:$|[-_\s])/i.test(labels)
    || semanticTokens(labels).some((token) => PRESENT_MOMENT_HISTORICAL_TOKEN.test(token.replace(/\d.*$/, "")));
};

const presentRankingMetric: Record<string, string> = { highestCoherence: "coherence", highestDensity: "localDensity",
  highestSynergy: "synergy", strongestBonds: "bondStrength", mostConnectedEntities: "neighborCount" };

const entityReferenceKey = (source: Record<string, unknown>, key: string): boolean => {
  if (["parentAId", "parentBId", "entityId"].includes(key)) return true;
  if (key === "identifier" && source.kind === "entity") return true;
  if (key === "id" && (source.kind === "entity" || ("neighborCount" in source && "currentRelationshipIds" in source))) return true;
  return false;
};

const entityReferenceArray = (source: Record<string, unknown>, key: string): boolean =>
  ["parentEntityIds", "newEntities", "disappearedEntities"].includes(key)
  || (key === "targets" && typeof source.kind === "string" && source.kind.startsWith("entity-"));

const relationshipReferenceKey = (source: Record<string, unknown>, key: string): boolean =>
  ["relationshipId", "parentRelationshipId"].includes(key)
  || (key === "identifier" && source.kind === "relationship")
  || (key === "id" && (source.kind === "relationship" || ("parentAId" in source && "parentBId" in source)));

const relationshipReferenceArray = (source: Record<string, unknown>, key: string): boolean =>
  ["currentRelationshipIds", "newRelationships", "disappearedRelationships"].includes(key)
  || (key === "targets" && typeof source.kind === "string" && source.kind.startsWith("relationship-"));

const hiddenUri = (value: string, cutoff: number | undefined): boolean => {
  if (cutoff === undefined) return false;
  const match = value.match(/\/(?:checkpoint|event)\/(\d+)(?:\/|$)/);
  return Boolean(match && Number(match[1]) < cutoff);
};

export function veilFilter(value: unknown, policy: VeilPolicy): unknown {
  const cutoff = policy.cutoff;
  const deep = policy.experiment.profile.historicalInscriptions?.mode === "redact";
  const cleanRoom = Boolean(policy.experiment.profile.cleanRoomHistory);
  const presentMoment = policy.experiment.profile.presentMoment === true;
  const retainStructuralLineage = deep && policy.experiment.profile.historicalInscriptions?.retainStructuralLineage === true;
  const visit = (item: unknown, key = ""): unknown => {
    if (typeof item === "string") {
      if (hiddenUri(item, cutoff)) return undefined;
      if (deep && INSCRIPTION_TEXT.test(item)) return undefined;
      if (cleanRoom && CLEAN_ROOM_HISTORY_TEXT.test(item)) return undefined;
      if (presentMoment && PRESENT_TEXT_FIELDS.test(key) && semanticTokens(item).some((token) => PRESENT_MOMENT_HISTORICAL_TOKEN.test(token))) return undefined;
      return item;
    }
    if (Array.isArray(item)) {
      const filtered = item.map((entry) => visit(entry, key)).filter((entry) => entry !== undefined);
      if (!presentMoment) return filtered;
      if (presentRankingMetric[key]) return [...filtered].sort((a: any, b: any) =>
        Number(b?.[presentRankingMetric[key]] ?? 0) - Number(a?.[presentRankingMetric[key]] ?? 0)
        || String(a?.id ?? a?.identifier).localeCompare(String(b?.id ?? b?.identifier)));
      if (["parentEntityIds", "currentRelationshipIds"].includes(key)) return [...filtered].sort((a, b) => String(a).localeCompare(String(b)));
      if (filtered.every((entry) => entry && typeof entry === "object" && "id" in (entry as Record<string, unknown>)))
        return [...filtered].sort((a: any, b: any) => typeof a.distance === "number" && typeof b.distance === "number"
          ? a.distance - b.distance || String(a.id).localeCompare(String(b.id)) : String(a.id).localeCompare(String(b.id)));
      return filtered;
    }
    if (!item || typeof item !== "object") return item;
    const source = item as Record<string, unknown>;
    const eventLike = typeof source.tick === "number" && typeof source.sequence === "number";
    if (typeof source.tick === "number" && cutoff !== undefined && source.tick < cutoff) return undefined;
    if (deep && taintedDerivedObject(source)) return undefined;
    const result: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(source)) {
      if (deep && (DEEP_INSCRIPTION_KEYS.test(childKey) || DEEP_CUMULATIVE_KEYS.test(childKey))) continue;
      if (cleanRoom && (CLEAN_ROOM_ALWAYS_HIDDEN.test(childKey)
        || (CLEAN_ROOM_HISTORY_TOKEN.test(childKey) && CLEAN_ROOM_COUNTER_TOKEN.test(childKey))
        || (eventLike && childKey === "description"))) continue;
      if (presentMoment && (PRESENT_MOMENT_ALWAYS_HIDDEN.test(childKey) || (childKey !== "currentTick" && historicalSemanticKey(childKey)))) continue;
      const retainedLineageKey = retainStructuralLineage && ANCESTRY_KEYS.test(childKey);
      if ((cutoff !== undefined && cutoff > 0 && (HISTORICAL_KEYS.test(childKey) || (AGE_FEATURE_KEY.test(childKey) && !retainedLineageKey)))
        || (!policy.experiment.profile.ancestry && ANCESTRY_KEYS.test(childKey))) continue;
      if (!policy.experiment.profile.coordinates && ["x", "y", "vx", "vy", "radius"].includes(childKey)) continue;
      if (!policy.experiment.profile.energy && childKey === "energy") continue;
      if (!policy.experiment.profile.relationshipMetrics && /^(bondStrength|relationshipStrength|strongestBond|strongestRelationship|coherence|synergy|localRelationshipDensity|localFieldPotential)$/.test(childKey)) continue;
      const presented = entityReferenceKey(source, childKey) ? policy.presentEntityId(child)
        : entityReferenceArray(source, childKey) && Array.isArray(child) ? child.map((entry) => policy.presentEntityId(entry))
        : relationshipReferenceKey(source, childKey) ? policy.presentRelationshipId(child)
        : relationshipReferenceArray(source, childKey) && Array.isArray(child) ? child.map((entry) => policy.presentRelationshipId(entry))
        : cleanRoom && childKey === "sequence" ? policy.presentEventId(child)
        : cleanRoom && (childKey === "cursor" || childKey === "nextCursor") ? policy.presentCursor(child) : child;
      const filtered = visit(presented, childKey);
      if (filtered !== undefined) result[childKey] = filtered;
    }
    return result;
  };
  return visit(value);
}
