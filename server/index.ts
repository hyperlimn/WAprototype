import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { INTERFACE_VERSION, type CanonicalSnapshot, type Heartbeat } from "./types.js";
import { MAX_BRIDGE_EVENTS, StateStore } from "./stateStore.js";
import type { OccurrenceRecord } from "../src/query/queryTypes.js";
import { handleQueryRoute, isSnapshotRoute } from "./queryRoutes.js";
import { optionalNumber, QueryValidationError } from "./queryValidation.js";
import { memoryPolicyFromEnvironment } from "../src/memory/memoryPolicy.js";
import { MemoryStore } from "./memory/memoryStore.js";
import { handleMemoryRoute } from "./memory/memoryRoutes.js";
import { ArchiveNotFoundError } from "./memory/archiveSelection.js";

const HOST = process.env.PROTOUNIVERSE_BRIDGE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PROTOUNIVERSE_BRIDGE_PORT ?? 8787);
const store = new StateStore();
const memory = new MemoryStore(path.resolve(process.env.PROTOUNIVERSE_MEMORY_ROOT ?? "data"), memoryPolicyFromEnvironment());
let browserConnected = false;

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};
const notFound = (response: ServerResponse, resource: string, id?: string): void =>
  json(response, 404, { error: "not_found", resource, ...(id === undefined ? {} : { id }) });
const snapshotUnavailable = (response: ServerResponse): void => json(response, 503, { error: "snapshot_unavailable" });

const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  if (request.method === "OPTIONS") return json(response, 204, null);
  if (request.method !== "GET") return json(response, 405, { error: "method_not_allowed" });
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  if (url.pathname === "/api") return json(response, 200, {
    project: "ProtoUniverse", interfaceVersion: INTERFACE_VERSION,
    description: "Observational, read-only access. The simulation is authoritative; interfaces observe it.",
    endpoints: {
      entities: "GET /api/entities?origin&minAge&maxAge&minEnergy&minNeighbors&minStrongestBond&minStrongestRelationship&relationshipId&sort&limit",
      relationships: "GET /api/relationships?minAge&maxAge&minBond&minStrength&minCoherence&minDensity&minSynergy&spatialActive&influenceActive&dormant&parentEntityId&ruptureEligible&sort&limit",
      region: "GET /api/region?x&y&radius&limit", neighbors: "GET /api/entity/:id/neighbors?radius&limit",
      lineage: "GET /api/entity/:id/lineage?depth", eventSearch: "GET /api/events/search?type&sinceTick&untilTick&entityId&relationshipId&limit",
      discover: "GET /api/discover?limit", state: "GET /api/state", recentEvents: "GET /api/events?limit=100",
      entity: "GET /api/entity/:id", relationship: "GET /api/relationship/:id", status: "GET /api/status",
      universes: "GET /api/universes", universe: "GET /api/universe/:seed",
      history: "GET /api/history?seed&sinceTick&untilTick&type&entityId&relationshipId&limit&cursor",
      historySummary: "GET /api/history/summary?seed&sinceTick&untilTick", checkpoints: "GET /api/checkpoints?seed&sinceTick&untilTick&limit",
      checkpoint: "GET /api/checkpoint/:tick?seed", nearestCheckpoint: "GET /api/checkpoint/nearest/:tick?seed&direction=before|after|nearest",
      memoryStatus: "GET /api/memory/status?seed",
    },
    limits: { default: 100, maximum: 500, discoveryDefault: 10, lineageMaximumDepth: 10 },
  });
  if (url.pathname === "/api/status") {
    const heartbeat = store.heartbeat;
    return json(response, 200, { connected: browserConnected, simulationVersion: heartbeat?.simulationVersion ?? null,
      seed: heartbeat?.seed ?? null, currentTick: heartbeat?.currentTick ?? null, entityCount: heartbeat?.entityCount ?? null,
      lastBrowserUpdateMsAgo: store.lastBrowserUpdateAt === null ? null : Date.now() - store.lastBrowserUpdateAt,
      lastSnapshotDurationMs: store.lastSnapshotDurationMs });
  }
  if (url.pathname === "/api/state") return store.snapshot
    ? json(response, 200, store.snapshot) : json(response, 503, { error: "snapshot_unavailable" });
  if (url.pathname === "/api/events") {
    const limit = optionalNumber(url, "limit", { integer: true, min: 1, max: MAX_BRIDGE_EVENTS }) ?? 100;
    return json(response, 200, store.events.slice(-limit));
  }
  if (await handleMemoryRoute(url, response, memory, store.events.length, json)) return;
  if (!store.snapshot) return isSnapshotRoute(url.pathname) ? snapshotUnavailable(response) : notFound(response, "endpoint");
  if (handleQueryRoute(url, response, store, json)) return;
  const entityMatch = url.pathname.match(/^\/api\/entity\/(\d+)$/);
  if (entityMatch) {
    const entity = store.entityById.get(Number(entityMatch[1]));
    return entity ? json(response, 200, entity) : notFound(response, "entity", entityMatch[1]);
  }
  const relationshipMatch = url.pathname.match(/^\/api\/relationship\/(.+)$/);
  if (relationshipMatch) {
    const id = decodeURIComponent(relationshipMatch[1]);
    const relationship = store.relationshipById.get(id);
    return relationship ? json(response, 200, relationship) : notFound(response, "relationship", id);
  }
  return notFound(response, "endpoint");
};

