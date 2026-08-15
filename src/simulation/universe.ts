import type { Entity } from "./entity";
import { createFingerprint } from "./fingerprint";
import { Bond, INTERACTION_RADIUS, stepPhysics } from "./physics";
import { SeededRandom } from "./seededRandom";
import { SpatialIndex } from "./spatialIndex";
import type { WorldState } from "./worldState";
import { HigherOrderPhysics } from "./higherOrderPhysics";
import { RelationshipLayer } from "./relationshipLayer";
import { DimensionalState } from "./dimensionalState";
import { InfluencePhysics } from "./influencePhysics";
import { RelationshipField } from "./relationshipField";
import { MAX_BASE_POPULATION, ReproductionSystem } from "./reproduction";
import { OccurrenceLog } from "./occurrenceLog";
import { RuptureSystem } from "./rupture";
import { SAVE_STATE_SCHEMA_VERSION, validateContinuation, type RuntimeProvenance, type UniverseContinuationState } from "./saveState";

export const SIMULATION_VERSION = "u0.6";
export const INITIAL_ENTITY_COUNT = 20;
export const EXTERNALLY_INTRODUCED_LIMIT = 300;
export const EXTERNAL_ARRIVAL_INTERVAL = 1000;
const WORLD_SPREAD = 2200;

export class Universe {
  readonly entities: Entity[] = [];
  readonly bonds = new Map<string, Bond>();
  readonly spatial = new SpatialIndex(INTERACTION_RADIUS);
  readonly relationshipLayer = new RelationshipLayer();
  readonly higherOrderPhysics = new HigherOrderPhysics();
  readonly dimensionalState = new DimensionalState();
  readonly influencePhysics = new InfluencePhysics();
  readonly relationshipField = new RelationshipField();
  readonly reproduction = new ReproductionSystem();
  readonly occurrences = new OccurrenceLog();
  readonly rupture = new RuptureSystem();
  private readonly random: SeededRandom;
  readonly runtime: RuntimeProvenance;
  readonly state: WorldState = {
    worldAlpha: 0,
    worldBeta: 0,
    worldGamma: 0,
    averageSpeed: 0,
    averageLocalDensity: 0,
    activeBonds: 0,
    activeRelationshipEntities: 0,
    averageRelationshipAge: 0,
    averageCoherence: 0,
    activeHigherOrderInteractions: 0,
    spatiallyActiveRelationships: 0,
    influenceActiveRelationships: 0,
    dualActiveRelationships: 0,
    influenceOnlyRelationships: 0,
    averageSynergy: 0,
    averageFieldPotential: 0,
    maximumFieldPotential: 0,
    averageFieldGradient: 0,
    maximumFieldGradient: 0,
    initialEntities: INITIAL_ENTITY_COUNT,
    externalArrivals: 0,
    reproductionBirths: 0,
    eligibleReproductiveRelationships: 0,
    birthsLast10000Ticks: 0,
    totalReproductionEvents: 0,
    relationshipsCreated: 0,
    relationshipsDestroyed: 0,
    dormantRelationships: 0,
    dimensionalTransitions: 0,
    lastReproductionTick: null,
    lastExternalArrivalTick: null,
    totalRuptureEvents: 0,
    rupturesLast10000Ticks: 0,
    lastRuptureTick: null,
    currentlyQualifiedRuptureCandidates: 0,
    ticks: 0,
    simulationTime: 0,
  };

  constructor(readonly seed: string, saved?: UniverseContinuationState) {
    this.random = new SeededRandom(`${SIMULATION_VERSION}:${seed}`);
    if (saved) {
      const value = validateContinuation(saved, SIMULATION_VERSION); if (value.universe !== seed) throw new Error("Save universe identity does not match requested universe");
      Object.assign(this.state, structuredClone(value.state)); this.entities.push(...structuredClone(value.entities));
      for (const [id, bond] of value.bonds) this.bonds.set(id, structuredClone(bond));
      this.relationshipLayer.restoreContinuation(structuredClone(value.relationships), structuredClone(value.relationshipCandidates));
      this.reproduction.restoreContinuationState(value.reproductionBirthTicks); this.rupture.restoreContinuationState(value.rupture);
      this.occurrences.restoreContinuationState(value.occurrences); this.random.restoreContinuationState(value.randomState);
      this.runtime = structuredClone(value.runtime);
    } else {
      this.runtime = { mode: "fresh", sourceSaveId: null, sourceSaveHash: null, sourceSaveTick: null };
      for (let i = 0; i < INITIAL_ENTITY_COUNT; i++) this.entities.push(this.createIntroducedEntity("initial", 0));
      this.measure();
    }
  }

