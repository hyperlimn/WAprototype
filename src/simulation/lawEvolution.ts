import type { Entity } from "./entity.js";
import type { RelationshipEntity } from "./relationshipEntity.js";
import type { WorldState } from "./worldState.js";
import { LAW_PARAMETER_REGISTRY, LAW_PARAMETER_REGISTRY_VERSION, applyParameterMutation, baseLawParameters, lawParameter,
  type EffectiveLawParameters, type LawParameterId, type LawParameterOperation } from "./lawParameters.js";
import { sha256Hex } from "./sha256.js";
import { SIMULATION_LAW_SET_VERSION } from "./systemManifest.js";

export const LAW_EVOLUTION_ENGINE_VERSION = "law-evolution/1";
export const COSMOLOGICAL_VECTOR_VERSION = "cosmological-state-vector/1";
export const LAW_GENOME_VERSION = "law-genome/1";
export const LAW_GRAMMAR_VERSION = "law-grammar/1";
export const PRODUCTION_LAW_EPOCH_INTERVAL = 500_000;
const DOMAIN = "ProtoUniverse/LawEvolution/v1";

type Classification = "present-structural" | "cumulative-historical" | "derived-measurement" | "identity-derived";
type Transform = "fraction" | "saturating" | "log-saturating";
export interface CosmologicalVectorDescriptor { id: string; classification: Classification; transform: Transform; scale: number; quantization: "uint16"; absent: "zero-with-validity" }
const descriptors = (items: Array<[string, Classification, Transform, number]>): readonly CosmologicalVectorDescriptor[] => Object.freeze(items.map(([id,classification,transform,scale])=>({id,classification,transform,scale,quantization:"uint16" as const,absent:"zero-with-validity" as const})));
export const COSMOLOGICAL_VECTOR_DESCRIPTORS = descriptors([
  ["population","present-structural","saturating",1000], ["relationshipsPerEntity","present-structural","saturating",12],
  ["bondsPerEntity","present-structural","saturating",12], ["spatialFraction","present-structural","fraction",1],
  ["influenceFraction","present-structural","fraction",1], ["dualFraction","present-structural","fraction",1],
  ["dormantFraction","present-structural","fraction",1], ["meanDegree","derived-measurement","saturating",12],
  ["highDegree","derived-measurement","saturating",24], ["hubConcentration","derived-measurement","fraction",1],
  ["largestComponentFraction","derived-measurement","fraction",1], ["spatialRmsRadius","derived-measurement","log-saturating",2200],
  ["spatialAnisotropy","derived-measurement","fraction",1], ["medianLocalDensity","derived-measurement","saturating",12],
  ["highSpeed","derived-measurement","saturating",1.8], ["meanEnergy","derived-measurement","log-saturating",1],
  ["meanCoherence","derived-measurement","fraction",1], ["meanSynergy","derived-measurement","saturating",1],
  ["highFieldPotential","derived-measurement","log-saturating",0.01], ["traitDiversity","identity-derived","fraction",1],
  ["frequencyDispersion","identity-derived","fraction",1], ["phaseOrder","identity-derived","fraction",1],
  ["lineageRootDiversity","present-structural","fraction",1], ["recentReproductionRate","cumulative-historical","saturating",0.01],
  ["recentRuptureRate","cumulative-historical","saturating",0.01], ["relationshipChurnRate","cumulative-historical","saturating",0.01],
  ["externalIntegrationFraction","cumulative-historical","fraction",1],
]);

export interface CosmologicalStateVector { schemaVersion: typeof COSMOLOGICAL_VECTOR_VERSION; tick: number; values: Record<string, number>; validity: Record<string, boolean> }
const finite = (value:number):number => { if(!Number.isFinite(value)) throw new Error("Non-finite cosmological state vector value"); return Object.is(value,-0)?0:value; };
const quantile = (values:number[], fraction:number):number => { if(!values.length)return 0; const ordered=[...values].sort((a,b)=>a-b); return ordered[Math.floor((ordered.length-1)*fraction)]; };

