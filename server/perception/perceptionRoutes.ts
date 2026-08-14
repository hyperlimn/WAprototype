import type { IncomingMessage, ServerResponse } from "node:http";
import type { PerceptionService } from "./perceptionService.js";
import type { InspectionTarget } from "../../src/perception/inspection.js";
import { PERCEPTION_LIMITS } from "../../src/perception/perceptionConfig.js";
import { enumValue, optionalNumber, optionalString, QueryValidationError, requiredNumber } from "../queryValidation.js";

type JsonWriter = (response: ServerResponse, status: number, body: unknown) => void;
const INSPECTION_KINDS = ["entity", "relationship", "region", "checkpoint", "event"] as const;
const SIMILAR_KINDS = ["entity", "relationship", "region"] as const;
const COMPARE_KINDS = ["entity", "relationship", "region", "checkpoint", "universe"] as const;

const target = (url: URL): InspectionTarget => {
  const kind = enumValue(url, "kind", INSPECTION_KINDS, "entity");
  if ((kind === "entity" || kind === "relationship") && !optionalString(url, "id")) throw new QueryValidationError("id", null, "is required");
  if (kind === "region") return { kind, x: requiredNumber(url, "x"), y: requiredNumber(url, "y"), radius: requiredNumber(url, "radius", { min: 0 }) };
  if (kind === "checkpoint") return { kind, tick: requiredNumber(url, "tick", { integer: true, min: 0 }) };
  if (kind === "event") return { kind, tick: requiredNumber(url, "tick", { integer: true, min: 0 }), sequence: requiredNumber(url, "sequence", { integer: true, min: 0 }) };
  return { kind, id: optionalString(url, "id") };
};

export const isPerceptionPath = (pathname: string): boolean => pathname.startsWith("/api/perception/");

export async function handlePerceptionRoute(url: URL, response: ServerResponse, service: PerceptionService, json: JsonWriter): Promise<boolean> {
  if (!isPerceptionPath(url.pathname)) return false;
  const seed = optionalString(url, "seed");
  if (url.pathname === "/api/perception/orient") { json(response, 200, await service.orient(seed, optionalString(url, "observer"))); return true; }
  if (url.pathname === "/api/perception/inspect") {
    const depth = optionalNumber(url, "depth", { integer: true, min: 1, max: PERCEPTION_LIMITS.maximumDepth }) ?? 1;
    json(response, 200, await service.inspect(seed, target(url), depth)); return true;
  }
  if (url.pathname === "/api/perception/context") { json(response, 200, await service.context(seed, target(url))); return true; }
  if (url.pathname === "/api/perception/changes") {
    json(response, 200, await service.changes({ seed, compareSeed: optionalString(url, "compareSeed"),
      checkpoint: optionalNumber(url, "checkpoint", { integer: true, min: 0 }), sinceTick: optionalNumber(url, "sinceTick", { integer: true, min: 0 }),
      tick: optionalNumber(url, "tick", { integer: true, min: 0 }) })); return true;
  }
  if (url.pathname === "/api/perception/anomalies") {
    const limit = optionalNumber(url, "limit", { integer: true, min: 1, max: PERCEPTION_LIMITS.maximumResults }) ?? 10;
    const hasRegion = url.searchParams.has("x") || url.searchParams.has("y") || url.searchParams.has("radius");
    const region = hasRegion ? { x: requiredNumber(url, "x"), y: requiredNumber(url, "y"), radius: requiredNumber(url, "radius", { min: 0 }) } : undefined;
    json(response, 200, await service.anomalies(seed, optionalString(url, "kind"), limit, region)); return true;
  }
  if (url.pathname === "/api/perception/similar") {
    const kind = enumValue(url, "kind", SIMILAR_KINDS, "entity"), id = optionalString(url, "id");
    if (!id && kind !== "region") throw new QueryValidationError("id", null, "is required");
    const region = kind === "region" ? { x: requiredNumber(url, "x"), y: requiredNumber(url, "y"), radius: requiredNumber(url, "radius", { min: 0 }) } : undefined;
    const limit = optionalNumber(url, "limit", { integer: true, min: 1, max: PERCEPTION_LIMITS.maximumResults }) ?? 10;
    json(response, 200, await service.similar(seed, kind, id, limit, region)); return true;
  }
  if (url.pathname === "/api/perception/compare") {
    const kind = enumValue(url, "kind", COMPARE_KINDS, "entity");
    const regionA = kind === "region" ? { x: requiredNumber(url, "xA"), y: requiredNumber(url, "yA"), radius: requiredNumber(url, "radiusA", { min: 0 }) } : undefined;
    const regionB = kind === "region" ? { x: requiredNumber(url, "xB"), y: requiredNumber(url, "yB"), radius: requiredNumber(url, "radiusB", { min: 0 }) } : undefined;
    json(response, 200, await service.compare({ seed, compareSeed: optionalString(url, "compareSeed"), kind,
      idA: optionalString(url, "idA"), idB: optionalString(url, "idB"),
      tickA: optionalNumber(url, "tickA", { integer: true, min: 0 }), tickB: optionalNumber(url, "tickB", { integer: true, min: 0 }), regionA, regionB })); return true;
  }
  if (url.pathname === "/api/perception/since-last") {
    const observer = optionalString(url, "observer"); if (!observer) throw new QueryValidationError("observer", null, "is required");
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(observer)) throw new QueryValidationError("observer", observer, "contains unsupported characters");
    json(response, 200, await service.sinceLast(observer, seed)); return true;
  }
  return false;
}

export async function handleMarkObserved(request: IncomingMessage, response: ServerResponse, service: PerceptionService, json: JsonWriter): Promise<void> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk); bytes += value.length;
    if (bytes > 16_384) throw new QueryValidationError("body", null, "must not exceed 16KB"); chunks.push(value);
  }
  let body: { observer?: unknown; seed?: unknown; tick?: unknown };
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body; }
  catch { throw new QueryValidationError("body", null, "must be valid JSON"); }
  if (typeof body.observer !== "string" || typeof body.seed !== "string" || !Number.isInteger(body.tick) || Number(body.tick) < 0) {
    throw new QueryValidationError("body", null, "requires observer, seed, and non-negative integer tick");
  }
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(body.observer)) throw new QueryValidationError("observer", body.observer, "contains unsupported characters");
  const archive = await service.observe(body.seed);
  if (archive.observation.source.seed !== body.seed) throw new QueryValidationError("seed", body.seed, "did not resolve exactly");
  json(response, 200, { perceptionSchemaVersion: "protouniverse-perception/1", observerMetadata: await service.observers.markObserved(body.observer, body.seed, Number(body.tick)),
    effect: "observer-metadata-only" });
}
