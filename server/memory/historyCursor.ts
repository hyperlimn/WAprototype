import { createHash } from "node:crypto";
import type { HistoryQuery } from "../../src/memory/memoryTypes.js";
import { QueryValidationError } from "../queryValidation.js";

interface CursorPayload { v: 1; seed: string; queryFingerprint: string; segmentIndex: number; recordPosition: number; direction: "newest" }

const fingerprintInput = (query: Omit<HistoryQuery, "limit">): string => JSON.stringify({
  sinceTick: query.sinceTick ?? null, untilTick: query.untilTick ?? null, type: query.type ?? null,
  entityId: query.entityId ?? null, relationshipId: query.relationshipId ?? null,
});

export const historyQueryFingerprint = (query: Omit<HistoryQuery, "limit">): string =>
  createHash("sha256").update(fingerprintInput(query)).digest("hex").slice(0, 24);

export const encodeHistoryCursor = (payload: Omit<CursorPayload, "v" | "direction">): string =>
  Buffer.from(JSON.stringify({ v: 1, direction: "newest", ...payload } satisfies CursorPayload), "utf8").toString("base64url");

export function decodeHistoryCursor(raw: string, seed: string, query: Omit<HistoryQuery, "limit">): CursorPayload {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (value.v !== 1 || value.direction !== "newest" || typeof value.seed !== "string"
      || typeof value.queryFingerprint !== "string" || !Number.isInteger(value.segmentIndex)
      || !Number.isInteger(value.recordPosition) || value.segmentIndex! < 1 || value.recordPosition! < 0) throw new Error("invalid cursor fields");
    if (value.seed !== seed) throw new Error("cursor belongs to another seed");
    if (value.queryFingerprint !== historyQueryFingerprint(query)) throw new Error("cursor does not match query filters");
    return value as CursorPayload;
  } catch (error) {
    throw new QueryValidationError("cursor", raw, error instanceof Error ? error.message : "invalid cursor");
  }
}
