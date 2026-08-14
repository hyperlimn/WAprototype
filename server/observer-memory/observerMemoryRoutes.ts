import type { IncomingMessage, ServerResponse } from "node:http";
import type { ObserverMemoryKind, ObserverMemoryStatus, UniverseReference } from "../../src/observer-memory/observerMemoryTypes.js";
import { OBSERVER_MEMORY_KINDS } from "../../src/observer-memory/observerMemoryTypes.js";
import type { ObserverMemoryStore } from "./observerMemoryStore.js";
import { ObserverMemoryValidationError, validateKind, validateObserver, validateUniverse } from "./observerMemoryValidation.js";

type JsonWriter = (response: ServerResponse, status: number, body: unknown) => void;
const body = async (request: IncomingMessage): Promise<Record<string, unknown>> => { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of request) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > 64 * 1024) throw new ObserverMemoryValidationError("body", null, "must not exceed 64KB"); chunks.push(value); } try { const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed; } catch { throw new ObserverMemoryValidationError("body", null, "must be a valid JSON object"); } };
const status = (value: string | null): ObserverMemoryStatus | undefined => { if (value === null) return undefined; if (!(["open", "resolved", "superseded"] as string[]).includes(value)) throw new ObserverMemoryValidationError("status", value, "must be open, resolved, or superseded"); return value as ObserverMemoryStatus; };

export async function handleObserverMemoryRoute(request: IncomingMessage, url: URL, response: ServerResponse, store: ObserverMemoryStore, json: JsonWriter): Promise<boolean> {
  if (!url.pathname.startsWith("/api/observer-memory")) return false;
  if (request.method === "GET" && url.pathname === "/api/observer-memory") {
    const observer = validateObserver(url.searchParams.get("observer")), universe = validateUniverse(url.searchParams.get("universe") ?? url.searchParams.get("seed"));
    const kindValue = url.searchParams.get("kind"), kind = kindValue === null ? undefined : validateKind(kindValue), requestedLimit = Number(url.searchParams.get("limit") ?? 100);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) throw new ObserverMemoryValidationError("limit", requestedLimit, "must be an integer from 1 to 500");
    json(response, 200, await store.recall(observer, universe, { kind, status: status(url.searchParams.get("status")), limit: requestedLimit })); return true;
  }
  if (request.method === "POST" && url.pathname === "/api/observer-memory") {
    const value = await body(request); const observer = validateObserver(value.observer), universe = validateUniverse(value.universe ?? value.seed), kind = validateKind(value.kind);
    const entry = await store.remember({ observer, universe, kind, content: value.content as string, universeTick: value.universeTick as number | undefined,
      tags: value.tags as string[] | undefined, references: value.references as UniverseReference[] | undefined });
    json(response, 201, { schemaVersion: "protouniverse-observer-memory/1", observer, universe, entry, effect: "observer-memory-only", authoritativeUniverseChanged: false }); return true;
  }
  const match = url.pathname.match(/^\/api\/observer-memory\/([^/]+)$/);
  if (request.method === "PATCH" && match) {
    const value = await body(request), observer = validateObserver(value.observer), universe = validateUniverse(value.universe ?? value.seed);
    const entry = await store.update(observer, universe, decodeURIComponent(match[1]), { content: value.content as string | undefined, status: value.status as ObserverMemoryStatus | undefined,
      resolution: value.resolution as string | undefined, references: value.references as UniverseReference[] | undefined, note: value.note as string | undefined });
    json(response, 200, { schemaVersion: "protouniverse-observer-memory/1", observer, universe, entry, effect: "observer-memory-only", authoritativeUniverseChanged: false }); return true;
  }
  throw new ObserverMemoryValidationError("path", url.pathname, `unsupported observer-memory operation; kinds: ${OBSERVER_MEMORY_KINDS.join(", ")}`);
}
