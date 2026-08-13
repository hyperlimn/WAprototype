import { currentTick, finite, type EntityRecord, type OccurrenceRecord, type QueryResponse, type QuerySnapshot, type RelationshipRecord } from "./queryTypes.js";

export interface DiscoveryResults {
  oldestEntities: EntityRecord[];
  highestEnergyEntities: EntityRecord[];
  mostConnectedEntities: EntityRecord[];
  oldestRelationships: RelationshipRecord[];
  highestCoherenceRelationships: RelationshipRecord[];
  highestDensityRelationships: RelationshipRecord[];
  highestSynergyRelationships: RelationshipRecord[];
  recentReproductions: OccurrenceRecord[];
  recentRuptures: OccurrenceRecord[];
}

export function queryDiscover(snapshot: QuerySnapshot, events: readonly OccurrenceRecord[], interfaceVersion: string,
  size = 10): QueryResponse<DiscoveryResults, { limit: number }> {
  const entities = snapshot.entities ?? [], relationships = snapshot.relationships ?? [];
  const top = <T>(items: readonly T[], compare: (a: T, b: T) => number) => [...items].sort(compare).slice(0, size);
  const byEntity = (select: (entity: EntityRecord) => number) =>
    (a: EntityRecord, b: EntityRecord) => select(b) - select(a) || a.id - b.id;
  const byRelationship = (select: (relationship: RelationshipRecord) => number) =>
    (a: RelationshipRecord, b: RelationshipRecord) => select(b) - select(a) || a.id.localeCompare(b.id);
  const results: DiscoveryResults = {
    oldestEntities: top(entities, byEntity((entity) => finite(entity.age))),
    highestEnergyEntities: top(entities, byEntity((entity) => finite(entity.energy))),
    mostConnectedEntities: top(entities, byEntity((entity) => entity.neighborCount)),
    oldestRelationships: top(relationships, byRelationship((relationship) => finite(relationship.age))),
    highestCoherenceRelationships: top(relationships, byRelationship((relationship) => finite(relationship.coherence))),
    highestDensityRelationships: top(relationships, byRelationship((relationship) => relationship.localRelationshipDensity)),
    highestSynergyRelationships: top(relationships, byRelationship((relationship) => finite(relationship.synergy))),
    recentReproductions: events.filter((event) => event.type === "reproduction").slice(-size).reverse(),
    recentRuptures: events.filter((event) => event.type === "rupture").slice(-size).reverse(),
  };
  return { interfaceVersion, currentTick: currentTick(snapshot), query: { limit: size },
    resultCount: Object.values(results).reduce((sum, values) => sum + values.length, 0), truncated: false, results };
}
