import type { Entity } from "./entity";
import type { Bond } from "./physics";
import type { RelationshipEntity } from "./relationshipEntity";

export const compareEntityIdentity = (a: Pick<Entity, "creationIndex">, b: Pick<Entity, "creationIndex">): number =>
  a.creationIndex - b.creationIndex;
export const compareRelationshipIdentity = (a: Pick<RelationshipEntity, "id">, b: Pick<RelationshipEntity, "id">): number =>
  a.id.localeCompare(b.id);
export const compareStringEntryKey = <T>(a: readonly [string, T], b: readonly [string, T]): number =>
  a[0].localeCompare(b[0]);

export const orderedEntities = (entities: readonly Entity[]): Entity[] => [...entities].sort(compareEntityIdentity);
export const orderedRelationships = (relationships: Iterable<RelationshipEntity>): RelationshipEntity[] =>
  [...relationships].sort(compareRelationshipIdentity);
export const orderedBonds = (bonds: ReadonlyMap<string, Bond>): [string, Bond][] =>
  [...bonds.entries()].sort(compareStringEntryKey);
