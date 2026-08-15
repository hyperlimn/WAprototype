import { deterministicStateHash } from "../simulation/deterministicStateHash";
import { sha256Hex } from "../simulation/sha256";
import type { UniverseContinuationState } from "../simulation/saveState";
import { SIMULATION_VERSION, Universe } from "../simulation/universe";
import { buildComparisonFrame, type CorrespondenceContext } from "./correspondence";
import { applyIntervention, canonicalJson, interventionHash, validateIntervention } from "./intervention";
import { COUNTERFACTUAL_BRANCH_VERSION, COUNTERFACTUAL_RULES_VERSION, type BranchMetadata, type CounterfactualIntervention, type PrimaryComparisonFrame } from "./types";

export interface CreatedBranchAuthority { universe:Universe;metadata:BranchMetadata;context:CorrespondenceContext;originComparison:PrimaryComparisonFrame; }

/** Creates branch authority only from an immutable completed-tick continuation.
 * The caller retains no mutable object shared with the returned Universe. */
export function createBranchAuthority(branchId:string,source:UniverseContinuationState,intervention:CounterfactualIntervention):CreatedBranchAuthority{
  const continuation=structuredClone(source),originStateHash=deterministicStateHash(continuation),universe=new Universe(continuation.universe,continuation);
  const validated=validateIntervention(intervention,universe),context={originStateHash,originEntityCount:universe.entities.length},originComparison=buildComparisonFrame(universe,context);
  applyIntervention(universe,validated);const postInterventionStateHash=deterministicStateHash(universe.continuationState()),hash=interventionHash(validated),lawAncestryHash=sha256Hex(canonicalJson(universe.lawEvolution.records.map((x)=>x.evolutionHash)));
  const branchCausalId=sha256Hex(["protouniverse/branch-causal/1",continuation.universe,"primary",continuation.tick,originStateHash,hash,SIMULATION_VERSION,COUNTERFACTUAL_RULES_VERSION,lawAncestryHash].join("\0"));
  const metadata:BranchMetadata={schemaVersion:COUNTERFACTUAL_BRANCH_VERSION,branchId,branchCausalId,parentUniverse:continuation.universe,parentTimeline:"primary",originTick:continuation.tick,originStateHash,interventionId:`I-${hash.slice(0,12)}`,interventionHash:hash,postInterventionStateHash,simulationVersion:SIMULATION_VERSION,branchRulesVersion:COUNTERFACTUAL_RULES_VERSION,lawSetHashAtOrigin:universe.lawEvolution.activeManifest.manifestHash,lawAncestryHash};
  return{universe,metadata,context,originComparison};
}
