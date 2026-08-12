import type { Entity } from "../simulation/entity";
import { relationship } from "../simulation/physics";
import type { Universe } from "../simulation/universe";
import { Camera } from "./camera";
import type { RelationshipEntity } from "../simulation/relationshipEntity";
import { EVENT_TRACE_DURATION_TICKS, type Occurrence } from "../simulation/occurrenceLog";

export class Renderer {
  private context: CanvasRenderingContext2D;
  relationFilter = 0.72;
  selected: Entity | null = null;
  selectedRelationship: RelationshipEntity | null = null;
  showSpatialRelationshipLayer = true;
  showInfluenceLayer = true;
  showField = false;
  observationMode = false;
  showInitialEntities = true;
  showExternalArrivals = true;
  showReproductionEntities = true;
  showRelationshipEvents = true;
  showDimensionalTransitions = true;

  constructor(readonly canvas: HTMLCanvasElement, readonly camera: Camera) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(universe: Universe): void {
    this.resize();
    const ctx = this.context;
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070a0d";
    ctx.fillRect(0, 0, width, height);

    if (this.showField) {
      const sampleSize = 56;
      for (let sy = sampleSize / 2; sy < height; sy += sampleSize) {
        for (let sx = sampleSize / 2; sx < width; sx += sampleSize) {
          const [wx, wy] = this.camera.screenToWorld(sx, sy, width, height);
          const potential = universe.relationshipField.potentialAt(wx, wy);
          const alpha = Math.min(0.055, potential * 1.2);
          if (alpha <= 0.001) continue;
          ctx.fillStyle = `rgba(91, 132, 133, ${alpha})`;
          ctx.fillRect(sx - sampleSize / 2, sy - sampleSize / 2, sampleSize, sampleSize);
        }
      }
    }

    if (this.showSpatialRelationshipLayer) {
      ctx.lineWidth = 0.5;
      for (const interaction of universe.higherOrderPhysics.activeInteractions) {
        const [ax, ay] = this.camera.worldToScreen(interaction.a.x, interaction.a.y, width, height);
        const [bx, by] = this.camera.worldToScreen(interaction.b.x, interaction.b.y, width, height);
        ctx.strokeStyle = "rgba(194, 217, 204, 0.035)";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    ctx.lineWidth = 0.65;
    for (const a of universe.entities) {
      for (const b of universe.spatial.nearby(a)) {
        if (b.creationIndex <= a.creationIndex) continue;
        const relation = relationship(a, b);
        if (relation < this.relationFilter) continue;
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (distance > universe.spatial.cellSize) continue;
        const [ax, ay] = this.camera.worldToScreen(a.x, a.y, width, height);
        const [bx, by] = this.camera.worldToScreen(b.x, b.y, width, height);
        if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax > width && bx > width) || (ay > height && by > height)) continue;
        ctx.strokeStyle = `rgba(117, 192, 195, ${Math.min(0.2, (relation - this.relationFilter) * 0.6 + 0.025)})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    for (const entity of universe.entities) {
      if (!this.entityVisible(entity)) continue;
      const [x, y] = this.camera.worldToScreen(entity.x, entity.y, width, height);
      if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
      const radius = Math.max(1.1, Math.min(3.5, 1.5 * Math.sqrt(this.camera.zoom)));
      const light = 58 + entity.gamma * 18;
      ctx.fillStyle = `hsla(${178 + entity.alpha * 36}, ${28 + entity.beta * 24}%, ${light}%, 0.9)`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (this.observationMode && entity.origin === "external arrival") {
        ctx.strokeStyle = "rgba(169, 193, 190, 0.72)";
        ctx.lineWidth = 0.7;
        ctx.strokeRect(x - radius - 2, y - radius - 2, radius * 2 + 4, radius * 2 + 4);
      } else if (this.observationMode && entity.origin === "reproduction") {
        ctx.strokeStyle = "rgba(211, 192, 137, 0.78)";
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(x, y - radius - 3);
        ctx.lineTo(x + radius + 3, y);
        ctx.lineTo(x, y + radius + 3);
        ctx.lineTo(x - radius - 3, y);
        ctx.closePath();
        ctx.stroke();
      }
      if (entity === this.selected) {
        ctx.strokeStyle = "#f5d987";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (this.showSpatialRelationshipLayer) {
      for (const entity of universe.relationshipLayer.entities.values()) {
        if (!entity.spatialActive) continue;
        const [x, y] = this.camera.worldToScreen(entity.x, entity.y, width, height);
        if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
        ctx.fillStyle = "rgba(235, 216, 153, 0.42)";
        ctx.fillRect(x - 1.25, y - 1.25, 2.5, 2.5);
        if (entity === this.selectedRelationship) {
          ctx.strokeStyle = "#f5d987";
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 5, y - 5, 10, 10);
        }
      }
    }
    if (this.showInfluenceLayer) {
      for (const entity of universe.relationshipLayer.entities.values()) {
        if (!entity.influenceActive || entity.spatialActive) continue;
        const [x, y] = this.camera.worldToScreen(entity.x, entity.y, width, height);
        if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
        ctx.strokeStyle = "rgba(151, 177, 183, 0.28)";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.stroke();
        if (entity === this.selectedRelationship) {
          ctx.strokeStyle = "#f5d987";
          ctx.strokeRect(x - 5, y - 5, 10, 10);
        }
      }
    }
    if (this.observationMode && this.showRelationshipEvents) {
      for (const entity of universe.relationshipLayer.entities.values()) {
        if (entity.spatialActive || entity.influenceActive) continue;
        const [x, y] = this.camera.worldToScreen(entity.x, entity.y, width, height);
        if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
        ctx.strokeStyle = "rgba(123, 139, 137, 0.22)";
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + 2, y + 2);
        ctx.moveTo(x + 2, y - 2); ctx.lineTo(x - 2, y + 2);
        ctx.stroke();
        if (entity === this.selectedRelationship) {
          ctx.strokeStyle = "#f5d987";
          ctx.strokeRect(x - 5, y - 5, 10, 10);
        }
      }
    }
    if (this.observationMode) this.drawOccurrenceTraces(universe, width, height);
  }

  private entityVisible(entity: Entity): boolean {
    if (!this.observationMode) return true;
    if (entity.origin === "initial") return this.showInitialEntities;
    if (entity.origin === "external arrival") return this.showExternalArrivals;
    return this.showReproductionEntities;
  }

  private occurrenceVisible(record: Occurrence): boolean {
    if (record.type === "external-arrival") return this.showExternalArrivals;
    if (record.type === "reproduction") return this.showReproductionEntities;
    if (record.type === "dimensional-transition") return this.showDimensionalTransitions;
    return this.showRelationshipEvents;
  }

  private drawOccurrenceTraces(universe: Universe, width: number, height: number): void {
    const ctx = this.context;
    for (const record of universe.occurrences.active(universe.state.ticks)) {
      if (!this.occurrenceVisible(record)) continue;
      const entity = record.entityId === undefined ? undefined : universe.entities[record.entityId];
      const worldX = entity?.x ?? record.x;
      const worldY = entity?.y ?? record.y;
      const [x, y] = this.camera.worldToScreen(worldX, worldY, width, height);
      const progress = (universe.state.ticks - record.tick) / EVENT_TRACE_DURATION_TICKS;
      const radius = 7 + progress * 25;
      const ruptureProgress = Math.min(1, (universe.state.ticks - record.tick) / 180);
      const traceRadius = record.type === "rupture" ? 6 + ruptureProgress * 22 : radius;
      const alpha = Math.max(0.12, 0.72 * (1 - progress));
      if (record.type === "reproduction" && entity && record.parentEntityIds) {
        ctx.strokeStyle = `rgba(205, 184, 126, ${alpha * 0.48})`;
        ctx.lineWidth = 0.65;
        ctx.setLineDash([3, 4]);
        for (const parentId of record.parentEntityIds) {
          const parent = universe.entities[parentId];
          const [px, py] = this.camera.worldToScreen(parent.x, parent.y, width, height);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = record.type === "external-arrival"
        ? `rgba(154, 190, 188, ${alpha})`
        : record.type === "reproduction" ? `rgba(215, 191, 125, ${alpha})`
          : record.type === "relationship-destroyed" ? `rgba(174, 129, 122, ${alpha})`
            : record.type === "rupture" ? `rgba(224, 139, 112, ${Math.max(0, 0.82 * (1 - ruptureProgress))})`
              : `rgba(171, 180, 154, ${alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, traceRadius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = "9px IBM Plex Mono, Cascadia Mono, Consolas, monospace";
      const label = record.type === "external-arrival" ? "EXT"
        : record.type === "reproduction" ? "BIRTH"
          : record.type === "relationship-formed" ? "REL+"
            : record.type === "relationship-destroyed" ? "REL−" : "DIM";
      const eventLabel = record.type === "rupture" ? "RUPTURE" : label;
      ctx.fillText(eventLabel, x + traceRadius + 3, y - 3);
    }
  }

  pick(screenX: number, screenY: number, universe: Universe): Entity | null {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    const [wx, wy] = this.camera.screenToWorld(screenX, screenY, width, height);
    let closest: Entity | null = null;
    let best = 10 / this.camera.zoom;
    for (const entity of universe.entities) {
      if (!this.entityVisible(entity)) continue;
      const distance = Math.hypot(entity.x - wx, entity.y - wy);
      if (distance < best) {
        best = distance;
        closest = entity;
      }
    }
    this.selected = closest;
    this.selectedRelationship = null;
    return closest;
  }

  pickRelationship(screenX: number, screenY: number, universe: Universe): RelationshipEntity | null {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const [wx, wy] = this.camera.screenToWorld(screenX, screenY, width, height);
    let closest: RelationshipEntity | null = null;
    let best = 8 / this.camera.zoom;
    for (const entity of universe.relationshipLayer.entities.values()) {
      const visible = (entity.spatialActive && this.showSpatialRelationshipLayer)
        || (!entity.spatialActive && entity.influenceActive && this.showInfluenceLayer)
        || (this.observationMode && this.showRelationshipEvents && !entity.spatialActive && !entity.influenceActive);
      if (!visible) continue;
      const distance = Math.hypot(entity.x - wx, entity.y - wy);
      if (distance < best) {
        best = distance;
        closest = entity;
      }
    }
    if (closest) {
      this.selectedRelationship = closest;
      this.selected = null;
    }
    return closest;
  }
}
