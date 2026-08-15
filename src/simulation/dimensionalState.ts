import type { RelationshipEntity } from "./relationshipEntity";

const DENSITY_RADIUS = 320;
const SPATIAL_DURATION_MIN = 4000;
const SPATIAL_DURATION_MAX = 20000;
const INFLUENCE_DURATION_MIN = 8000;
const INFLUENCE_DURATION_MAX = 40000;

const durationFromSegment = (fingerprint: string, start: number, min: number, max: number): number => {
  const normalized = parseInt(fingerprint.slice(start, start + 4), 16) / 0xffff;
  return Math.round(min + (max - min) * normalized);
};

export const deriveDimensionalDurations = (fingerprint: string): {
  spatialDuration: number;
  influenceDuration: number;
} => ({
  // Characters 17–20 and 21–24 were not previously interpreted by any law.
  spatialDuration: durationFromSegment(fingerprint, 16, SPATIAL_DURATION_MIN, SPATIAL_DURATION_MAX),
  influenceDuration: durationFromSegment(fingerprint, 20, INFLUENCE_DURATION_MIN, INFLUENCE_DURATION_MAX),
});

export class DimensionalState {
  private readonly cells = new Map<string, RelationshipEntity[]>();
  update(relationships: RelationshipEntity[]): void {
    for (const entity of relationships) {
      entity.spatialActive = entity.age < entity.spatialDuration;
      entity.influenceActive = entity.age < entity.influenceDuration;
      entity.localRelationshipDensity = 0;
      entity.synergy = 0;
    }

    const spatial = relationships.filter((entity) => entity.spatialActive);
    const cells = this.cells; cells.clear();
    for (const entity of spatial) {
      const key = this.key(Math.floor(entity.x / DENSITY_RADIUS), Math.floor(entity.y / DENSITY_RADIUS));
      const cell = cells.get(key);
      if (cell) cell.push(entity);
      else cells.set(key, [entity]);
    }

    for (const entity of spatial) {
      const cx = Math.floor(entity.x / DENSITY_RADIUS);
      const cy = Math.floor(entity.y / DENSITY_RADIUS);
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          const cell = cells.get(this.key(x, y));
          if (!cell) continue;
          for (const other of cell) {
            if (other !== entity && Math.hypot(other.x - entity.x, other.y - entity.y) < DENSITY_RADIUS) {
              entity.localRelationshipDensity++;
            }
          }
        }
      }
      if (entity.influenceActive) {
        const boundedDensity = entity.localRelationshipDensity / (entity.localRelationshipDensity + 4);
        entity.synergy = entity.coherence * boundedDensity;
      }
    }
  }

  private key(x: number, y: number): string { return `${x},${y}`; }
}
