import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ExperimentDefinition } from "../../src/laboratory/experimentTypes.js";

export const FROZEN_ARTIFACT_VERSION = "protouniverse-frozen-experiment-artifact/1";
export const COMPARISON_ARTIFACT_VERSION = "protouniverse-reveal-comparison-result/1";

const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const resultDirectory = (root: string, experiment: ExperimentDefinition): string => path.join(root, experiment.id);
export const frozenArtifactPath = (root: string, experiment: ExperimentDefinition): string => path.join(resultDirectory(root, experiment), "blind-reconstruction.json");
export const comparisonArtifactPath = (root: string, experiment: ExperimentDefinition): string => path.join(resultDirectory(root, experiment), "reveal-comparison.json");

export interface FrozenArtifact {
  recordType: typeof FROZEN_ARTIFACT_VERSION;
  immutable: true;
  frozenAt: string;
  payload: Record<string, unknown>;
  integrity: { algorithm: "sha256"; payloadSha256: string; writeMode: "exclusive-create" };
}

const protect = async (file: string): Promise<void> => { try { await chmod(file, 0o444); } catch {} };

export async function freezeReconstruction(root: string, experiment: ExperimentDefinition, input: {
  runId: string; transcriptFile: string; metadataFile: string; startedAt: string; finishedAt: string;
  universeTickAtEntry: number | null; simulationVersion: string | null; exactOutput: string; reconstruction: unknown;
}): Promise<FrozenArtifact> {
  if (!experiment.chamber) throw new Error(`Experiment ${experiment.id} has no Reveal / Comparison Chamber`);
  const payload = { experimentId: experiment.id, experimentRevision: experiment.revision, universe: experiment.universe,
    observer: experiment.observer, phase: "blind-reconstruction", artifactKind: experiment.chamber.freeze.artifactKind,
    sourceRun: { runId: input.runId, transcriptFile: input.transcriptFile, metadataFile: input.metadataFile,
      startedAt: input.startedAt, finishedAt: input.finishedAt },
    observedUniverse: { tickAtEntry: input.universeTickAtEntry, reportedRange: (input.reconstruction as any)?.observedRange ?? null },
    versions: { profile: experiment.profile.version, prompt: experiment.promptVersion,
      interface: "protouniverse-lab-mcp/1", simulation: input.simulationVersion,
      outputSchema: experiment.chamber.freeze.outputSchemaVersion, chamber: experiment.chamber.version },
    exactObserverOutput: input.exactOutput, reconstruction: input.reconstruction };
  const artifact: FrozenArtifact = { recordType: FROZEN_ARTIFACT_VERSION, immutable: true, frozenAt: new Date().toISOString(), payload,
    integrity: { algorithm: "sha256", payloadSha256: digest(payload), writeMode: "exclusive-create" } };
  const file = frozenArtifactPath(root, experiment); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o444 });
  await protect(file); return artifact;
}

export async function loadAndValidateFrozenArtifact(root: string, experiment: ExperimentDefinition): Promise<FrozenArtifact> {
  if (!experiment.chamber) throw new Error(`Experiment ${experiment.id} has no Reveal / Comparison Chamber`);
  let artifact: FrozenArtifact;
  try { artifact = JSON.parse(await readFile(frozenArtifactPath(root, experiment), "utf8")) as FrozenArtifact; }
  catch { throw new Error(`Reveal refused: no valid frozen Phase 1 artifact exists for ${experiment.id}`); }
  if (artifact.recordType !== FROZEN_ARTIFACT_VERSION || artifact.immutable !== true || artifact.integrity?.algorithm !== "sha256"
    || artifact.integrity.payloadSha256 !== digest(artifact.payload)
    || artifact.payload.experimentId !== experiment.id || artifact.payload.experimentRevision !== experiment.revision)
    throw new Error(`Reveal refused: frozen Phase 1 artifact integrity validation failed for ${experiment.id}`);
  return artifact;
}

