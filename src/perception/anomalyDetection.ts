import type { QuerySnapshot } from "../query/queryTypes.js";
import type { AnomalyResult } from "./perceptionTypes.js";
import { finiteValues, robustScore, round } from "./statistics.js";

export function findAnomalies(snapshot: QuerySnapshot, kind?: string, limit = 10): AnomalyResult[] {
  const entities = snapshot.entities ?? [], relationships = snapshot.relationships ?? [], results: AnomalyResult[] = [];
  const entityMetrics = [
    { name: "neighbor count", key: "neighborCount" as const, values: finiteValues(entities.map((item) => item.neighborCount)) },
    { name: "energy", key: "energy" as const, values: finiteValues(entities.map((item) => item.energy)) },
    { name: "age", key: "age" as const, values: finiteValues(entities.map((item) => item.age)) },
  ];
  if (!kind || kind === "entity") for (const entity of entities) for (const metric of entityMetrics) {
    const value = entity[metric.key], scored = robustScore(value, metric.values);
    if (scored.score < 2.5) continue;
    results.push({ kind: "entity", identifier: entity.id, anomalyScore: round(Math.min(1, scored.score / 8)), category: `extreme-${metric.key}`,
      reason: `${metric.name} is ${round(scored.score)} robust deviations from the median`, supportingMetrics: { [metric.key]: value },
      comparisonBaseline: { median: scored.median, mad: scored.mad, baselinePopulation: metric.values.length },
      explainability: { classification: "derived", method: "median-MAD", baseline: `all ${metric.values.length} entities in the observed snapshot` } });
  }
  const relationshipMetrics = [
    { name: "coherence", key: "coherence" as const, values: finiteValues(relationships.map((item) => item.coherence)) },
    { name: "synergy", key: "synergy" as const, values: finiteValues(relationships.map((item) => item.synergy)) },
    { name: "density", key: "localRelationshipDensity" as const, values: finiteValues(relationships.map((item) => item.localRelationshipDensity)) },
    { name: "age", key: "age" as const, values: finiteValues(relationships.map((item) => item.age)) },
  ];
  if (!kind || kind === "relationship") for (const relationship of relationships) for (const metric of relationshipMetrics) {
    const value = relationship[metric.key] as number | null, scored = robustScore(value, metric.values);
    if (scored.score < 2.5) continue;
    results.push({ kind: "relationship", identifier: relationship.id, anomalyScore: round(Math.min(1, scored.score / 8)), category: `extreme-${metric.key}`,
      reason: `${metric.name} is ${round(scored.score)} robust deviations from the median`, supportingMetrics: { [metric.key]: value },
      comparisonBaseline: { median: scored.median, mad: scored.mad, baselinePopulation: metric.values.length },
      explainability: { classification: "derived", method: "median-MAD", baseline: `all ${metric.values.length} relationships in the observed snapshot` } });
  }
  return results.sort((a, b) => b.anomalyScore - a.anomalyScore || String(a.identifier).localeCompare(String(b.identifier))).slice(0, limit);
}
