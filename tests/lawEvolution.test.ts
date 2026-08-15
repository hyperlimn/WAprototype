import assert from "node:assert/strict";
import test from "node:test";
import { Universe, SIMULATION_VERSION } from "../src/simulation/universe.js";
import { LAW_PARAMETER_REGISTRY, applyParameterMutation } from "../src/simulation/lawParameters.js";
import { COSMOLOGICAL_VECTOR_DESCRIPTORS, COSMOLOGICAL_VECTOR_VERSION, PRODUCTION_LAW_EPOCH_INTERVAL,
  buildCosmologicalStateVector, decodeLawGenome, deriveEvolutionHash, encodeCosmologicalStateVector, initialLawEvolutionState } from "../src/simulation/lawEvolution.js";
import { deterministicStateHash } from "../src/simulation/deterministicStateHash.js";
import { LEGACY_SAVE_STATE_SCHEMA_VERSION, SAVE_STATE_SCHEMA_VERSION, validateContinuation, type LegacyUniverseContinuationState } from "../src/simulation/saveState.js";
import { sha256Hex } from "../src/simulation/sha256.js";
import { buildWorldSnapshot } from "../src/interface/worldSnapshot.js";

const advance=(universe:Universe,count:number)=>{for(let i=0;i<count;i++)universe.step();};

test("Law Evolution production interval and base parameter registry are bounded",()=>{
  assert.equal(PRODUCTION_LAW_EPOCH_INTERVAL,500_000); assert.equal(initialLawEvolutionState().epochInterval,500_000);
  for(const item of LAW_PARAMETER_REGISTRY){assert.equal(initialLawEvolutionState().activeManifest.effectiveParameters[item.id],item.baseValue);assert.ok(item.min<item.baseValue&&item.baseValue<item.max);assert.ok(item.maximumChangePerEpoch>0);}
});

test("cosmological vector and big-endian fixed-point encoding are deterministic",()=>{
  const a=new Universe("law-vector"),b=new Universe("law-vector");advance(a,12);advance(b,12);
  const av=buildCosmologicalStateVector(a.state,a.entities,[...a.relationshipLayer.entities.values()]);
  const bv=buildCosmologicalStateVector(b.state,b.entities,[...b.relationshipLayer.entities.values()]);
  assert.deepEqual(av,bv);assert.deepEqual(encodeCosmologicalStateVector(av),encodeCosmologicalStateVector(bv));
  assert.equal(av.schemaVersion,COSMOLOGICAL_VECTOR_VERSION);assert.equal(encodeCosmologicalStateVector(av).length,COSMOLOGICAL_VECTOR_DESCRIPTORS.length*3);
  assert.equal(Buffer.from(encodeCosmologicalStateVector(av)).toString("hex"),"01050501000001021e010000010000010000010000010000010000010000010ccd013f090192ec01000001057c01001901000001000001000001ffff01ffff01572301ffff010000010000010000010000");
});

