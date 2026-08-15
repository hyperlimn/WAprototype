import type { Universe } from "../simulation/universe";
import type { Occurrence } from "../simulation/occurrenceLog";
import { sha256Hex } from "../simulation/sha256";
import type { ComparisonEntity, ComparisonOccurrence, ComparisonRelationship, PrimaryComparisonFrame } from "./types";

export interface CorrespondenceContext { originStateHash: string; originEntityCount: number; }

export function entityCausalKeys(universe: Universe, context: CorrespondenceContext): Map<number,string> {
  const keys = new Map<number,string>();
  const resolve = (id: number): string => {
    const prior = keys.get(id); if (prior) return prior;
    const entity = universe.entities[id]; if (!entity) return `missing:${id}`;
    let key: string;
    if (id < context.originEntityCount) key = `origin:${context.originStateHash}:entity:${id}`;
    else if (entity.origin === "external arrival") key = `external:${entity.birthTick}:${entity.fingerprint}`;
    else {
      const parents = entity.parentEntityIds?.map(resolve).sort() ?? ["unknown","unknown"];
      // The child fingerprint already incorporates the authoritative per-relationship
      // reproduction ordinal. Use the causal parent pair rather than a local relationship ID.
      key = `descendant:${sha256Hex(`${parents[0]}\0${parents[1]}\0${relationshipCausalKey(parents[0],parents[1])}\0${entity.birthTick}\0${entity.fingerprint}`)}`;
    }
    keys.set(id,key); return key;
  };
  for (const entity of universe.entities) resolve(entity.creationIndex);
  return keys;
}

export const relationshipCausalKey = (a: string,b: string): string => { const pair=[a,b].sort(); return `relationship:${sha256Hex(`${pair[0]}\0${pair[1]}`)}`; };

function occurrenceSignature(record: Occurrence, entityKeys: Map<number,string>, relationshipKeys: Map<string,string>): string {
  const entities = [record.entityId, ...(record.parentEntityIds ?? [])].filter((id): id is number => id !== undefined).map((id) => entityKeys.get(id) ?? `missing:${id}`).sort();
  const relationship = record.relationshipId ? relationshipKeys.get(record.relationshipId) ?? record.relationshipId : "";
  return sha256Hex([record.tick, record.type, ...entities, relationship, record.transition ?? "", record.lawEvolutionId ?? ""].join("\0"));
}

export function buildComparisonFrame(universe: Universe, context: CorrespondenceContext): PrimaryComparisonFrame {
  const keys=entityCausalKeys(universe,context), relationshipKeys=new Map<string,string>();
  const entities:ComparisonEntity[]=universe.entities.map((entity)=>({localId:entity.creationIndex,causalKey:keys.get(entity.creationIndex)!,x:entity.x,y:entity.y,fingerprint:entity.fingerprint}));
  const relationships:ComparisonRelationship[]=[...universe.relationshipLayer.entities.values()].map((relationship)=>{
    const parentKeys:[string,string]=[keys.get(relationship.parentAId)!,keys.get(relationship.parentBId)!].sort() as [string,string];
    const causalKey=relationshipCausalKey(...parentKeys); relationshipKeys.set(relationship.id,causalKey);
    return{localId:relationship.id,causalKey,parentKeys,spatialActive:relationship.spatialActive,influenceActive:relationship.influenceActive,bondStrength:relationship.bondStrength,coherence:relationship.coherence};
  });
  const occurrences:ComparisonOccurrence[]=universe.occurrences.records.map((record)=>({tick:record.tick,signature:occurrenceSignature(record,keys,relationshipKeys)}));
  return{tick:universe.state.ticks,entities,relationships,occurrences,lawSetHash:universe.lawEvolution.activeManifest.manifestHash};
}
