import { currentTick, type OccurrenceRecord, type QueryResponse, type QuerySnapshot } from "./queryTypes.js";

export const OCCURRENCE_TYPES = ["external-arrival", "reproduction", "relationship-formed", "relationship-destroyed", "rupture", "dimensional-transition"] as const;

export interface EventQueryParams { type?: string; sinceTick?: number; untilTick?: number; entityId?: number; relationshipId?: string; limit: number }

export function queryEvents(snapshot: QuerySnapshot, events: readonly OccurrenceRecord[], params: EventQueryParams,
  interfaceVersion: string): QueryResponse<OccurrenceRecord[], EventQueryParams> {
  const filtered = events.filter((event) => (params.type === undefined || event.type === params.type)
    && (params.sinceTick === undefined || event.tick >= params.sinceTick)
    && (params.untilTick === undefined || event.tick <= params.untilTick)
    && (params.entityId === undefined || event.entityId === params.entityId || event.parentEntityIds?.includes(params.entityId) === true)
    && (params.relationshipId === undefined || event.relationshipId === params.relationshipId));
  const selected = filtered.slice(-params.limit).reverse();
  return { interfaceVersion, currentTick: currentTick(snapshot), query: params, resultCount: selected.length,
    truncated: filtered.length > params.limit, results: selected };
}
