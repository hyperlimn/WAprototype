import type { DimensionMode } from "../rendering/dimensionProjection.js";
export interface ExplorerObserverState { cameraX: number; cameraY: number; zoom: number; dimension: DimensionMode; entityId: string }
export class CloseupSession {
  private disposed = false;
  constructor(readonly state: Readonly<ExplorerObserverState>, private readonly disposeResources: () => void) {}
  close(restore: (state: Readonly<ExplorerObserverState>) => void): void { if (this.disposed) return; this.disposed = true; this.disposeResources(); restore(this.state); }
  get isDisposed(): boolean { return this.disposed; }
}
