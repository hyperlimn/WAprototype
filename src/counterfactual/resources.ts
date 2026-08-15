import type { Universe } from "../simulation/universe";
import { COUNTERFACTUAL_LIMITS } from "./types";

export function estimateBranchMemory(universe:Universe):number{return JSON.stringify(universe.continuationState()).length*4+universe.entities.length*512+universe.relationshipLayer.entities.size*768;}
export function branchResourceLimitReason(population:number,relationships:number,estimatedMemoryBytes:number):string|null{
  if(population>COUNTERFACTUAL_LIMITS.maximumPopulation)return "branch population limit exceeded";
  if(relationships>COUNTERFACTUAL_LIMITS.maximumRelationships)return "branch relationship limit exceeded";
  if(estimatedMemoryBytes>COUNTERFACTUAL_LIMITS.hardMemoryBytes)return "estimated branch memory ceiling exceeded";
  return null;
}
