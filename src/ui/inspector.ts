import type { Entity } from "../simulation/entity";
import type { RelationshipEntity } from "../simulation/relationshipEntity";
import { ruptureParameters } from "../simulation/rupture";

const row = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

export function updateInspector(element: HTMLElement, entity: Entity | null): void {
  if (!entity) {
    element.innerHTML = `<h2>Entity inspector</h2><p class="empty">Select a point to inspect its immutable fingerprint and current state.</p>`;
    return;
  }
  element.innerHTML = `<h2>Entity ${entity.creationIndex.toString().padStart(3, "0")}</h2>
    <p class="fingerprint">${entity.fingerprint}</p>
    <dl>${[
      row("alpha", entity.alpha.toFixed(6)),
      row("beta", entity.beta.toFixed(6)),
      row("gamma", entity.gamma.toFixed(6)),
      row("Origin type", entity.origin === "external arrival" ? "external" : entity.origin),
      row("Birth tick", String(entity.birthTick)),
      row("Parent relationship", entity.parentRelationshipId ?? "none"),
      row("Parent entity IDs", entity.parentEntityIds ? `${entity.parentEntityIds[0]} + ${entity.parentEntityIds[1]}` : "none"),
      row("Age", entity.age.toFixed(1)),
      row("Energy", entity.energy.toFixed(7)),
      row("Velocity", `${entity.vx.toFixed(4)}, ${entity.vy.toFixed(4)}`),
      row("Neighbors", String(entity.neighborCount)),
      row("Strongest relation", entity.strongestRelationship.toFixed(5)),
      row("Strongest bond", entity.strongestBond.toFixed(5)),
    ].join("")}</dl>`;
}

export function updateRelationshipInspector(
  element: HTMLElement,
  entity: RelationshipEntity,
  parents: [Entity, Entity],
): void {
  const rupture = ruptureParameters(entity.fingerprint);
  element.innerHTML = `<h2>Relationship ${entity.id}</h2>
    <p class="fingerprint">${entity.fingerprint}</p>
    <dl>${[
      row("Parent A", `${entity.parentAId} / ${parents[0].fingerprint.slice(0, 12)}…`),
      row("Parent B", `${entity.parentBId} / ${parents[1].fingerprint.slice(0, 12)}…`),
      row("Creation tick", String(entity.creationTick)),
      row("Age", entity.age.toFixed(1)),
      row("Spatial duration", `${entity.spatialDuration} ticks`),
      row("Influence duration", `${entity.influenceDuration} ticks`),
      row("Spatial active", entity.spatialActive ? "yes" : "no"),
      row("Influence active", entity.influenceActive ? "yes" : "no"),
      row("Synergy", entity.synergy.toFixed(5)),
      row("Field source", entity.fieldSourceStrength.toFixed(7)),
      row("Field potential", entity.localFieldPotential.toFixed(7)),
      row("Field gradient", entity.localFieldGradientMagnitude.toFixed(9)),
      row("Bond strength", entity.bondStrength.toFixed(5)),
      row("Relationship", entity.relationshipStrength.toFixed(5)),
      row("Distance", entity.distance.toFixed(4)),
      row("Orientation", `${entity.orientation.toFixed(5)} rad`),
      row("Relative velocity", `${entity.relativeVx.toFixed(4)}, ${entity.relativeVy.toFixed(4)}`),
      row("Internal energy", entity.internalEnergy.toFixed(7)),
      row("Coherence", entity.coherence.toFixed(5)),
      row("Rupture qualified", entity.ruptureQualified ? "yes" : "no"),
      row("Rupture count", String(entity.ruptureCount)),
      row("Last rupture tick", entity.lastRuptureTick === null ? "—" : String(entity.lastRuptureTick)),
      row("Rupture density threshold", String(rupture.densityThreshold)),
      row("Rupture energy threshold", rupture.internalEnergyThreshold.toFixed(7)),
      row("Rupture minimum age", String(rupture.minimumAge)),
      row("Rupture bond threshold", rupture.requiredBondStrength.toFixed(5)),
      row("Reproduction eligible", entity.reproductionEligible ? "yes" : "no"),
      row("Next eligible tick", String(entity.nextEligibleTick)),
      row("Reproduction count", String(entity.reproductionCount)),
    ].join("")}</dl>`;
}
