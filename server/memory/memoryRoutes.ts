import type { ServerResponse } from "node:http";
import { OCCURRENCE_TYPES } from "../../src/query/eventQueries.js";
import type { HistoryQuery } from "../../src/memory/memoryTypes.js";
import type { MemoryStore } from "./memoryStore.js";
import { enumValue, optionalNumber, optionalString, QueryValidationError, queryLimit } from "../queryValidation.js";
import { resolveUniverse } from "./archiveSelection.js";
import { archiveStatus, findNearestCheckpoint, getCheckpoint, listCheckpoints, queryHistoryPage,
  summarizeArchiveHistory, universeSummary } from "./archiveQueries.js";
import { listUniverses } from "./universeCatalog.js";

type JsonWriter = (response: ServerResponse, status: number, body: unknown) => void;
const DIRECTIONS = ["before", "after", "nearest"] as const;

const range = (url: URL): { sinceTick?: number; untilTick?: number } => {
  const sinceTick = optionalNumber(url, "sinceTick", { integer: true, min: 0 });
  const untilTick = optionalNumber(url, "untilTick", { integer: true, min: 0 });
  if (sinceTick !== undefined && untilTick !== undefined && sinceTick > untilTick) {
    throw new QueryValidationError("sinceTick", String(sinceTick), "must not exceed untilTick");
  }
  return { sinceTick, untilTick };
};

export async function handleMemoryRoute(url: URL, response: ServerResponse, memory: MemoryStore,
  recentCacheCount: number, json: JsonWriter): Promise<boolean> {
  if (url.pathname === "/api/universes") {
    const catalog = await listUniverses(memory.root);
    json(response, 200, { resultCount: catalog.universes.length, results: catalog.universes.map((item) => item.metadata), warnings: catalog.warnings }); return true;
  }
  const universeMatch = url.pathname.match(/^\/api\/universe\/([^/]+)$/);
  if (universeMatch) {
    const catalog = await listUniverses(memory.root);
    const archive = resolveUniverse(catalog, decodeURIComponent(universeMatch[1]), memory.activeSeed);
    json(response, 200, universeSummary(archive, memory.activeSeed)); return true;
  }
  const historicalRoute = url.pathname === "/api/memory/status" || url.pathname === "/api/history"
    || url.pathname === "/api/history/summary" || url.pathname === "/api/checkpoints"
    || /^\/api\/checkpoint\/(?:nearest\/)?\d+$/.test(url.pathname)
    || /^\/api\/history\/(?:entity\/\d+|relationship\/.+)$/.test(url.pathname);
  if (!historicalRoute) return false;
  const catalog = await listUniverses(memory.root);
  const archive = resolveUniverse(catalog, optionalString(url, "seed"), memory.activeSeed);
  if (url.pathname === "/api/memory/status") { json(response, 200, archiveStatus(archive, recentCacheCount, memory.activeSeed)); return true; }
  if (url.pathname === "/api/history" || /^\/api\/history\/(?:entity\/\d+|relationship\/.+)$/.test(url.pathname)) {
    const type = optionalString(url, "type");
    if (type !== undefined) enumValue(url, "type", OCCURRENCE_TYPES, OCCURRENCE_TYPES[0]);
    const entity = url.pathname.match(/^\/api\/history\/entity\/(\d+)$/);
    const relationship = url.pathname.match(/^\/api\/history\/relationship\/(.+)$/);
    const query: HistoryQuery = { ...range(url), type,
      entityId: entity ? Number(entity[1]) : optionalNumber(url, "entityId", { integer: true, min: 0 }),
      relationshipId: relationship ? decodeURIComponent(relationship[1]) : optionalString(url, "relationshipId"), limit: queryLimit(url) };
    json(response, 200, await queryHistoryPage(archive, query, optionalString(url, "cursor"))); return true;
  }
  if (url.pathname === "/api/history/summary") {
    const query = range(url); json(response, 200, { seed: archive.manifest.seed, query,
      results: await summarizeArchiveHistory(archive, query.sinceTick, query.untilTick) }); return true;
  }
  if (url.pathname === "/api/checkpoints") {
    const query = range(url), limit = queryLimit(url);
    const results = listCheckpoints(archive, query.sinceTick, query.untilTick, limit);
    json(response, 200, { seed: archive.manifest.seed, query: { ...query, limit }, resultCount: results.length, results }); return true;
  }
  const nearest = url.pathname.match(/^\/api\/checkpoint\/nearest\/(\d+)$/);
  if (nearest) {
    const tick = Number(nearest[1]), direction = enumValue(url, "direction", DIRECTIONS, "nearest");
    const result = await findNearestCheckpoint(archive, tick, direction);
    json(response, result ? 200 : 404, result ? { seed: archive.manifest.seed, query: { tick, direction }, ...result }
      : { error: "not_found", resource: "checkpoint", seed: archive.manifest.seed, tick, direction }); return true;
  }
  const exact = url.pathname.match(/^\/api\/checkpoint\/(\d+)$/)!;
  const tick = Number(exact[1]), checkpoint = await getCheckpoint(archive, tick);
  json(response, checkpoint ? 200 : 404, checkpoint ? { seed: archive.manifest.seed, checkpoint }
    : { error: "not_found", resource: "checkpoint", seed: archive.manifest.seed, tick }); return true;
}
