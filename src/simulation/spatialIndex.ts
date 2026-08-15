import type { Entity } from "./entity";

export class SpatialIndex {
  private cells = new Map<string, Entity[]>();
  constructor(readonly cellSize: number) {}

  rebuild(entities: Entity[]): void {
    this.cells.clear();
    for (const entity of entities) {
      const key = this.key(Math.floor(entity.x / this.cellSize), Math.floor(entity.y / this.cellSize));
      const cell = this.cells.get(key);
      if (cell) cell.push(entity);
      else this.cells.set(key, [entity]);
    }
  }

  nearby(entity: Entity): Entity[] {
    return this.nearbyInto(entity, []);
  }

  nearbyInto(entity: Entity, result: Entity[]): Entity[] {
    result.length = 0;
    const cx = Math.floor(entity.x / this.cellSize);
    const cy = Math.floor(entity.y / this.cellSize);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const cell = this.cells.get(this.key(x, y));
        if (cell) result.push(...cell);
      }
    }
    return result;
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }
}
