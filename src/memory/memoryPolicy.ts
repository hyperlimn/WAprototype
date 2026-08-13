import type { MemoryMode } from "./memoryTypes.js";

export interface MemoryPolicy {
  mode: MemoryMode;
  checkpointIntervalTicks: number;
  segmentMaxEvents: number;
  recentDetailTicks: number;
  condensedEraTicks: number;
}

const positiveInteger = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function memoryPolicyFromEnvironment(environment: NodeJS.ProcessEnv = process.env): MemoryPolicy {
  const mode: MemoryMode = environment.PROTOUNIVERSE_MEMORY_MODE === "condensed" ? "condensed" : "complete";
  return {
    mode,
    checkpointIntervalTicks: positiveInteger(environment.PROTOUNIVERSE_CHECKPOINT_INTERVAL_TICKS, 25_000),
    segmentMaxEvents: positiveInteger(environment.PROTOUNIVERSE_EVENT_SEGMENT_SIZE, 10_000),
    recentDetailTicks: positiveInteger(environment.PROTOUNIVERSE_RECENT_DETAIL_TICKS, 100_000),
    condensedEraTicks: positiveInteger(environment.PROTOUNIVERSE_CONDENSED_ERA_TICKS, 100_000),
  };
}
