import type { Entity } from "./entity";
import type { Bond } from "./physics";
import { relationship } from "./physics";
import { deriveRelationshipFingerprint, type RelationshipEntity } from "./relationshipEntity";
import { deriveDimensionalDurations } from "./dimensionalState";

export const RELATIONSHIP_CREATION_BOND = 0.22;
export const RELATIONSHIP_DESTRUCTION_BOND = 0.08;
export const RELATIONSHIP_PERSISTENCE_TICKS = 90;

export class RelationshipLayer {
  readonly entities = new Map<string, RelationshipEntity>();
  private membershipRevision = 0;
  private readonly candidateSince = new Map<string, number>();

  get revision(): number { return this.membershipRevision; }

  /** Read-only observation of the lifecycle timer; never creates or advances candidate state. */
  candidateFirstTick(id: string): number | undefined {
    return this.candidateSince.get(id);
  }

  continuationCandidates(): [string, number][] { return [...this.candidateSince.entries()].sort(([a], [b]) => a.localeCompare(b)); }
  restoreContinuation(relationships: RelationshipEntity[], candidates: [string, number][]): void {
    this.entities.clear(); this.candidateSince.clear();
    for (const relationship of relationships) this.entities.set(relationship.id, relationship);
    for (const [id, tick] of candidates) this.candidateSince.set(id, tick);
    this.membershipRevision++;
  }

  /** Atomic authoritative membership removal used by bounded branch-only
   * interventions. Ordinary tick workspaces observe the revision on next sync. */
  sever(id:string):boolean{const existed=this.entities.delete(id);this.candidateSince.delete(id);if(existed)this.membershipRevision++;return existed;}

  update(baseEntities: Entity[], bonds: Map<string, Bond>, tick: number): void {
    for (const [id, bond] of bonds) {
      if (this.entities.has(id)) continue;
      if (bond.strength >= RELATIONSHIP_CREATION_BOND) {
        const since = this.candidateSince.get(id);
        if (since === undefined) this.candidateSince.set(id, tick);
        else if (tick - since >= RELATIONSHIP_PERSISTENCE_TICKS) {
          const [a, b] = this.parents(id, baseEntities);
          this.entities.set(id, this.create(id, a, b, bond.strength, tick));
          this.membershipRevision++;
          this.candidateSince.delete(id);
        }
      } else {
        this.candidateSince.delete(id);
      }
    }

    for (const id of this.candidateSince.keys()) {
      if (!bonds.has(id)) this.candidateSince.delete(id);
    }

    for (const [id, entity] of this.entities) {
      const bond = bonds.get(id);
      if (!bond || bond.strength < RELATIONSHIP_DESTRUCTION_BOND) {
        this.entities.delete(id);
        this.membershipRevision++;
        continue;
      }
      const a = baseEntities[entity.parentAId], b = baseEntities[entity.parentBId];
      this.measure(entity, a, b, bond.strength, tick);
    }
  }

  private parents(id: string, entities: Entity[]): [Entity, Entity] {
    const [aId, bId] = id.split(":").map(Number);
    return [entities[aId], entities[bId]];
  }

  private create(id: string, a: Entity, b: Entity, bondStrength: number, tick: number): RelationshipEntity {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const fingerprint = deriveRelationshipFingerprint(a, b);
    const durations = deriveDimensionalDurations(fingerprint);
    const entity: RelationshipEntity = {
      id,
      fingerprint,
      parentAId: a.creationIndex,
      parentBId: b.creationIndex,
      creationTick: tick,
      ...durations,
      age: 0,
      spatialActive: true,
      influenceActive: true,
      bondStrength,
      relationshipStrength: relationship(a, b),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance,
      orientation: Math.atan2(b.y - a.y, b.x - a.x),
      relativeVx: b.vx - a.vx,
      relativeVy: b.vy - a.vy,
      internalEnergy: 0,
      distanceChangeEma: 0,
      coherence: 0,
      localRelationshipDensity: 0,
      synergy: 0,
      fieldSourceStrength: 0,
      localFieldPotential: 0,
      localFieldGradientMagnitude: 0,
      reproductionEligible: false,
      nextEligibleTick: tick,
      reproductionCount: 0,
      lastReproductionTick: null,
      ruptureQualified: false,
      ruptureCount: 0,
      lastRuptureTick: null,
    };
    this.measure(entity, a, b, bondStrength, tick);
    return entity;
  }

  private measure(entity: RelationshipEntity, a: Entity, b: Entity, bondStrength: number, tick: number): void {
    const previousDistance = entity.distance;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    entity.age = tick - entity.creationTick;
    entity.bondStrength = bondStrength;
    entity.relationshipStrength = relationship(a, b);
    entity.x = (a.x + b.x) / 2;
    entity.y = (a.y + b.y) / 2;
    entity.distance = distance;
    entity.orientation = Math.atan2(dy, dx);
    entity.relativeVx = b.vx - a.vx;
    entity.relativeVy = b.vy - a.vy;
    entity.internalEnergy = 0.25 * (entity.relativeVx ** 2 + entity.relativeVy ** 2);
    const normalizedChange = Math.min(1, Math.abs(distance - previousDistance) / 2);
    entity.distanceChangeEma = entity.distanceChangeEma * 0.95 + normalizedChange * 0.05;
    const distanceStability = 1 - entity.distanceChangeEma;
    entity.coherence = 0.45 * bondStrength + 0.35 * entity.relationshipStrength + 0.2 * distanceStability;
  }
}
