import type { RelationshipEntity } from "./relationshipEntity";

const INFLUENCE_RADIUS = 420;
const INFLUENCE_SCALE = 0.012;
const MAX_INFLUENCE_MODULATION = 0.06;

export class InfluencePhysics {
  readonly modulation = new Map<string, number>();
  private readonly cells = new Map<string, RelationshipEntity[]>();

  update(relationships: RelationshipEntity[], spatialRelationships?: readonly RelationshipEntity[], influenceRelationships?: readonly RelationshipEntity[]): void {
    this.modulation.clear();
    const spatial = spatialRelationships ?? relationships.filter((entity) => entity.spatialActive);
    const influential = influenceRelationships ?? relationships.filter((entity) => entity.influenceActive);
    const cells = this.cells; cells.clear();
    for (const source of influential) {
      const key = this.key(Math.floor(source.x / INFLUENCE_RADIUS), Math.floor(source.y / INFLUENCE_RADIUS));
      const cell = cells.get(key);
      if (cell) cell.push(source);
      else cells.set(key, [source]);
    }

    for (const target of spatial) {
      let field = 0;
      const cx = Math.floor(target.x / INFLUENCE_RADIUS);
      const cy = Math.floor(target.y / INFLUENCE_RADIUS);
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          const cell = cells.get(this.key(x, y));
          if (!cell) continue;
          for (const source of cell) {
            if (source === target) continue;
            const distance = Math.hypot(source.x - target.x, source.y - target.y);
            if (distance >= INFLUENCE_RADIUS) continue;
            const falloff = 1 - distance / INFLUENCE_RADIUS;
            field += INFLUENCE_SCALE * source.coherence * falloff;
          }
        }
      }
      this.modulation.set(target.id, 1 + Math.min(MAX_INFLUENCE_MODULATION, field));
    }
  }

  private key(x: number, y: number): string { return `${x},${y}`; }
}
