import type { EntityRecord, RelationshipRecord } from "../../src/query/queryTypes.js";
import { projectEntity, projectRelationship, type DimensionMode } from "../../src/rendering/dimensionProjection.js";
import { oscillationAtTick } from "../../src/simulation/oscillation.js";

export interface HumanViewport { width: number; height: number; centerX: number; centerY: number; zoom: number; worldRadius: number }
export type SceneCommand =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: readonly [number, number, number]; alpha: number; width: number }
  | { kind: "circle"; x: number; y: number; radius: number; color: readonly [number, number, number]; alpha: number };

const finite = (value: number | null | undefined, fallback = 0): number => Number.isFinite(value) ? Number(value) : fallback;
const hslToRgb = (h: number, s: number, l: number): readonly [number, number, number] => {
  s /= 100; l /= 100; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};
const screen = (x: number, y: number, view: HumanViewport): [number, number] =>
  [(x - view.centerX) * view.zoom + view.width / 2, (y - view.centerY) * view.zoom + view.height / 2];

export function defaultViewport(entities: readonly EntityRecord[], width: number, height: number, centerX?: number, centerY?: number,
  zoom?: number, worldRadius?: number): HumanViewport {
  const points = entities.filter((entity) => entity.x !== null && entity.y !== null);
  const cx = centerX ?? (points.length ? points.reduce((sum, item) => sum + finite(item.x), 0) / points.length : 0);
  const cy = centerY ?? (points.length ? points.reduce((sum, item) => sum + finite(item.y), 0) / points.length : 0);
  const radius = worldRadius ?? Math.max(100, ...points.map((item) => Math.hypot(finite(item.x) - cx, finite(item.y) - cy)));
  return { width, height, centerX: cx, centerY: cy, worldRadius: radius,
    zoom: zoom ?? Math.min(width, height) * .44 / radius };
}

/** Deterministic view-only scene. It consumes canonical observations and cannot mutate them. */
export function buildHumanViewScene(entities: readonly EntityRecord[], relationships: readonly RelationshipRecord[], tick: number,
  dimension: DimensionMode, viewport: HumanViewport): SceneCommand[] {
  const commands: SceneCommand[] = [], byId = new Map(entities.map((entity) => [entity.id, entity]));
  const lineage = new Set<number>();
  if (dimension === "lineage") for (const child of entities) for (const parentId of child.parentEntityIds ?? []) {
    const parent = byId.get(parentId); if (!parent || child.x === null || child.y === null || parent.x === null || parent.y === null) continue;
    lineage.add(child.id); lineage.add(parent.id); const [x1, y1] = screen(parent.x, parent.y, viewport), [x2, y2] = screen(child.x, child.y, viewport);
    commands.push({ kind: "line", x1, y1, x2, y2, color: [218, 185, 112], alpha: .72, width: 1.2 });
  }
  for (const relationship of relationships) {
    const a = byId.get(relationship.parentAId), b = byId.get(relationship.parentBId);
    if (!a || !b || a.x === null || a.y === null || b.x === null || b.y === null) continue;
    const projected = dimension === "composite"
      ? { visible: relationship.spatialActive || relationship.influenceActive, alpha: relationship.spatialActive ? .2 : .1,
        lineWidth: relationship.spatialActive ? .7 : .5, color: relationship.spatialActive ? [117, 192, 195] as const : [151, 177, 183] as const }
      : projectRelationship(dimension, relationship);
    if (!projected.visible) continue;
    const [x1, y1] = screen(a.x, a.y, viewport), [x2, y2] = screen(b.x, b.y, viewport);
    commands.push({ kind: "line", x1, y1, x2, y2, color: projected.color, alpha: projected.alpha, width: projected.lineWidth });
  }
  for (const entity of entities) {
    if (entity.x === null || entity.y === null) continue;
    const currentOscillation = entity.naturalFrequency === null || entity.naturalFrequency === undefined || entity.phase === null || entity.phase === undefined
      ? finite(entity.currentOscillation) : oscillationAtTick({ naturalFrequency: entity.naturalFrequency, phase: entity.phase }, tick);
    const visual = projectEntity(dimension, { alpha: finite(entity.alpha, .5), beta: finite(entity.beta, .5), gamma: finite(entity.gamma, .5),
      currentOscillation, participatesInLineage: lineage.has(entity.id) });
    const [x, y] = screen(entity.x, entity.y, viewport), radius = Math.max(1.1, Math.min(3.5, 1.5 * Math.sqrt(viewport.zoom))) * visual.radiusScale;
    commands.push({ kind: "circle", x, y, radius, color: hslToRgb(visual.hue, visual.saturation, visual.lightness), alpha: visual.opacity });
  }
  return commands;
}
