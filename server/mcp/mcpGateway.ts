import path from "node:path";
import { listUniverses } from "../memory/universeCatalog.js";
import { resolveUniverse } from "../memory/archiveSelection.js";
import { findNearestCheckpoint, getCheckpoint, listCheckpoints, queryHistoryPage, universeSummary } from "../memory/archiveQueries.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { memoryPolicyFromEnvironment } from "../../src/memory/memoryPolicy.js";
import { StateStore } from "../stateStore.js";
import { PerceptionService } from "../perception/perceptionService.js";
import { ObserverMemoryStore } from "../observer-memory/observerMemoryStore.js";

export class GatewayError extends Error { constructor(readonly status: number, readonly body: unknown) { super(`ProtoUniverse bridge returned ${status}`); } }

export interface Gateway {
  get(pathname: string, params?: Record<string, unknown>): Promise<any>;
  post(pathname: string, body: unknown): Promise<any>;
  patch(pathname: string, body: unknown): Promise<any>;
}

export class McpGateway {
  private readonly localMemory = new MemoryStore(path.resolve(process.env.PROTOUNIVERSE_MEMORY_ROOT ?? "data"), memoryPolicyFromEnvironment());
  private readonly localObserverMemory = new ObserverMemoryStore(path.join(this.localMemory.root, "observer-memory"));
  private readonly localPerception = new PerceptionService(new StateStore(), this.localMemory, this.localObserverMemory);
  constructor(readonly baseUrl = process.env.PROTOUNIVERSE_BRIDGE_URL ?? "http://127.0.0.1:8787") {}
  async get(pathname: string, params: Record<string, unknown> = {}): Promise<any> {
    const url = new URL(pathname, this.baseUrl);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    return this.request(url, { method: "GET" });
  }
  async post(pathname: string, body: unknown): Promise<any> {
    return this.write(pathname, body, "POST");
  }
  async patch(pathname: string, body: unknown): Promise<any> { return this.write(pathname, body, "PATCH"); }
  private async write(pathname: string, body: unknown, method: "POST" | "PATCH"): Promise<any> {
    try { return await this.request(new URL(pathname, this.baseUrl), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (error) {
      if (!(error instanceof GatewayError) || error.status !== 503) throw error;
      if (pathname === "/api/observer-memory") {
        const value = body as any; const entry = await this.localObserverMemory.remember({ observer: value.observer, universe: value.universe, kind: value.kind, content: value.content, universeTick: value.universeTick, tags: value.tags, references: value.references });
        return { schemaVersion: "protouniverse-observer-memory/1", entry, effect: "observer-memory-only", authoritativeUniverseChanged: false };
      }
      if (pathname.startsWith("/api/observer-memory/")) {
        const value = body as any, id = decodeURIComponent(pathname.slice("/api/observer-memory/".length)); const entry = await this.localObserverMemory.update(value.observer, value.universe, id, value);
        return { schemaVersion: "protouniverse-observer-memory/1", entry, effect: "observer-memory-only", authoritativeUniverseChanged: false };
      }
      if (pathname !== "/api/perception/mark-observed") throw error;
      const value = body as { observer: string; seed: string; tick: number };
      return { perceptionSchemaVersion: "protouniverse-perception/1", observerMetadata: await this.localPerception.observers.markObserved(value.observer, value.seed, value.tick), effect: "observer-metadata-only" };
    }
  }
  private async request(url: URL, init: RequestInit): Promise<any> {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      const body = await response.json(); if (!response.ok) throw new GatewayError(response.status, body); return body;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      try { return await this.localArchiveRequest(url); }
      catch { throw new GatewayError(503, { error: "bridge_unavailable", message: "The localhost bridge is unavailable and the requested operation could not be resolved from persisted archives." }); }
    }
  }
  private async localArchiveRequest(url: URL): Promise<any> {
    const seed = url.searchParams.get("seed") ?? undefined, catalog = await listUniverses(this.localMemory.root);
    const number = (name: string) => url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined;
    if (url.pathname === "/api/universes") return { resultCount: catalog.universes.length, results: catalog.universes.map((item) => item.metadata), warnings: catalog.warnings };
    const universe = url.pathname.match(/^\/api\/universe\/([^/]+)$/);
    if (universe) { const archive = resolveUniverse(catalog, decodeURIComponent(universe[1]), null); return universeSummary(archive, null); }
    if (url.pathname === "/api/perception/orient") return this.localPerception.orient(seed, url.searchParams.get("observer") ?? undefined);
    if (url.pathname === "/api/perception/since-last") return this.localPerception.sinceLast(String(url.searchParams.get("observer")), seed);
    if (url.pathname === "/api/observer-memory") return this.localObserverMemory.recall(String(url.searchParams.get("observer")), String(url.searchParams.get("universe") ?? seed), {
      kind: (url.searchParams.get("kind") ?? undefined) as any, status: (url.searchParams.get("status") ?? undefined) as any, limit: number("limit") });
    const archive = resolveUniverse(catalog, seed, null);
    if (url.pathname === "/api/history") return queryHistoryPage(archive, { sinceTick: number("sinceTick"), untilTick: number("untilTick"),
      type: url.searchParams.get("type") ?? undefined, entityId: number("entityId"), relationshipId: url.searchParams.get("relationshipId") ?? undefined,
      limit: number("limit") ?? 100 }, url.searchParams.get("cursor") ?? undefined);
    if (url.pathname === "/api/checkpoints") { const results = listCheckpoints(archive, number("sinceTick"), number("untilTick"), number("limit") ?? 100); return { seed: archive.manifest.seed, resultCount: results.length, results }; }
    const exact = url.pathname.match(/^\/api\/checkpoint\/(\d+)$/);
    if (exact) { const checkpoint = await getCheckpoint(archive, Number(exact[1])); if (!checkpoint) throw new Error("not found"); return { seed: archive.manifest.seed, checkpoint }; }
    const nearest = url.pathname.match(/^\/api\/checkpoint\/nearest\/(\d+)$/);
    if (nearest) { const direction = (url.searchParams.get("direction") ?? "nearest") as "before" | "after" | "nearest"; const found = await findNearestCheckpoint(archive, Number(nearest[1]), direction); if (!found) throw new Error("not found"); return { seed: archive.manifest.seed, ...found }; }
    if (url.pathname === "/api/perception/inspect") return this.localPerception.inspect(seed, { kind: url.searchParams.get("kind") as any, id: url.searchParams.get("id") ?? undefined,
      x: number("x"), y: number("y"), radius: number("radius"), tick: number("tick"), sequence: number("sequence") }, number("depth") ?? 1);
    if (url.pathname === "/api/perception/context") return this.localPerception.context(seed, { kind: url.searchParams.get("kind") as any, id: url.searchParams.get("id") ?? undefined,
      x: number("x"), y: number("y"), radius: number("radius"), tick: number("tick"), sequence: number("sequence") });
    throw new Error("unsupported offline archive operation");
  }
}
