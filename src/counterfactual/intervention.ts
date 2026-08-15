import type { Universe } from "../simulation/universe";
import { sha256Hex } from "../simulation/sha256";
import { COUNTERFACTUAL_INTERVENTION_VERSION, type CounterfactualIntervention, type ImpulseVector } from "./types";

export const COUNTERFACTUAL_IMPULSE_PRESETS={subtle:.025,moderate:.075,strong:.175} as const;
/** Covers the strongest supported presentation combination (0.175 × 20 = 3.5)
 * with explicit finite headroom. Only the final vector enters authority. */
export const COUNTERFACTUAL_MAXIMUM_IMPULSE=4;
export const COUNTERFACTUAL_MAXIMUM_DISPLACEMENT=500;

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)])) : value;
export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));

export function validateImpulse(value: ImpulseVector): void {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) throw new Error("Impulse components must be finite");
  if (Math.abs(value.x) > COUNTERFACTUAL_MAXIMUM_IMPULSE || Math.abs(value.y) > COUNTERFACTUAL_MAXIMUM_IMPULSE) throw new Error(`Impulse component exceeds ${COUNTERFACTUAL_MAXIMUM_IMPULSE} world-units/tick`);
  const magnitude = Math.hypot(value.x, value.y);
  if (!(magnitude > 0) || magnitude > COUNTERFACTUAL_MAXIMUM_IMPULSE + Number.EPSILON) throw new Error(`Impulse magnitude must be greater than zero and at most ${COUNTERFACTUAL_MAXIMUM_IMPULSE} world-units/tick`);
}
export function validateDisplacement(value:ImpulseVector):void{if(!Number.isFinite(value?.x)||!Number.isFinite(value?.y))throw new Error("Displacement components must be finite");const magnitude=Math.hypot(value.x,value.y);if(!(magnitude>0)||magnitude>COUNTERFACTUAL_MAXIMUM_DISPLACEMENT+Number.EPSILON)throw new Error(`Displacement magnitude must be greater than zero and at most ${COUNTERFACTUAL_MAXIMUM_DISPLACEMENT} world units`);}

export function resolveCanonicalCluster(universe: Universe, anchorEntityId: number): number[] {
  if (!Number.isInteger(anchorEntityId) || !universe.entities[anchorEntityId]) throw new Error("Counterfactual anchor entity does not exist");
  const members = new Set<number>([anchorEntityId]);
  for (const relationship of universe.relationshipLayer.entities.values()) {
    if (relationship.parentAId === anchorEntityId) members.add(relationship.parentBId);
    else if (relationship.parentBId === anchorEntityId) members.add(relationship.parentAId);
  }
  const resolved = [...members].sort((a,b) => a-b);
  if (resolved.length > 32) throw new Error(`Connected cluster has ${resolved.length} members; Counterfactual limit is 32`);
  return resolved;
}

