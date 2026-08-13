import type { EntityRecord, QuerySnapshot, RelationshipRecord } from "../query/queryTypes.js";
import { PERCEPTION_FEATURE_VERSION } from "./perceptionTypes.js";
import { finiteValues, normalized, round } from "./statistics.js";
import type { OccurrenceRecord } from "../query/queryTypes.js";
import { queryRegion, type RegionResults } from "../query/spatialQueries.js";

type Feature = { name: string; target: number; candidate: number; difference: number };
const similarity = (features: Feature[], categoricalMatch = 1): number => round(Math.max(0, 1 - features.reduce((sum, item) => sum + item.difference, 0) / Math.max(1, features.length)) * 0.85 + categoricalMatch * 0.15);

export function findSimilarEntity(snapshot: QuerySnapshot, target: EntityRecord, limit = 10): Record<string, unknown> {
  const entities = snapshot.entities ?? [];
  const scales = { energy: finiteValues(entities.map((item) => item.energy)), age: finiteValues(entities.map((item) => item.age)),
    neighbors: finiteValues(entities.map((item) => item.neighborCount)), bond: finiteValues(entities.map((item) => item.strongestBond)),
    relationship: finiteValues(entities.map((item) => item.strongestRelationship)) };
  const vector = (item: EntityRecord) => ({ energy: normalized(item.energy, scales.energy), age: normalized(item.age, scales.age),
    neighbors: normalized(item.neighborCount, scales.neighbors), bond: normalized(item.strongestBond, scales.bond),
    relationship: normalized(item.strongestRelationship, scales.relationship) });
  const targetVector = vector(target);
  const matches = entities.filter((item) => item.id !== target.id).map((candidate) => {
    const candidateVector = vector(candidate);
    const features = Object.keys(targetVector).map((name) => ({ name, target: targetVector[name as keyof typeof targetVector],
      candidate: candidateVector[name as keyof typeof candidateVector], difference: Math.abs(targetVector[name as keyof typeof targetVector] - candidateVector[name as keyof typeof candidateVector]) }));
    return { object: { kind: "entity", id: candidate.id }, similarityScore: similarity(features, candidate.origin === target.origin ? 1 : 0),
      sharedFeatures: [...features].sort((a, b) => a.difference - b.difference).slice(0, 3).map((item) => item.name),
      importantDifferences: [...features].sort((a, b) => b.difference - a.difference).slice(0, 2), features };
  }).sort((a, b) => b.similarityScore - a.similarityScore || Number(a.object.id) - Number(b.object.id)).slice(0, limit);
  return { featureVersion: PERCEPTION_FEATURE_VERSION, method: "normalized-feature-distance", target: { kind: "entity", id: target.id }, matches,
    baseline: `${entities.length} entities in canonical snapshot` };
}

export function findSimilarRelationship(snapshot: QuerySnapshot, target: RelationshipRecord, limit = 10): Record<string, unknown> {
  const relationships = snapshot.relationships ?? [];
  const keys = ["age", "bondStrength", "coherence", "synergy", "localRelationshipDensity", "localFieldPotential"] as const;
  const scales = Object.fromEntries(keys.map((key) => [key, finiteValues(relationships.map((item) => item[key] as number | null))])) as Record<typeof keys[number], number[]>;
  const vector = (item: RelationshipRecord) => Object.fromEntries(keys.map((key) => [key, normalized(item[key] as number | null, scales[key])])) as Record<typeof keys[number], number>;
  const targetVector = vector(target);
  const matches = relationships.filter((item) => item.id !== target.id).map((candidate) => {
    const candidateVector = vector(candidate), features = keys.map((name) => ({ name, target: targetVector[name], candidate: candidateVector[name], difference: Math.abs(targetVector[name] - candidateVector[name]) }));
    const stateMatch = candidate.spatialActive === target.spatialActive && candidate.influenceActive === target.influenceActive ? 1 : 0;
    return { object: { kind: "relationship", id: candidate.id }, similarityScore: similarity(features, stateMatch),
      sharedFeatures: [...features].sort((a, b) => a.difference - b.difference).slice(0, 3).map((item) => item.name),
      importantDifferences: [...features].sort((a, b) => b.difference - a.difference).slice(0, 2), features };
  }).sort((a, b) => b.similarityScore - a.similarityScore || String(a.object.id).localeCompare(String(b.object.id))).slice(0, limit);
  return { featureVersion: PERCEPTION_FEATURE_VERSION, method: "normalized-feature-distance", target: { kind: "relationship", id: target.id }, matches,
    baseline: `${relationships.length} relationships in canonical snapshot` };
}

const regionVector = (region: RegionResults) => ({ entityCount: region.metrics.entityCount, relationshipCount: region.metrics.relationshipCount,
  energy: region.metrics.averageEnergy ?? 0, coherence: region.metrics.averageCoherence ?? 0, synergy: region.metrics.averageSynergy ?? 0,
  ruptures: region.metrics.recentRuptureCount });

export function findSimilarRegions(snapshot: QuerySnapshot, events: readonly OccurrenceRecord[], target: { x: number; y: number; radius: number }, limit = 10): Record<string, unknown> {
  const targetRegion = queryRegion(snapshot, events, { ...target, limit: 100 }, "perception-internal").results;
  const candidates = (snapshot.entities ?? []).filter((item) => item.x !== null && item.y !== null && Math.hypot(item.x - target.x, item.y - target.y) > target.radius)
    .slice(0, 50).map((item) => ({ x: item.x!, y: item.y!, radius: target.radius,
      region: queryRegion(snapshot, events, { x: item.x!, y: item.y!, radius: target.radius, limit: 100 }, "perception-internal").results }));
  const vectors = [regionVector(targetRegion), ...candidates.map((item) => regionVector(item.region))], keys = Object.keys(vectors[0]) as Array<keyof ReturnType<typeof regionVector>>;
  const scales = Object.fromEntries(keys.map((key) => [key, vectors.map((item) => item[key])])) as Record<keyof ReturnType<typeof regionVector>, number[]>;
  const normalizedVector = (value: ReturnType<typeof regionVector>) => Object.fromEntries(keys.map((key) => [key, normalized(value[key], scales[key])])) as Record<keyof ReturnType<typeof regionVector>, number>;
  const targetVector = normalizedVector(vectors[0]);
  const matches = candidates.map((candidate) => {
    const vector = normalizedVector(regionVector(candidate.region)), features = keys.map((name) => ({ name, target: targetVector[name], candidate: vector[name], difference: Math.abs(targetVector[name] - vector[name]) }));
    return { object: { kind: "region", x: candidate.x, y: candidate.y, radius: candidate.radius }, similarityScore: similarity(features),
      sharedFeatures: [...features].sort((a, b) => a.difference - b.difference).slice(0, 3).map((item) => item.name),
      importantDifferences: [...features].sort((a, b) => b.difference - a.difference).slice(0, 2) };
  }).sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
  return { featureVersion: PERCEPTION_FEATURE_VERSION, method: "normalized-region-feature-distance", target, matches,
    baseline: `${candidates.length} bounded entity-centered candidate regions`, limitation: "Candidate regions are samples, not authoritative clusters." };
}
