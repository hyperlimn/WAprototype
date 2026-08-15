import { McpServer } from "@modelcontextprotocol/server";
import { McpGateway, type Gateway } from "../mcp/mcpGateway.js";
import { registerMcpTools } from "../mcp/mcpTools.js";
import { registerMcpResources } from "../mcp/mcpResources.js";
import type { ExperimentDefinition } from "../../src/laboratory/experimentTypes.js";
import { LaboratoryGateway } from "./laboratoryGateway.js";
import { registerRevealChamberTool, type FrozenArtifact } from "./revealChamber.js";

const instructions = `This is a ProtoUniverse observational doorway. Begin unfamiliar investigation with orient. Use only the exposed observational faculties. Treat inaccessible, unavailable, absent, and unknown as distinct conditions. Never infer that an inaccessible interval did not exist. The interface cannot mutate the universe.`;

export function buildLaboratoryMcpServer(experiment: ExperimentDefinition, authoritative: Gateway = new McpGateway(),
  options: { frozenArtifact?: FrozenArtifact } = {}): McpServer {
  const gateway = new LaboratoryGateway(authoritative, experiment);
  const server = new McpServer({ name: "protouniverse-lab", version: "protouniverse-lab-mcp/1" }, {
    instructions, capabilities: { tools: {}, resources: {} },
  });
  const profile = experiment.profile, presentMoment = profile.presentMoment === true;
  registerMcpTools(server, gateway, { observerMemory: experiment.profile.observerMemory, bookmarks: experiment.profile.bookmarks,
    fixedObserver: experiment.observer, faculties: { orient: profile.currentState, inspect: profile.entities || profile.relationships || profile.regions,
      context: profile.entities || profile.relationships || profile.regions, anomalies: profile.anomalyDetection, similar: profile.similarity,
      compare: profile.comparison, changes: profile.changes ?? profile.comparison, list_universes: profile.catalogs ?? true,
      history: profile.history.enabled && profile.events, checkpoints: profile.checkpoints, checkpoint: profile.checkpoints,
      human_view: profile.humanView === true, law_epoch: profile.lawEvolution === true, laws: profile.lawEvolution === true,
      law_history: profile.lawEvolution === true && profile.history.enabled, law_inspect: profile.lawEvolution === true },
    targetKinds: presentMoment ? ["entity", "relationship", "region"] : undefined,
    compareKinds: presentMoment ? ["entity", "relationship", "region"] : undefined });
  registerMcpResources(server, gateway, { bookmarks: profile.bookmarks, universe: profile.catalogs ?? true,
    entities: profile.entities, relationships: profile.relationships, checkpoints: profile.checkpoints,
    events: profile.events && profile.history.enabled, regions: profile.regions, presentMoment });
  if (options.frozenArtifact) registerRevealChamberTool(server, options.frozenArtifact);
  return server;
}
