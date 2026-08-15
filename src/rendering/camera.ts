export class Camera {
  x = 0;
  y = 0;
  zoom = 0.55;

  worldToScreen(x: number, y: number, width: number, height: number): [number, number] {
    return [(x - this.x) * this.zoom + width / 2, (y - this.y) * this.zoom + height / 2];
  }

  screenToWorld(x: number, y: number, width: number, height: number): [number, number] {
    return [(x - width / 2) / this.zoom + this.x, (y - height / 2) / this.zoom + this.y];
  }

  zoomAt(factor: number, sx: number, sy: number, width: number, height: number): void {
    const before = this.screenToWorld(sx, sy, width, height);
    this.zoom = Math.max(0.12, Math.min(Camera.MAX_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(sx, sy, width, height);
    this.x += before[0] - after[0];
    this.y += before[1] - after[1];
  }
  static readonly MAX_ZOOM = 12;
}
