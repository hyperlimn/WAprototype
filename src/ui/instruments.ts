import type { Universe } from "../simulation/universe";
import { buildRelationshipFormationDiagnostics } from "../observation/relationshipDiagnostics";
import { buildRuptureDiagnostics } from "../observation/ruptureDiagnostics";
import { buildRuptureCascadeDiagnostics } from "../observation/ruptureCascadeDiagnostics";

const row = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

export function updateInstruments(element: HTMLElement, universe: Universe): void {
  const s = universe.state;
  const formation = buildRelationshipFormationDiagnostics(universe);
  const rupture = buildRuptureDiagnostics(universe);
  const pass = rupture.conditionPassCounts;
  const blocked = rupture.singleBlockerCounts;
  const cascade = buildRuptureCascadeDiagnostics(universe);
  element.innerHTML = [
    row("Total base population", String(universe.entities.length)),
    row("Initial entities", String(s.initialEntities)),
    row("External arrivals", String(s.externalArrivals)),
    row("Reproduction births", String(s.reproductionBirths)),
    row("Eligible relationships", String(s.eligibleReproductiveRelationships)),
    row("Total reproduction events", String(s.totalReproductionEvents)),
    row("Last reproduction tick", s.lastReproductionTick === null ? "—" : String(s.lastReproductionTick)),
    row("Last external-arrival tick", s.lastExternalArrivalTick === null ? "—" : String(s.lastExternalArrivalTick)),
    row("Births / last 10k ticks", String(s.birthsLast10000Ticks)),
    row("worldAlpha", s.worldAlpha.toFixed(5)),
    row("worldBeta", s.worldBeta.toFixed(5)),
    row("worldGamma", s.worldGamma.toFixed(5)),
    row("Average speed", s.averageSpeed.toFixed(5)),
    row("Local density", s.averageLocalDensity.toFixed(3)),
    row("Active bonds", String(s.activeBonds)),
    row("Relationship entities", String(s.activeRelationshipEntities)),
    row("Relationships created", String(s.relationshipsCreated)),
    row("Relationships destroyed", String(s.relationshipsDestroyed)),
    row("Total rupture events", String(s.totalRuptureEvents)),
    row("Ruptures / last 10k ticks", String(s.rupturesLast10000Ticks)),
    row("Last rupture tick", s.lastRuptureTick === null ? "—" : String(s.lastRuptureTick)),
    row("Rupture candidates", String(s.currentlyQualifiedRuptureCandidates)),
    row("Rupture qualification", `${s.activeRelationshipEntities} relationships`),
    row("Pass bond", String(pass.bond)),
    row("Pass density", String(pass.density)),
    row("Pass energy", String(pass.internalEnergy)),
    row("Pass age", String(pass.age)),
    row("Pass cooldown", String(pass.cooldown)),
    row("Pass all", String(pass.all)),
    row("Blocked only by bond", String(blocked.bond)),
    row("Blocked only by density", String(blocked.density)),
    row("Blocked only by energy", String(blocked.internalEnergy)),
    row("Blocked only by age", String(blocked.age)),
    row("Blocked only by cooldown", String(blocked.cooldown)),
    row("Rupture bursts", String(cascade.ruptureBurstCount)),
    row("Current/recent burst size", String(cascade.currentOrRecentBurstSize)),
    row("Largest rupture burst", String(cascade.longestObservedRuptureBurst)),
    row("Followed within 500 ticks", String(cascade.ruptureEventsFollowedWithin500Ticks)),
    row("Nearby follow-ups", String(
      cascade.countsByTimeWindowAndDistanceBand["500"]["0-50"]
      + cascade.countsByTimeWindowAndDistanceBand["500"]["50-100"]
      + cascade.countsByTimeWindowAndDistanceBand["500"]["100-200"],
    )),
    row("Structurally connected follow-ups", String(
      cascade.sharedStructureAssociations.structurallyConnectedFollowUpCount,
    )),
    row("Strongest candidate bond", formation.strongestCandidateBond === null ? "—" : formation.strongestCandidateBond.toFixed(5)),
    row("Creation bond threshold", formation.creationBondThreshold.toFixed(5)),
    row("Strongest candidate persistence", `${formation.strongestCandidatePersistenceTicks} ticks`),
    row("Required persistence", `${formation.requiredPersistenceTicks} ticks`),
    row("Candidates above threshold", String(formation.candidatePairsAboveCreationThreshold)),
    row("Blocked only by persistence", String(formation.candidatePairsBlockedByPersistence)),
    row("Candidates without bond", String(formation.candidatePairsWithoutBondRecord)),
    row("Avg relation age", s.averageRelationshipAge.toFixed(1)),
    row("Avg coherence", s.averageCoherence.toFixed(5)),
    row("Higher-order interactions", String(s.activeHigherOrderInteractions)),
    row("Spatially active", String(s.spatiallyActiveRelationships)),
    row("Influence active", String(s.influenceActiveRelationships)),
    row("Dual active", String(s.dualActiveRelationships)),
    row("Influence only", String(s.influenceOnlyRelationships)),
    row("Dormant relationships", String(s.dormantRelationships)),
    row("Dimensional transitions", String(s.dimensionalTransitions)),
    row("Average synergy", s.averageSynergy.toFixed(5)),
    row("Avg field potential", s.averageFieldPotential.toFixed(7)),
    row("Max field potential", s.maximumFieldPotential.toFixed(7)),
    row("Avg field gradient", s.averageFieldGradient.toFixed(9)),
    row("Max field gradient", s.maximumFieldGradient.toFixed(9)),
    row("Simulation ticks", String(s.ticks)),
    row("Seed", universe.seed),
  ].join("");
}
