#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ExperimentStore } from "../server/laboratory/experimentStore.ts";
import { DEFAULT_EXPEDITION_TIMEOUT_SECONDS, terminateProcessTree } from "./observer-loop.mjs";
import { buildLaboratoryCodexCommand } from "./lab-command.mjs";
import { createEmptyLaboratoryWorkspace, removeLaboratoryWorkspace } from "./lab-isolation.mjs";
import { freezeReconstruction, frozenArtifactPath } from "../server/laboratory/revealChamber.ts";

export const LAB_PROMPT = `You are entering ProtoUniverse.

Explore freely.

Follow your curiosity.

Use any available faculties.

Do not modify the universe.

Report what you discover, what seems puzzling, and what questions arise.`;

const values = process.argv.slice(2); let experimentId, timeoutSeconds = DEFAULT_EXPEDITION_TIMEOUT_SECONDS;
for (let index = 0; index < values.length; index++) {
  if (values[index] === "--experiment") experimentId = values[++index];
  else if (values[index] === "--expedition-timeout") timeoutSeconds = Number(values[++index]);
  else throw new Error(`unknown option: ${values[index]}`);
}
if (!experimentId) throw new Error("lab:once requires --experiment <id>");
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("expedition timeout must be a positive number");

const experiment = await new ExperimentStore().load(experimentId);
const resultsRoot = path.resolve("data/laboratory/results");
if (experiment.chamber) {
  try { await fs.access(frozenArtifactPath(resultsRoot, experiment)); throw new Error(`Phase 1 refused: frozen reconstruction already exists for ${experiment.id}`); }
  catch (error) { if (error instanceof Error && !error.message.startsWith("Phase 1 refused") && (error).code !== "ENOENT") throw error;
    if (error instanceof Error && error.message.startsWith("Phase 1 refused")) throw error; }
}
const instrumentWorkingDirectory = process.cwd();
const startedAt = new Date(), runDirectory = path.resolve("data", "laboratory", "runs", experiment.id);
await fs.mkdir(runDirectory, { recursive: true });
const id = `run-${startedAt.toISOString().replaceAll(":", "-")}`;
const transcriptFile = path.join(runDirectory, `${id}.log`), metadataFile = path.join(runDirectory, `${id}.json`);
const transcript = createWriteStream(transcriptFile, { flags: "wx" });
const observerWorkspace = await createEmptyLaboratoryWorkspace();
const lastMessageFile = experiment.chamber ? path.join(observerWorkspace, "phase-one-output.json") : undefined;
const outputSchemaFile = experiment.chamber ? path.join(instrumentWorkingDirectory, "server", "laboratory", "schemas", "archaeological-reconstruction.schema.json") : undefined;
const { command, args } = buildLaboratoryCodexCommand(experiment, observerWorkspace, instrumentWorkingDirectory, process.platform,
  { phase: "blind", outputSchemaFile, lastMessageFile });
let entry = null;
try {
  const response = await fetch(new URL(`/api/perception/orient?seed=${encodeURIComponent(experiment.universe)}`, process.env.PROTOUNIVERSE_BRIDGE_URL ?? "http://127.0.0.1:8787"), { signal: AbortSignal.timeout(3_000) });
  if (response.ok) { const value = await response.json(); entry = { universeTick: value.source?.tick ?? value.derived?.identity?.tick ?? null, simulationVersion: value.source?.simulationVersion ?? null }; }
} catch {}