export const server = createServer((request, response) => {
  handleRequest(request, response).catch((error: unknown) => {
    if (error instanceof QueryValidationError) {
      json(response, 400, { error: "invalid_query", parameter: error.parameter, value: error.value, message: error.message });
    } else if (error instanceof ArchiveNotFoundError) {
      json(response, 404, { error: "not_found", resource: "universe", seed: error.seed, message: error.message });
    } else {
      console.error(error);
      json(response, 500, { error: "internal_error" });
    }
  });
});

server.on("upgrade", (request: IncomingMessage, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key || request.url !== "/") return socket.destroy();
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  browserConnected = true;
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f, offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; const wide = buffer.readBigUInt64BE(2); if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return socket.destroy(); length = Number(wide); offset = 10; }
      const frameLength = offset + (masked ? 4 : 0) + length;
      if (buffer.length < frameLength) return;
      const opcode = buffer[0] & 0x0f;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(frameLength);
      if (opcode === 8) return socket.end();
      if (opcode !== 1) continue;
      try {
        const message = JSON.parse(payload.toString("utf8")) as { type?: string; snapshot?: CanonicalSnapshot; occurrences?: OccurrenceRecord[]; serializationDurationMs?: number } & Heartbeat;
        if (message.interfaceVersion !== INTERFACE_VERSION) continue;
        if (message.type === "heartbeat") {
          store.updateHeartbeat(message);
          void memory.setIdentity({ seed: message.seed, simulationVersion: message.simulationVersion, interfaceVersion: INTERFACE_VERSION });
        } else if (message.type === "snapshot" && message.snapshot) {
          store.updateSnapshot(message.snapshot, message.serializationDurationMs);
          const seed = String(message.snapshot.metadata.seed ?? message.seed ?? "unknown");
          const simulationVersion = String(message.snapshot.metadata.simulationVersion ?? message.simulationVersion ?? "unknown");
          const identity = { seed, simulationVersion, interfaceVersion: INTERFACE_VERSION };
          void memory.ingestEvents(message.snapshot.recentOccurrences ?? [], identity);
          void memory.ingestSnapshot(message.snapshot, identity);
        } else if (message.type === "occurrences" && Array.isArray(message.occurrences)) {
          store.addEvents(message.occurrences);
          const identity = store.heartbeat && { seed: store.heartbeat.seed, simulationVersion: store.heartbeat.simulationVersion, interfaceVersion: INTERFACE_VERSION };
          if (identity) void memory.ingestEvents(message.occurrences, identity);
        }
      } catch { /* Ignore malformed observation messages. */ }
    }
  });
  socket.on("close", () => { browserConnected = false; });
  socket.on("error", () => { browserConnected = false; });
});

server.listen(PORT, HOST, () => console.log(`ProtoUniverse machine bridge listening at http://${HOST}:${PORT}`));