export async function validateFrozenSourceRun(runsRoot: string, experiment: ExperimentDefinition, artifact: FrozenArtifact): Promise<void> {
  const source = artifact.payload.sourceRun as any;
  if (!source || typeof source.runId !== "string" || typeof source.metadataFile !== "string" || path.basename(source.metadataFile) !== source.metadataFile)
    throw new Error("Reveal refused: frozen artifact has invalid source-run provenance");
  const metadataFile = path.join(runsRoot, experiment.id, source.metadataFile);
  let metadata: any; try { metadata = JSON.parse(await readFile(metadataFile, "utf8")); } catch { throw new Error("Reveal refused: source Phase 1 run metadata is unavailable"); }
  if (!metadata.succeeded || metadata.experimentId !== experiment.id || metadata.observer !== experiment.observer
    || metadata.finishedAt !== source.finishedAt || Date.parse(artifact.frozenAt) < Date.parse(metadata.finishedAt))
    throw new Error("Reveal refused: source Phase 1 run was not validly completed before freezing");
}

export async function writeComparisonResult(root: string, experiment: ExperimentDefinition, frozen: FrozenArtifact, input: {
  runId: string; startedAt: string; finishedAt: string; exactOutput: string; comparison: unknown;
}): Promise<Record<string, unknown>> {
  const payload = { experimentId: experiment.id, experimentRevision: experiment.revision, universe: experiment.universe,
    phase: "reveal-comparison", sourceFrozenArtifact: { file: "blind-reconstruction.json", payloadSha256: frozen.integrity.payloadSha256,
      frozenAt: frozen.frozenAt }, sourceRun: { runId: input.runId, startedAt: input.startedAt, finishedAt: input.finishedAt },
    versions: { chamber: experiment.chamber?.version, prompt: experiment.chamber?.reveal.promptVersion,
      outputSchema: experiment.chamber?.reveal.outputSchemaVersion, interface: "protouniverse-lab-mcp/1" },
    exactObserverOutput: input.exactOutput, comparison: input.comparison };
  const result = { recordType: COMPARISON_ARTIFACT_VERSION, immutable: true, createdAt: new Date().toISOString(), payload,
    integrity: { algorithm: "sha256", payloadSha256: digest(payload), writeMode: "exclusive-create" } };
  const file = comparisonArtifactPath(root, experiment); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o444 });
  await protect(file); return result;
}

export function validateComparisonAgainstFrozen(frozen: FrozenArtifact, comparison: any, expectedSchemaVersion: string): void {
  if (comparison?.schemaVersion !== expectedSchemaVersion) throw new Error("unexpected comparison schema version");
  if (comparison.frozenArtifactHash !== frozen.integrity.payloadSha256) throw new Error("comparison did not bind to the validated frozen artifact hash");
  const originals = (frozen.payload.reconstruction as any)?.hypotheses ?? [], evaluations = comparison.evaluations ?? [];
  if (evaluations.length !== originals.length) throw new Error("comparison must evaluate every frozen hypothesis exactly once");
  for (const original of originals) {
    const matches = evaluations.filter((item: any) => item.hypothesisId === original.id);
    if (matches.length !== 1) throw new Error(`comparison altered or omitted frozen hypothesis ${original.id}`);
    const evaluation = matches[0];
    if (evaluation.originalHypothesis !== original.hypothesis || evaluation.originalConfidence !== original.confidence
      || evaluation.originalReasoning !== original.reasoning || evaluation.originalEstimatedTiming !== original.estimatedTiming
      || evaluation.originalPrediction !== original.prediction || JSON.stringify(evaluation.originalEvidence) !== JSON.stringify(original.evidence)
      || JSON.stringify(evaluation.originalCompetingExplanations) !== JSON.stringify(original.competingExplanations))
      throw new Error(`comparison altered or omitted frozen hypothesis ${original.id}`);
  }
}

export function registerRevealChamberTool(server: McpServer, artifact: FrozenArtifact): void {
  server.registerTool("frozen_reconstruction", { title: "Read frozen reconstruction", description: "Read the immutable blind reconstruction exactly as frozen before reveal.",
    inputSchema: z.object({}), outputSchema: z.looseObject({}), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  async () => ({ content: [{ type: "text", text: `Frozen reconstruction ${artifact.integrity.payloadSha256}. Original wording is immutable.` }], structuredContent: artifact }));
}
