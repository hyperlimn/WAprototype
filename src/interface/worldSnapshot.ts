import type { Entity } from "../simulation/entity";
import { MAX_OCCURRENCES, type Occurrence } from "../simulation/occurrenceLog";
import type { RelationshipEntity } from "../simulation/relationshipEntity";
import { MAX_BASE_POPULATION } from "../simulation/reproduction";
import { SIMULATION_VERSION, type Universe } from "../simulation/universe";
import { buildRelationshipFormationDiagnostics } from "../ui/relationshipDiagnostics";
import { ruptureParameters } from "../simulation/rupture";
import { buildRuptureDiagnostics } from "../ui/ruptureDiagnostics";
import { buildRuptureCascadeDiagnostics } from "../ui/ruptureCascadeDiagnostics";
import { oscillationAtTick } from "../simulation/oscillation";

export const EXPORT_SCHEMA_VERSION = "universe-0-simulation-log/5";

type NumericSummary = { min: number | null; max: number | null; mean: number | null };

const number = (value: number): number | null =>
  Number.isFinite(value) ? Number(value.toPrecision(9)) : null;

const summarize = <T>(items: readonly T[], select: (item: T) => number): NumericSummary => {
  const values = items.map(select).filter(Number.isFinite);
  if (!values.length) return { min: null, max: null, mean: null };
  return {
    min: number(Math.min(...values)),
    max: number(Math.max(...values)),
    mean: number(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
};

const descending = <T>(select: (item: T) => number, tie: (a: T, b: T) => number) =>
  (a: T, b: T): number => select(b) - select(a) || tie(a, b);

const entityRecord = (entity: Entity, tick: number) => ({
  creationIndex: entity.creationIndex,
  fingerprint: entity.fingerprint,
  origin: entity.origin,
  birthTick: entity.birthTick,
  parentRelationshipId: entity.parentRelationshipId,
  parentEntityIds: entity.parentEntityIds,
  alpha: number(entity.alpha), beta: number(entity.beta), gamma: number(entity.gamma),
  naturalFrequency: number(entity.naturalFrequency), phase: number(entity.phase),
  currentOscillation: number(oscillationAtTick(entity, tick)),
  x: number(entity.x), y: number(entity.y), vx: number(entity.vx), vy: number(entity.vy),
  energy: number(entity.energy), age: number(entity.age), neighborCount: entity.neighborCount,
  strongestRelationship: number(entity.strongestRelationship), strongestBond: number(entity.strongestBond),
});

const relationshipRecord = (relationship: RelationshipEntity) => ({
  id: relationship.id,
  fingerprint: relationship.fingerprint,
  parentAId: relationship.parentAId,
  parentBId: relationship.parentBId,
  creationTick: relationship.creationTick,
  age: number(relationship.age),
  spatialDuration: relationship.spatialDuration,
  influenceDuration: relationship.influenceDuration,
  spatialActive: relationship.spatialActive,
  influenceActive: relationship.influenceActive,
  bondStrength: number(relationship.bondStrength),
  relationshipStrength: number(relationship.relationshipStrength),
  x: number(relationship.x), y: number(relationship.y), distance: number(relationship.distance),
  orientation: number(relationship.orientation), relativeVx: number(relationship.relativeVx),
  relativeVy: number(relationship.relativeVy), internalEnergy: number(relationship.internalEnergy),
  coherence: number(relationship.coherence),
  localRelationshipDensity: relationship.localRelationshipDensity,
  synergy: number(relationship.synergy), fieldSourceStrength: number(relationship.fieldSourceStrength),
  localFieldPotential: number(relationship.localFieldPotential),
  localFieldGradientMagnitude: number(relationship.localFieldGradientMagnitude),
  reproductionEligible: relationship.reproductionEligible,
  nextEligibleReproductionTick: relationship.nextEligibleTick,
  reproductionCount: relationship.reproductionCount,
  ruptureQualified: relationship.ruptureQualified,
  ruptureCount: relationship.ruptureCount,
  lastRuptureTick: relationship.lastRuptureTick,
  ruptureThresholds: ruptureParameters(relationship.fingerprint),
});

const occurrenceRecord = (record: Occurrence) => ({
  sequence: record.sequence,
  tick: record.tick,
  type: record.type,
  description: record.description,
  ...(record.entityId === undefined ? {} : { entityId: record.entityId }),
  ...(record.relationshipId === undefined ? {} : { relationshipId: record.relationshipId }),
  ...(record.parentEntityIds === undefined ? {} : { parentEntityIds: record.parentEntityIds }),
  ...(record.transition === undefined ? {} : { transition: record.transition }),
  ...(record.rupture === undefined ? {} : { rupture: record.rupture }),
  x: number(record.x),
  y: number(record.y),
});

export function buildWorldSnapshot(universe: Universe) {
  const state = universe.state;
  const entities = [...universe.entities].sort((a, b) => a.creationIndex - b.creationIndex);
  const relationships = [...universe.relationshipLayer.entities.values()];
  const relationshipIdsByEntity = new Map<number, string[]>();
  for (const relationship of relationships) {
    const forA = relationshipIdsByEntity.get(relationship.parentAId) ?? [];
    forA.push(relationship.id);
    relationshipIdsByEntity.set(relationship.parentAId, forA);
    const forB = relationshipIdsByEntity.get(relationship.parentBId) ?? [];
    forB.push(relationship.id);
    relationshipIdsByEntity.set(relationship.parentBId, forB);
  }
  const formation = buildRelationshipFormationDiagnostics(universe);
  const ruptureDiagnostics = buildRuptureDiagnostics(universe);
  const ruptureCascadeDiagnostics = buildRuptureCascadeDiagnostics(universe);
  const entityTie = (a: Entity, b: Entity): number => a.creationIndex - b.creationIndex;
  const relationshipTie = (a: RelationshipEntity, b: RelationshipEntity): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  const sampledEntityMap = new Map<number, Entity>();
  const addEntities = (items: Entity[]): void => items.slice(0, 10).forEach((entity) => sampledEntityMap.set(entity.creationIndex, entity));
  addEntities(entities);
  addEntities([...entities].sort((a, b) => b.creationIndex - a.creationIndex));
  addEntities([...entities].sort(descending((entity) => entity.energy, entityTie)));
  addEntities([...entities].sort(descending((entity) => entity.neighborCount, entityTie)));
  addEntities([...entities].sort(descending((entity) => entity.strongestBond, entityTie)));

  const sampledRelationshipMap = new Map<string, RelationshipEntity>();
  const addRelationships = (items: RelationshipEntity[]): void => items.slice(0, 10)
    .forEach((relationship) => sampledRelationshipMap.set(relationship.id, relationship));
  addRelationships([...relationships].sort(descending((relationship) => relationship.age, relationshipTie)));
  addRelationships([...relationships].sort(descending((relationship) => relationship.coherence, relationshipTie)));
  addRelationships([...relationships].sort(descending((relationship) => relationship.fieldSourceStrength, relationshipTie)));
  addRelationships([...relationships].sort(descending((relationship) => relationship.synergy, relationshipTie)));

  const recentOccurrences = universe.occurrences.records.slice(-MAX_OCCURRENCES);
  const recentReproductionEvents = recentOccurrences
    .filter((record) => record.type === "reproduction")
    .slice(-50)
    .map((record) => {
      const child = record.entityId === undefined ? undefined : universe.entities[record.entityId];
      return {
        tick: record.tick,
        childEntityId: record.entityId ?? null,
        childFingerprint: child?.fingerprint ?? null,
        parentEntityIds: record.parentEntityIds ?? null,
        parentRelationshipId: record.relationshipId ?? null,
      };
    });

  return {
    metadata: {
      exportSchemaVersion: EXPORT_SCHEMA_VERSION,
      simulationVersion: SIMULATION_VERSION,
      seed: universe.seed,
      currentTick: state.ticks,
      simulationTime: number(state.simulationTime),
      basePopulationCap: MAX_BASE_POPULATION,
      entityCount: entities.length,
      runtime: universe.runtime,
    },
    population: {
      initialCount: state.initialEntities,
      externalArrivalCount: state.externalArrivals,
      reproductionBirthCount: state.reproductionBirths,
      totalReproductionEvents: state.totalReproductionEvents,
      eligibleReproductiveRelationships: state.eligibleReproductiveRelationships,
      birthsLast10000Ticks: state.birthsLast10000Ticks,
      lastReproductionTick: state.lastReproductionTick,
      lastExternalArrivalTick: state.lastExternalArrivalTick,
    },
    worldState: {
      worldAlpha: number(state.worldAlpha), worldBeta: number(state.worldBeta), worldGamma: number(state.worldGamma),
      averageSpeed: number(state.averageSpeed), averageLocalDensity: number(state.averageLocalDensity),
      activeBonds: state.activeBonds, activeRelationshipEntities: state.activeRelationshipEntities,
      averageRelationshipAge: number(state.averageRelationshipAge), averageCoherence: number(state.averageCoherence),
      activeHigherOrderInteractions: state.activeHigherOrderInteractions,
      spatiallyActiveRelationships: state.spatiallyActiveRelationships,
      influenceActiveRelationships: state.influenceActiveRelationships,
      dualActiveRelationships: state.dualActiveRelationships,
      influenceOnlyRelationships: state.influenceOnlyRelationships,
      dormantRelationships: state.dormantRelationships,
      averageSynergy: number(state.averageSynergy), averageFieldPotential: number(state.averageFieldPotential),
      maximumFieldPotential: number(state.maximumFieldPotential), averageFieldGradient: number(state.averageFieldGradient),
      maximumFieldGradient: number(state.maximumFieldGradient), relationshipsCreated: state.relationshipsCreated,
      relationshipsDestroyed: state.relationshipsDestroyed, dimensionalTransitions: state.dimensionalTransitions,
    },
    entitiesSummary: {
      countByOrigin: {
        initial: entities.filter((entity) => entity.origin === "initial").length,
        externalArrival: entities.filter((entity) => entity.origin === "external arrival").length,
        reproduction: entities.filter((entity) => entity.origin === "reproduction").length,
      },
      alpha: summarize(entities, (entity) => entity.alpha), beta: summarize(entities, (entity) => entity.beta),
      gamma: summarize(entities, (entity) => entity.gamma), energy: summarize(entities, (entity) => entity.energy),
      neighborCount: summarize(entities, (entity) => entity.neighborCount),
      strongestRelationship: summarize(entities, (entity) => entity.strongestRelationship),
      strongestBond: summarize(entities, (entity) => entity.strongestBond),
    },
    relationshipsSummary: {
      total: relationships.length,
      spatialActive: relationships.filter((relationship) => relationship.spatialActive).length,
      influenceActive: relationships.filter((relationship) => relationship.influenceActive).length,
      dualActive: relationships.filter((relationship) => relationship.spatialActive && relationship.influenceActive).length,
      dormant: relationships.filter((relationship) => !relationship.spatialActive && !relationship.influenceActive).length,
      age: summarize(relationships, (relationship) => relationship.age),
      coherence: summarize(relationships, (relationship) => relationship.coherence),
      bondStrength: summarize(relationships, (relationship) => relationship.bondStrength),
      relationshipStrength: summarize(relationships, (relationship) => relationship.relationshipStrength),
      localRelationshipDensity: summarize(relationships, (relationship) => relationship.localRelationshipDensity),
      synergy: summarize(relationships, (relationship) => relationship.synergy),
      fieldSourceStrength: summarize(relationships, (relationship) => relationship.fieldSourceStrength),
      localFieldPotential: summarize(relationships, (relationship) => relationship.localFieldPotential),
      localFieldGradientMagnitude: summarize(relationships, (relationship) => relationship.localFieldGradientMagnitude),
    },
    relationshipFormationDiagnostics: {
      creationBondThreshold: number(formation.creationBondThreshold),
      destructionBondThreshold: number(formation.destructionBondThreshold),
      requiredPersistenceTicks: formation.requiredPersistenceTicks,
      strongestCandidateBond: formation.strongestCandidateBond === null ? null : number(formation.strongestCandidateBond),
      strongestCandidatePersistenceTicks: formation.strongestCandidatePersistenceTicks,
      candidatePairsAboveCreationThreshold: formation.candidatePairsAboveCreationThreshold,
      candidatePairsBlockedByPersistence: formation.candidatePairsBlockedByPersistence,
      candidatePairsWithoutBondRecord: formation.candidatePairsWithoutBondRecord,
      topCandidates: formation.topCandidates.map((candidate) => ({
        pairId: candidate.pairId,
        parentEntityIds: candidate.parentEntityIds,
        relationshipStrength: number(candidate.relationshipStrength),
        bondStrength: number(candidate.bondStrength),
        relationshipCreationBondThreshold: number(candidate.relationshipCreationBondThreshold),
        relationshipDestructionThreshold: number(candidate.relationshipDestructionThreshold),
        requiredPersistenceTicks: candidate.requiredPersistenceTicks,
        consecutiveTicksAboveCreationThreshold: candidate.consecutiveTicksAboveCreationThreshold,
        firstTickAboveCreationThreshold: candidate.firstTickAboveCreationThreshold,
        distance: number(candidate.distance),
        preferredBaseInteractionDistance: number(candidate.preferredBaseInteractionDistance),
        withinBondAccrualDistance: candidate.withinBondAccrualDistance,
        bondRecordExists: candidate.bondRecordExists,
        qualifiesOnBondStrength: candidate.qualifiesOnBondStrength,
        qualifiesOnPersistenceDuration: candidate.qualifiesOnPersistenceDuration,
        otherLifecycleConditionBlocksCreation: candidate.otherLifecycleConditionBlocksCreation,
        blockingReason: candidate.blockingReason,
      })),
    },
    reproductionSummary: {
      totalEligibleRelationships: state.eligibleReproductiveRelationships,
      totalReproductionEvents: state.totalReproductionEvents,
      totalReproducedEntities: state.reproductionBirths,
      recentReproductionEvents,
    },
    ruptureSummary: {
      totalRuptureEvents: state.totalRuptureEvents,
      rupturesLast10000Ticks: state.rupturesLast10000Ticks,
      lastRuptureTick: state.lastRuptureTick,
      currentlyQualifiedCandidates: state.currentlyQualifiedRuptureCandidates,
      recentRuptureEvents: universe.rupture.recentEvents.slice(-50),
      ...ruptureDiagnostics,
    },
    ruptureCascadeSummary: ruptureCascadeDiagnostics,
    recentOccurrences: recentOccurrences.map(occurrenceRecord),
    sampledEntities: [...sampledEntityMap.values()].map((entity) => entityRecord(entity, state.ticks)),
    sampledRelationships: [...sampledRelationshipMap.values()].map(relationshipRecord),
    entities: entities.map((entity) => ({
      id: entity.creationIndex,
      ...entityRecord(entity, state.ticks),
      currentRelationshipIds: relationshipIdsByEntity.get(entity.creationIndex) ?? [],
    })),
    relationships: relationships.map(relationshipRecord),
  };
}
