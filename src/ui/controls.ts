export interface ControlCallbacks {
  togglePlay(): boolean;
  restart(): void;
  newUniverse(): void;
  relation(value: number): void;
  speed(value: number): void;
  spatialRelationshipLayer(visible: boolean): void;
  influenceLayer(visible: boolean): void;
  fieldLayer(visible: boolean): void;
  observationMode(visible: boolean): void;
  initialEntities(visible: boolean): void;
  externalArrivals(visible: boolean): void;
  reproductionEntities(visible: boolean): void;
  relationshipEvents(visible: boolean): void;
  dimensionalTransitions(visible: boolean): void;
}

export function bindControls(callbacks: ControlCallbacks): void {
  const playPause = document.querySelector<HTMLButtonElement>("#playPause")!;
  const relation = document.querySelector<HTMLInputElement>("#relation")!;
  const relationValue = document.querySelector<HTMLOutputElement>("#relationValue")!;
  const speed = document.querySelector<HTMLInputElement>("#speed")!;
  const speedValue = document.querySelector<HTMLOutputElement>("#speedValue")!;
  const spatialRelationshipLayer = document.querySelector<HTMLInputElement>("#spatialRelationshipLayer")!;
  const influenceLayer = document.querySelector<HTMLInputElement>("#influenceLayer")!;
  const fieldLayer = document.querySelector<HTMLInputElement>("#fieldLayer")!;
  const observationMode = document.querySelector<HTMLInputElement>("#observationMode")!;
  const observationOptions = document.querySelector<HTMLElement>("#observationOptions")!;

  playPause.addEventListener("click", () => {
    const playing = callbacks.togglePlay();
    playPause.textContent = playing ? "Pause" : "Play";
  });
  document.querySelector("#restart")!.addEventListener("click", callbacks.restart);
  document.querySelector("#newUniverse")!.addEventListener("click", callbacks.newUniverse);
  relation.addEventListener("input", () => {
    relationValue.value = Number(relation.value).toFixed(2);
    callbacks.relation(Number(relation.value));
  });
  speed.addEventListener("input", () => {
    // A logarithmic scale keeps precise control near 1× while reaching 100×.
    const multiplier = 10 ** (Number(speed.value) / 100);
    const displayed = multiplier < 10
      ? multiplier.toFixed(2)
      : multiplier < 1000 ? multiplier.toFixed(1) : multiplier.toFixed(0);
    speedValue.value = `${displayed}×`;
    callbacks.speed(multiplier);
  });
  spatialRelationshipLayer.addEventListener("change", () =>
    callbacks.spatialRelationshipLayer(spatialRelationshipLayer.checked));
  influenceLayer.addEventListener("change", () => callbacks.influenceLayer(influenceLayer.checked));
  fieldLayer.addEventListener("change", () => callbacks.fieldLayer(fieldLayer.checked));
  observationMode.addEventListener("change", () => {
    observationOptions.hidden = !observationMode.checked;
    callbacks.observationMode(observationMode.checked);
  });
  const bindToggle = (id: string, callback: (visible: boolean) => void): void => {
    const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
    input.addEventListener("change", () => callback(input.checked));
  };
  bindToggle("observeInitial", callbacks.initialEntities);
  bindToggle("observeExternal", callbacks.externalArrivals);
  bindToggle("observeReproduction", callbacks.reproductionEntities);
  bindToggle("observeRelationships", callbacks.relationshipEvents);
  bindToggle("observeDimensions", callbacks.dimensionalTransitions);
}