test("evolution hash and genome decoding are stable and bounded",()=>{
  assert.equal(sha256Hex("abc"),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const state=initialLawEvolutionState(25),bytes=new Uint8Array([1,2,3]);
  const hash=deriveEvolutionHash("law-hash",1,25,bytes,state.activeManifest.manifestHash,null,25);
  assert.equal(hash,"771dcd3e179a000829c83a7d99bb24284c3077374afe04588fbf7a84e81bfc23"); assert.deepEqual(decodeLawGenome(hash,1),decodeLawGenome(hash,1));
  for(let i=0;i<256;i++){const genome=decodeLawGenome(i.toString(16).padStart(2,"0").repeat(32),1),descriptor=LAW_PARAMETER_REGISTRY.find(item=>item.id===genome.targetParameter)!;assert.equal(genome.operation,descriptor.operation);assert.ok(genome.magnitude>=0&&genome.magnitude<=descriptor.maximumChangePerEpoch);const result=applyParameterMutation(descriptor.baseValue,descriptor,genome.polarity,genome.magnitude);assert.ok(result>=descriptor.min&&result<=descriptor.max);}
});

test("boundary is atomic and installs mutation only after completing its tick",()=>{
  const evolved=new Universe("law-boundary",undefined,{lawEpochInterval:25}),control=new Universe("law-boundary",undefined,{lawEpochInterval:1000});advance(evolved,24);advance(control,24);
  assert.equal(deterministicStateHash(evolved.continuationState()),deterministicStateHash(control.continuationState()));advance(evolved,1);advance(control,1);
  assert.deepEqual(evolved.entities,control.entities,"boundary tick itself used the prior laws");assert.deepEqual([...evolved.relationshipLayer.entities.values()],[...control.relationshipLayer.entities.values()]);
  assert.equal(evolved.lawEvolution.completedEpoch,1);assert.equal(evolved.lawEvolution.records[0].bornAtTick,25);assert.equal(evolved.occurrences.records.at(-1)?.type,"law-evolution");
  const born=evolved.lawEvolution.records[0];assert.notEqual(born.priorValue,born.resultingValue);assert.equal(evolved.lawEvolution.activeManifest.effectiveParameters[born.targetParameter],born.resultingValue);
  advance(evolved,2_000);advance(control,2_000);assert.notDeepEqual(evolved.entities,control.entities,"the installed effective law causally changes subsequent physics");
});

test("save before and at an epoch boundary resumes with identical manifest and future",()=>{
  const uninterrupted=new Universe("law-resume",undefined,{lawEpochInterval:30});advance(uninterrupted,29);const before=uninterrupted.continuationState();
  const resumedBefore=new Universe("law-resume",structuredClone(before));advance(uninterrupted,1);advance(resumedBefore,1);assert.deepEqual(resumedBefore.lawEvolution,uninterrupted.lawEvolution);assert.equal(deterministicStateHash(resumedBefore.continuationState()),deterministicStateHash(uninterrupted.continuationState()));
  const at=uninterrupted.continuationState(),serialized=JSON.stringify(at);const resumedAt=new Universe("law-resume",JSON.parse(serialized));advance(uninterrupted,40);advance(resumedAt,40);assert.equal(deterministicStateHash(resumedAt.continuationState()),deterministicStateHash(uninterrupted.continuationState()));assert.equal(JSON.stringify(at),serialized);
});

test("legacy v1 migration is explicit and fails at the first epoch",()=>{
  const source=new Universe("legacy-law");advance(source,10);const current=source.continuationState();const {lawEvolution:_,...legacy}=current;
  const migrated=validateContinuation({...legacy,schemaVersion:LEGACY_SAVE_STATE_SCHEMA_VERSION} as LegacyUniverseContinuationState,SIMULATION_VERSION);assert.equal(migrated.schemaVersion,SAVE_STATE_SCHEMA_VERSION);assert.equal(migrated.lawEvolution.completedEpoch,0);
  assert.throws(()=>validateContinuation({...legacy,schemaVersion:LEGACY_SAVE_STATE_SCHEMA_VERSION,tick:500000,state:{...legacy.state,ticks:500000}}),/cannot be migrated/);
});

test("non-finite vector inputs fail closed",()=>{
  const vector={schemaVersion:COSMOLOGICAL_VECTOR_VERSION,tick:0,values:Object.fromEntries(COSMOLOGICAL_VECTOR_DESCRIPTORS.map(item=>[item.id,0])),validity:Object.fromEntries(COSMOLOGICAL_VECTOR_DESCRIPTORS.map(item=>[item.id,true]))} as const;vector.values.population=Number.NaN;assert.throws(()=>encodeCosmologicalStateVector(vector),/Non-finite/);
});

test("rendering, snapshot profiling, and wall-clock reads cannot affect law birth",()=>{
  const observed=new Universe("law-observation-independent",undefined,{lawEpochInterval:20}),plain=new Universe("law-observation-independent",undefined,{lawEpochInterval:20});
  for(let tick=0;tick<20;tick++){Date.now();performance.now();buildWorldSnapshot(observed);observed.profiler.snapshot();observed.step();plain.step();}
  assert.deepEqual(observed.lawEvolution,plain.lawEvolution);assert.equal(deterministicStateHash(observed.continuationState()),deterministicStateHash(plain.continuationState()));
});
