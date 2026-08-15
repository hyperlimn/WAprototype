import type { Entity } from "./entity";
import type { OccurrenceLog, RuptureOccurrenceData } from "./occurrenceLog";
import type { Bond } from "./physics";
import type { RelationshipEntity } from "./relationshipEntity";
import type { WorldState } from "./worldState";

const normalized = (fingerprint: string, start: number): number =>
  parseInt(fingerprint.slice(start, start + 4), 16) / 0xffff;

export interface RuptureParameters {
  densityThreshold: number;
  internalEnergyThreshold: number;
  minimumAge: number;
  ruptureSensitivity: number;
  requiredBondStrength: number;
  repulsionMagnitude: number;
  cooldown: number;
}

export interface RuptureEvent extends RuptureOccurrenceData {
  readonly tick: number;
  readonly relationshipId: string;
  readonly parentEntityIds: readonly [number, number];
  readonly x: number;
  readonly y: number;
}

export const ruptureParameters = (fingerprint: string): RuptureParameters => {
  const sensitivity = 0.55 + 0.45 * normalized(fingerprint, 52);
  return {
    // Previously unused characters 41-64 (zero-based offsets 40-63).
    densityThreshold: 5 + Math.floor(normalized(fingerprint, 40) * 8),
    internalEnergyThreshold: 0.0004 + 0.0026 * normalized(fingerprint, 44),
    minimumAge: Math.round(6_000 + 18_000 * normalized(fingerprint, 48)),
    ruptureSensitivity: sensitivity,
    requiredBondStrength: 0.52 + 0.34 * sensitivity,
    repulsionMagnitude: 0.16 + 0.34 * normalized(fingerprint, 56),
    cooldown: Math.round(8_000 + 22_000 * normalized(fingerprint, 60)),
  };
};

export class RuptureSystem {
  readonly recentEvents: RuptureEvent[] = [];
  private readonly eventTicks: number[] = [];

  continuationState(): { recentEvents: RuptureEvent[]; eventTicks: number[] } {
    return { recentEvents: structuredClone(this.recentEvents), eventTicks: [...this.eventTicks] };
  }
  restoreContinuationState(value: { recentEvents: RuptureEvent[]; eventTicks: number[] }): void {
    this.recentEvents.splice(0, this.recentEvents.length, ...structuredClone(value.recentEvents));
    this.eventTicks.splice(0, this.eventTicks.length, ...value.eventTicks);
  }

  update(
    relationships: RelationshipEntity[], entities: Entity[], bonds: Map<string, Bond>,
    state: WorldState, occurrences: OccurrenceLog,
  ): void {
    const ordered = [...relationships].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let qualified = 0;
    for (const relationship of ordered) {
      const parameters = ruptureParameters(relationship.fingerprint);
      const cooldownElapsed = relationship.lastRuptureTick === null
        || state.ticks - relationship.lastRuptureTick >= parameters.cooldown;
      relationship.ruptureQualified = relationship.bondStrength >= parameters.requiredBondStrength
        && relationship.localRelationshipDensity >= parameters.densityThreshold
        && relationship.internalEnergy >= parameters.internalEnergyThreshold
        && relationship.age >= parameters.minimumAge
        && cooldownElapsed;
      if (!relationship.ruptureQualified) continue;
      qualified++;
      const bond = bonds.get(relationship.id);
      if (!bond) continue;

      const a = entities[relationship.parentAId];
      const b = entities[relationship.parentBId];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance <= 0) continue;
      const impulse = parameters.repulsionMagnitude;
      const ix = (b.x - a.x) / distance * impulse;
      const iy = (b.y - a.y) / distance * impulse;
      a.vx -= ix; a.vy -= iy;
      b.vx += ix; b.vy += iy;

      const bondStrengthAtTrigger = bond.strength;
      const weakeningFraction = 0.55 + 0.37 * parameters.ruptureSensitivity;
      bond.strength = Math.max(0, bond.strength * (1 - weakeningFraction));
      relationship.bondStrength = bond.strength;
      relationship.lastRuptureTick = state.ticks;
      relationship.ruptureCount++;
      relationship.ruptureQualified = false;

      const data: RuptureOccurrenceData = {
        density: relationship.localRelationshipDensity,
        internalEnergy: relationship.internalEnergy,
        bondStrengthAtTrigger,
        densityThreshold: parameters.densityThreshold,
        internalEnergyThreshold: parameters.internalEnergyThreshold,
        minimumAge: parameters.minimumAge,
        requiredBondStrength: parameters.requiredBondStrength,
        ruptureSensitivity: parameters.ruptureSensitivity,
        repulsionMagnitude: impulse,
        cooldown: parameters.cooldown,
        resultingBondStrength: bond.strength,
      };
      const event: RuptureEvent = {
        tick: state.ticks, relationshipId: relationship.id,
        parentEntityIds: [relationship.parentAId, relationship.parentBId],
        x: relationship.x, y: relationship.y, ...data,
      };
      this.recentEvents.push(event);
      if (this.recentEvents.length > 500) this.recentEvents.shift();
      this.eventTicks.push(state.ticks);
      state.totalRuptureEvents++;
      state.lastRuptureTick = state.ticks;
      occurrences.add({
        tick: state.ticks, type: "rupture",
        description: `rupture — relationship ${relationship.id}`,
        relationshipId: relationship.id,
        parentEntityIds: event.parentEntityIds,
        x: relationship.x, y: relationship.y, rupture: data,
      });
    }
    const firstTick = state.ticks - 10_000 + 1;
    while (this.eventTicks.length && this.eventTicks[0] < firstTick) this.eventTicks.shift();
    state.rupturesLast10000Ticks = this.eventTicks.length;
    state.currentlyQualifiedRuptureCandidates = qualified;
  }
}
