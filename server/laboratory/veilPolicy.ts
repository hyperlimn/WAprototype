import type { ExperimentDefinition, ExperimentalContext } from "../../src/laboratory/experimentTypes.js";

export class VeilAccessError extends Error {
  readonly classification = "inaccessible";
  constructor(message: string) { super(message); }
}

export class VeilPolicy {
  readonly context: ExperimentalContext;
  constructor(readonly experiment: ExperimentDefinition) {
    this.context = { experimentId: experiment.id, experimentRevision: experiment.revision, profileVersion: experiment.profile.version, restricted: true };
  }
  get cutoff(): number | undefined { return this.experiment.profile.history.minimumAccessibleTick; }
  assertUniverse(value: unknown): void {
    if (value !== undefined && value !== null && value !== this.experiment.universe)
      throw new VeilAccessError(this.experiment.profile.discloseExperimentalContext
        ? "The requested universe is inaccessible under the current observation profile." : "The requested universe is inaccessible.");
  }
  assertTick(tick: unknown, category = "Historical data"): void {
    if (typeof tick === "number" && this.cutoff !== undefined && tick < this.cutoff)
      throw new VeilAccessError(this.experiment.profile.discloseExperimentalContext
        ? `${category} before tick ${this.cutoff} is not accessible under the current observation profile.`
        : `${category} outside the accessible range is inaccessible.`);
  }
  assertFeature(enabled: boolean, category: string): void {
    if (!enabled) throw new VeilAccessError(this.experiment.profile.discloseExperimentalContext
      ? `${category} is not accessible under the current observation profile.` : `${category} is inaccessible.`);
  }
}