export function validateIntervention(value: CounterfactualIntervention, universe?: Universe): CounterfactualIntervention {
  if (!value || value.schemaVersion !== COUNTERFACTUAL_INTERVENTION_VERSION) throw new Error("Unsupported counterfactual intervention");
  if(value.kind==="relationship-sever"){if(typeof value.target.relationshipId!=="string"||!/^[0-9]+:[0-9]+$/.test(value.target.relationshipId))throw new Error("Invalid relationship target");if(universe&&!universe.relationshipLayer.entities.has(value.target.relationshipId))throw new Error("Relationship target does not exist");return structuredClone(value);}
  if(value.kind==="entity-impulse"||value.kind==="cluster-impulse")validateImpulse(value.deltaVelocity);
  else if(value.kind==="entity-displace"||value.kind==="cluster-displace")validateDisplacement(value.deltaPosition);
  else if(value.kind==="cluster-radial-pulse"){validateImpulse({x:value.magnitude,y:0});if(!["expand","compress"].includes(value.mode))throw new Error("Invalid radial mode");}
  else if(value.kind==="cluster-spin"){validateImpulse({x:value.magnitude,y:0});if(!["clockwise","counterclockwise"].includes(value.direction))throw new Error("Invalid spin direction");}
  else throw new Error("Unsupported counterfactual intervention");
  const ids = value.kind === "entity-impulse"||value.kind==="entity-displace" ? [value.target.entityId] : value.target.resolvedEntityIds;
  if (!ids.length || ids.length > 32 || ids.some((id) => !Number.isInteger(id) || id < 0) || new Set(ids).size !== ids.length) throw new Error("Invalid intervention target membership");
  if (value.kind !== "entity-impulse"&&value.kind!=="entity-displace" && (ids.some((id,index) => index > 0 && ids[index-1] >= id) || !ids.includes(value.target.anchorEntityId))) throw new Error("Cluster membership must be unique, sorted, and include its anchor");
  if (universe) {
    if (ids.some((id) => !universe.entities[id])) throw new Error("Intervention target does not exist");
    if (value.kind !== "entity-impulse"&&value.kind!=="entity-displace" && canonicalJson(resolveCanonicalCluster(universe, value.target.anchorEntityId)) !== canonicalJson(ids)) throw new Error("Cluster membership does not match origin topology");
  }
  return structuredClone(value);
}

export function interventionHash(value: CounterfactualIntervention): string { return sha256Hex(`protouniverse/intervention/2\0${canonicalJson(value)}`); }
export function applyIntervention(universe: Universe, value: CounterfactualIntervention): void {
  const intervention = validateIntervention(value, universe);
  if(intervention.kind==="relationship-sever"){universe.severRelationship(intervention.target.relationshipId);return;}
  const ids = intervention.kind === "entity-impulse"||intervention.kind==="entity-displace" ? [intervention.target.entityId] : intervention.target.resolvedEntityIds;
  if(intervention.kind==="entity-impulse"||intervention.kind==="cluster-impulse")for(const id of ids){universe.entities[id].vx+=intervention.deltaVelocity.x;universe.entities[id].vy+=intervention.deltaVelocity.y;}
  else if(intervention.kind==="entity-displace"||intervention.kind==="cluster-displace")for(const id of ids){universe.entities[id].x+=intervention.deltaPosition.x;universe.entities[id].y+=intervention.deltaPosition.y;}
  else{const center=ids.reduce((sum,id)=>({x:sum.x+universe.entities[id].x/ids.length,y:sum.y+universe.entities[id].y/ids.length}),{x:0,y:0});for(const id of ids){const entity=universe.entities[id],dx=entity.x-center.x,dy=entity.y-center.y,length=Math.hypot(dx,dy);if(length===0)continue;const nx=dx/length,ny=dy/length;if(intervention.kind==="cluster-radial-pulse"){const sign=intervention.mode==="expand"?1:-1;entity.vx+=nx*intervention.magnitude*sign;entity.vy+=ny*intervention.magnitude*sign;}else{const sign=intervention.direction==="clockwise"?1:-1;entity.vx+=ny*intervention.magnitude*sign;entity.vy-=nx*intervention.magnitude*sign;}}}
}

export function interventionSummary(value:CounterfactualIntervention):string{switch(value.kind){case"entity-impulse":return`entity ${value.target.entityId} impulse (${value.deltaVelocity.x}, ${value.deltaVelocity.y})`;case"cluster-impulse":return`cluster ${value.target.anchorEntityId} impulse (${value.deltaVelocity.x}, ${value.deltaVelocity.y})`;case"entity-displace":return`entity ${value.target.entityId} displace (${value.deltaPosition.x}, ${value.deltaPosition.y})`;case"cluster-displace":return`cluster ${value.target.anchorEntityId} displace (${value.deltaPosition.x}, ${value.deltaPosition.y})`;case"cluster-radial-pulse":return`cluster ${value.target.anchorEntityId} ${value.mode} ${value.magnitude}`;case"cluster-spin":return`cluster ${value.target.anchorEntityId} spin ${value.direction} ${value.magnitude}`;case"relationship-sever":return`sever relationship ${value.target.relationshipId}`;}}
