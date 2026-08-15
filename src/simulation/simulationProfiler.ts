import { SIMULATION_SYSTEM_ORDER, type SimulationSystemId } from "./systemManifest";

export interface SimulationTimingSnapshot {
  sampleIntervalSteps: number;
  measuredSteps: number;
  lastStepMs: number;
  rollingAverageStepMs: number;
  phases: Record<SimulationSystemId, { lastMs: number; rollingAverageMs: number }>;
}

const now = (): number => typeof performance === "undefined" ? Date.now() : performance.now();

export class SimulationProfiler {
  static readonly SAMPLE_INTERVAL_STEPS = 60;
  private totalSteps = 0;
  private sampling = false;
  private measuredSteps = 0;
  private stepStarted = 0;
  private lastStepMs = 0;
  private rollingStepMs = 0;
  private readonly phaseLast = Object.fromEntries(SIMULATION_SYSTEM_ORDER.map((id) => [id, 0])) as Record<SimulationSystemId, number>;
  private readonly phaseRolling = Object.fromEntries(SIMULATION_SYSTEM_ORDER.map((id) => [id, 0])) as Record<SimulationSystemId, number>;
  private readonly smoothing = 0.05;

  beginStep(): void {
    this.sampling = this.totalSteps % SimulationProfiler.SAMPLE_INTERVAL_STEPS === 0;
    if (this.sampling) this.stepStarted = now();
  }
  clock(): number { return this.sampling ? now() : 0; }
  record(id: SimulationSystemId, started: number): void {
    if (!this.sampling) return;
    const elapsed = now() - started;
    this.phaseLast[id] = elapsed;
    this.phaseRolling[id] = this.measuredSteps === 0 ? elapsed
      : this.phaseRolling[id] + this.smoothing * (elapsed - this.phaseRolling[id]);
  }
  measure<T>(id: SimulationSystemId, operation: () => T): T {
    if (!this.sampling) return operation();
    const started = now();
    try { return operation(); }
    finally {
      const elapsed = now() - started;
      this.phaseLast[id] = elapsed;
      this.phaseRolling[id] = this.measuredSteps === 0 ? elapsed
        : this.phaseRolling[id] + this.smoothing * (elapsed - this.phaseRolling[id]);
    }
  }
  endStep(): void {
    this.totalSteps++;
    if (!this.sampling) return;
    this.lastStepMs = now() - this.stepStarted;
    this.rollingStepMs = this.measuredSteps === 0 ? this.lastStepMs
      : this.rollingStepMs + this.smoothing * (this.lastStepMs - this.rollingStepMs);
    this.measuredSteps++;
  }
  snapshot(): SimulationTimingSnapshot {
    return {
      sampleIntervalSteps: SimulationProfiler.SAMPLE_INTERVAL_STEPS,
      measuredSteps: this.measuredSteps, lastStepMs: this.lastStepMs, rollingAverageStepMs: this.rollingStepMs,
      phases: Object.fromEntries(SIMULATION_SYSTEM_ORDER.map((id) => [id, {
        lastMs: this.phaseLast[id], rollingAverageMs: this.phaseRolling[id],
      }])) as SimulationTimingSnapshot["phases"],
    };
  }
}
