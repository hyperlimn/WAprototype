import type { OccurrenceRecord, QuerySnapshot } from "../query/queryTypes.js";
import { finiteValues, mean, round } from "./statistics.js";

const metrics = (snapshot: QuerySnapshot, events: readonly OccurrenceRecord[]) => ({
  population: snapshot.entities?.length ?? 0, relationships: snapshot.relationships?.length ?? 0,
  births: events.filter((item) => item.type === "reproduction").length,
  ruptures: events.filter((item) => item.type === "rupture").length,
  averageCoherence: mean(finiteValues((snapshot.relationships ?? []).map((item) => item.coherence))) ?? 0,
  averageSynergy: mean(finiteValues((snapshot.relationships ?? []).map((item) => item.synergy))) ?? 0,
  averageDensity: mean(finiteValues((snapshot.relationships ?? []).map((item) => item.localRelationshipDensity))) ?? 0,
});

export function detectChanges(current: QuerySnapshot, reference: QuerySnapshot, currentEvents: readonly OccurrenceRecord[] = [],
  referenceEvents: readonly OccurrenceRecord[] = []): Record<string, unknown> {
  const before = metrics(reference, referenceEvents), after = metrics(current, currentEvents);
  const changes = Object.keys(after).map((metric) => {
    const a = before[metric as keyof typeof before], b = after[metric as keyof typeof after], delta = b - a;
    return { metric, before: a, after: b, delta: round(delta), normalizedMagnitude: round(Math.abs(delta) / Math.max(Math.abs(a), Math.abs(b), 1)),
      reasonForSignificance: delta === 0 ? "no observed change" : `${metric} ${delta > 0 ? "increased" : "decreased"} across the observation boundary` };
  }).sort((a, b) => b.normalizedMagnitude - a.normalizedMagnitude);
  const currentEntities = new Set((current.entities ?? []).map((item) => item.id)), referenceEntities = new Set((reference.entities ?? []).map((item) => item.id));
  const currentRelationships = new Set((current.relationships ?? []).map((item) => item.id)), referenceRelationships = new Set((reference.relationships ?? []).map((item) => item.id));
  return { changes, newEntities: [...currentEntities].filter((id) => !referenceEntities.has(id)).slice(0, 100),
    disappearedEntities: [...referenceEntities].filter((id) => !currentEntities.has(id)).slice(0, 100),
    newRelationships: [...currentRelationships].filter((id) => !referenceRelationships.has(id)).slice(0, 100),
    disappearedRelationships: [...referenceRelationships].filter((id) => !currentRelationships.has(id)).slice(0, 100),
    explainability: { classification: "derived", method: "checkpoint aggregate and identity-set difference",
      baseline: "selected reference observation", limitation: "Differences show association across observations, not causation." } };
}
