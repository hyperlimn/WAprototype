export const SIMULATION_LAW_SET_VERSION = "u0.6/system-order-1";

/** Documentation and regression guard for the current Universe.step order.
 * Universe.step remains hand-wired in v1; this manifest does not execute it.
 */
export const SIMULATION_SYSTEM_ORDER = Object.freeze([
  "base-physics",
  "clock-and-external-arrivals",
  "relationship-lifecycle",
  "dimensional-state",
  "rupture",
  "dimensional-transition-events",
  "influence-physics",
  "relationship-field",
  "higher-order-physics",
  "aggregate-measurement",
  "reproduction",
  "post-reproduction-measurement-if-needed",
] as const);

export type SimulationSystemId = typeof SIMULATION_SYSTEM_ORDER[number];
