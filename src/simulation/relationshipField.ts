import type { Entity } from "./entity";
import type { RelationshipEntity } from "./relationshipEntity";

export const FIELD_RADIUS = 800;
export const FIELD_SOFTENING = 60;
export const FIELD_FORCE_STRENGTH = 0.004;

interface FieldSample {
  potential: number;
  gradientX: number;
  gradientY: number;
}

const dimensionalFactor = (entity: RelationshipEntity): number => {
  if (entity.spatialActive && entity.influenceActive) return 1;
  if (entity.spatialActive) return 0.8;
  if (entity.influenceActive) return 0.65;
  return 0;
};

export const fieldSourceStrength = (entity: RelationshipEntity): number =>
  entity.coherence * entity.bondStrength * dimensionalFactor(entity);

export class RelationshipField {
  private readonly cells = new Map<string, RelationshipEntity[]>();

  update(relationships: RelationshipEntity[], baseEntities: Entity[], dt: number): void {
    this.cells.clear();
    for (const entity of relationships) {
      entity.fieldSourceStrength = fieldSourceStrength(entity);
      entity.localFieldPotential = 0;
      entity.localFieldGradientMagnitude = 0;
      if (entity.fieldSourceStrength <= 0) continue;
      const key = this.key(Math.floor(entity.x / FIELD_RADIUS), Math.floor(entity.y / FIELD_RADIUS));
      const cell = this.cells.get(key);
      if (cell) cell.push(entity);
      else this.cells.set(key, [entity]);
    }

    for (const entity of relationships) {
      if (!entity.spatialActive) continue;
      const sample = this.sample(entity.x, entity.y, entity.id);
      entity.localFieldPotential = sample.potential;
      entity.localFieldGradientMagnitude = Math.hypot(sample.gradientX, sample.gradientY);
      const ax = FIELD_FORCE_STRENGTH * sample.gradientX * dt;
      const ay = FIELD_FORCE_STRENGTH * sample.gradientY * dt;
      // Translation is equal for both parents, adding no direct internal force.
      baseEntities[entity.parentAId].vx += ax;
      baseEntities[entity.parentAId].vy += ay;
      baseEntities[entity.parentBId].vx += ax;
      baseEntities[entity.parentBId].vy += ay;
    }
  }

  potentialAt(x: number, y: number): number {
    return this.sample(x, y).potential;
  }

  private sample(x: number, y: number, excludedId?: string): FieldSample {
    let potential = 0;
    let gradientX = 0;
    let gradientY = 0;
    const cx = Math.floor(x / FIELD_RADIUS);
    const cy = Math.floor(y / FIELD_RADIUS);

    for (let cellY = cy - 1; cellY <= cy + 1; cellY++) {
      for (let cellX = cx - 1; cellX <= cx + 1; cellX++) {
        for (const source of this.cells.get(this.key(cellX, cellY)) ?? []) {
          if (source.id === excludedId) continue;
          const dx = source.x - x;
          const dy = source.y - y;
          const distanceSq = dx * dx + dy * dy;
          const distance = Math.sqrt(distanceSq);
          if (distance >= FIELD_RADIUS) continue;

          const softened = Math.sqrt(distanceSq + FIELD_SOFTENING ** 2);
          const windowBase = 1 - distance / FIELD_RADIUS;
          const window = windowBase * windowBase;
          potential += source.fieldSourceStrength * window / softened;

          if (distance > 0) {
            // Analytic inward gradient of strength × window / softenedDistance.
            const gradientMagnitude = source.fieldSourceStrength * (
              distance * window / (softened ** 3)
              + 2 * windowBase / (FIELD_RADIUS * softened)
            );
            gradientX += dx / distance * gradientMagnitude;
            gradientY += dy / distance * gradientMagnitude;
          }
        }
      }
    }
    return { potential, gradientX, gradientY };
  }

  private key(x: number, y: number): string { return `${x},${y}`; }
}
