import type { Entity } from "./entity";
import { decodeFingerprint } from "./fingerprint";
import type { RelationshipEntity } from "./relationshipEntity";
import type { WorldState } from "./worldState";

export const MAX_BASE_POPULATION = 1000;
export const REPRODUCTION_COMPATIBILITY_GATE = 0.82;
const MINIMUM_AGE_MIN = 8_000;
const MINIMUM_AGE_RANGE = 24_000;
const COHERENCE_MIN = 0.68;
const COHERENCE_RANGE = 0.20;
const COOLDOWN_MIN = 30_000;
const COOLDOWN_RANGE = 70_000;

const normalized = (fingerprint: string, start: number): number =>
  parseInt(fingerprint.slice(start, start + 4), 16) / 0xffff;
const duration = (value: number, minimum: number, range: number): number =>
  minimum + Math.floor(value * (range + 1));

export interface ReproductionParameters {
  compatibility: number;
  minimumAge: number;
  coherenceThreshold: number;
  cooldown: number;
}

export function reproductionParameters(
  parentA: Entity,
  parentB: Entity,
  relationship: RelationshipEntity,
): ReproductionParameters {
  const parentTraitA = normalized(parentA.fingerprint, 12);
  const parentTraitB = normalized(parentB.fingerprint, 12);
  const relationshipTrait = normalized(relationship.fingerprint, 24);
  return {
    compatibility: (parentTraitA + parentTraitB + relationshipTrait) / 3,
    minimumAge: duration(normalized(relationship.fingerprint, 28), MINIMUM_AGE_MIN, MINIMUM_AGE_RANGE),
    coherenceThreshold: COHERENCE_MIN + COHERENCE_RANGE * normalized(relationship.fingerprint, 32),
    cooldown: duration(normalized(relationship.fingerprint, 36), COOLDOWN_MIN, COOLDOWN_RANGE),
  };
}

// Synchronous SHA-256 keeps tick processing deterministic and avoids asynchronous Web Crypto ordering.
function sha256(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const w = new Uint32Array(64);
  const rotate = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return [...h].map((value) => value.toString(16).padStart(8, "0")).join("");
}

const quantize = (value: number): number => Math.round(value * 1_000_000);

export function worldStateSignature(state: WorldState): string {
  return [
    state.ticks,
    quantize(state.worldAlpha), quantize(state.worldBeta), quantize(state.worldGamma),
    quantize(state.averageSpeed), state.activeRelationshipEntities,
    quantize(state.averageCoherence), quantize(state.averageFieldPotential),
  ].join(":");
}

interface BirthRequest {
  relationship: RelationshipEntity;
  parentA: Entity;
  parentB: Entity;
}

export class ReproductionSystem {
  private readonly birthTicks: number[] = [];

  update(entities: Entity[], relationships: RelationshipEntity[], state: WorldState): Entity[] {
    const requests: BirthRequest[] = [];
    const ordered = [...relationships].sort((a, b) => a.id.localeCompare(b.id));
    for (const relationship of ordered) {
      const parentA = entities[relationship.parentAId];
      const parentB = entities[relationship.parentBId];
      const parameters = reproductionParameters(parentA, parentB, relationship);
      const ageTick = relationship.creationTick + parameters.minimumAge;
      const cooldownTick = relationship.lastReproductionTick === null
        ? ageTick : relationship.lastReproductionTick + parameters.cooldown;
      relationship.nextEligibleTick = Math.max(ageTick, cooldownTick);
      relationship.reproductionEligible = entities.length < MAX_BASE_POPULATION
        && relationship.bondStrength >= 0.08
        && state.ticks >= relationship.nextEligibleTick
        && relationship.coherence >= parameters.coherenceThreshold
        && parameters.compatibility >= REPRODUCTION_COMPATIBILITY_GATE;
      if (relationship.reproductionEligible) requests.push({ relationship, parentA, parentB });
    }
    const births: Entity[] = [];
    const signature = worldStateSignature(state);
    for (const request of requests) {
      if (entities.length + births.length >= MAX_BASE_POPULATION) break;
      births.push(this.createChild(request, entities.length + births.length, state.ticks, signature));
      request.relationship.reproductionCount++;
      request.relationship.lastReproductionTick = state.ticks;
      request.relationship.nextEligibleTick = state.ticks
        + reproductionParameters(request.parentA, request.parentB, request.relationship).cooldown;
      request.relationship.reproductionEligible = false;
      this.birthTicks.push(state.ticks);
    }
    if (entities.length + births.length >= MAX_BASE_POPULATION) {
      for (const relationship of ordered) relationship.reproductionEligible = false;
    }
    while (this.birthTicks.length && this.birthTicks[0] < state.ticks - 9_999) this.birthTicks.shift();
    state.eligibleReproductiveRelationships = ordered.filter(
      (relationship) => relationship.reproductionEligible,
    ).length;
    state.birthsLast10000Ticks = this.birthTicks.length;
    return births;
  }

  private createChild(request: BirthRequest, creationIndex: number, tick: number, signature: string): Entity {
    const { relationship, parentA, parentB } = request;
    const [first, second] = parentA.fingerprint < parentB.fingerprint
      ? [parentA, parentB] : [parentB, parentA];
    const fingerprint = sha256([
      first.fingerprint, second.fingerprint, relationship.fingerprint,
      relationship.reproductionCount, tick, signature,
    ].join("|"));
    const traits = decodeFingerprint(fingerprint);
    const angle = normalized(fingerprint, 12) * Math.PI * 2;
    const radius = 8 + normalized(fingerprint, 16) * 16;
    const velocityAngle = normalized(fingerprint, 20) * Math.PI * 2;
    const velocityMagnitude = 0.002 + normalized(fingerprint, 24) * 0.008;
    return {
      ...traits,
      creationIndex,
      creationTimestamp: tick,
      origin: "reproduction",
      birthTick: tick,
      parentRelationshipId: relationship.id,
      parentEntityIds: [relationship.parentAId, relationship.parentBId],
      x: relationship.x + Math.cos(angle) * radius,
      y: relationship.y + Math.sin(angle) * radius,
      vx: (first.vx + second.vx) / 2 + Math.cos(velocityAngle) * velocityMagnitude,
      vy: (first.vy + second.vy) / 2 + Math.sin(velocityAngle) * velocityMagnitude,
      energy: 0, age: 0, neighborCount: 0, strongestRelationship: 0, strongestBond: 0,
    };
  }
}
