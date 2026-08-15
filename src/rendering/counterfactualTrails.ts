import type { BranchFrame } from "../counterfactual/types";
export interface CounterfactualTrailSample{x:number;y:number;tick:number;}
export class CounterfactualTrailStore{
  private readonly values=new Map<string,CounterfactualTrailSample[]>();private branchId:string|null=null;private frameTick=-1;
  clear():void{this.values.clear();this.branchId=null;this.frameTick=-1;}
  update(frame:BranchFrame,sampleLimit:number):void{sampleLimit=Math.max(2,Math.min(32,Math.round(sampleLimit)));if(frame.branchId!==this.branchId){this.clear();this.branchId=frame.branchId;}if(frame.tick===this.frameTick)return;this.frameTick=frame.tick;
    const candidates=frame.entities.filter((entity)=>entity.primaryX!==null&&entity.primaryY!==null&&Math.hypot(entity.x-entity.primaryX,entity.y-entity.primaryY)>1e-9).sort((a,b)=>Math.hypot(b.x-b.primaryX!,b.y-b.primaryY!)-Math.hypot(a.x-a.primaryX!,a.y-a.primaryY!)).slice(0,400),retained=new Set<string>();
    for(const entity of candidates){retained.add(entity.causalKey);const samples=this.values.get(entity.causalKey)??[];samples.push({x:entity.x,y:entity.y,tick:frame.tick});if(samples.length>sampleLimit)samples.splice(0,samples.length-sampleLimit);this.values.set(entity.causalKey,samples);}for(const key of this.values.keys())if(!retained.has(key))this.values.delete(key);
  }
  entries():IterableIterator<CounterfactualTrailSample[]>{return this.values.values();}get trackedEntities():number{return this.values.size;}sampleCount(key:string):number{return this.values.get(key)?.length??0;}
}
