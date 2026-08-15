import type { Universe } from "../simulation/universe";
import { buildComparisonFrame, type CorrespondenceContext } from "./correspondence";
import type { BranchFrame, DivergenceMetrics, OverlayEntity, OverlayRelationship, PrimaryComparisonFrame } from "./types";
import { COUNTERFACTUAL_LIMITS } from "./types";
import { deterministicStateHash } from "../simulation/deterministicStateHash";

export interface DivergenceMilestones { firstPositionDivergenceTick:number|null; firstTopologyDivergenceTick:number|null; firstOccurrenceDivergenceTick:number|null; firstPopulationDivergenceTick:number|null; firstLawEvolutionDivergenceTick:number|null; }
export const emptyMilestones=():DivergenceMilestones=>({firstPositionDivergenceTick:null,firstTopologyDivergenceTick:null,firstOccurrenceDivergenceTick:null,firstPopulationDivergenceTick:null,firstLawEvolutionDivergenceTick:null});
const differs=(a:number,b:number)=>Math.abs(a-b)>1e-12;

export function compareBranch(branch:Universe,primary:PrimaryComparisonFrame,context:CorrespondenceContext,branchId:string,originTick:number,milestones:DivergenceMilestones,status:BranchFrame["status"],estimatedMemoryBytes:number):BranchFrame{
  const started=performance.now(), branchRead=buildComparisonFrame(branch,context);
  const primaryEntities=new Map(primary.entities.map((x)=>[x.causalKey,x])),branchEntities=new Map(branchRead.entities.map((x)=>[x.causalKey,x]));
  let sum=0,max=0,shared=0;
  const entities:OverlayEntity[]=[];
  for(const item of branchRead.entities.slice(0,COUNTERFACTUAL_LIMITS.maximumOverlayEntities)){
    const peer=primaryEntities.get(item.causalKey),distance=peer?Math.hypot(item.x-peer.x,item.y-peer.y):0;
    if(peer){sum+=distance;max=Math.max(max,distance);shared++;}
    entities.push({localId:item.localId,causalKey:item.causalKey,correspondence:peer?(item.localId<context.originEntityCount?"shared-origin":"shared-descendant"):"branch-only",x:item.x,y:item.y,primaryX:peer?.x??null,primaryY:peer?.y??null});
  }
  const primaryRelationships=new Map(primary.relationships.map((x)=>[x.causalKey,x])),branchRelationships=new Map(branchRead.relationships.map((x)=>[x.causalKey,x]));
  let topology=0;
  for(const key of primaryRelationships.keys())if(!branchRelationships.has(key))topology++;
  for(const key of branchRelationships.keys())if(!primaryRelationships.has(key))topology++;
  const union=new Set([...primaryRelationships.keys(),...branchRelationships.keys()]).size;
  const relationships:OverlayRelationship[]=[];
  const entityByKey=new Map(branchRead.entities.map((x)=>[x.causalKey,x]));
  for(const item of [...branchRead.relationships].sort((a,b)=>a.causalKey.localeCompare(b.causalKey)).slice(0,COUNTERFACTUAL_LIMITS.maximumOverlayRelationships)){
    const peer=primaryRelationships.get(item.causalKey),a=entityByKey.get(item.parentKeys[0]),b=entityByKey.get(item.parentKeys[1]); if(!a||!b)continue;
    const equal=peer&&!differs(peer.bondStrength,item.bondStrength)&&!differs(peer.coherence,item.coherence)&&peer.spatialActive===item.spatialActive&&peer.influenceActive===item.influenceActive;
    relationships.push({causalKey:item.causalKey,correspondence:peer?(equal?"shared-equal":"shared-divergent-state"):"branch-only",ax:a.x,ay:a.y,bx:b.x,by:b.y});
  }
  if(relationships.length<COUNTERFACTUAL_LIMITS.maximumOverlayRelationships){
    const primaryEntityByKey=new Map(primary.entities.map((x)=>[x.causalKey,x]));
    for(const item of [...primary.relationships].sort((a,b)=>a.causalKey.localeCompare(b.causalKey))){
      if(branchRelationships.has(item.causalKey))continue; const a=primaryEntityByKey.get(item.parentKeys[0]),b=primaryEntityByKey.get(item.parentKeys[1]); if(!a||!b)continue;
      relationships.push({causalKey:item.causalKey,correspondence:"primary-only",ax:a.x,ay:a.y,bx:b.x,by:b.y});
      if(relationships.length>=COUNTERFACTUAL_LIMITS.maximumOverlayRelationships)break;
    }
  }
  const primarySignatures=new Set(primary.occurrences.map((x)=>x.signature)),branchSignatures=new Set(branchRead.occurrences.map((x)=>x.signature));
  const unmatched=[...primary.occurrences.filter((x)=>!branchSignatures.has(x.signature)),...branchRead.occurrences.filter((x)=>!primarySignatures.has(x.signature))].sort((a,b)=>a.tick-b.tick);
  const mean=shared?sum/shared:0,populationDelta=branchRead.entities.length-primary.entities.length,lawSetEqual=branchRead.lawSetHash===primary.lawSetHash;
  if(max>1e-9&&milestones.firstPositionDivergenceTick===null)milestones.firstPositionDivergenceTick=branch.state.ticks;
  if(topology&&milestones.firstTopologyDivergenceTick===null)milestones.firstTopologyDivergenceTick=branch.state.ticks;
  if(unmatched.length&&milestones.firstOccurrenceDivergenceTick===null)milestones.firstOccurrenceDivergenceTick=unmatched[0].tick;
  if(populationDelta&&milestones.firstPopulationDivergenceTick===null)milestones.firstPopulationDivergenceTick=branch.state.ticks;
  if(!lawSetEqual&&milestones.firstLawEvolutionDivergenceTick===null)milestones.firstLawEvolutionDivergenceTick=branch.state.ticks;
  const metrics:DivergenceMetrics={branchAge:branch.state.ticks-originTick,meanPosition:mean,maximumPosition:max,relationshipTopologyDifference:topology,normalizedRelationshipDivergence:union?topology/union:0,populationDelta,firstDivergentOccurrenceTick:unmatched[0]?.tick??milestones.firstOccurrenceDivergenceTick,lawSetEqual,...milestones};
  return{branchId,tick:branch.state.ticks,lag:Math.max(0,primary.tick-branch.state.ticks),status,branchStateHash:deterministicStateHash(branch.continuationState()),entities,relationships,metrics,estimatedMemoryBytes,comparisonDurationMs:performance.now()-started};
}
