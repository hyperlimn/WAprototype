import type { WorldState } from "./worldState";

export type WorldStateFieldClass =
  | "authoritative-continuation"
  | "authoritative-cumulative-history"
  | "simulation-clock-scheduler"
  | "derived-measurement"
  | "rebuildable-cache"
  | "observer-only";

export interface WorldStateFieldDescriptor {
  classification: WorldStateFieldClass;
  description: string;
}

/**
 * Inventory of the current WorldState shape. This is descriptive only: it does
 * not change persistence or runtime representation. `satisfies` makes adding a
 * WorldState field without classifying it a compile-time error.
 */
export const WORLD_STATE_FIELDS = {
  worldAlpha: { classification: "derived-measurement", description: "Current population mean alpha." },
  worldBeta: { classification: "derived-measurement", description: "Current population mean beta." },
  worldGamma: { classification: "derived-measurement", description: "Current population mean gamma." },
  averageSpeed: { classification: "derived-measurement", description: "Current population mean speed." },
  averageLocalDensity: { classification: "derived-measurement", description: "Current mean entity neighbor count." },
  activeBonds: { classification: "derived-measurement", description: "Current bond-map size." },
  activeRelationshipEntities: { classification: "derived-measurement", description: "Current relationship count." },
  averageRelationshipAge: { classification: "derived-measurement", description: "Current relationship mean age." },
  averageCoherence: { classification: "derived-measurement", description: "Current relationship mean coherence." },
  activeHigherOrderInteractions: { classification: "derived-measurement", description: "Current higher-order interaction count." },
  spatiallyActiveRelationships: { classification: "derived-measurement", description: "Current spatial-active relationship count." },
  influenceActiveRelationships: { classification: "derived-measurement", description: "Current influence-active relationship count." },
  dualActiveRelationships: { classification: "derived-measurement", description: "Current dual-active relationship count." },
  influenceOnlyRelationships: { classification: "derived-measurement", description: "Current influence-only relationship count." },
  averageSynergy: { classification: "derived-measurement", description: "Current dual-active mean synergy." },
  averageFieldPotential: { classification: "derived-measurement", description: "Current spatial relationship mean field potential." },
  maximumFieldPotential: { classification: "derived-measurement", description: "Current maximum field potential." },
  averageFieldGradient: { classification: "derived-measurement", description: "Current spatial relationship mean field gradient." },
  maximumFieldGradient: { classification: "derived-measurement", description: "Current maximum field gradient." },
  initialEntities: { classification: "authoritative-cumulative-history", description: "Count introduced during initialization." },
  externalArrivals: { classification: "authoritative-cumulative-history", description: "Cumulative external arrivals." },
  reproductionBirths: { classification: "authoritative-cumulative-history", description: "Cumulative reproduction births." },
  eligibleReproductiveRelationships: { classification: "derived-measurement", description: "Current reproduction eligibility count." },
  birthsLast10000Ticks: { classification: "rebuildable-cache", description: "Rolling count derived from reproduction birth ticks." },
  totalReproductionEvents: { classification: "authoritative-cumulative-history", description: "Cumulative reproduction event count." },
  relationshipsCreated: { classification: "authoritative-cumulative-history", description: "Cumulative relationship creations." },
  relationshipsDestroyed: { classification: "authoritative-cumulative-history", description: "Cumulative relationship destructions." },
  dormantRelationships: { classification: "derived-measurement", description: "Current dormant relationship count." },
  dimensionalTransitions: { classification: "authoritative-cumulative-history", description: "Cumulative relationship dimensional transitions." },
  lastReproductionTick: { classification: "authoritative-continuation", description: "Latest reproduction scheduler/history marker." },
  lastExternalArrivalTick: { classification: "authoritative-continuation", description: "Latest external-arrival scheduler/history marker." },
  totalRuptureEvents: { classification: "authoritative-cumulative-history", description: "Cumulative rupture count." },
  rupturesLast10000Ticks: { classification: "rebuildable-cache", description: "Rolling rupture count derived from rupture event ticks." },
  lastRuptureTick: { classification: "authoritative-continuation", description: "Latest rupture scheduler/history marker." },
  currentlyQualifiedRuptureCandidates: { classification: "derived-measurement", description: "Current rupture qualification count." },
  ticks: { classification: "simulation-clock-scheduler", description: "Authoritative discrete simulation tick." },
  simulationTime: { classification: "simulation-clock-scheduler", description: "Authoritative accumulated simulation time." },
} satisfies Record<keyof WorldState, WorldStateFieldDescriptor>;
