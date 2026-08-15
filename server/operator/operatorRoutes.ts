import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { ExperimentStore } from "../laboratory/experimentStore.js";
import { comparisonArtifactPath, frozenArtifactPath } from "../laboratory/revealChamber.js";
import { OperatorManager } from "./operatorManager.js";

type Json = (response: ServerResponse, status: number, body: unknown) => void;
const exists = (file: string) => access(file).then(() => true, () => false);
const body = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 20_000) throw new Error("Operator request too large"); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

export class OperatorRoutes {
  readonly manager = new OperatorManager();
  constructor(readonly runtime: () => unknown) {}
  async handle(request: IncomingMessage, url: URL, response: ServerResponse, json: Json): Promise<boolean> {
    if (!url.pathname.startsWith("/api/operator")) return false;
    const origin = request.headers.origin;
    if (origin && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)) { json(response, 403, { error: "operator_origin_forbidden" }); return true; }
    if (request.method === "GET" && url.pathname === "/api/operator/catalog") {
      const definitions = await new ExperimentStore().list(), results = path.resolve("data/laboratory/results");
      const experiments = await Promise.all(definitions.map(async (experiment) => {
        const frozen = experiment.chamber ? await exists(frozenArtifactPath(results, experiment)) : false;
        const compared = experiment.chamber ? await exists(comparisonArtifactPath(results, experiment)) : false;
        return { id: experiment.id, observer: experiment.observer, hasChamber: Boolean(experiment.chamber), frozen, compared,
          blindAvailable: !frozen, revealAvailable: Boolean(experiment.chamber && frozen && !compared),
          revealUnavailableReason: !experiment.chamber ? "No Reveal / Comparison Chamber" : !frozen ? "No frozen reconstruction exists" : compared ? "Reveal comparison already exists" : null };
      }));
      json(response, 200, { commands: this.manager.catalog(), experiments, runtime: this.runtime(), saveStatePattern: "data/universes/<universe>/save-states/save-<12-digit-tick>.json" }); return true;
    }
    if (request.method === "GET" && url.pathname === "/api/operator/runs") { json(response, 200, { runs: this.manager.list() }); return true; }
    if (request.method === "POST" && url.pathname === "/api/operator/run") {
      try { const value = await body(request) as { commandId?: unknown; args?: unknown };
        if (typeof value.commandId !== "string") throw new Error("commandId is required");
        json(response, 202, { run: this.manager.start(value.commandId, value.args) });
      } catch (error) { json(response, 400, { error: "invalid_operator_action", message: error instanceof Error ? error.message : "invalid action" }); } return true;
    }
    const stop = url.pathname.match(/^\/api\/operator\/runs\/([^/]+)\/stop$/);
    if (request.method === "POST" && stop) {
      try { json(response, 200, { run: await this.manager.stop(decodeURIComponent(stop[1])) }); }
      catch (error) { json(response, 409, { error: "operator_stop_refused", message: error instanceof Error ? error.message : "stop refused" }); } return true;
    }
    json(response, 404, { error: "not_found", resource: "operator" }); return true;
  }
}
