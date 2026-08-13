import { currentTick, type EntityRecord, type OccurrenceRecord, type QueryResponse, type QuerySnapshot, type RelationshipRecord } from "./queryTypes.js";

export interface RegionParams { x: number; y: number; radius: number; limit: number }
export interface RegionResults { entities: EntityRecord[]; relationships: RelationshipRecord[]; metrics: {
  entityCount: number; relationshipCount: number; averageEnergy: number | null; averageNeighborCount: number | null;
  averageCoherence: number | null; averageSynergy: number | null; averageFieldPotential: number | null; recentRuptureCount: number;
} }
const average = (values: Array<number | null>): number | null => {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
const inside = (x: number | null, y: number | null, params: RegionParams): boolean =>
  x !== null && y !== null && Math.hypot(x - params.x, y - params.y) <= params.radius;

export function queryRegion(snapshot: QuerySnapshot, events: readonly OccurrenceRecord[], params: RegionParams,
  interfaceVersion: string): QueryResponse<RegionResults, RegionParams> {
  const entities = (snapshot.entities ?? []).filter((entity) => inside(entity.x, entity.y, params));
  const relationships = (snapshot.relationships ?? []).filter((relationship) => inside(relationship.x, relationship.y, params));
  const recentRuptureCount = events.filter((event) => event.type === "rupture" && inside(event.x, event.y, params)).length;
  const limitedEntities = entities.slice(0, params.limit), limitedRelationships = relationships.slice(0, params.limit);
  return { interfaceVersion, currentTick: currentTick(snapshot), query: params,
    resultCount: limitedEntities.length + limitedRelationships.length,
    truncated: entities.length > params.limit || relationships.length > params.limit, results: {
      entities: limitedEntities, relationships: limitedRelationships,
      metrics: { entityCount: entities.length, relationshipCount: relationships.length,
        averageEnergy: average(entities.map((entity) => entity.energy)),
        averageNeighborCount: average(entities.map((entity) => entity.neighborCount)),
        averageCoherence: average(relationships.map((relationship) => relationship.coherence)),
        averageSynergy: average(relationships.map((relationship) => relationship.synergy)),
        averageFieldPotential: average(relationships.map((relationship) => relationship.localFieldPotential)), recentRuptureCount },
    } };
}