  continuationState(): UniverseContinuationState {
    return structuredClone({ schemaVersion: SAVE_STATE_SCHEMA_VERSION, simulationVersion: SIMULATION_VERSION, universe: this.seed,
      tick: this.state.ticks, runtime: this.runtime, state: this.state, entities: this.entities,
      bonds: [...this.bonds.entries()].sort(([a], [b]) => a.localeCompare(b)), relationships: [...this.relationshipLayer.entities.values()].sort((a, b) => a.id.localeCompare(b.id)),
      relationshipCandidates: this.relationshipLayer.continuationCandidates(), reproductionBirthTicks: this.reproduction.continuationState(),
      rupture: this.rupture.continuationState(), occurrences: this.occurrences.continuationState(), randomState: this.random.continuationState() });
  }

  step(dt = 1): void {
    stepPhysics(this.entities, this.spatial, this.bonds, this.state, dt);
    this.state.ticks++;
    this.state.simulationTime += dt;
    if (this.state.ticks % EXTERNAL_ARRIVAL_INTERVAL === 0
      && this.state.initialEntities + this.state.externalArrivals < EXTERNALLY_INTRODUCED_LIMIT
      && this.entities.length < MAX_BASE_POPULATION) {
      const arrival = this.createIntroducedEntity("external arrival", this.state.ticks);
      this.entities.push(arrival);
      this.state.externalArrivals++;
      this.state.lastExternalArrivalTick = this.state.ticks;
      this.occurrences.add({
        tick: this.state.ticks, type: "external-arrival",
        description: `external arrival — entity ${arrival.creationIndex}`,
        entityId: arrival.creationIndex, x: arrival.x, y: arrival.y,
      });
    }
    const previousRelationships = new Map([...this.relationshipLayer.entities].map(([id, entity]) => [id, {
      entity, spatialActive: entity.spatialActive, influenceActive: entity.influenceActive,
    }]));
    this.relationshipLayer.update(this.entities, this.bonds, this.state.ticks);
    const relationships = [...this.relationshipLayer.entities.values()];
    for (const relationship of relationships) {
      if (previousRelationships.has(relationship.id)) continue;
      this.state.relationshipsCreated++;
      this.occurrences.add({
        tick: this.state.ticks, type: "relationship-formed",
        description: `relationship formed — entities ${relationship.parentAId} + ${relationship.parentBId}`,
        relationshipId: relationship.id,
        parentEntityIds: [relationship.parentAId, relationship.parentBId],
        x: relationship.x, y: relationship.y,
      });
    }
    for (const [id, previous] of previousRelationships) {
      if (this.relationshipLayer.entities.has(id)) continue;
      this.state.relationshipsDestroyed++;
      this.occurrences.add({
        tick: this.state.ticks, type: "relationship-destroyed",
        description: `relationship destroyed — ${id}`,
        relationshipId: id,
        parentEntityIds: [previous.entity.parentAId, previous.entity.parentBId],
        x: previous.entity.x, y: previous.entity.y,
      });
    }
    this.dimensionalState.update(relationships);
    this.rupture.update(relationships, this.entities, this.bonds, this.state, this.occurrences);
    for (const relationship of relationships) {
      const previous = previousRelationships.get(relationship.id);
      if (!previous) continue;
      const transition = this.dimensionalTransition(
        previous.spatialActive, previous.influenceActive,
        relationship.spatialActive, relationship.influenceActive,
      );
      if (!transition) continue;
      this.state.dimensionalTransitions++;
      this.occurrences.add({
        tick: this.state.ticks, type: "dimensional-transition",
        description: `${transition} — relationship ${relationship.id}`,
        relationshipId: relationship.id, transition,
        parentEntityIds: [relationship.parentAId, relationship.parentBId],
        x: relationship.x, y: relationship.y,
      });
    }
    this.influencePhysics.update(relationships);
    this.relationshipField.update(relationships, this.entities, dt);
    this.higherOrderPhysics.step(relationships, this.entities, this.influencePhysics.modulation, dt);
    this.measure();
    const births = this.reproduction.update(this.entities, relationships, this.state);
    if (births.length) {
      this.entities.push(...births);
      this.state.reproductionBirths += births.length;
      this.state.totalReproductionEvents += births.length;
      this.state.lastReproductionTick = this.state.ticks;
      for (const child of births) {
        const parents = child.parentEntityIds!;
        this.occurrences.add({
          tick: this.state.ticks, type: "reproduction",
          description: `reproduction — entities ${parents[0]} + ${parents[1]} → entity ${child.creationIndex}`,
          entityId: child.creationIndex,
          relationshipId: child.parentRelationshipId!,
          parentEntityIds: parents,
          x: child.x, y: child.y,
        });
      }
      this.measure();
    }
  }

