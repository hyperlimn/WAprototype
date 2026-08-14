import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildMcpServer } from "./mcpServer.js";

serveStdio(() => buildMcpServer(), { onerror: (error) => process.stderr.write(`ProtoUniverse MCP error: ${error.message}\n`) });
