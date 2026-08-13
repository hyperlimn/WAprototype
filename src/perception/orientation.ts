import type { ObservedUniverse, PerceptionEnvelope } from "./perceptionTypes.js";
import { PERCEPTION_SCHEMA_VERSION } from "./perceptionTypes.js";
import { findAnomalies } from "./anomalyDetection.js";
import { rankAttention } from "./attention.js";
import { finiteValues, mean } from "./statistics.js";

const top = <T>(items: readonly T[], compare: (a: T, b: T) => number, limit = 5): T[] => [...items].sort(compare).slice(0, limit);

export function orientUniverse(observation: ObservedUniverse): PerceptionEnvelope<Record<string, unknown>> {
  const snapshot = observation.snapshot, entities = snapshot?.entities ?? [], relationships = snapshot?.relationships ?? [], events = observation.events;
  const count = (type: string) => events.filter((event) => event.type === type).length;
  const anomalies = snapshot ? findAnomalies(snapshot, undefined, 10) : [];
  return { perceptionSchemaVersion: PERCEPTION_SCHEMA_VERSION, source: observation.source,
    authoritative: { snapshotAvailable: snapshot !== null, memoryRange: observation.memoryRange, recentEventCount: events.length },
    derived: {
      identity: { seed: observation.source.seed, simulationVersion: observation.source.simulationVersion,
        tick: observation.source.tick, liveOrArchived: observation.source.mode, population: entities.length,
        relationshipCount: relationships.length, memoryRange: observation.memoryRange },
      activity: { recentBirths: count("reproduction"), recentRuptures: count("rupture"),
        recentRelationshipFormations: count("relationship-formed"), recentRelationshipDestructions: count("relationship-destroyed"),
        dimensionalTransitions: count("dimensional-transition"), recentEventRate: observation.memoryRange.latestTick !== null
          && events.length ? events.length / Math.max(1, observation.memoryRange.latestTick - Math.min(...events.map((item) => item.tick)) + 1) : null },
      structure: { mostConnectedEntities: top(entities, (a, b) => b.neighborCount - a.neighborCount),
        oldestEntities: top(entities, (a, b) => (b.age ?? -Infinity) - (a.age ?? -Infinity)),
        oldestRelationships: top(relationships, (a, b) => (b.age ?? -Infinity) - (a.age ?? -Infinity)),
        highestCoherence: top(relationships, (a, b) => (b.coherence ?? -Infinity) - (a.coherence ?? -Infinity)),
        highestDensity: top(relationships, (a, b) => b.localRelationshipDensity - a.localRelationshipDensity),
        highestSynergy: top(relationships, (a, b) => (b.synergy ?? -Infinity) - (a.synergy ?? -Infinity)),
        strongestBonds: top(relationships, (a, b) => (b.bondStrength ?? -Infinity) - (a.bondStrength ?? -Infinity)),
        universeAverages: { energy: mean(finiteValues(entities.map((item) => item.energy))), coherence: mean(finiteValues(relationships.map((item) => item.coherence))) } },
      change: { status: "reference-required", suggestedOperation: "/api/perception/changes" }, anomalies,
      attentionSuggestions: snapshot ? rankAttention(snapshot, anomalies, 8) : [],
      explainability: { classification: "derived", method: "bounded rankings, archive event counts, median-MAD anomalies, weighted attention",
        baseline: snapshot ? "selected canonical observation" : "archive manifest and event history", limitation: snapshot ? undefined : "No checkpoint was available; structural perception is limited." },
    } };
}
