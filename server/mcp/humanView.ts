import type { Gateway } from "./mcpGateway.js";
import type { CanonicalSnapshot } from "../types.js";
import type { DimensionMode } from "../../src/rendering/dimensionProjection.js";
import { buildHumanViewScene, defaultViewport } from "./humanViewScene.js";
import { rasterizePng } from "./pngRaster.js";

export interface HumanViewRequest { seed?: string; dimension: DimensionMode; width: number; height: number; centerX?: number; centerY?: number; zoom?: number; worldRadius?: number }
export async function renderHumanView(gateway: Gateway, request: HumanViewRequest) {
  const snapshot = await gateway.get("/api/state", { seed: request.seed }) as CanonicalSnapshot;
  const universe = String(snapshot.metadata.seed ?? "unknown"), tick = Number(snapshot.metadata.currentTick);
  if (!Number.isFinite(tick)) throw new Error("The authoritative current simulation tick is unavailable.");
  if (request.seed && request.seed !== universe) throw new Error(`Current live universe is ${universe}, not ${request.seed}.`);
  const entities = snapshot.entities ?? [], relationships = snapshot.relationships ?? [];
  const viewport = defaultViewport(entities, request.width, request.height, request.centerX, request.centerY, request.zoom, request.worldRadius);
  const commands = buildHumanViewScene(entities, relationships, tick, request.dimension, viewport);
  return { png: rasterizePng(request.width, request.height, commands), metadata: { schemaVersion: "protouniverse-rendered-view/1", universe, tick,
    dimension: request.dimension, viewport, width: request.width, height: request.height, entityCount: entities.length, relationshipCount: relationships.length,
    renderKind: "rendered_view", authoritativeUniverseChanged: false } };
}
