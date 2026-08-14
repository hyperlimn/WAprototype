import { McpServer } from "@modelcontextprotocol/server";
import { McpGateway, type Gateway } from "../mcp/mcpGateway.js";
import { registerMcpTools } from "../mcp/mcpTools.js";
import { registerMcpResources } from "../mcp/mcpResources.js";
import type { ExperimentDefinition } from "../../src/laboratory/experimentTypes.js";
import { LaboratoryGateway } from "./laboratoryGateway.js";

const instructions = `This is a ProtoUniverse observational doorway. Begin unfamiliar investigation with orient. Use only the exposed observational faculties. Treat inaccessible, unavailable, absent, and unknown as distinct conditions. Never infer that an inaccessible interval did not exist. The interface cannot mutate the universe.`;

export function buildLaboratoryMcpServer(experiment: ExperimentDefinition, authoritative: Gateway = new McpGateway()): McpServer {
  const gateway = new LaboratoryGateway(authoritative, experiment);
  const server = new McpServer({ name: "protouniverse-lab", version: "protouniverse-lab-mcp/1" }, {
    instructions, capabilities: { tools: {}, resources: {} },
  });
  registerMcpTools(server, gateway, { observerMemory: experiment.profile.observerMemory, bookmarks: experiment.profile.bookmarks,
    fixedObserver: experiment.observer });
  registerMcpResources(server, gateway, { bookmarks: experiment.profile.bookmarks });
  return server;
}
