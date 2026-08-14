import { McpServer } from "@modelcontextprotocol/server";
import { McpGateway } from "./mcpGateway.js";
import { MCP_INSTRUCTIONS } from "./mcpInstructions.js";
import { registerMcpTools } from "./mcpTools.js";
import { registerMcpResources } from "./mcpResources.js";
import { registerMcpPrompts } from "./mcpPrompts.js";

export function buildMcpServer(gateway = new McpGateway()): McpServer {
  const server = new McpServer({ name: "protouniverse", version: "protouniverse-mcp/1" }, { instructions: MCP_INSTRUCTIONS,
    capabilities: { tools: {}, resources: {}, prompts: {} } });
  registerMcpTools(server, gateway); registerMcpResources(server, gateway); registerMcpPrompts(server); return server;
}
