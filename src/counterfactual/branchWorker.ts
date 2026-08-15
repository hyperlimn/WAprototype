/// <reference lib="webworker" />
import { Universe } from "../simulation/universe";
import type { CorrespondenceContext } from "./correspondence";
import { compareBranch, emptyMilestones } from "./divergence";
import { createBranchAuthority } from "./branchAuthority";
import { branchResourceLimitReason, estimateBranchMemory } from "./resources";
import { COUNTERFACTUAL_LIMITS, COUNTERFACTUAL_PROTOCOL_VERSION, type BranchFrame, type BranchMetadata, type BranchRunStatus, type PrimaryComparisonFrame, type WorkerCommand, type WorkerResponse } from "./types";

const scope:DedicatedWorkerGlobalScope=self as unknown as DedicatedWorkerGlobalScope;
let universe:Universe|null=null,metadata:BranchMetadata|null=null,context:CorrespondenceContext|null=null,primary:PrimaryComparisonFrame|null=null;
let targetTick=0,runStatus:BranchRunStatus="PAUSED",scheduled=false,terminated=false,lastFrame:BranchFrame|null=null,lastPublished=0,lastStatusPublished=0;
const milestones=emptyMilestones();
const send=(message:WorkerResponse):void=>scope.postMessage(message);
const assertEnvelope=(message:unknown):WorkerCommand=>{
  if(!message||typeof message!=="object")throw new Error("Invalid counterfactual worker message");const value=message as Record<string,unknown>;
  if(value.protocol!==COUNTERFACTUAL_PROTOCOL_VERSION||typeof value.type!=="string")throw new Error("Invalid counterfactual worker envelope");
  const exact=(allowed:string[])=>{if(Object.keys(value).some((key)=>!["protocol","type",...allowed].includes(key)))throw new Error("Unknown counterfactual command field");};
  if(value.type==="CREATE_BRANCH"){exact(["branchId","continuation","intervention"]);if(typeof value.branchId!=="string"||!/^B-[0-9]{4,}$/.test(value.branchId)||!value.continuation||typeof value.continuation!=="object"||!value.intervention||typeof value.intervention!=="object")throw new Error("Invalid CREATE_BRANCH command");}
  else if(value.type==="SET_TARGET_TICK"){exact(["targetTick","primary"]);if(!Number.isInteger(value.targetTick)||!value.primary||typeof value.primary!=="object")throw new Error("Invalid SET_TARGET_TICK command");}
  else if(value.type==="PAUSE"||value.type==="RESUME")exact([]);
  else if(value.type==="TERMINATE"){exact(["reason"]);if(typeof value.reason!=="string"||value.reason.length<1||value.reason.length>160)throw new Error("Invalid TERMINATE command");}
  else throw new Error("Unsupported counterfactual command");return value as unknown as WorkerCommand;
};

function publish(force=false):void{
  if(!universe||!metadata||!context||!primary)return; const now=performance.now(); if(!force&&now-lastPublished<40)return;
  lastFrame=compareBranch(universe,primary,context,metadata.branchId,metadata.originTick,milestones,runStatus,estimateBranchMemory(universe)); lastPublished=now; send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"FRAME",frame:lastFrame});
}
function resourceReason():string|null{
  if(!universe)return null;return branchResourceLimitReason(universe.entities.length,universe.relationshipLayer.entities.size,estimateBranchMemory(universe));
}
function schedule():void{if(scheduled||terminated||runStatus!=="RUNNING")return;scheduled=true;setTimeout(pump,0);}
function pump():void{
  scheduled=false;if(!universe||terminated||runStatus!=="RUNNING")return;
  const started=performance.now();let steps=0;
  while(universe.state.ticks<targetTick&&steps<COUNTERFACTUAL_LIMITS.maximumBatchSteps&&performance.now()-started<8){universe.step();steps++;}
  const reason=resourceReason();if(reason){runStatus="RESOURCE_LIMITED";if(universe.state.ticks===primary?.tick)publish(true);send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"RESOURCE_LIMIT",reason,frame:lastFrame!});return;}
  if(universe.state.ticks===targetTick)publish(true);else if(performance.now()-lastStatusPublished>=100){lastStatusPublished=performance.now();send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"STATUS",status:runStatus,tick:universe.state.ticks,lag:targetTick-universe.state.ticks});}
  if(universe.state.ticks<targetTick)setTimeout(schedule,12);
}

scope.onmessage=(event:MessageEvent<unknown>)=>{try{const message=assertEnvelope(event.data);
  if(terminated){send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"ERROR",code:"branch_terminated",message:"Branch has terminated"});return;}
  if(message.type==="CREATE_BRANCH"){
    if(universe)throw new Error("A branch already exists in this worker");send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"CREATING",branchId:message.branchId});const started=performance.now();
    const created=createBranchAuthority(message.branchId,message.continuation,message.intervention);universe=created.universe;context=created.context;metadata=created.metadata;
    primary=created.originComparison;targetTick=metadata.originTick;runStatus="RUNNING";lastFrame=compareBranch(universe,primary,context,message.branchId,metadata.originTick,milestones,runStatus,estimateBranchMemory(universe));
    send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"READY",metadata,frame:lastFrame,reconstructionDurationMs:performance.now()-started});return;
  }
  if(!universe)throw new Error("No branch exists");
  if(message.type==="SET_TARGET_TICK"){if(!Number.isInteger(message.targetTick)||message.targetTick<universe.state.ticks||message.primary.tick!==message.targetTick)throw new Error("Invalid branch target tick");targetTick=message.targetTick;primary=message.primary;schedule();return;}
  if(message.type==="PAUSE"){runStatus="PAUSED";if(universe.state.ticks===primary?.tick)publish(true);send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"STATUS",status:runStatus,tick:universe.state.ticks,lag:Math.max(0,targetTick-universe.state.ticks)});return;}
  if(message.type==="RESUME"){if(runStatus==="RESOURCE_LIMITED")throw new Error("Resource-limited branch cannot resume");runStatus="RUNNING";schedule();return;}
  if(message.type==="TERMINATE"){terminated=true;runStatus="PAUSED";const tick=universe.state.ticks,metrics=lastFrame?.metrics??null;universe=null;metadata=null;context=null;primary=null;lastFrame=null;send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"TERMINATED",reason:message.reason,finalTick:tick,finalMetrics:metrics});scope.close();}
}catch(error){runStatus="ERROR";send({protocol:COUNTERFACTUAL_PROTOCOL_VERSION,type:"ERROR",code:"invalid_command",message:error instanceof Error?error.message:"Counterfactual worker failed"});}};
