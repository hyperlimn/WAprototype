import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { buildWorldSnapshot } from "../src/interface/worldSnapshot.js";
import { deterministicStateHash } from "../src/simulation/deterministicStateHash.js";
import type { SaveStateArtifact, UniverseContinuationState } from "../src/simulation/saveState.js";
import { Universe } from "../src/simulation/universe.js";

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const ticks = Number(argument("--ticks") ?? 4_000);
const warmupTicks = Number(argument("--warmup") ?? 1_000);
const savePath = argument("--save");
if (!Number.isInteger(ticks) || ticks < 1 || !Number.isInteger(warmupTicks) || warmupTicks < 0) throw new Error("ticks and warmup must be non-negative integers");

let seed = argument("--seed") ?? "optimization-v1-benchmark";
let start: UniverseContinuationState | undefined;
if (savePath) {
  const artifact = JSON.parse(await readFile(savePath, "utf8")) as SaveStateArtifact;
  seed = artifact.universe;
  start = artifact.continuation;
} else {
  const warmup = new Universe(seed);
  for (let index = 0; index < warmupTicks; index++) warmup.step();
  start = warmup.continuationState();
}

const universe = new Universe(seed, structuredClone(start));
(globalThis as typeof globalThis & { gc?: () => void }).gc?.();
const memoryBefore = process.memoryUsage().heapUsed;
const started = performance.now();
for (let index = 0; index < ticks; index++) universe.step();
const elapsedMs = performance.now() - started;
(globalThis as typeof globalThis & { gc?: () => void }).gc?.();
const memoryAfter = process.memoryUsage().heapUsed;

buildWorldSnapshot(universe);
const snapshotRuns = 5;
let snapshotBuildMs = 0, snapshotBytes = 0;
for (let index = 0; index < snapshotRuns; index++) {
  const snapshotStarted = performance.now();
  const snapshot = buildWorldSnapshot(universe);
  snapshotBuildMs += performance.now() - snapshotStarted;
  snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
}

console.log(JSON.stringify({
  seed, source: savePath ? "save" : "fresh-warmup", startTick: start.tick, endTick: universe.state.ticks,
  ticks, elapsedMs, ticksPerSecond: ticks / elapsedMs * 1_000, averageStepMs: elapsedMs / ticks,
  retainedHeapDeltaBytes: memoryAfter - memoryBefore, entityCount: universe.entities.length,
  relationshipCount: universe.relationshipLayer.entities.size,
  systemTimings: universe.profiler.snapshot(), snapshotBuildMs: snapshotBuildMs / snapshotRuns,
  snapshotBytes, stateHash: deterministicStateHash(universe.continuationState()),
}, null, 2));
