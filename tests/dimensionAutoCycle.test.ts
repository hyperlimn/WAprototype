import assert from "node:assert/strict";
import test from "node:test";
import { DimensionAutoCycle, nextCycleMode, normalizeAutoCycleSettings, type TimerDriver } from "../src/ui/dimensionAutoCycle.js";
import type { DimensionMode } from "../src/rendering/dimensionProjection.js";

test("auto-cycle settings discard stale dimensions and invalid intervals", () => {
  assert.deepEqual(normalizeAutoCycleSettings({ enabled: true,
    dimensions: ["spatial", "removed" as DimensionMode, "frequency"], intervalMs: 12_345 }),
  { enabled: true, dimensions: ["spatial", "frequency"], intervalMs: 20_000 });
  assert.deepEqual(normalizeAutoCycleSettings({}).dimensions, ["composite", "spatial", "influence", "lineage", "frequency"]);
  assert.equal(nextCycleMode("influence", ["spatial", "influence", "frequency"]), "frequency");
  assert.equal(nextCycleMode("composite", ["spatial", "influence", "frequency"]), "spatial");
  assert.equal(nextCycleMode("spatial", ["spatial"]), null);
});

test("auto-cycle owns one timer, resets after manual selection, and pauses while hidden", () => {
  let nextHandle = 0, mode: DimensionMode = "spatial";
  const callbacks = new Map<number, () => void>(), cleared: number[] = [], selected: DimensionMode[] = [];
  const timers: TimerDriver = { set(callback) { const handle = ++nextHandle; callbacks.set(handle, () => { callbacks.delete(handle); callback(); }); return handle; },
    clear(handle) { cleared.push(handle as number); callbacks.delete(handle as number); } };
  const selector = { current: () => mode, select(value: DimensionMode, persist = false) { mode = value; selected.push(value); assert.equal(persist, false); } };
  const controller = new DimensionAutoCycle(selector, { enabled: true, dimensions: ["spatial", "influence", "frequency"], intervalMs: 5_000 }, timers);
  assert.equal(callbacks.size, 1);
  controller.manualSelection(); assert.equal(callbacks.size, 1); assert.ok(cleared.includes(1));
  const activeCallback = [...callbacks.values()][0]; activeCallback();
  assert.deepEqual(selected, ["influence"]); assert.equal(callbacks.size, 1);
  controller.visibilityChanged(false); assert.equal(callbacks.size, 0); assert.equal(controller.active, false);
  controller.visibilityChanged(true); assert.equal(callbacks.size, 1);
  controller.update({ enabled: true, dimensions: ["spatial"], intervalMs: 10_000 });
  assert.equal(callbacks.size, 0); assert.equal(controller.active, false);
});
