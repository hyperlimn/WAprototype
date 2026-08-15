import type { Camera } from "../rendering/camera.js";
import type { Renderer } from "../rendering/renderer.js";
import type { Universe } from "../simulation/universe.js";
import type { DimensionAutoCycle } from "../ui/dimensionAutoCycle.js";
import type { DimensionSelectorController } from "../ui/dimensionSelector.js";
import { CloseupSession, type ExplorerObserverState } from "./closeupSession.js";
import { morphologyInspectorEntries } from "./morphologyInspector.js";
import type { CloseupCameraPreset } from "./symmetryCamera.js";
import type { EntityCloseupHandle } from "./threeEntityCloseup.js";

export const CLOSEUP_INVITATION_ZOOM = 7;

interface Elements {
  invitation: HTMLButtonElement;
  closeup: HTMLElement;
  viewport: HTMLElement;
  back: HTMLButtonElement;
  identity: HTMLElement;
  fingerprint: HTMLElement;
  presetButtons: readonly HTMLButtonElement[];
  morphologyValues: HTMLElement;
}

export function bindEntityCloseup(elements: Elements, camera: Camera, renderer: Renderer,
  selector: DimensionSelectorController, autoCycle: DimensionAutoCycle,
  getUniverse: () => Universe): { update(): void; exit(): void; active(): boolean } {
  let session: CloseupSession | null = null;
  let activeHandle: EntityCloseupHandle | null = null;
  let loadGeneration = 0;

  const selectPreset = (preset: CloseupCameraPreset): void => {
    activeHandle?.setCameraPreset(preset);
    for (const button of elements.presetButtons) button.classList.toggle("is-selected", button.dataset.closeupPreset === preset);
  };
  for (const button of elements.presetButtons) button.addEventListener("click", () => selectPreset(button.dataset.closeupPreset as CloseupCameraPreset));

  const restore = (state: ExplorerObserverState): void => {
    const universe = getUniverse();
    camera.x = state.cameraX; camera.y = state.cameraY; camera.zoom = state.zoom;
    selector.select(state.dimension, false);
    renderer.selected = universe.entities.find((entity) => entity.fingerprint === state.entityId) ?? null;
  };
  const exit = (): void => {
    loadGeneration++;
    session?.close(restore); session = null; activeHandle = null;
    elements.closeup.hidden = true;
    elements.viewport.replaceChildren();
    autoCycle.visibilityChanged(!document.hidden);
  };
  const enter = async (): Promise<void> => {
    const entity = renderer.selected;
    if (!entity || session) return;
    const generation = ++loadGeneration;
    const saved: ExplorerObserverState = { cameraX: camera.x, cameraY: camera.y, zoom: camera.zoom,
      dimension: selector.current(), entityId: entity.fingerprint };
    let disposeMounted = (): void => {};
    session = new CloseupSession(saved, () => disposeMounted());
    elements.identity.textContent = "Selected entity";
    elements.fingerprint.textContent = entity.fingerprint;
    elements.morphologyValues.replaceChildren(); selectPreset("free");
    elements.closeup.hidden = false; elements.invitation.hidden = true;
    autoCycle.visibilityChanged(false);
    try {
      const { mountThreeEntityCloseup } = await import("./threeEntityCloseup.js");
      if (generation !== loadGeneration) return;
      const handle = mountThreeEntityCloseup(elements.viewport, entity, () => getUniverse().state.ticks);
      activeHandle = handle; disposeMounted = () => handle.dispose();
      for (const entry of morphologyInspectorEntries(handle.genome)) {
        const row = document.createElement("div"), term = document.createElement("dt"), value = document.createElement("dd");
        term.textContent = entry.label; value.textContent = entry.value; row.append(term, value); elements.morphologyValues.append(row);
      }
      selectPreset("free");
      if (generation !== loadGeneration) handle.dispose();
    } catch (error) {
      console.error("Entity Close-Up could not start", error);
      session = null; activeHandle = null;
      elements.closeup.hidden = true;
      autoCycle.visibilityChanged(!document.hidden);
    }
  };
  elements.invitation.addEventListener("click", () => void enter());
  elements.back.addEventListener("click", exit);
  return {
    update: () => { elements.invitation.hidden = Boolean(session) || elements.closeup.hidden === false
      || !renderer.selected || camera.zoom < CLOSEUP_INVITATION_ZOOM; },
    exit,
    active: () => elements.closeup.hidden === false,
  };
}
