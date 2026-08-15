#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ExperimentStore } from "./experimentStore.js";
import { buildLaboratoryMcpServer } from "./laboratoryMcpServer.js";
import path from "node:path";
import { loadAndValidateFrozenArtifact, type FrozenArtifact } from "./revealChamber.js";

const argument = process.argv.indexOf("--experiment");
if (argument < 0 || !process.argv[argument + 1]) throw new Error("protouniverse-lab requires --experiment <id>");
const definition = await new ExperimentStore().load(process.argv[argument + 1]);
const phaseArgument = process.argv.indexOf("--phase"), phase = phaseArgument < 0 ? "blind" : process.argv[phaseArgument + 1];
if (phase !== "blind" && phase !== "reveal") throw new Error("laboratory MCP phase must be blind or reveal");
let experiment = definition, frozenArtifact: FrozenArtifact | undefined;
if (phase === "reveal") {
  if (!definition.chamber) throw new Error(`Experiment ${definition.id} has no Reveal / Comparison Chamber`);
  frozenArtifact = await loadAndValidateFrozenArtifact(path.resolve("data/laboratory/results"), definition);
  experiment = { ...definition, observer: definition.chamber.reveal.observer, promptVersion: definition.chamber.reveal.promptVersion,
    prompt: definition.chamber.reveal.prompt, profile: definition.chamber.reveal.profile };
}
serveStdio(() => buildLaboratoryMcpServer(experiment, undefined, { frozenArtifact }),
  { onerror: (error) => process.stderr.write(`ProtoUniverse Laboratory MCP error: ${error.message}\n`) });
