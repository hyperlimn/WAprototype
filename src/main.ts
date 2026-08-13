import "./style.css";
import { Camera } from "./rendering/camera";
import { Renderer } from "./rendering/renderer";
import { SIMULATION_VERSION, Universe } from "./simulation/universe";
import { bindControls } from "./ui/controls";
import { updateInspector, updateRelationshipInspector } from "./ui/inspector";
import { updateInstruments } from "./ui/instruments";
import { updateOccurrences } from "./ui/occurrences";
import { copySimulationExport } from "./ui/simulationExport";
import { startMachineBridgeClient, type MachineBridgeStatus } from "./interface/machineBridgeClient";

const canvas = document.querySelector<HTMLCanvasElement>("#universe")!;
const instruments = document.querySelector<HTMLElement>("#instruments")!;
const inspector = document.querySelector<HTMLElement>("#inspector")!;
const occurrences = document.querySelector<HTMLElement>("#occurrences")!;
const copyStatus = document.querySelector<HTMLElement>("#copyStatus")!;
const bridgeConnection = document.querySelector<HTMLElement>("#bridgeConnection")!;
const bridgeLastPublish = document.querySelector<HTMLElement>("#bridgeLastPublish")!;
const memoryMode = document.querySelector<HTMLElement>("#memoryMode")!;
const memoryEvents = document.querySelector<HTMLElement>("#memoryEvents")!;
const memoryLatest = document.querySelector<HTMLElement>("#memoryLatest")!;
document.querySelector<HTMLElement>("#simulationVersion")!.textContent = SIMULATION_VERSION;
const camera = new Camera();
const renderer = new Renderer(canvas, camera);

const seedFromUrl = new URLSearchParams(location.search).get("seed");
let universe = new Universe(seedFromUrl || "U0-000001");
let playing = true;
let speed = 1;
let tickCredit = 0;
let schedulerTime = performance.now();
let lastRenderTime = 0;
let instrumentTimer = 0;
let bridgeStatus: MachineBridgeStatus = { connected: false, lastPublishAt: null, lastSnapshotDurationMs: null };

function replaceUniverse(seed: string): void {
  universe = new Universe(seed);
  renderer.selected = null;
  renderer.selectedRelationship = null;
  updateInspector(inspector, null);
  updateInstruments(instruments, universe);
  updateOccurrences(occurrences, universe);
  const url = new URL(location.href);
  url.searchParams.set("seed", seed);
  history.replaceState(null, "", url);
}

bindControls({
  togglePlay: () => {
    playing = !playing;
    tickCredit = 0;
    schedulerTime = performance.now();
    return playing;
  },
  restart: () => replaceUniverse(universe.seed),
  newUniverse: () => replaceUniverse(`U0-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, "0")}`),
  relation: (value) => (renderer.relationFilter = value),
  speed: (value) => {
    speed = value;
    // Discard wall-time scheduling debt so lowering speed takes effect immediately.
    tickCredit = 0;
    schedulerTime = performance.now();
  },
  spatialRelationshipLayer: (visible) => (renderer.showSpatialRelationshipLayer = visible),
  influenceLayer: (visible) => (renderer.showInfluenceLayer = visible),
  fieldLayer: (visible) => (renderer.showField = visible),
  observationMode: (visible) => (renderer.observationMode = visible),
  initialEntities: (visible) => (renderer.showInitialEntities = visible),
  externalArrivals: (visible) => (renderer.showExternalArrivals = visible),
  reproductionEntities: (visible) => (renderer.showReproductionEntities = visible),
  relationshipEvents: (visible) => (renderer.showRelationshipEvents = visible),
  dimensionalTransitions: (visible) => (renderer.showDimensionalTransitions = visible),
});