export function buildCosmologicalStateVector(state: WorldState, entities: readonly Entity[], relationships: readonly RelationshipEntity[]): CosmologicalStateVector {
  const n=entities.length,r=relationships.length, degrees=new Array<number>(n).fill(0), adjacency=Array.from({length:n},()=>[] as number[]);
  for(const rel of relationships){degrees[rel.parentAId]++;degrees[rel.parentBId]++;adjacency[rel.parentAId].push(rel.parentBId);adjacency[rel.parentBId].push(rel.parentAId);}
  let largest=0; const seen=new Uint8Array(n); for(let i=0;i<n;i++){if(seen[i])continue;let size=0;const stack=[i];seen[i]=1;while(stack.length){const at=stack.pop()!;size++;for(const next of adjacency[at])if(!seen[next]){seen[next]=1;stack.push(next);}}largest=Math.max(largest,size);}
  const cx=n?entities.reduce((s,e)=>s+e.x,0)/n:0,cy=n?entities.reduce((s,e)=>s+e.y,0)/n:0;
  let xx=0,yy=0,xy=0,energy=0,sin=0,cos=0,frequencyMean=0; const speeds:number[]=[],densities:number[]=[],fields:number[]=[];
  for(const e of entities)frequencyMean+=e.naturalFrequency; frequencyMean=n?frequencyMean/n:0;
  for(const e of entities){const dx=e.x-cx,dy=e.y-cy;xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;energy+=e.energy;speeds.push(Math.hypot(e.vx,e.vy));densities.push(e.neighborCount);const angle=e.phase+Math.PI*2*e.naturalFrequency*state.ticks/1000;sin+=Math.sin(angle);cos+=Math.cos(angle);}
  for(const rel of relationships)fields.push(rel.localFieldPotential);
  const trace=xx+yy,disc=Math.sqrt(Math.max(0,(xx-yy)**2+4*xy*xy)),major=(trace+disc)/2,minor=(trace-disc)/2;
  const variance=(key:"alpha"|"beta"|"gamma")=>{if(!n)return 0;const mean=entities.reduce((s,e)=>s+e[key],0)/n;return entities.reduce((s,e)=>s+(e[key]-mean)**2,0)/n;};
  const roots=new Set<number>(); const rootOf=(id:number):number=>{let current=id,guard=0;while(entities[current]?.parentEntityIds&&guard++<n)current=Math.min(...entities[current].parentEntityIds!);return current;}; for(const e of entities)roots.add(rootOf(e.creationIndex));
  const values:Record<string,number>={population:n,relationshipsPerEntity:n?r/n:0,bondsPerEntity:n?state.activeBonds/n:0,
    spatialFraction:r?state.spatiallyActiveRelationships/r:0,influenceFraction:r?state.influenceActiveRelationships/r:0,dualFraction:r?state.dualActiveRelationships/r:0,dormantFraction:r?state.dormantRelationships/r:0,
    meanDegree:n?degrees.reduce((a,b)=>a+b,0)/n:0,highDegree:quantile(degrees,0.9),hubConcentration:r?Math.max(0,...degrees)/(2*r):0,largestComponentFraction:n?largest/n:0,
    spatialRmsRadius:n?Math.sqrt(trace/n):0,spatialAnisotropy:major>0?Math.max(0,Math.min(1,1-minor/major)):0,medianLocalDensity:quantile(densities,0.5),highSpeed:quantile(speeds,0.9),meanEnergy:n?energy/n:0,
    meanCoherence:state.averageCoherence,meanSynergy:state.averageSynergy,highFieldPotential:quantile(fields,0.9),traitDiversity:Math.min(1,(variance("alpha")+variance("beta")+variance("gamma"))/0.25),
    frequencyDispersion:n?Math.sqrt(entities.reduce((s,e)=>s+(e.naturalFrequency-frequencyMean)**2,0)/n)/0.25:0,
    phaseOrder:n?Math.hypot(sin,cos)/n:0,lineageRootDiversity:n?roots.size/n:0,recentReproductionRate:state.birthsLast10000Ticks/10000,recentRuptureRate:state.rupturesLast10000Ticks/10000,
    relationshipChurnRate:state.ticks?(state.relationshipsCreated+state.relationshipsDestroyed)/state.ticks:0,externalIntegrationFraction:n?state.externalArrivals/n:0};
  for(const descriptor of COSMOLOGICAL_VECTOR_DESCRIPTORS)values[descriptor.id]=finite(values[descriptor.id]);
  return {schemaVersion:COSMOLOGICAL_VECTOR_VERSION,tick:state.ticks,values,validity:Object.fromEntries(COSMOLOGICAL_VECTOR_DESCRIPTORS.map(d=>[d.id,n>0]))};
}