process.stdout.write(`[laboratory] experiment ${experiment.id} started as ${experiment.observer}\n`);
transcript.write(`# ProtoUniverse Laboratory run\n# experiment=${experiment.id} observer=${experiment.observer} startedAt=${startedAt.toISOString()}\n\n`);
const child = spawn(command, args, { cwd: observerWorkspace, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
child.stdout.on("data", (chunk) => { process.stdout.write(chunk); transcript.write(chunk); });
child.stderr.on("data", (chunk) => { process.stderr.write(chunk); transcript.write(chunk); });
let stopping = false, timedOut = false;
const stop = async (reason) => { if (stopping || child.exitCode !== null) return; stopping = true; transcript.write(`\n[laboratory] ${reason}; terminating owned Codex process tree\n`); await terminateProcessTree(child); };
process.once("SIGINT", () => void stop("SIGINT")); process.once("SIGTERM", () => void stop("SIGTERM"));
const completion = new Promise((resolve) => child.once("exit", (exitCode, signal) => resolve({ exitCode, signal })).once("error", (error) => resolve({ exitCode: null, signal: null, error: String(error.stack ?? error) })));
child.stdin.end(experiment.prompt ?? LAB_PROMPT);
const timer = setTimeout(() => { timedOut = true; process.stderr.write(`[laboratory] expedition timeout after ${timeoutSeconds}s\n`); void stop("expedition timeout"); }, timeoutSeconds * 1_000);
const result = await completion; clearTimeout(timer);
const finishedAt = new Date();
let exactOutput = null, reconstruction = null, outputError = null;
if (experiment.chamber && result.exitCode === 0 && !timedOut && !result.error) {
  try {
    exactOutput = await fs.readFile(lastMessageFile, "utf8"); reconstruction = JSON.parse(exactOutput);
    if (reconstruction?.schemaVersion !== experiment.chamber.freeze.outputSchemaVersion) throw new Error("unexpected reconstruction schema version");
  } catch (error) { outputError = String(error instanceof Error ? error.message : error); }
}
let workspaceRemoved = false, workspaceCleanupError = null;
try { await removeLaboratoryWorkspace(observerWorkspace); workspaceRemoved = true; }
catch (error) { workspaceCleanupError = String(error instanceof Error ? error.message : error); }
await new Promise((resolve) => transcript.end(resolve));
const metadata = { recordType: "protouniverse-laboratory-run/1", experimentId: experiment.id, observer: experiment.observer,
  universe: experiment.universe, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), universeTickAtEntry: entry?.universeTick ?? null,
  experimentRevision: experiment.revision, profileVersion: experiment.profile.version, experimentDefinition: experiment,
  promptVersion: experiment.promptVersion, machineInterfaceVersion: "protouniverse-lab-mcp/1",
  simulationVersion: entry?.simulationVersion ?? null, exitCode: result.exitCode, signal: result.signal, timedOut,
  completion: timedOut ? "expedition-timeout" : result.error ? "launch-error" : "codex-exit", error: result.error ?? null,
  succeeded: result.exitCode === 0 && !timedOut && !result.error && !outputError, expeditionTimeoutSeconds: timeoutSeconds,
  environmentIsolation: "sealed-capability-set/1", workspaceIsolation: { kind: "temporary-empty-directory", removed: workspaceRemoved, cleanupError: workspaceCleanupError },
  normalMcpAvailable: false, webAvailable: false, shellAvailable: false,
  filesystemExposure: "No model filesystem tools; observer starts in an empty temporary workspace; read-only sandbox is defense in depth.",
  manualClassification: null, contaminationReason: null, phase: "blind",
  phaseOneFreeze: experiment.chamber ? { required: true, outputSchemaVersion: experiment.chamber.freeze.outputSchemaVersion } : null,
  structuredOutputError: outputError,
  command: { executable: command, args }, transcriptFile: path.basename(transcriptFile), interpretation: null };
await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
let frozen = null;
if (metadata.succeeded && experiment.chamber) {
  try { frozen = await freezeReconstruction(resultsRoot, experiment, { runId: id,
    transcriptFile: path.basename(transcriptFile), metadataFile: path.basename(metadataFile), startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(), universeTickAtEntry: entry?.universeTick ?? null, simulationVersion: entry?.simulationVersion ?? null,
    exactOutput, reconstruction }); }
  catch (error) { process.stderr.write(`[laboratory] Phase 1 freeze failed: ${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; }
}
process.stdout.write(`\n[laboratory] experiment ${experiment.id} finished | completion=${metadata.completion} | Codex exit=${result.exitCode ?? result.signal ?? "launch-error"}\n`);
if (frozen) process.stdout.write(`[laboratory] reconstruction frozen immutably | sha256=${frozen.integrity.payloadSha256}\n`);
if (!metadata.succeeded) process.exitCode = 1;
