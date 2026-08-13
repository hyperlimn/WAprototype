import type { ServerResponse } from "node:http";
import { queryDiscover } from "../src/query/discoveryQueries.js";
import { queryEntities, queryEntityLineage, queryEntityNeighbors } from "../src/query/entityQueries.js";
import { queryEvents, OCCURRENCE_TYPES } from "../src/query/eventQueries.js";
import { queryRelationships } from "../src/query/relationshipQueries.js";
import { queryRegion } from "../src/query/spatialQueries.js";
import type { EntityQueryParams, RelationshipQueryParams } from "../src/query/queryTypes.js";
import { INTERFACE_VERSION } from "./types.js";
import type { StateStore } from "./stateStore.js";
import { enumValue, optionalBoolean, optionalNumber, optionalString, QueryValidationError, queryLimit, requiredNumber } from "./queryValidation.js";

type JsonWriter = (response: ServerResponse, status: number, body: unknown) => void;

const ENTITY_SORTS = ["age-desc", "energy-desc", "neighbors-desc", "bond-desc", "relationship-desc", "id-asc"] as const;
const RELATIONSHIP_SORTS = ["age-desc", "bond-desc", "coherence-desc", "density-desc", "synergy-desc", "id-asc"] as const;

const validateRange = (minimum: number | undefined, maximum: number | undefined, parameter: string): void => {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new QueryValidationError(parameter, String(minimum), `must not exceed ${parameter.replace(/^min/, "max")}`);
  }
};

export const isSnapshotRoute = (pathname: string): boolean =>
  ["/api/entities", "/api/relationships", "/api/region", "/api/events/search", "/api/discover"].includes(pathname)
  || /^\/api\/entity\/\d+(?:\/neighbors|\/lineage)?$/.test(pathname)
  || /^\/api\/relationship\/.+$/.test(pathname);

export function handleQueryRoute(url: URL, response: ServerResponse, store: StateStore, json: JsonWriter): boolean {
  const snapshot = store.snapshot;
  if (!snapshot) return false;
  if (url.pathname === "/api/entities") {
    const params: EntityQueryParams = {
      origin: optionalString(url, "origin"), minAge: optionalNumber(url, "minAge", { min: 0 }),
      maxAge: optionalNumber(url, "maxAge", { min: 0 }), minEnergy: optionalNumber(url, "minEnergy"),
      minNeighbors: optionalNumber(url, "minNeighbors", { integer: true, min: 0 }),
      minStrongestBond: optionalNumber(url, "minStrongestBond"),
      minStrongestRelationship: optionalNumber(url, "minStrongestRelationship"),
      relationshipId: optionalString(url, "relationshipId"), limit: queryLimit(url),
      sort: enumValue(url, "sort", ENTITY_SORTS, "id-asc"),
    };
    validateRange(params.minAge, params.maxAge, "minAge");
    json(response, 200, queryEntities(snapshot, params, INTERFACE_VERSION)); return true;
  }
  if (url.pathname === "/api/relationships") {
    const params: RelationshipQueryParams = {
      minAge: optionalNumber(url, "minAge", { min: 0 }), maxAge: optionalNumber(url, "maxAge", { min: 0 }),
      minBond: optionalNumber(url, "minBond"), minStrength: optionalNumber(url, "minStrength"),
      minCoherence: optionalNumber(url, "minCoherence"), minDensity: optionalNumber(url, "minDensity", { min: 0 }),
      minSynergy: optionalNumber(url, "minSynergy"), spatialActive: optionalBoolean(url, "spatialActive"),
      influenceActive: optionalBoolean(url, "influenceActive"), dormant: optionalBoolean(url, "dormant"),
      parentEntityId: optionalNumber(url, "parentEntityId", { integer: true, min: 0 }),
      ruptureEligible: optionalBoolean(url, "ruptureEligible"), limit: queryLimit(url),
      sort: enumValue(url, "sort", RELATIONSHIP_SORTS, "id-asc"),
    };
    validateRange(params.minAge, params.maxAge, "minAge");
    json(response, 200, queryRelationships(snapshot, params, INTERFACE_VERSION)); return true;
  }
  if (url.pathname === "/api/region") {
    const params = { x: requiredNumber(url, "x"), y: requiredNumber(url, "y"),
      radius: requiredNumber(url, "radius", { min: 0 }), limit: queryLimit(url) };
    json(response, 200, queryRegion(snapshot, store.events, params, INTERFACE_VERSION)); return true;
  }
  if (url.pathname === "/api/events/search") {
    const type = optionalString(url, "type");
    if (type !== undefined && !(OCCURRENCE_TYPES as readonly string[]).includes(type)) {
      enumValue(url, "type", OCCURRENCE_TYPES, OCCURRENCE_TYPES[0]);
    }
    const params = { type, sinceTick: optionalNumber(url, "sinceTick", { integer: true, min: 0 }),
      untilTick: optionalNumber(url, "untilTick", { integer: true, min: 0 }),
      entityId: optionalNumber(url, "entityId", { integer: true, min: 0 }), relationshipId: optionalString(url, "relationshipId"),
      limit: queryLimit(url) };
    if (params.sinceTick !== undefined && params.untilTick !== undefined && params.sinceTick > params.untilTick) {
      throw new QueryValidationError("sinceTick", String(params.sinceTick), "must not exceed untilTick");
    }
    json(response, 200, queryEvents(snapshot, store.events, params, INTERFACE_VERSION)); return true;
  }
  if (url.pathname === "/api/discover") {
    const size = optionalNumber(url, "limit", { integer: true, min: 1, max: 50 }) ?? 10;
    json(response, 200, queryDiscover(snapshot, store.events, INTERFACE_VERSION, size)); return true;
  }
  const neighbors = url.pathname.match(/^\/api\/entity\/(\d+)\/neighbors$/);
  if (neighbors) {
    const entity = store.entityById.get(Number(neighbors[1]));
    if (!entity) { json(response, 404, { error: "not_found", resource: "entity", id: neighbors[1] }); return true; }
    const params = { radius: optionalNumber(url, "radius", { min: 0 }) ?? 150, limit: queryLimit(url) };
    json(response, 200, queryEntityNeighbors(snapshot, store.indexes, entity, params, INTERFACE_VERSION)); return true;
  }
  const lineage = url.pathname.match(/^\/api\/entity\/(\d+)\/lineage$/);
  if (lineage) {
    const entity = store.entityById.get(Number(lineage[1]));
    if (!entity) { json(response, 404, { error: "not_found", resource: "entity", id: lineage[1] }); return true; }
    const depth = optionalNumber(url, "depth", { integer: true, min: 0, max: 10 }) ?? 3;
    json(response, 200, queryEntityLineage(snapshot, store.indexes, entity, depth, INTERFACE_VERSION)); return true;
  }
  return false;
}
