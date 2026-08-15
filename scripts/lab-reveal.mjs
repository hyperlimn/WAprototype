#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ExperimentStore } from "../server/laboratory/experimentStore.ts";
import { comparisonArtifactPath, loadAndValidateFrozenArtifact, validateComparisonAgainstFrozen, validateFrozenSourceRun, writeComparisonResult } from "../server/laboratory/revealChamber.ts";
import { DEFAULT_EXPEDITION_TIMEOUT_SECONDS, terminateProcessTree } from "./observer-loop.mjs";
import { buildLaboratoryCodexCommand } from "./lab-command.mjs";
import { createEmptyLaboratoryWorkspace, removeLaboratoryWorkspace } from "./lab-isolation.mjs";

const values = process.argv.slice(2); let experimentId, timeoutSeconds = DEFAULT_EXPEDITION_TIMEOUT_SECONDS;
for (let index = 0; index < values.length; index++) {
  if (values[index] === "--experiment") experimentId = values[++index];
  else if (values[index] === "--expedition-timeout") timeoutSeconds = Number(values[++index]);
  else throw new Error(`unknown option: ${values[index]}`);
}
if (!experimentId) throw new Error("lab:reveal requires --experiment <id>");
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("expedition timeout must be a positive number");

const definition = await new ExperimentStore().load(experimentId);
if (!definition.chamber) throw new Error(`Experiment ${definition.id} has no Reveal / Comparison Chamber`);
const repository = process.cwd(), resultsRoot = path.resolve("data/laboratory/results"), runsRoot = path.resolve("data/laboratory/runs");
const frozen = await loadAndValidateFrozenArtifact(resultsRoot, definition);
await validateFrozenSourceRun(runsRoot, definition, frozen);
try { await fs.access(comparisonArtifactPath(resultsRoot, definition)); throw new Error(`Reveal refused: comparison result already exists for ${definition.id}`); }
catch (error) { if (error instanceof Error && !error.message.startsWith("Reveal refused") && (error).code !== "ENOENT") throw error;
  if (error instanceof Error && error.message.startsWith("Reveal refused")) throw error; }
const experiment = { ...definition, observer: definition.chamber.reveal.observer, promptVersion: definition.chamber.reveal.promptVersion,
  prompt: definition.chamber.reveal.prompt, profile: definition.chamber.reveal.profile };
const startedAt = new Date(), runDirectory = path.join(runsRoot, definition.id, "reveal"); await fs.mkdir(runDirectory, { recursive: true });
const id = `reveal-${startedAt.toISOString().replaceAll(":", "-")}`, transcriptFile = path.join(runDirectory, `${id}.log`), metadataFile = path.join(runDirectory, `${id}.json`);
const transcript = createWriteStream(transcriptFile, { flags: "wx" }), stage = await createEmptyLaboratoryWorkspace();
const lastMessageFile = path.join(stage, "reveal-comparison-output.json");
const outputSchemaFile = path.join(repository, "server", "laboratory", "schemas", "archaeological-reveal-comparison.schema.json");
const { command, args } = buildLaboratoryCodexCommand(definition, stage, repository, process.platform,
  { phase: "reveal", outputSchemaFile, lastMessageFile });
transcript.write(`# ProtoUniverse Reveal / Comparison run\n# experiment=${definition.id} frozenSha256=${frozen.integrity.payloadSha256} startedAt=${startedAt.toISOString()}\n\n`);
process.stdout.write(`[laboratory] reveal ${definition.id} started | frozenSha256=${frozen.integrity.payloadSha256}\n`);
const child = spawn(command, args, { cwd: stage, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
child.stdout.on("data", (chunk) => { process.stdout.write(chunk); transcript.write(chunk); });
child.stderr.on("data", (chunk) => { process.stderr.write(chunk); transcript.write(chunk); });
let stopping = false, timedOut = false;
const stop = async (reason) => { if (stopping || child.exitCode !== null) return; stopping = true; transcript.write(`\n[laboratory] ${reason}; terminating owned Codex process tree\n`); await terminateProcessTree(child); };
process.once("SIGINT", () => void stop("SIGINT")); process.once("SIGTERM", () => void stop("SIGTERM"));
const completion = new Promise((resolve) => child.once("exit", (exitCode, signal) => resolve({ exitCode, signal })).once("error", (error) => resolve({ exitCode: null, signal: null, error: String(error.stack ?? error) })));
child.stdin.end(experiment.prompt);
const timer = setTimeout(() => { timedOut = true; process.stderr.write(`[laboratory] reveal timeout after ${timeoutSeconds}s\n`); void stop("reveal timeout"); }, timeoutSeconds * 1_000);
const result = await completion; clearTimeout(timer); const finishedAt = new Date();
let exactOutput = null, comparison = null, outputError = null;
if (result.exitCode === 0 && !timedOut && !result.error) {
  try {
    exactOutput = await fs.readFile(lastMessageFile, "utf8"); comparison = JSON.parse(exactOutput);
    validateComparisonAgainstFrozen(frozen, comparison, definition.chamber.reveal.outputSchemaVersion);
  } catch (error) { outputError = String(error instanceof Error ? error.message : error); }
}
let workspaceRemoved = false, workspaceCleanupError = null;
try { await removeLaboratoryWorkspace(stage); workspaceRemoved = true; } catch (error) { workspaceCleanupError = String(error instanceof Error ? error.message : error); }
await new Promise((resolve) => transcript.end(resolve));
const metadata = { recordType: "protouniverse-laboratory-run/1", phase: "reveal-comparison", experimentId: definition.id,
  observer: experiment.observer, universe: definition.universe, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
  experimentRevision: definition.revision, profileVersion: experiment.profile.version, promptVersion: experiment.promptVersion,
  machineInterfaceVersion: "protouniverse-lab-mcp/1", frozenArtifactSha256: frozen.integrity.payloadSha256,
  exitCode: result.exitCode, signal: result.signal, timedOut, completion: timedOut ? "expedition-timeout" : result.error ? "launch-error" : "codex-exit",
  error: result.error ?? null, structuredOutputError: outputError, succeeded: result.exitCode === 0 && !timedOut && !result.error && !outputError,
  expeditionTimeoutSeconds: timeoutSeconds, environmentIsolation: "sealed-capability-set/1",
  workspaceIsolation: { kind: "temporary-empty-directory", removed: workspaceRemoved, cleanupError: workspaceCleanupError },
  normalMcpAvailable: false, webAvailable: false, shellAvailable: false,
  filesystemExposure: "No model filesystem tools; frozen artifact is exposed only through the read-only chamber faculty.",
  command: { executable: command, args }, transcriptFile: path.basename(transcriptFile), interpretation: null };
await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
if (metadata.succeeded) {
  try { const saved = await writeComparisonResult(resultsRoot, definition, frozen, { runId: id, startedAt: metadata.startedAt,
    finishedAt: metadata.finishedAt, exactOutput, comparison }); process.stdout.write(`[laboratory] comparison saved immutably | sha256=${saved.integrity.payloadSha256}\n`); }
  catch (error) { process.stderr.write(`[laboratory] comparison save failed: ${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; }
} else process.exitCode = 1;
process.stdout.write(`[laboratory] reveal ${definition.id} finished | completion=${metadata.completion}\n`);
