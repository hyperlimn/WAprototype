import type { EntityRecord, QueryIndexes, QuerySnapshot, RelationshipRecord } from "../query/queryTypes.js";
import { queryEntityLineage, queryEntityNeighbors } from "../query/entityQueries.js";
import { queryRegion } from "../query/spatialQueries.js";
import { findAnomalies } from "./anomalyDetection.js";
import { findSimilarEntity, findSimilarRelationship } from "./similarity.js";
import type { ObservedUniverse } from "./perceptionTypes.js";
import { finiteValues, mean } from "./statistics.js";

const indexes = (snapshot: QuerySnapshot): QueryIndexes => {
  const entities = snapshot.entities ?? [], relationships = snapshot.relationships ?? [];
  const relationshipsByParent = new Map<number, RelationshipRecord[]>();
  for (const relationship of relationships) for (const id of [relationship.parentAId, relationship.parentBId]) {
    const values = relationshipsByParent.get(id) ?? []; values.push(relationship); relationshipsByParent.set(id, values);
  }
  return { entityById: new Map(entities.map((item) => [item.id, item])), relationshipById: new Map(relationships.map((item) => [item.id, item])), relationshipsByParent };
};

export type InspectionTarget = { kind: "entity" | "relationship" | "region" | "event" | "checkpoint"; id?: string; x?: number; y?: number; radius?: number; tick?: number; sequence?: number };

export function inspectTarget(observation: ObservedUniverse, target: InspectionTarget, depth = 1): Record<string, unknown> | null {
  const snapshot = observation.snapshot; if (!snapshot) return null;
  const index = indexes(snapshot), anomalies = findAnomalies(snapshot, undefined, 100);
  if (target.kind === "entity") {
    const entity = index.entityById.get(Number(target.id)); if (!entity) return null;
    const radius = 100 + depth * 100, neighbors = queryEntityNeighbors(snapshot, index, entity, { radius, limit: 10 * depth }, "perception-internal").results;
    const lineage = queryEntityLineage(snapshot, index, entity, depth, "perception-internal").results;
    return { target: { kind: "entity", id: entity.id }, summary: `${entity.origin} entity with ${entity.neighborCount} spatial neighbors and ${entity.currentRelationshipIds.length} relationships`,
      currentProperties: entity, localContext: neighbors.nearbyEntities, connectedObjects: neighbors.connectedRelationships,
      lineage, anomalousTraits: anomalies.filter((item) => item.kind === "entity" && item.identifier === entity.id),
      similarObjects: findSimilarEntity(snapshot, entity, 5), suggestedNextInspections: neighbors.connectedRelationships.slice(0, 3).map((item) => ({ kind: "relationship", id: (item.relationship as RelationshipRecord).id })),
      explainability: { classification: "derived", method: "indexed neighborhood, recorded lineage, normalized similarity", baseline: "selected snapshot" } };
  }
  if (target.kind === "relationship") {
    const relationship = index.relationshipById.get(String(target.id)); if (!relationship) return null;
    const parents = [index.entityById.get(relationship.parentAId), index.entityById.get(relationship.parentBId)].filter((item): item is EntityRecord => Boolean(item));
    return { target: { kind: "relationship", id: relationship.id }, summary: `relationship age ${relationship.age}, coherence ${relationship.coherence}, synergy ${relationship.synergy}`,
      currentProperties: relationship, localContext: relationship.x !== null && relationship.y !== null
        ? queryRegion(snapshot, observation.events, { x: relationship.x, y: relationship.y, radius: 150 + depth * 100, limit: 10 * depth }, "perception-internal").results : null,
      connectedObjects: { parents }, historicalContext: { ruptureEvents: observation.events.filter((item) => item.relationshipId === relationship.id && item.type === "rupture") },
      anomalousTraits: anomalies.filter((item) => item.kind === "relationship" && item.identifier === relationship.id),
      similarObjects: findSimilarRelationship(snapshot, relationship, 5), suggestedNextInspections: parents.map((item) => ({ kind: "entity", id: item.id })),
      explainability: { classification: "derived", method: "parent index, geometric region, archive event filter, normalized similarity", baseline: "selected snapshot" } };
  }
  if (target.kind === "region" && target.x !== undefined && target.y !== undefined && target.radius !== undefined) {
    const region = queryRegion(snapshot, observation.events, { x: target.x, y: target.y, radius: target.radius, limit: 25 * depth }, "perception-internal").results;
    const universeEnergy = mean(finiteValues((snapshot.entities ?? []).map((item) => item.energy))), universeCoherence = mean(finiteValues((snapshot.relationships ?? []).map((item) => item.coherence)));
    return { target, summary: `region containing ${region.metrics.entityCount} entities and ${region.metrics.relationshipCount} relationships`,
      currentProperties: region.metrics, localContext: { entities: region.entities, relationships: region.relationships },
      historicalContext: observation.events.filter((item) => item.x !== null && item.y !== null && Math.hypot(item.x - target.x!, item.y - target.y!) <= target.radius!).slice(-10 * depth),
      anomalousTraits: { energyDifferenceFromUniverseMean: region.metrics.averageEnergy === null || universeEnergy === null ? null : region.metrics.averageEnergy - universeEnergy,
        coherenceDifferenceFromUniverseMean: region.metrics.averageCoherence === null || universeCoherence === null ? null : region.metrics.averageCoherence - universeCoherence },
      suggestedNextInspections: region.entities.slice(0, 3).map((item) => ({ kind: "entity", id: item.id })),
      explainability: { classification: "derived", method: "geometric radius and universe-wide mean comparison", baseline: "entire selected snapshot", limitation: "Region identity is inferred geometry, not simulation cluster state." } };
  }
  if (target.kind === "event") {
    const event = observation.events.find((item) => item.tick === target.tick && item.sequence === target.sequence); if (!event) return null;
    return { target: { kind: "event", tick: event.tick, sequence: event.sequence }, summary: event.description, currentProperties: event,
      localContext: event.x === null || event.y === null ? null : queryRegion(snapshot, observation.events, { x: event.x, y: event.y, radius: 200 * depth, limit: 10 * depth }, "perception-internal").results,
      connectedObjects: { entityId: event.entityId ?? null, relationshipId: event.relationshipId ?? null },
      explainability: { classification: "derived", method: "event identity and geometric context", baseline: "authoritative archived occurrence" } };
  }
  if (target.kind === "checkpoint") return { target, summary: `observational checkpoint at tick ${observation.source.tick}`,
    currentProperties: snapshot.metadata, localContext: { population: snapshot.entities?.length ?? 0, relationships: snapshot.relationships?.length ?? 0 },
    explainability: { classification: "derived", method: "checkpoint snapshot summary", baseline: "authoritative stored checkpoint" } };
  return null;
}

export function contextOf(observation: ObservedUniverse, target: InspectionTarget): Record<string, unknown> | null {
  const inspected = inspectTarget(observation, target, 2); if (!inspected) return null;
  return { target: inspected.target, surroundingEnvironment: inspected.localContext,
    strongerExternalConnections: inspected.connectedObjects ?? null, lineageOrParentContext: inspected.lineage ?? inspected.connectedObjects ?? null,
    largerScaleActivity: inspected.historicalContext ?? null, candidateStructureMembership: { classification: "inferred",
      label: "local neighborhood or connected component", limitation: "ProtoUniverse has no authoritative cluster identity system." },
    explainability: { classification: "inferred", method: "zoomed geometric and relationship context", baseline: "depth-2 local inspection" } };
}
