import type { Entity } from "./entity";
import type { RelationshipEntity } from "./relationshipEntity";

const HIGHER_ORDER_RADIUS = 320;
const HIGHER_ORDER_FORCE = 0.000035;
const COMPATIBILITY_CENTER = 0.58;
const MIN_PREFERRED_DISTANCE = 70;
const MAX_PREFERRED_DISTANCE = 220;
const EQUILIBRIUM_WIDTH = 42;

export interface HigherOrderInteraction {
  a: RelationshipEntity;
  b: RelationshipEntity;
  compatibility: number;
  preferredDistance: number;
}

class RelationshipSpatialIndex {
  private readonly cells = new Map<string, RelationshipEntity[]>();

  rebuild(entities: RelationshipEntity[]): void {
    this.cells.clear();
    for (const entity of entities) {
      const key = this.key(Math.floor(entity.x / HIGHER_ORDER_RADIUS), Math.floor(entity.y / HIGHER_ORDER_RADIUS));
      const cell = this.cells.get(key);
      if (cell) cell.push(entity);
      else this.cells.set(key, [entity]);
    }
  }

  nearby(entity: RelationshipEntity): RelationshipEntity[] {
    const cx = Math.floor(entity.x / HIGHER_ORDER_RADIUS);
    const cy = Math.floor(entity.y / HIGHER_ORDER_RADIUS);
    const result: RelationshipEntity[] = [];
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const cell = this.cells.get(this.key(x, y));
        if (cell) result.push(...cell);
      }
    }
    return result;
  }

  private key(x: number, y: number): string { return `${x},${y}`; }
}

const fingerprintDistance = (a: string, b: string): number => {
  let difference = 0;
  for (let i = 0; i < 16; i++) difference += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16)) / 15;
  return difference / 16;
};

export const higherOrderCompatibility = (a: RelationshipEntity, b: RelationshipEntity): number =>
  1 - 0.6 * fingerprintDistance(a.fingerprint, b.fingerprint) - 0.4 * Math.abs(a.coherence - b.coherence);

/** Symmetric immutable spacing from the first 16 bits of each relationship identity. */
export const preferredHigherOrderDistance = (a: RelationshipEntity, b: RelationshipEntity): number => {
  const aValue = parseInt(a.fingerprint.slice(0, 4), 16) / 0xffff;
  const bValue = parseInt(b.fingerprint.slice(0, 4), 16) / 0xffff;
  return MIN_PREFERRED_DISTANCE + (MAX_PREFERRED_DISTANCE - MIN_PREFERRED_DISTANCE) * (aValue + bValue) / 2;
};

export class HigherOrderPhysics {
  readonly activeInteractions: HigherOrderInteraction[] = [];
  private readonly spatial = new RelationshipSpatialIndex();

  step(
    relationships: RelationshipEntity[],
    baseEntities: Entity[],
    influenceModulation: ReadonlyMap<string, number>,
    dt: number,
  ): void {
    this.activeInteractions.length = 0;
    const spatialRelationships = relationships.filter((entity) => entity.spatialActive);
    this.spatial.rebuild(spatialRelationships);
    for (const a of spatialRelationships) {
      for (const b of this.spatial.nearby(a)) {
        if (b.id <= a.id || this.sharesParent(a, b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0 || distance >= HIGHER_ORDER_RADIUS) continue;
        const compatibility = higherOrderCompatibility(a, b);
        const polarity = compatibility - COMPATIBILITY_CENTER;
        const preferredDistance = preferredHigherOrderDistance(a, b);
        const radialResponse = polarity > 0
          ? Math.tanh((distance - preferredDistance) / EQUILIBRIUM_WIDTH)
          : 1;
        const falloff = 1 - distance / HIGHER_ORDER_RADIUS;
        const influence = ((influenceModulation.get(a.id) ?? 1) + (influenceModulation.get(b.id) ?? 1)) / 2;
        const synergy = 1 + 0.08 * (a.synergy + b.synergy) / 2;
        const magnitude = HIGHER_ORDER_FORCE * polarity * radialResponse
          * falloff * a.coherence * b.coherence * influence * synergy * dt;
        const fx = dx / distance * magnitude;
        const fy = dy / distance * magnitude;
        // Equal acceleration of both parents translates the relationship center
        // without directly changing its internal separation.
        baseEntities[a.parentAId].vx += fx;
        baseEntities[a.parentAId].vy += fy;
        baseEntities[a.parentBId].vx += fx;
        baseEntities[a.parentBId].vy += fy;
        baseEntities[b.parentAId].vx -= fx;
        baseEntities[b.parentAId].vy -= fy;
        baseEntities[b.parentBId].vx -= fx;
        baseEntities[b.parentBId].vy -= fy;
        this.activeInteractions.push({ a, b, compatibility, preferredDistance });
      }
    }
  }

  private sharesParent(a: RelationshipEntity, b: RelationshipEntity): boolean {
    return a.parentAId === b.parentAId || a.parentAId === b.parentBId
      || a.parentBId === b.parentAId || a.parentBId === b.parentBId;
  }
}
