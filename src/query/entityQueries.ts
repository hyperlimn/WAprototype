import { currentTick, finite, type EntityQueryParams, type EntityRecord, type QueryIndexes, type QueryResponse, type QuerySnapshot } from "./queryTypes.js";

export type CompactEntityRecord = Pick<EntityRecord, "id" | "fingerprint" | "origin" | "birthTick" | "age" | "x" | "y" |
  "energy" | "neighborCount" | "strongestBond" | "strongestRelationship" | "currentRelationshipIds" |
  "naturalFrequency" | "phase" | "currentOscillation">;

const compact = (entity: EntityRecord): CompactEntityRecord => ({
  id: entity.id, fingerprint: entity.fingerprint, origin: entity.origin, birthTick: entity.birthTick,
  age: entity.age, x: entity.x, y: entity.y, energy: entity.energy, neighborCount: entity.neighborCount,
  naturalFrequency: entity.naturalFrequency, phase: entity.phase, currentOscillation: entity.currentOscillation,
  strongestBond: entity.strongestBond, strongestRelationship: entity.strongestRelationship,
  currentRelationshipIds: entity.currentRelationshipIds,
});

export function queryEntities(snapshot: QuerySnapshot, params: EntityQueryParams, interfaceVersion: string): QueryResponse<CompactEntityRecord[], EntityQueryParams> {
  const filtered = (snapshot.entities ?? []).filter((entity) =>
    (params.origin === undefined || entity.origin === params.origin)
    && (params.minAge === undefined || finite(entity.age) >= params.minAge)
    && (params.maxAge === undefined || finite(entity.age) <= params.maxAge)
    && (params.minEnergy === undefined || finite(entity.energy) >= params.minEnergy)
    && (params.minNeighbors === undefined || entity.neighborCount >= params.minNeighbors)
    && (params.minStrongestBond === undefined || finite(entity.strongestBond) >= params.minStrongestBond)
    && (params.minStrongestRelationship === undefined || finite(entity.strongestRelationship) >= params.minStrongestRelationship)
    && (params.relationshipId === undefined || entity.currentRelationshipIds.includes(params.relationshipId)));
  const sorters: Record<EntityQueryParams["sort"], (a: EntityRecord, b: EntityRecord) => number> = {
    "age-desc": (a, b) => finite(b.age) - finite(a.age) || a.id - b.id,
    "energy-desc": (a, b) => finite(b.energy) - finite(a.energy) || a.id - b.id,
    "neighbors-desc": (a, b) => b.neighborCount - a.neighborCount || a.id - b.id,
    "bond-desc": (a, b) => finite(b.strongestBond) - finite(a.strongestBond) || a.id - b.id,
    "relationship-desc": (a, b) => finite(b.strongestRelationship) - finite(a.strongestRelationship) || a.id - b.id,
    "id-asc": (a, b) => a.id - b.id,
  };
  filtered.sort(sorters[params.sort]);
  return { interfaceVersion, currentTick: currentTick(snapshot), query: params,
    resultCount: Math.min(filtered.length, params.limit), truncated: filtered.length > params.limit,
    results: filtered.slice(0, params.limit).map(compact) };
}

export interface NeighborParams { radius: number; limit: number }
export interface NeighborResult {
  entity: EntityRecord; nearbyEntities: Array<CompactEntityRecord & { distance: number }>;
  connectedRelationships: Array<{ relationship: unknown; partner: EntityRecord | null; distance: number | null;
    relationshipStrength: number | null; bondStrength: number | null }>;
}

export function queryEntityNeighbors(snapshot: QuerySnapshot, indexes: QueryIndexes, entity: EntityRecord,
  params: NeighborParams, interfaceVersion: string): QueryResponse<NeighborResult, NeighborParams> {
  const distanceBetween = (a: EntityRecord, b: EntityRecord): number | null =>
    a.x === null || a.y === null || b.x === null || b.y === null ? null : Math.hypot(a.x - b.x, a.y - b.y);
  const nearby = (snapshot.entities ?? []).filter((candidate) => candidate.id !== entity.id).map((candidate) => {
    const distance = distanceBetween(candidate, entity);
    return distance === null ? null : { ...compact(candidate), distance };
  }).filter((candidate): candidate is CompactEntityRecord & { distance: number } => candidate !== null && candidate.distance <= params.radius)
    .sort((a, b) => a.distance - b.distance || a.id - b.id);
  const connected = [...(indexes.relationshipsByParent.get(entity.id) ?? [])].map((relationship) => {
    const partnerId = relationship.parentAId === entity.id ? relationship.parentBId : relationship.parentAId;
    const partner = indexes.entityById.get(partnerId) ?? null;
    return { relationship, partner, distance: partner ? distanceBetween(partner, entity) : null,
      relationshipStrength: relationship.relationshipStrength, bondStrength: relationship.bondStrength };
  }).sort((a, b) => finite(b.bondStrength) - finite(a.bondStrength));
  const total = nearby.length + connected.length;
  const results = { entity, nearbyEntities: nearby.slice(0, params.limit), connectedRelationships: connected.slice(0, params.limit) };
  return { interfaceVersion, currentTick: currentTick(snapshot), query: params,
    resultCount: results.nearbyEntities.length + results.connectedRelationships.length,
    truncated: nearby.length > params.limit || connected.length > params.limit, results };
}

export interface LineageResult { entity: EntityRecord; origin: string; parents: EntityRecord[]; parentRelationship: unknown | null; ancestors: LineageNode[] }
export interface LineageNode { entity: EntityRecord; parents: LineageNode[]; ancestryAvailable: boolean }

export function queryEntityLineage(snapshot: QuerySnapshot, indexes: QueryIndexes, entity: EntityRecord,
  depth: number, interfaceVersion: string): QueryResponse<LineageResult, { depth: number }> {
  const build = (value: EntityRecord, remaining: number, seen: Set<number>): LineageNode => {
    if (!value.parentEntityIds) return { entity: value, parents: [], ancestryAvailable: true };
    if (remaining <= 0 || seen.has(value.id)) return { entity: value, parents: [], ancestryAvailable: false };
    const nextSeen = new Set(seen).add(value.id);
    const parents = value.parentEntityIds.map((id) => indexes.entityById.get(id)).filter((item): item is EntityRecord => item !== undefined)
      .map((parent) => build(parent, remaining - 1, nextSeen));
    return { entity: value, parents, ancestryAvailable: parents.length === value.parentEntityIds.length };
  };
  const parents = entity.parentEntityIds?.map((id) => indexes.entityById.get(id)).filter((item): item is EntityRecord => item !== undefined) ?? [];
  const ancestors = parents.map((parent) => build(parent, depth - 1, new Set([entity.id])));
  const result = { entity, origin: entity.origin, parents,
    parentRelationship: entity.parentRelationshipId ? indexes.relationshipById.get(entity.parentRelationshipId) ?? null : null, ancestors };
  return { interfaceVersion, currentTick: currentTick(snapshot), query: { depth }, resultCount: ancestors.length,
    truncated: false, results: result };
}
