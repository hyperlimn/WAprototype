import type { Entity } from "./entity";
import { SpatialIndex } from "./spatialIndex";
import type { WorldState } from "./worldState";

export const INTERACTION_RADIUS = 145;
export const BOND_DISTANCE = 66;
const BASE_FORCE = 0.0018;
const DAMPING = 0.992;
const MAX_SPEED = 1.8;
const EQUILIBRIUM_WIDTH = 18;
const MIN_PREFERRED_DISTANCE = 20;
const MAX_PREFERRED_DISTANCE = 90;

export interface Bond {
  strength: number;
  touched: boolean;
}

export const relationship = (a: Entity, b: Entity): number =>
  1 - (Math.abs(a.alpha - b.alpha) + Math.abs(a.beta - b.beta) + Math.abs(a.gamma - b.gamma)) / 3;

/** Symmetric equilibrium spacing derived only from the pair's immutable traits. */
export const preferredInteractionDistance = (a: Entity, b: Entity): number => {
  const pairTraitMean = (a.alpha + a.beta + a.gamma + b.alpha + b.beta + b.gamma) / 6;
  return MIN_PREFERRED_DISTANCE + (MAX_PREFERRED_DISTANCE - MIN_PREFERRED_DISTANCE) * pairTraitMean;
};

export function stepPhysics(
  entities: Entity[],
  spatial: SpatialIndex,
  bonds: Map<string, Bond>,
  world: WorldState,
  dt: number,
  parameters: { baseForce: number; damping: number } = { baseForce: BASE_FORCE, damping: DAMPING },
): void {
  spatial.rebuild(entities);
  for (const bond of bonds.values()) bond.touched = false;
  for (const entity of entities) {
    entity.neighborCount = 0;
    entity.strongestRelationship = 0;
    entity.strongestBond = 0;
  }

  // A speed-dependent feedback coefficient closes the local → global → local loop.
  const feedback = 1 + Math.min(0.12, world.averageSpeed * 0.045);
  const radiusSq = INTERACTION_RADIUS * INTERACTION_RADIUS;
  const nearby: Entity[] = [];
  for (const a of entities) {
    for (const b of spatial.nearbyInto(a, nearby)) {
      if (b.creationIndex <= a.creationIndex) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= 0 || distanceSq > radiusSq) continue;

      const distance = Math.sqrt(distanceSq);
      const relation = relationship(a, b);
      a.neighborCount++;
      b.neighborCount++;
      a.strongestRelationship = Math.max(a.strongestRelationship, relation);
      b.strongestRelationship = Math.max(b.strongestRelationship, relation);

      const key = `${a.creationIndex}:${b.creationIndex}`;
      let bond = bonds.get(key);
      if (distance < BOND_DISTANCE) {
        if (!bond) {
          bond = { strength: 0, touched: true };
          bonds.set(key, bond);
        }
        bond.touched = true;
        bond.strength = Math.min(1, bond.strength + 0.0015 * dt);
      }
      const memory = bond?.strength ?? 0;
      if (bond) {
        a.strongestBond = Math.max(a.strongestBond, memory);
        b.strongestBond = Math.max(b.strongestBond, memory);
      }

      const polarity = relation - world.worldAlpha;
      // Attractive pairs cross smoothly from repulsion to attraction around their
      // fingerprint-derived spacing. Genuinely repulsive pairs retain their force.
      const radialResponse = polarity > 0
        ? Math.tanh((distance - preferredInteractionDistance(a, b)) / EQUILIBRIUM_WIDTH)
        : 1;
      const falloff = 1 - distance / INTERACTION_RADIUS;
      const magnitude = parameters.baseForce * feedback * polarity * radialResponse * falloff * (1 + memory * 0.55) * dt;
      const fx = (dx / distance) * magnitude;
      const fy = (dy / distance) * magnitude;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  for (const [key, bond] of bonds) {
    if (!bond.touched) {
      bond.strength -= 0.00035 * dt;
      if (bond.strength <= 0.002) bonds.delete(key);
    }
  }

  for (const entity of entities) {
    entity.vx *= Math.pow(parameters.damping, dt);
    entity.vy *= Math.pow(parameters.damping, dt);
    const speed = Math.hypot(entity.vx, entity.vy);
    if (speed > MAX_SPEED) {
      entity.vx = (entity.vx / speed) * MAX_SPEED;
      entity.vy = (entity.vy / speed) * MAX_SPEED;
    }
    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;
    entity.age += dt;
    entity.energy = 0.5 * (entity.vx * entity.vx + entity.vy * entity.vy);
  }
}
