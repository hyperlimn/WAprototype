import type { EntityRecord, QuerySnapshot, RelationshipRecord } from "../query/queryTypes.js";
import { finiteValues, mean, round } from "./statistics.js";

const numericComparison = (a: object, b: object, keys: string[]) => keys.map((metric) => {
  const first = a as Record<string, unknown>, second = b as Record<string, unknown>;
  const before = typeof first[metric] === "number" ? first[metric] as number : null, after = typeof second[metric] === "number" ? second[metric] as number : null;
  const delta = before === null || after === null ? null : after - before;
  const scale = before === null || after === null ? 1 : Math.max(Math.abs(before), Math.abs(after), 1e-9);
  return { metric, a: before, b: after, delta, normalizedDelta: delta === null ? null : round(delta / scale) };
}).sort((a, b) => Math.abs(b.normalizedDelta ?? 0) - Math.abs(a.normalizedDelta ?? 0));

export const compareEntities = (a: EntityRecord, b: EntityRecord): Record<string, unknown> => ({ kind: "entity-comparison", targets: [a.id, b.id],
  sharedCharacteristics: [a.origin === b.origin ? `origin:${a.origin}` : null].filter(Boolean),
  largestDifferences: numericComparison(a, b, ["energy", "age", "neighborCount", "strongestBond", "strongestRelationship", "vx", "vy"]),
  structuralDifferences: { relationshipCount: [a.currentRelationshipIds.length, b.currentRelationshipIds.length], lineageAvailable: [a.parentEntityIds !== null, b.parentEntityIds !== null] },
  explainability: { classification: "derived", method: "normalized metric deltas", baseline: "the two selected authoritative entity records" } });

export const compareRelationships = (a: RelationshipRecord, b: RelationshipRecord): Record<string, unknown> => ({ kind: "relationship-comparison", targets: [a.id, b.id],
  sharedCharacteristics: [a.spatialActive === b.spatialActive ? `spatialActive:${a.spatialActive}` : null,
    a.influenceActive === b.influenceActive ? `influenceActive:${a.influenceActive}` : null].filter(Boolean),
  largestDifferences: numericComparison(a, b, ["age", "bondStrength", "relationshipStrength", "coherence", "synergy", "localRelationshipDensity", "localFieldPotential"]),
  explainability: { classification: "derived", method: "normalized metric deltas", baseline: "the two selected authoritative relationship records" } });

const universeMetrics = (snapshot: QuerySnapshot) => ({ population: snapshot.entities?.length ?? 0, relationships: snapshot.relationships?.length ?? 0,
  averageEnergy: mean(finiteValues((snapshot.entities ?? []).map((item) => item.energy))),
  averageCoherence: mean(finiteValues((snapshot.relationships ?? []).map((item) => item.coherence))),
  averageSynergy: mean(finiteValues((snapshot.relationships ?? []).map((item) => item.synergy))),
  averageDensity: mean(finiteValues((snapshot.relationships ?? []).map((item) => item.localRelationshipDensity))) });

export const compareUniverses = (a: QuerySnapshot, b: QuerySnapshot, versions: [string | null, string | null]): Record<string, unknown> => ({
  kind: "universe-comparison", compatibleSimulationVersions: versions[0] === versions[1],
  warnings: versions[0] === versions[1] ? [] : [`Simulation versions differ (${versions[0] ?? "unknown"} vs ${versions[1] ?? "unknown"}); comparisons may not be semantically equivalent.`],
  largestDifferences: numericComparison(universeMetrics(a), universeMetrics(b), ["population", "relationships", "averageEnergy", "averageCoherence", "averageSynergy", "averageDensity"]),
  explainability: { classification: "derived", method: "snapshot aggregate deltas", baseline: "canonical snapshot aggregates" } });

export const compareRegions = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => ({
  kind: "region-comparison", largestDifferences: numericComparison(a, b, ["entityCount", "relationshipCount", "averageEnergy", "averageNeighborCount", "averageCoherence", "averageSynergy", "averageFieldPotential", "recentRuptureCount"]),
  structuralDifferences: { a, b }, explainability: { classification: "derived", method: "normalized region aggregate deltas",
    baseline: "two geometric observations", limitation: "Regions are inferred geometry, not authoritative clusters." } });
