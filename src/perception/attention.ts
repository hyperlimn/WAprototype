import type { QuerySnapshot } from "../query/queryTypes.js";
import type { AnomalyResult, AttentionSuggestion } from "./perceptionTypes.js";
import { ATTENTION_WEIGHTS } from "./perceptionConfig.js";
import { finiteValues, normalized, round } from "./statistics.js";

export function rankAttention(snapshot: QuerySnapshot, anomalies: AnomalyResult[], limit = 8): AttentionSuggestion[] {
  const entities = snapshot.entities ?? [], relationships = snapshot.relationships ?? [];
  const neighborValues = finiteValues(entities.map((item) => item.neighborCount)), entityAges = finiteValues(entities.map((item) => item.age));
  const relationshipAges = finiteValues(relationships.map((item) => item.age)), densities = finiteValues(relationships.map((item) => item.localRelationshipDensity));
  const anomalyById = new Map(anomalies.map((item) => [`${item.kind}:${item.identifier}`, item.anomalyScore]));
  const suggestions: AttentionSuggestion[] = entities.map((entity) => {
    const anomaly = anomalyById.get(`entity:${entity.id}`) ?? 0, connectivity = normalized(entity.neighborCount, neighborValues), persistence = normalized(entity.age, entityAges);
    const score = round(anomaly * ATTENTION_WEIGHTS.anomaly + connectivity * ATTENTION_WEIGHTS.connectivity + persistence * ATTENTION_WEIGHTS.persistence);
    return { kind: "entity", identifier: entity.id, score,
      reason: `surfaced for ${anomaly ? "statistical anomaly, " : ""}connectivity and persistence`,
      supportingMetrics: { anomaly, neighborCount: entity.neighborCount, age: entity.age, energy: entity.energy },
      suggestedNextPerceptionOperation: `/api/perception/inspect?kind=entity&id=${entity.id}&depth=2`,
      explainability: { classification: "derived", method: "transparent weighted attention signals", baseline: "current snapshot ranks" } };
  });
  suggestions.push(...relationships.map<AttentionSuggestion>((relationship) => {
    const anomaly = anomalyById.get(`relationship:${relationship.id}`) ?? 0, persistence = normalized(relationship.age, relationshipAges), extremity = normalized(relationship.localRelationshipDensity, densities);
    const score = round(anomaly * ATTENTION_WEIGHTS.anomaly + persistence * ATTENTION_WEIGHTS.persistence + extremity * ATTENTION_WEIGHTS.structuralExtremity);
    return { kind: "relationship", identifier: relationship.id, score,
      reason: `surfaced for ${anomaly ? "statistical anomaly, " : ""}age and structural density`,
      supportingMetrics: { anomaly, age: relationship.age, coherence: relationship.coherence, synergy: relationship.synergy, density: relationship.localRelationshipDensity },
      suggestedNextPerceptionOperation: `/api/perception/inspect?kind=relationship&id=${encodeURIComponent(relationship.id)}&depth=2`,
      explainability: { classification: "derived", method: "transparent weighted attention signals", baseline: "current snapshot ranks" } };
  }));
  return suggestions.sort((a, b) => b.score - a.score || String(a.identifier).localeCompare(String(b.identifier))).slice(0, limit);
}
