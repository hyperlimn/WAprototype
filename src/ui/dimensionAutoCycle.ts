import { DIMENSION_MODES, type DimensionMode } from "../rendering/dimensionProjection.js";
import type { DimensionSelectorController } from "./dimensionSelector.js";

export const AUTO_CYCLE_INTERVALS = [5_000, 10_000, 20_000, 30_000, 60_000] as const;
export const AUTO_CYCLE_DEFAULT_INTERVAL = 20_000;
export const AUTO_CYCLE_STORAGE = {
  enabled: "protouniverse.observer.autoCycle.enabled",
  dimensions: "protouniverse.observer.autoCycle.dimensions",
  interval: "protouniverse.observer.autoCycle.intervalMs",
} as const;

export interface AutoCycleSettings { enabled: boolean; dimensions: DimensionMode[]; intervalMs: number }
export interface TimerDriver { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }

export function normalizeAutoCycleSettings(value: Partial<AutoCycleSettings>, modes: readonly DimensionMode[] = DIMENSION_MODES): AutoCycleSettings {
  const dimensions = Array.isArray(value.dimensions)
    ? modes.filter((mode) => value.dimensions!.includes(mode)) : [...modes];
  const intervalMs = AUTO_CYCLE_INTERVALS.includes(value.intervalMs as typeof AUTO_CYCLE_INTERVALS[number])
    ? value.intervalMs! : AUTO_CYCLE_DEFAULT_INTERVAL;
  return { enabled: value.enabled === true, dimensions, intervalMs };
}

export function nextCycleMode(current: DimensionMode, dimensions: readonly DimensionMode[]): DimensionMode | null {
  if (dimensions.length < 2) return null;
  const index = dimensions.indexOf(current);
  return dimensions[index < 0 ? 0 : (index + 1) % dimensions.length];
}

export class DimensionAutoCycle {
  private timer: unknown = null;
  private visible = true;
  private settings: AutoCycleSettings;
  constructor(private readonly selector: DimensionSelectorController, settings: AutoCycleSettings,
    private readonly timers: TimerDriver, private readonly onStatusChange: (active: boolean) => void = () => {}) {
    this.settings = normalizeAutoCycleSettings(settings);
    this.restart();
  }
  update(settings: AutoCycleSettings): void { this.settings = normalizeAutoCycleSettings(settings); this.restart(); }
  manualSelection(): void { this.restart(); }
  visibilityChanged(visible: boolean): void { this.visible = visible; this.restart(); }
  stop(): void { this.clear(); this.onStatusChange(false); }
  get active(): boolean { return this.visible && this.settings.enabled && this.settings.dimensions.length >= 2; }
  private restart(): void {
    this.clear(); this.onStatusChange(this.active);
    if (this.active) this.timer = this.timers.set(() => this.advance(), this.settings.intervalMs);
  }
  private advance(): void {
    this.timer = null;
    const next = nextCycleMode(this.selector.current(), this.settings.dimensions);
    if (next) this.selector.select(next, false);
    this.restart();
  }
  private clear(): void { if (this.timer !== null) this.timers.clear(this.timer); this.timer = null; }
}

const readSettings = (): AutoCycleSettings => {
  try {
    const dimensions = JSON.parse(localStorage.getItem(AUTO_CYCLE_STORAGE.dimensions) ?? "null");
    return normalizeAutoCycleSettings({ enabled: localStorage.getItem(AUTO_CYCLE_STORAGE.enabled) === "true",
      dimensions, intervalMs: Number(localStorage.getItem(AUTO_CYCLE_STORAGE.interval)) });
  } catch { return normalizeAutoCycleSettings({}); }
};

const saveSettings = (settings: AutoCycleSettings): void => {
  try {
    localStorage.setItem(AUTO_CYCLE_STORAGE.enabled, String(settings.enabled));
    localStorage.setItem(AUTO_CYCLE_STORAGE.dimensions, JSON.stringify(settings.dimensions));
    localStorage.setItem(AUTO_CYCLE_STORAGE.interval, String(settings.intervalMs));
  } catch { /* Auto Cycle still works when storage is unavailable. */ }
};

export function bindDimensionAutoCycle(root: HTMLElement, selector: DimensionSelectorController): DimensionAutoCycle {
  const enabled = root.querySelector<HTMLInputElement>("#autoCycleEnabled")!;
  const choices = root.querySelector<HTMLElement>("#autoCycleDimensions")!;
  const interval = root.querySelector<HTMLSelectElement>("#autoCycleInterval")!;
  const status = root.querySelector<HTMLElement>("#autoCycleStatus")!;
  const summaryState = root.querySelector<HTMLElement>("#autoCycleSummaryState")!;
  const summary = root.querySelector<HTMLElement>("summary")!;
  let settings = readSettings();
  enabled.checked = settings.enabled; interval.value = String(settings.intervalMs);
  for (const mode of DIMENSION_MODES) {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox"; input.value = mode; input.checked = settings.dimensions.includes(mode);
    label.append(input, mode[0].toUpperCase() + mode.slice(1)); choices.append(label);
  }
  const controller = new DimensionAutoCycle(selector, settings, {
    set: (callback, delay) => window.setTimeout(callback, delay), clear: (handle) => window.clearTimeout(handle as number),
  }, (active) => {
    root.classList.toggle("is-active", active); summary.setAttribute("aria-label", active ? "Auto Cycle active" : "Auto Cycle settings");
    summaryState.textContent = active ? "On" : settings.enabled ? "Waiting" : "Off";
    status.textContent = active ? "Cycling lenses" : settings.enabled ? "Select at least two lenses" : "Off";
  });
  const update = (): void => {
    settings = normalizeAutoCycleSettings({ enabled: enabled.checked,
      dimensions: [...choices.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((input) => input.value as DimensionMode),
      intervalMs: Number(interval.value) });
    saveSettings(settings); controller.update(settings);
  };
  enabled.addEventListener("change", update); choices.addEventListener("change", update); interval.addEventListener("change", update);
  document.addEventListener("visibilitychange", () => controller.visibilityChanged(!document.hidden));
  controller.visibilityChanged(!document.hidden);
  return controller;
}