export function encodeCosmologicalStateVector(vector:CosmologicalStateVector):Uint8Array{
  if(vector.schemaVersion!==COSMOLOGICAL_VECTOR_VERSION)throw new Error("Unsupported cosmological vector schema");
  const bytes=new Uint8Array(COSMOLOGICAL_VECTOR_DESCRIPTORS.length*3),view=new DataView(bytes.buffer);let offset=0;
  for(const descriptor of COSMOLOGICAL_VECTOR_DESCRIPTORS){const valid=vector.validity[descriptor.id]===true,value=finite(vector.values[descriptor.id]);let normalized=0;if(valid){if(descriptor.transform==="fraction")normalized=Math.max(0,Math.min(1,value));else if(descriptor.transform==="saturating")normalized=value<=0?0:value/(value+descriptor.scale);else{const logged=value<=0?0:Math.log1p(value/descriptor.scale);normalized=logged/(1+logged);}}bytes[offset++]=valid?1:0;view.setUint16(offset,Math.round(Math.max(0,Math.min(1,normalized))*65535),false);offset+=2;}return bytes;
}

export interface LawGenomeV1 { schemaVersion:typeof LAW_GENOME_VERSION; grammarVersion:typeof LAW_GRAMMAR_VERSION; family:"parameter-modulation"; targetParameter:LawParameterId; operation:LawParameterOperation; magnitude:number; polarity:-1|1; boundsReference:string; sourceEvolutionHash:string; epoch:number }
export interface EvolvedLawRecord { id:string; epoch:number; bornAtTick:number; sourceVectorHash:string; evolutionHash:string; genome:LawGenomeV1; targetParameter:LawParameterId; priorValue:number; resultingValue:number; implementationVersion:typeof LAW_EVOLUTION_ENGINE_VERSION }
export interface LawSetManifest { schemaVersion:"law-set-manifest/1"; baseLawSetVersion:string; engineVersion:typeof LAW_EVOLUTION_ENGINE_VERSION; parameterRegistryVersion:string; vectorSchemaVersion:typeof COSMOLOGICAL_VECTOR_VERSION; grammarVersion:typeof LAW_GRAMMAR_VERSION; effectiveParameters:EffectiveLawParameters; evolvedLaws:EvolvedLawRecord[]; previousManifestHash:string|null; manifestHash:string }
export interface LawEvolutionRecord extends EvolvedLawRecord { vector:CosmologicalStateVector; previousLawSetHash:string; previousEvolutionHash:string|null; resultingManifestHash:string }
export interface LawEvolutionState { schemaVersion:"law-evolution-continuation/1"; epochInterval:number; completedEpoch:number; previousEvolutionHash:string|null; activeManifest:LawSetManifest; records:LawEvolutionRecord[] }
const stable=(value:unknown):string=>JSON.stringify(value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(stable(v))])):Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):value);
const hashManifest=(value:Omit<LawSetManifest,"manifestHash">):string=>sha256Hex(stable(value));
export function initialLawEvolutionState(epochInterval=PRODUCTION_LAW_EPOCH_INTERVAL):LawEvolutionState{if(!Number.isInteger(epochInterval)||epochInterval<1)throw new Error("Invalid law epoch interval");const partial:Omit<LawSetManifest,"manifestHash">={schemaVersion:"law-set-manifest/1",baseLawSetVersion:SIMULATION_LAW_SET_VERSION,engineVersion:LAW_EVOLUTION_ENGINE_VERSION,parameterRegistryVersion:LAW_PARAMETER_REGISTRY_VERSION,vectorSchemaVersion:COSMOLOGICAL_VECTOR_VERSION,grammarVersion:LAW_GRAMMAR_VERSION,effectiveParameters:baseLawParameters(),evolvedLaws:[],previousManifestHash:null};return{schemaVersion:"law-evolution-continuation/1",epochInterval,completedEpoch:0,previousEvolutionHash:null,activeManifest:{...partial,manifestHash:hashManifest(partial)},records:[]};}
const concat=(parts:(string|Uint8Array)[]):Uint8Array=>{const encoded=parts.map(p=>typeof p==="string"?new TextEncoder().encode(p):p),out=new Uint8Array(encoded.reduce((s,p)=>s+p.length+1,0));let at=0;for(const part of encoded){out.set(part,at);at+=part.length;out[at++]=0;}return out;};
export function deriveEvolutionHash(seed:string,epoch:number,tick:number,bytes:Uint8Array,previousManifestHash:string,previousEvolutionHash:string|null,epochInterval:number):string{return sha256Hex(concat([DOMAIN,seed,String(epoch),String(tick),String(epochInterval),LAW_GRAMMAR_VERSION,COSMOLOGICAL_VECTOR_VERSION,bytes,previousManifestHash,previousEvolutionHash??""]));}
export function decodeLawGenome(hash:string,epoch:number):LawGenomeV1{if(!/^[0-9a-f]{64}$/.test(hash))throw new Error("Invalid Law Evolution Hash");const bytes=Uint8Array.from(hash.match(/../g)!,x=>parseInt(x,16)),descriptor=LAW_PARAMETER_REGISTRY[((bytes[0]<<8)|bytes[1])%LAW_PARAMETER_REGISTRY.length],fraction=((bytes[4]<<24>>>0)+(bytes[5]<<16)+(bytes[6]<<8)+bytes[7])/0xffffffff;return{schemaVersion:LAW_GENOME_VERSION,grammarVersion:LAW_GRAMMAR_VERSION,family:"parameter-modulation",targetParameter:descriptor.id,operation:descriptor.operation,magnitude:descriptor.maximumChangePerEpoch*(0.25+0.75*fraction),polarity:(bytes[8]&1)?1:-1,boundsReference:`${LAW_PARAMETER_REGISTRY_VERSION}/${descriptor.id}`,sourceEvolutionHash:hash,epoch};}
export function evolveLawState(current:LawEvolutionState,seed:string,vector:CosmologicalStateVector):LawEvolutionState{const epoch=current.completedEpoch+1,bytes=encodeCosmologicalStateVector(vector),vectorHash=sha256Hex(bytes),evolutionHash=deriveEvolutionHash(seed,epoch,vector.tick,bytes,current.activeManifest.manifestHash,current.previousEvolutionHash,current.epochInterval),genome=decodeLawGenome(evolutionHash,epoch),descriptor=lawParameter(genome.targetParameter),prior=current.activeManifest.effectiveParameters[genome.targetParameter],resulting=applyParameterMutation(prior,descriptor,genome.polarity,genome.magnitude),id=`law-${epoch.toString().padStart(6,"0")}-${evolutionHash.slice(0,12)}`;
  const evolved:EvolvedLawRecord={id,epoch,bornAtTick:vector.tick,sourceVectorHash:vectorHash,evolutionHash,genome,targetParameter:genome.targetParameter,priorValue:prior,resultingValue:resulting,implementationVersion:LAW_EVOLUTION_ENGINE_VERSION},effective={...current.activeManifest.effectiveParameters,[genome.targetParameter]:resulting};
  const partial={...current.activeManifest,effectiveParameters:effective,evolvedLaws:[...current.activeManifest.evolvedLaws,evolved],previousManifestHash:current.activeManifest.manifestHash};delete (partial as Partial<LawSetManifest>).manifestHash;const manifest={...(partial as Omit<LawSetManifest,"manifestHash">),manifestHash:hashManifest(partial as Omit<LawSetManifest,"manifestHash">)};const record:LawEvolutionRecord={...evolved,vector,previousLawSetHash:current.activeManifest.manifestHash,previousEvolutionHash:current.previousEvolutionHash,resultingManifestHash:manifest.manifestHash};return{...current,completedEpoch:epoch,previousEvolutionHash:evolutionHash,activeManifest:manifest,records:[...current.records,record]};}

export function validateLawEvolutionState(value:LawEvolutionState,tick:number):LawEvolutionState{if(!value||value.schemaVersion!=="law-evolution-continuation/1"||!Number.isInteger(value.epochInterval)||value.epochInterval<1||value.completedEpoch!==Math.floor(tick/value.epochInterval)||!value.activeManifest||!Array.isArray(value.records)||value.records.length!==value.completedEpoch)throw new Error("Malformed Law Evolution continuation");for(const descriptor of LAW_PARAMETER_REGISTRY){const current=value.activeManifest.effectiveParameters[descriptor.id];if(!Number.isFinite(current)||current<descriptor.min||current>descriptor.max)throw new Error("Law parameter outside registry bounds");}const {manifestHash,...manifest}=value.activeManifest;if(hashManifest(manifest)!==manifestHash)throw new Error("Law-set manifest hash mismatch");for(const record of value.records){if(record.epoch<1||record.bornAtTick!==record.epoch*value.epochInterval||!Number.isFinite(record.priorValue)||!Number.isFinite(record.resultingValue)||record.vector.schemaVersion!==COSMOLOGICAL_VECTOR_VERSION)throw new Error("Invalid Law Evolution record");encodeCosmologicalStateVector(record.vector);}return value;}