  private dimensionalTransition(
    wasSpatial: boolean, wasInfluence: boolean, isSpatial: boolean, isInfluence: boolean,
  ): string | null {
    if (wasSpatial === isSpatial && wasInfluence === isInfluence) return null;
    if (wasSpatial && wasInfluence && isSpatial && !isInfluence) return "dual-active → spatial-only";
    if (wasSpatial && wasInfluence && !isSpatial && isInfluence) return "dual-active → influence-only";
    if (wasSpatial && !wasInfluence && !isSpatial && !isInfluence) return "spatial-only → dormant";
    if (!wasSpatial && wasInfluence && !isSpatial && !isInfluence) return "influence-only → dormant";
    return `${wasSpatial ? "spatial" : "non-spatial"}/${wasInfluence ? "influence" : "non-influence"} → ${isSpatial ? "spatial" : "non-spatial"}/${isInfluence ? "influence" : "non-influence"}`;
  }

  private createIntroducedEntity(origin: "initial" | "external arrival", tick: number): Entity {
    const traits = createFingerprint(this.random);
    return {
      ...traits,
      creationIndex: this.entities.length,
      creationTimestamp: tick,
      origin,
      birthTick: tick,
      parentRelationshipId: null,
      parentEntityIds: null,
      x: this.random.range(-WORLD_SPREAD / 2, WORLD_SPREAD / 2),
      y: this.random.range(-WORLD_SPREAD / 2, WORLD_SPREAD / 2),
      vx: this.random.range(-0.035, 0.035),
      vy: this.random.range(-0.035, 0.035),
      energy: 0,
      age: 0,
      neighborCount: 0,
      strongestRelationship: 0,
      strongestBond: 0,
    };
  }

  private measure(): void {
    let alpha = 0, beta = 0, gamma = 0, speed = 0, density = 0;
    for (const entity of this.entities) {
      alpha += entity.alpha;
      beta += entity.beta;
      gamma += entity.gamma;
      speed += Math.hypot(entity.vx, entity.vy);
      density += entity.neighborCount;
    }
    const count = this.entities.length || 1;
    this.state.worldAlpha = alpha / count;
    this.state.worldBeta = beta / count;
    this.state.worldGamma = gamma / count;
    this.state.averageSpeed = speed / count;
    this.state.averageLocalDensity = density / count;
    this.state.activeBonds = this.bonds.size;
    const relationships = [...this.relationshipLayer.entities.values()];
    this.state.activeRelationshipEntities = relationships.length;
    this.state.averageRelationshipAge = relationships.length
      ? relationships.reduce((sum, entity) => sum + entity.age, 0) / relationships.length : 0;
    this.state.averageCoherence = relationships.length
      ? relationships.reduce((sum, entity) => sum + entity.coherence, 0) / relationships.length : 0;
    this.state.activeHigherOrderInteractions = this.higherOrderPhysics.activeInteractions.length;
    const spatial = relationships.filter((entity) => entity.spatialActive);
    const influential = relationships.filter((entity) => entity.influenceActive);
    const dual = relationships.filter((entity) => entity.spatialActive && entity.influenceActive);
    this.state.spatiallyActiveRelationships = spatial.length;
    this.state.influenceActiveRelationships = influential.length;
    this.state.dualActiveRelationships = dual.length;
    this.state.influenceOnlyRelationships = relationships.filter(
      (entity) => !entity.spatialActive && entity.influenceActive,
    ).length;
    this.state.dormantRelationships = relationships.filter(
      (entity) => !entity.spatialActive && !entity.influenceActive,
    ).length;
    this.state.averageSynergy = dual.length
      ? dual.reduce((sum, entity) => sum + entity.synergy, 0) / dual.length : 0;
    this.state.averageFieldPotential = spatial.length
      ? spatial.reduce((sum, entity) => sum + entity.localFieldPotential, 0) / spatial.length : 0;
    this.state.maximumFieldPotential = spatial.reduce(
      (maximum, entity) => Math.max(maximum, entity.localFieldPotential), 0,
    );
    this.state.averageFieldGradient = spatial.length
      ? spatial.reduce((sum, entity) => sum + entity.localFieldGradientMagnitude, 0) / spatial.length : 0;
    this.state.maximumFieldGradient = spatial.reduce(
      (maximum, entity) => Math.max(maximum, entity.localFieldGradientMagnitude), 0,
    );
  }
}
