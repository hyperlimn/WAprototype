import type { RelationshipLayer } from "./relationshipLayer";
import type { RelationshipEntity } from "./relationshipEntity";

/** Per-Universe scratch views for the current relationship membership.
 * Arrays contain the same mutable domain objects and preserve each consumer's
 * pre-v1 ordering. The workspace is neither authoritative nor persisted.
 */
export class RelationshipTickWorkspace {
  private revision = -1;
  all: RelationshipEntity[] = [];
  ruptureOrdered: RelationshipEntity[] = [];
  reproductionOrdered: RelationshipEntity[] = [];
  readonly spatial: RelationshipEntity[] = [];
  readonly influential: RelationshipEntity[] = [];
  readonly dual: RelationshipEntity[] = [];
  readonly dormant: RelationshipEntity[] = [];
  readonly previousDimensionFlags = new Map<RelationshipEntity, number>();

  sync(layer: RelationshipLayer): void {
    if (this.revision === layer.revision) return;
    this.revision = layer.revision;
    this.all = [...layer.entities.values()];
    this.ruptureOrdered = [...this.all].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.reproductionOrdered = [...this.all].sort((a, b) => a.id.localeCompare(b.id));
  }

  captureDimensionFlags(): void {
    this.previousDimensionFlags.clear();
    for (const relationship of this.all) this.previousDimensionFlags.set(relationship,
      (relationship.spatialActive ? 1 : 0) | (relationship.influenceActive ? 2 : 0));
  }

  classify(): void {
    this.spatial.length = 0; this.influential.length = 0; this.dual.length = 0; this.dormant.length = 0;
    for (const relationship of this.all) {
      if (relationship.spatialActive) this.spatial.push(relationship);
      if (relationship.influenceActive) this.influential.push(relationship);
      if (relationship.spatialActive && relationship.influenceActive) this.dual.push(relationship);
      else if (!relationship.spatialActive && !relationship.influenceActive) this.dormant.push(relationship);
    }
  }
}
