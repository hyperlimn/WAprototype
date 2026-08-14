#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ExperimentStore } from "./experimentStore.js";
import { buildLaboratoryMcpServer } from "./laboratoryMcpServer.js";

const argument = process.argv.indexOf("--experiment");
if (argument < 0 || !process.argv[argument + 1]) throw new Error("protouniverse-lab requires --experiment <id>");
const experiment = await new ExperimentStore().load(process.argv[argument + 1]);
serveStdio(() => buildLaboratoryMcpServer(experiment), { onerror: (error) => process.stderr.write(`ProtoUniverse Laboratory MCP error: ${error.message}\n`) });
