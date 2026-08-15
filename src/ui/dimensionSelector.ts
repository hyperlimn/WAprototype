import { DIMENSION_MODES, type DimensionMode } from "../rendering/dimensionProjection.js";

const STORAGE_KEY = "protouniverse.observer.dimension";

function restoredMode(): DimensionMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return DIMENSION_MODES.includes(value as DimensionMode) ? value as DimensionMode : "composite";
  } catch { return "composite"; }
}

export interface DimensionSelectorController {
  current(): DimensionMode;
  select(mode: DimensionMode, persist?: boolean): void;
}

export function bindDimensionSelector(select: HTMLSelectElement, onChange: (mode: DimensionMode) => void,
  onManualChange?: () => void): DimensionSelectorController {
  let current = restoredMode();
  const apply = (mode: DimensionMode, persist = false): void => {
    current = mode;
    select.value = mode;
    if (persist) try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Selection still works without storage. */ }
    onChange(mode);
  };
  apply(current);
  select.addEventListener("change", () => {
    const mode = DIMENSION_MODES.includes(select.value as DimensionMode) ? select.value as DimensionMode : "composite";
    apply(mode, true);
    onManualChange?.();
  });
  return { current: () => current, select: apply };
}