let dragging = false;
let moved = false;
let pointerX = 0;
let pointerY = 0;
canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  moved = false;
  pointerX = event.clientX;
  pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - pointerX;
  const dy = event.clientY - pointerY;
  if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
  pointerX = event.clientX;
  pointerY = event.clientY;
});
canvas.addEventListener("pointerup", (event) => {
  dragging = false;
  if (!moved) {
    const bounds = canvas.getBoundingClientRect();
    const canvasX = event.clientX - bounds.left;
    const canvasY = event.clientY - bounds.top;
    const relationship = renderer.pickRelationship(canvasX, canvasY, universe);
    if (relationship) {
      updateRelationshipInspector(inspector, relationship, [
        universe.entities[relationship.parentAId], universe.entities[relationship.parentBId],
      ]);
    } else {
      updateInspector(inspector, renderer.pick(canvasX, canvasY, universe));
    }
  }
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  renderer.resize();
  const bounds = canvas.getBoundingClientRect();
  camera.zoomAt(
    Math.exp(-event.deltaY * 0.001),
    event.clientX - bounds.left,
    event.clientY - bounds.top,
    canvas.clientWidth,
    canvas.clientHeight,
  );
}, { passive: false });

let copyConfirmationTimer = 0;
document.querySelector<HTMLButtonElement>("#copySimulationLog")!.addEventListener("click", async () => {
  window.clearTimeout(copyConfirmationTimer);
  try {
    await copySimulationExport(universe);
    copyStatus.textContent = "Simulation log copied";
  } catch {
    copyStatus.textContent = "Clipboard unavailable";
  }
  copyConfirmationTimer = window.setTimeout(() => { copyStatus.textContent = ""; }, 2600);
});

function simulationPump(): void {
  const now = performance.now();
  if (playing) {
    const elapsed = now - schedulerTime;
    tickCredit += (elapsed / (1000 / 60)) * speed;
    const batchStart = performance.now();
    let steps = 0;
    while (tickCredit >= 1 && steps < 256 && performance.now() - batchStart < 8) {
      universe.step(1);
      tickCredit--;
      steps++;
    }
  }
  schedulerTime = now;
  window.setTimeout(simulationPump, 0);
}

function renderInterval(): number {
  if (speed >= 1000) return 500;
  if (speed >= 100) return 200;
  if (speed >= 20) return 100;
  return 0;
}

function frame(now: number): void {
  const elapsed = lastRenderTime === 0 ? 0 : now - lastRenderTime;
  if (now - lastRenderTime < renderInterval()) {
    requestAnimationFrame(frame);
    return;
  }
  lastRenderTime = now;
  renderer.draw(universe);
  instrumentTimer += elapsed;
  if (instrumentTimer > 150) {
    updateInstruments(instruments, universe);
    updateOccurrences(occurrences, universe);
    if (renderer.selected) updateInspector(inspector, renderer.selected);
    else if (renderer.selectedRelationship && universe.relationshipLayer.entities.has(renderer.selectedRelationship.id)) {
      const relationship = renderer.selectedRelationship;
      updateRelationshipInspector(inspector, relationship, [
        universe.entities[relationship.parentAId], universe.entities[relationship.parentBId],
      ]);
    } else if (renderer.selectedRelationship) {
      renderer.selectedRelationship = null;
      updateInspector(inspector, null);
    }
    instrumentTimer = 0;
  }
  requestAnimationFrame(frame);
}

updateInstruments(instruments, universe);
updateOccurrences(occurrences, universe);
startMachineBridgeClient(() => universe, (status) => {
  bridgeStatus = status;
  bridgeConnection.textContent = status.connected ? "connected" : "disconnected";
});
window.setInterval(() => {
  bridgeLastPublish.textContent = bridgeStatus.lastPublishAt === null
    ? "never" : `${((performance.now() - bridgeStatus.lastPublishAt) / 1000).toFixed(1)}s`;
}, 250);
window.setInterval(async () => {
  try {
    const response = await fetch("http://127.0.0.1:8787/api/memory/status");
    if (!response.ok) return;
    const status = await response.json() as { mode: string; persistedEventCount: number; latestPersistedTick: number | null };
    memoryMode.textContent = status.mode;
    memoryEvents.textContent = status.persistedEventCount.toLocaleString();
    memoryLatest.textContent = status.latestPersistedTick === null ? "none" : `tick ${status.latestPersistedTick.toLocaleString()}`;
  } catch { memoryMode.textContent = "unavailable"; }
}, 2_000);
simulationPump();
requestAnimationFrame(frame);
