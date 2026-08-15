import type { UniverseContinuationState } from "../simulation/saveState";

export const COUNTERFACTUAL_PROTOCOL_VERSION = "counterfactual-worker/1" as const;
export const COUNTERFACTUAL_INTERVENTION_VERSION = "counterfactual-intervention/2" as const;
export const COUNTERFACTUAL_BRANCH_VERSION = "counterfactual-branch/1" as const;
export const COUNTERFACTUAL_RULES_VERSION = "counterfactual-rules/1" as const;

export const COUNTERFACTUAL_LIMITS = {
  maximumPopulation: 1_000, maximumRelationships: 10_000,
  softMemoryBytes: 128 * 1024 * 1024, hardMemoryBytes: 256 * 1024 * 1024,
  maximumBatchSteps: 256, maximumOverlayEntities: 2_000, maximumOverlayRelationships: 5_000,
} as const;

export type ImpulseVector = { x: number; y: number };
export type CounterfactualIntervention = {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "entity-impulse";
  target: { entityId: number };
  deltaVelocity: ImpulseVector;
} | {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "cluster-impulse";
  target: { anchorEntityId: number; resolvedEntityIds: number[] };
  deltaVelocity: ImpulseVector;
} | {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "entity-displace";
  target: { entityId:number };
  deltaPosition: ImpulseVector;
} | {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "cluster-displace";
  target: { anchorEntityId:number; resolvedEntityIds:number[] };
  deltaPosition: ImpulseVector;
} | {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "cluster-radial-pulse";
  target: { anchorEntityId:number; resolvedEntityIds:number[] };
  mode:"expand"|"compress"; magnitude:number;
} | {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "cluster-spin";
  target: { anchorEntityId:number; resolvedEntityIds:number[] };
  direction:"clockwise"|"counterclockwise"; magnitude:number;
} | {
  schemaVersion: typeof COUNTERFACTUAL_INTERVENTION_VERSION;
  kind: "relationship-sever";
  target:{relationshipId:string};
};

export interface BranchMetadata {
  schemaVersion: typeof COUNTERFACTUAL_BRANCH_VERSION;
  branchId: string; branchCausalId: string;
  parentUniverse: string; parentTimeline: "primary";
  originTick: number; originStateHash: string;
  interventionId: string; interventionHash: string; postInterventionStateHash: string;
  simulationVersion: string; branchRulesVersion: typeof COUNTERFACTUAL_RULES_VERSION;
  lawSetHashAtOrigin: string; lawAncestryHash: string;
}

export type EntityCorrespondenceClass = "shared-origin" | "shared-descendant" | "branch-only" | "primary-only";
export type RelationshipCorrespondenceClass = "shared-equal" | "shared-divergent-state" | "branch-only" | "primary-only";

export interface ComparisonEntity { localId: number; causalKey: string; x: number; y: number; fingerprint: string; }
export interface ComparisonRelationship { localId: string; causalKey: string; parentKeys: [string,string]; spatialActive: boolean; influenceActive: boolean; bondStrength: number; coherence: number; }
export interface ComparisonOccurrence { tick: number; signature: string; }
export interface PrimaryComparisonFrame {
  tick: number; entities: ComparisonEntity[]; relationships: ComparisonRelationship[];
  occurrences: ComparisonOccurrence[]; lawSetHash: string;
}

export interface DivergenceMetrics {
  branchAge: number; meanPosition: number; maximumPosition: number;
  relationshipTopologyDifference: number; normalizedRelationshipDivergence: number;
  populationDelta: number; firstDivergentOccurrenceTick: number | null; lawSetEqual: boolean;
  firstPositionDivergenceTick: number | null; firstTopologyDivergenceTick: number | null;
  firstOccurrenceDivergenceTick: number | null; firstPopulationDivergenceTick: number | null;
  firstLawEvolutionDivergenceTick: number | null;
}

export interface OverlayEntity { localId: number; causalKey: string; correspondence: EntityCorrespondenceClass; x: number; y: number; primaryX: number | null; primaryY: number | null; }
export interface OverlayRelationship { causalKey: string; correspondence: RelationshipCorrespondenceClass; ax: number; ay: number; bx: number; by: number; }
export interface BranchFrame { branchId: string; tick: number; lag: number; status: BranchRunStatus; branchStateHash:string; entities: OverlayEntity[]; relationships: OverlayRelationship[]; metrics: DivergenceMetrics; estimatedMemoryBytes: number; comparisonDurationMs: number; }
export type BranchRunStatus = "RUNNING" | "PAUSED" | "RESOURCE_LIMITED" | "ERROR";

export type WorkerCommand =
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "CREATE_BRANCH"; branchId: string; continuation: UniverseContinuationState; intervention: CounterfactualIntervention }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "SET_TARGET_TICK"; targetTick: number; primary: PrimaryComparisonFrame }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "PAUSE" }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "RESUME" }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "TERMINATE"; reason: string };

export type WorkerResponse =
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "CREATING"; branchId: string }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "READY"; metadata: BranchMetadata; frame: BranchFrame; reconstructionDurationMs: number }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "FRAME"; frame: BranchFrame }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "STATUS"; status: BranchRunStatus; tick: number; lag: number }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "RESOURCE_LIMIT"; reason: string; frame: BranchFrame }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "ERROR"; code: string; message: string }
  | { protocol: typeof COUNTERFACTUAL_PROTOCOL_VERSION; type: "TERMINATED"; reason: string; finalTick: number; finalMetrics: DivergenceMetrics | null };
