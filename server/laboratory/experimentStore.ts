import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";
import { CLEAN_ROOM_VEIL_PROFILE_VERSION, DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION, LABORATORY_SCHEMA_VERSION, PRESENT_MOMENT_VEIL_PROFILE_VERSION, REVEAL_CHAMBER_VERSION, VEIL_PROFILE_VERSION, type ExperimentDefinition } from "../../src/laboratory/experimentTypes.js";

const identity = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/);
const profileSchema = z.strictObject({
  version: z.union([z.literal(VEIL_PROFILE_VERSION), z.literal(DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION), z.literal(CLEAN_ROOM_VEIL_PROFILE_VERSION), z.literal(PRESENT_MOMENT_VEIL_PROFILE_VERSION)]),
  history: z.strictObject({ enabled: z.boolean(), minimumAccessibleTick: z.number().int().min(0).optional() }),
  currentState: z.boolean(), checkpoints: z.boolean(), events: z.boolean(), entities: z.boolean(), relationships: z.boolean(),
  ancestry: z.boolean(), coordinates: z.boolean(), energy: z.boolean(), relationshipMetrics: z.boolean(), regions: z.boolean(),
  similarity: z.boolean(), anomalyDetection: z.boolean(), comparison: z.boolean(), observerMemory: z.boolean(), bookmarks: z.boolean(),
  discloseExperimentalContext: z.boolean(),
  historicalInscriptions: z.strictObject({ mode: z.literal("redact"), retainStructuralLineage: z.boolean() }).optional(),
  entityIdentifiers: z.literal("opaque").optional(),
  relationshipIdentifiers: z.literal("opaque").optional(),
  cleanRoomHistory: z.strictObject({ eventIdentifiers: z.literal("opaque"), paginationCursors: z.literal("opaque"),
    redactCumulativeBookkeeping: z.literal(true) }).optional(),
  identityPresentation: z.literal("non-order-preserving").optional(), presentMoment: z.literal(true).optional(),
  changes: z.boolean().optional(), catalogs: z.boolean().optional(), humanView: z.boolean().optional(),
}).superRefine((profile, context) => {
  const hasV2Policy = Boolean(profile.historicalInscriptions || profile.entityIdentifiers || profile.relationshipIdentifiers || profile.cleanRoomHistory);
  if (profile.version === VEIL_PROFILE_VERSION && hasV2Policy)
    context.addIssue({ code: "custom", message: "Veil v2/v3 access policies are unavailable in Veil v1" });
  if (profile.version === DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION && !hasV2Policy)
    context.addIssue({ code: "custom", message: "Veil v2 requires a v2 access policy" });
  if (profile.version === DEEP_ARCHAEOLOGY_VEIL_PROFILE_VERSION && (profile.relationshipIdentifiers || profile.cleanRoomHistory))
    context.addIssue({ code: "custom", message: "Clean-room policies require Veil v3" });
  if (profile.version === CLEAN_ROOM_VEIL_PROFILE_VERSION && (!profile.relationshipIdentifiers || !profile.cleanRoomHistory))
    context.addIssue({ code: "custom", message: "Veil v3 requires relationship identifiers and cleanRoomHistory" });
  if (profile.version === PRESENT_MOMENT_VEIL_PROFILE_VERSION && (!profile.identityPresentation || !profile.entityIdentifiers || !profile.relationshipIdentifiers))
    context.addIssue({ code: "custom", message: "Veil v4 requires non-order-preserving entity and relationship identities" });
  if (profile.presentMoment && (profile.history.enabled || profile.checkpoints || profile.events || profile.similarity || profile.changes !== false || profile.catalogs !== false))
    context.addIssue({ code: "custom", message: "Present Moment must disable history, checkpoints, events, similarity, changes, and catalogs" });
});
const chamberSchema = z.strictObject({ version: z.literal(REVEAL_CHAMBER_VERSION),
  freeze: z.strictObject({ artifactKind: identity, outputSchemaVersion: z.string().min(1).max(120) }),
  reveal: z.strictObject({ observer: identity, promptVersion: z.string().min(1).max(120), prompt: z.string().min(1).max(30_000),
    outputSchemaVersion: z.string().min(1).max(120), profile: profileSchema }) });
const experimentSchema = z.strictObject({ schemaVersion: z.literal(LABORATORY_SCHEMA_VERSION), id: identity, revision: z.string().min(1).max(120),
  universe: z.string().min(1).max(120), observer: identity, promptVersion: z.string().min(1).max(120), profile: profileSchema,
  prompt: z.string().min(1).max(30_000).optional(), chamber: chamberSchema.optional(),
  description: z.string().max(1000).optional(), scientificQuestion: z.string().min(1).max(1000).optional() });

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
