import type { Gateway } from "../mcp/mcpGateway.js";
import type { ExperimentDefinition } from "../../src/laboratory/experimentTypes.js";
import { VeilAccessError, VeilPolicy } from "./veilPolicy.js";
import { veilFilter } from "./veilFiltering.js";

export class LaboratoryGateway implements Gateway {
  readonly policy: VeilPolicy;
  constructor(readonly authoritative: Gateway, readonly experiment: ExperimentDefinition) { this.policy = new VeilPolicy(experiment); }

  async get(pathname: string, supplied: Record<string, unknown> = {}): Promise<any> {
    const params = { ...supplied }; this.policy.assertUniverse(params.seed ?? params.universe);
    if (pathname === "/api/universes") {
      const result = await this.authoritative.get(pathname, params);
      return this.finish({ ...result, results: (result.results ?? []).filter((item: any) => item.seed === this.experiment.universe) });
    }
    if (pathname.startsWith("/api/universe/")) {
      const requested = decodeURIComponent(pathname.slice("/api/universe/".length)); this.policy.assertUniverse(requested);
    } else params.seed = this.experiment.universe;

    const profile = this.experiment.profile, cutoff = this.policy.cutoff;
    if (pathname === "/api/perception/orient") {
      this.policy.assertFeature(profile.currentState, "Current state"); delete params.observer;
    } else if (pathname === "/api/history") {
      this.policy.assertFeature(profile.history.enabled && profile.events, "Historical event data");
      if (cutoff !== undefined) {
        if (typeof params.untilTick === "number" && params.untilTick < cutoff) this.policy.assertTick(params.untilTick);
        params.sinceTick = Math.max(cutoff, typeof params.sinceTick === "number" ? params.sinceTick : cutoff);
      }
    } else if (pathname === "/api/checkpoints") {
      this.policy.assertFeature(profile.checkpoints, "Checkpoints");
      if (cutoff !== undefined) {
        if (typeof params.untilTick === "number" && params.untilTick < cutoff) this.policy.assertTick(params.untilTick, "Checkpoints");
        params.sinceTick = Math.max(cutoff, typeof params.sinceTick === "number" ? params.sinceTick : cutoff);
      }
    } else if (/^\/api\/checkpoint\//.test(pathname)) {
      this.policy.assertFeature(profile.checkpoints, "Checkpoints");
      const match = pathname.match(/\/api\/checkpoint\/(?:nearest\/)?(\d+)$/); if (match) this.policy.assertTick(Number(match[1]), "Checkpoints");
    } else if (pathname === "/api/perception/inspect" || pathname === "/api/perception/context") {
      const kind = String(params.kind ?? "");
      this.policy.assertFeature(kind === "entity" ? profile.entities : kind === "relationship" ? profile.relationships : kind === "region" ? profile.regions : kind === "checkpoint" ? profile.checkpoints : profile.events, kind || "Target");
      if (kind === "event" || kind === "checkpoint" || params.tick !== undefined) this.policy.assertTick(params.tick, kind === "checkpoint" ? "Checkpoints" : "Historical data");
    } else if (pathname === "/api/perception/anomalies") this.policy.assertFeature(profile.anomalyDetection, "Anomaly detection");
    else if (pathname === "/api/perception/similar") this.policy.assertFeature(profile.similarity, "Similarity analysis");
    else if (pathname === "/api/perception/compare") {
      this.policy.assertFeature(profile.comparison, "Comparison"); this.policy.assertUniverse(params.compareSeed);
      this.policy.assertTick(params.tickA, "Checkpoint comparison"); this.policy.assertTick(params.tickB, "Checkpoint comparison");
    } else if (pathname === "/api/perception/changes") {
      this.policy.assertFeature(profile.comparison, "Change detection"); this.policy.assertUniverse(params.compareSeed);
      this.policy.assertTick(params.sinceTick ?? params.checkpoint ?? params.tick, "Change comparisons");
    } else if (pathname === "/api/perception/since-last") this.policy.assertFeature(profile.bookmarks, "Observer bookmarks");
    else if (pathname === "/api/observer-memory") this.policy.assertFeature(profile.observerMemory, "Observer Memory");

    const result = await this.authoritative.get(pathname, params);
    if (pathname.includes("checkpoint")) {
      const tick = result?.checkpoint?.tick ?? result?.metadata?.tick; this.policy.assertTick(tick, "Checkpoints");
    }
    return this.finish(result);
  }

  async post(pathname: string, _body: unknown): Promise<any> {
    if (pathname === "/api/perception/mark-observed") this.policy.assertFeature(this.experiment.profile.bookmarks, "Observer bookmarks");
    if (pathname === "/api/observer-memory") this.policy.assertFeature(this.experiment.profile.observerMemory, "Observer Memory");
    throw new VeilAccessError("Mutation is not available through the laboratory interface.");
  }
  async patch(_pathname: string, _body: unknown): Promise<any> { throw new VeilAccessError("Mutation is not available through the laboratory interface."); }
  private finish(value: unknown): any {
    const filtered = veilFilter(value, this.policy) as Record<string, unknown>;
    if (Array.isArray(filtered.results)) filtered.resultCount = filtered.results.length;
    return this.experiment.profile.discloseExperimentalContext ? { ...filtered, experimentalContext: this.policy.context } : filtered;
  }
}
