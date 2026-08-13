import { currentTick, finite, type QueryResponse, type QuerySnapshot, type RelationshipQueryParams, type RelationshipRecord } from "./queryTypes.js";

export type CompactRelationshipRecord = Pick<RelationshipRecord, "id" | "fingerprint" | "parentAId" | "parentBId" |
  "creationTick" | "age" | "spatialActive" | "influenceActive" | "bondStrength" | "relationshipStrength" |
  "x" | "y" | "coherence" | "localRelationshipDensity" | "synergy" | "localFieldPotential" | "ruptureQualified">;

export function queryRelationships(snapshot: QuerySnapshot, params: RelationshipQueryParams,
  interfaceVersion: string): QueryResponse<CompactRelationshipRecord[], RelationshipQueryParams> {
  const filtered = (snapshot.relationships ?? []).filter((relationship) => {
    const dormant = !relationship.spatialActive && !relationship.influenceActive;
    return (params.minAge === undefined || finite(relationship.age) >= params.minAge)
      && (params.maxAge === undefined || finite(relationship.age) <= params.maxAge)
      && (params.minBond === undefined || finite(relationship.bondStrength) >= params.minBond)
      && (params.minStrength === undefined || finite(relationship.relationshipStrength) >= params.minStrength)
      && (params.minCoherence === undefined || finite(relationship.coherence) >= params.minCoherence)
      && (params.minDensity === undefined || relationship.localRelationshipDensity >= params.minDensity)
      && (params.minSynergy === undefined || finite(relationship.synergy) >= params.minSynergy)
      && (params.spatialActive === undefined || relationship.spatialActive === params.spatialActive)
      && (params.influenceActive === undefined || relationship.influenceActive === params.influenceActive)
      && (params.dormant === undefined || dormant === params.dormant)
      && (params.parentEntityId === undefined || relationship.parentAId === params.parentEntityId || relationship.parentBId === params.parentEntityId)
      && (params.ruptureEligible === undefined || relationship.ruptureQualified === params.ruptureEligible);
  });
  const sorters: Record<RelationshipQueryParams["sort"], (a: RelationshipRecord, b: RelationshipRecord) => number> = {
    "age-desc": (a, b) => finite(b.age) - finite(a.age) || a.id.localeCompare(b.id),
    "bond-desc": (a, b) => finite(b.bondStrength) - finite(a.bondStrength) || a.id.localeCompare(b.id),
    "coherence-desc": (a, b) => finite(b.coherence) - finite(a.coherence) || a.id.localeCompare(b.id),
    "density-desc": (a, b) => b.localRelationshipDensity - a.localRelationshipDensity || a.id.localeCompare(b.id),
    "synergy-desc": (a, b) => finite(b.synergy) - finite(a.synergy) || a.id.localeCompare(b.id),
    "id-asc": (a, b) => a.id.localeCompare(b.id),
  };
  filtered.sort(sorters[params.sort]);
  return { interfaceVersion, currentTick: currentTick(snapshot), query: params,
    resultCount: Math.min(filtered.length, params.limit), truncated: filtered.length > params.limit,
    results: filtered.slice(0, params.limit) };
}
