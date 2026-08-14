import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";
import { LABORATORY_SCHEMA_VERSION, VEIL_PROFILE_VERSION, type ExperimentDefinition } from "../../src/laboratory/experimentTypes.js";

const identity = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/);
const profileSchema = z.strictObject({
  version: z.literal(VEIL_PROFILE_VERSION),
  history: z.strictObject({ enabled: z.boolean(), minimumAccessibleTick: z.number().int().min(0).optional() }),
  currentState: z.boolean(), checkpoints: z.boolean(), events: z.boolean(), entities: z.boolean(), relationships: z.boolean(),
  ancestry: z.boolean(), coordinates: z.boolean(), energy: z.boolean(), relationshipMetrics: z.boolean(), regions: z.boolean(),
  similarity: z.boolean(), anomalyDetection: z.boolean(), comparison: z.boolean(), observerMemory: z.boolean(), bookmarks: z.boolean(),
  discloseExperimentalContext: z.boolean(),
});
const experimentSchema = z.strictObject({ schemaVersion: z.literal(LABORATORY_SCHEMA_VERSION), id: identity, revision: z.string().min(1).max(120),
  universe: z.string().min(1).max(120), observer: identity, promptVersion: z.string().min(1).max(120), profile: profileSchema,
  description: z.string().max(1000).optional() });

export class ExperimentDefinitionError extends Error {}

export class ExperimentStore {
  constructor(readonly directory = path.resolve(process.env.PROTOUNIVERSE_LAB_ROOT ?? "data/laboratory", "experiments")) {}
  async load(id: string): Promise<ExperimentDefinition> {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) throw new ExperimentDefinitionError("invalid experiment id");
    try { return experimentSchema.parse(JSON.parse(await readFile(path.join(this.directory, `${id}.json`), "utf8"))) as ExperimentDefinition; }
    catch (error) { throw new ExperimentDefinitionError(`Cannot load experiment ${id}: ${error instanceof Error ? error.message : "invalid definition"}`); }
  }
  async list(): Promise<ExperimentDefinition[]> {
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map((name) => this.load(name.slice(0, -5))));
  }
}
