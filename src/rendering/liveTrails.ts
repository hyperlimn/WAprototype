import type { Universe } from "../simulation/universe";

export const PRIMARY_TRAIL_LIMITS={maximumTrackedEntities:1_000,maximumSamplesPerEntity:64,maximumRenderedSegments:10_000,defaultSamples:24,defaultSamplingIntervalTicks:10} as const;
export interface RecordedTrail { entityId:number; startTick:number; samplingIntervalTicks:number; points:Array<{tick:number;x:number;y:number}>; }
export interface RecordedTrailStats { startTick:number;currentTick:number;sampledPoints:number;sampledPathLength:number;displacement:number;samplingIntervalTicks:number; }

class EntityTrailBuffer{
  private readonly values:Float64Array;private start=0;private count=0;
  constructor(readonly entityId:number,readonly startTick:number,readonly interval:number,readonly capacity:number){this.values=new Float64Array(capacity*3);}
  push(tick:number,x:number,y:number):void{const index=(this.start+this.count)%this.capacity,at=index*3;this.values[at]=tick;this.values[at+1]=x;this.values[at+2]=y;if(this.count<this.capacity)this.count++;else this.start=(this.start+1)%this.capacity;}
  points():Array<{tick:number;x:number;y:number}>{const out=[];for(let i=0;i<this.count;i++){const at=((this.start+i)%this.capacity)*3;out.push({tick:this.values[at],x:this.values[at+1],y:this.values[at+2]});}return out;}
}

export class PrimaryLiveTrailRecorder{
  private buffers=new Map<number,EntityTrailBuffer>();private active=false;private activationTick:number|null=null;private lastSampleTick:number|null=null;
  constructor(private sampleLimit:number=PRIMARY_TRAIL_LIMITS.defaultSamples,readonly samplingIntervalTicks:number=PRIMARY_TRAIL_LIMITS.defaultSamplingIntervalTicks){this.sampleLimit=Math.max(2,Math.min(PRIMARY_TRAIL_LIMITS.maximumSamplesPerEntity,Math.round(sampleLimit)));}
  get enabled():boolean{return this.active;}get recordedEntityCount():number{return this.buffers.size;}
  enable(universe:Universe):void{this.clear();this.active=true;this.activationTick=universe.state.ticks;this.sampleNow(universe);}
  disable():void{this.active=false;this.clear();}
  clear():void{this.buffers.clear();this.activationTick=null;this.lastSampleTick=null;}
  sample(universe:Universe):void{if(!this.active)return;if(this.lastSampleTick!==null&&universe.state.ticks-this.lastSampleTick<this.samplingIntervalTicks)return;this.sampleNow(universe);}
  private sampleNow(universe:Universe):void{const tick=universe.state.ticks;if(this.activationTick===null)this.activationTick=tick;for(const entity of universe.entities.slice(0,PRIMARY_TRAIL_LIMITS.maximumTrackedEntities)){let buffer=this.buffers.get(entity.creationIndex);if(!buffer){buffer=new EntityTrailBuffer(entity.creationIndex,tick,this.samplingIntervalTicks,this.sampleLimit);this.buffers.set(entity.creationIndex,buffer);}buffer.push(tick,entity.x,entity.y);}this.lastSampleTick=tick;}
  trails():RecordedTrail[]{return[...this.buffers.values()].map((buffer)=>({entityId:buffer.entityId,startTick:buffer.startTick,samplingIntervalTicks:buffer.interval,points:buffer.points()}));}
  stats(entityId:number,currentTick:number):RecordedTrailStats|null{const buffer=this.buffers.get(entityId);if(!buffer)return null;const points=buffer.points();if(!points.length)return null;let path=0;for(let i=1;i<points.length;i++)path+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);return{startTick:buffer.startTick,currentTick,sampledPoints:points.length,sampledPathLength:path,displacement:Math.hypot(points.at(-1)!.x-points[0].x,points.at(-1)!.y-points[0].y),samplingIntervalTicks:buffer.interval};}
}
