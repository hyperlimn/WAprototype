import { BOND_DISTANCE, INTERACTION_RADIUS, preferredInteractionDistance, relationship } from "../simulation/physics";
import {
  RELATIONSHIP_CREATION_BOND,
  RELATIONSHIP_DESTRUCTION_BOND,
  RELATIONSHIP_PERSISTENCE_TICKS,
} from "../simulation/relationshipLayer";
import { SpatialIndex } from "../simulation/spatialIndex";
import type { Universe } from "../simulation/universe";

export type RelationshipFormationBlockingReason =
  | "bond-below-creation-threshold"
  | "persistence-not-yet-met"
  | "bond-record-missing"
  | "already-relationship"
  | "unknown";

export interface RelationshipFormationCandidate {
  pairId: string;
  parentEntityIds: readonly [number, number];
  relationshipStrength: number;
  bondStrength: number;
  relationshipCreationBondThreshold: number;
  relationshipDestructionThreshold: number;
  requiredPersistenceTicks: number;
  consecutiveTicksAboveCreationThreshold: number;
  firstTickAboveCreationThreshold: number | null;
  distance: number;
  preferredBaseInteractionDistance: number;
  withinBondAccrualDistance: boolean;
  bondRecordExists: boolean;
  qualifiesOnBondStrength: boolean;
  qualifiesOnPersistenceDuration: boolean;
  otherLifecycleConditionBlocksCreation: boolean;
  blockingReason: RelationshipFormationBlockingReason;
}

export interface RelationshipFormationDiagnostics {
  creationBondThreshold: number;
  destructionBondThreshold: number;
  requiredPersistenceTicks: number;
  strongestCandidateBond: number | null;
  strongestCandidatePersistenceTicks: number;
  candidatePairsAboveCreationThreshold: number;
  candidatePairsBlockedByPersistence: number;
  candidatePairsWithoutBondRecord: number;
  topCandidates: RelationshipFormationCandidate[];
}

const pairKey = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;

export function buildRelationshipFormationDiagnostics(universe: Universe): RelationshipFormationDiagnostics {
  const pairIds = new Set<string>(universe.bonds.keys());
  const spatial = new SpatialIndex(INTERACTION_RADIUS);
  spatial.rebuild(universe.entities);
  const radiusSquared = INTERACTION_RADIUS * INTERACTION_RADIUS;
  for (const a of universe.entities) {
    for (const b of spatial.nearby(a)) {
      if (b.creationIndex <= a.creationIndex) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy <= radiusSquared) pairIds.add(pairKey(a.creationIndex, b.creationIndex));
    }
  }

  const candidates: RelationshipFormationCandidate[] = [];
  for (const id of pairIds) {
    const [aId, bId] = id.split(":").map(Number);
    const a = universe.entities[aId];
    const b = universe.entities[bId];
    if (!a || !b) continue;
    const alreadyRelationship = universe.relationshipLayer.entities.has(id);
    if (alreadyRelationship) continue;
    const bond = universe.bonds.get(id);
    const firstTick = universe.relationshipLayer.candidateFirstTick(id);
    const persistenceTicks = firstTick === undefined ? 0 : Math.max(0, universe.state.ticks - firstTick);
    const bondStrength = bond?.strength ?? 0;
    const qualifiesOnBondStrength = bond !== undefined && bondStrength >= RELATIONSHIP_CREATION_BOND;
    const qualifiesOnPersistenceDuration = firstTick !== undefined
      && persistenceTicks >= RELATIONSHIP_PERSISTENCE_TICKS;
    const blockingReason: RelationshipFormationBlockingReason = alreadyRelationship
      ? "already-relationship"
      : !bond ? "bond-record-missing"
        : !qualifiesOnBondStrength ? "bond-below-creation-threshold"
          : !qualifiesOnPersistenceDuration ? "persistence-not-yet-met" : "unknown";
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    candidates.push({
      pairId: id,
      parentEntityIds: [aId, bId],
      relationshipStrength: relationship(a, b),
      bondStrength,
      relationshipCreationBondThreshold: RELATIONSHIP_CREATION_BOND,
      relationshipDestructionThreshold: RELATIONSHIP_DESTRUCTION_BOND,
      requiredPersistenceTicks: RELATIONSHIP_PERSISTENCE_TICKS,
      consecutiveTicksAboveCreationThreshold: persistenceTicks,
      firstTickAboveCreationThreshold: firstTick ?? null,
      distance,
      preferredBaseInteractionDistance: preferredInteractionDistance(a, b),
      withinBondAccrualDistance: distance < BOND_DISTANCE,
      bondRecordExists: bond !== undefined,
      qualifiesOnBondStrength,
      qualifiesOnPersistenceDuration,
      otherLifecycleConditionBlocksCreation: false,
      blockingReason,
    });
  }

  candidates.sort((a, b) =>
    b.bondStrength - a.bondStrength
    || b.consecutiveTicksAboveCreationThreshold - a.consecutiveTicksAboveCreationThreshold
    || b.relationshipStrength - a.relationshipStrength
    || (a.pairId < b.pairId ? -1 : a.pairId > b.pairId ? 1 : 0));

  return {
    creationBondThreshold: RELATIONSHIP_CREATION_BOND,
    destructionBondThreshold: RELATIONSHIP_DESTRUCTION_BOND,
    requiredPersistenceTicks: RELATIONSHIP_PERSISTENCE_TICKS,
    strongestCandidateBond: candidates.length ? candidates[0].bondStrength : null,
    strongestCandidatePersistenceTicks: candidates.reduce(
      (maximum, candidate) => Math.max(maximum, candidate.consecutiveTicksAboveCreationThreshold), 0,
    ),
    candidatePairsAboveCreationThreshold: candidates.filter((candidate) => candidate.qualifiesOnBondStrength).length,
    candidatePairsBlockedByPersistence: candidates.filter(
      (candidate) => candidate.blockingReason === "persistence-not-yet-met",
    ).length,
    candidatePairsWithoutBondRecord: candidates.filter((candidate) => !candidate.bondRecordExists).length,
    topCandidates: candidates.slice(0, 20),
  };
}
