import type { McpServer, ResourceLink } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Gateway } from "./mcpGateway.js";
import { checkpointUri, entityUri, eventUri, regionUri, relationshipUri, universeUri } from "./mcpUris.js";
import { historySchema, limit, seed, targetSchema } from "./mcpSchemas.js";
import { OBSERVER_MEMORY_KINDS } from "../../src/observer-memory/observerMemoryTypes.js";
import { DIMENSION_MODES } from "../../src/rendering/dimensionProjection.js";
import { renderHumanView } from "./humanView.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const observerWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const genericOutput = z.looseObject({});
const output = (result: any, summary: string, links: ResourceLink[] = []) => ({ content: [{ type: "text" as const, text: summary }, ...links], structuredContent: result });
const link = (uri: string, name: string, description: string): ResourceLink => ({ type: "resource_link", uri, name, description, mimeType: "application/json" });

const resolvedSeed = (value: any): string | null => value?.source?.seed ?? value?.seed ?? value?.derived?.identity?.seed ?? null;
const attentionLinks = (result: any): ResourceLink[] => {
  const selectedSeed = resolvedSeed(result); if (!selectedSeed) return [];
  return (result?.derived?.attentionSuggestions ?? []).slice(0, 10).flatMap((item: any) => item.kind === "entity" ? [link(entityUri(selectedSeed, item.identifier), `Entity ${item.identifier}`, item.reason)]
    : item.kind === "relationship" ? [link(relationshipUri(selectedSeed, String(item.identifier)), `Relationship ${item.identifier}`, item.reason)]
    : item.region ? [link(regionUri(selectedSeed, item.region.x, item.region.y, item.region.radius), "Suggested region", item.reason)] : []);
};
const targetParams = (args: z.infer<typeof targetSchema>) => ({ ...args });

type Faculty = "orient" | "inspect" | "context" | "anomalies" | "similar" | "compare" | "changes" | "list_universes" | "history" | "checkpoints" | "checkpoint" | "human_view";
export interface McpToolOptions { observerMemory?: boolean; bookmarks?: boolean; fixedObserver?: string;
  faculties?: Partial<Record<Faculty, boolean>>; targetKinds?: Array<"entity" | "relationship" | "region" | "checkpoint" | "event">;
  compareKinds?: Array<"entity" | "relationship" | "region" | "checkpoint" | "universe"> }
export function registerMcpTools(server: McpServer, gateway: Gateway, options: McpToolOptions = {}): void {
  const observerMemory = options.observerMemory ?? true, bookmarks = options.bookmarks ?? true;
  const enabled = (faculty: Faculty): boolean => options.faculties?.[faculty] !== false;
  const targetKinds = options.targetKinds ?? ["entity", "relationship", "region", "checkpoint", "event"];
  const scopedTargetSchema = targetSchema.extend({ kind: z.enum(targetKinds as [typeof targetKinds[number], ...typeof targetKinds[number][]]) });
  if (enabled("human_view")) server.registerTool("human_view", { title: "Look through the ProtoUniverse human view",
    description: "Render the current authoritative universe through the same dimension projection semantics as the human canvas. Returns a deterministic PNG, not a browser or desktop screenshot.",
    inputSchema: z.object({ seed, dimension: z.enum(DIMENSION_MODES).default("composite"), width: z.number().int().min(160).max(1600).default(1000),
      height: z.number().int().min(120).max(1200).default(700), centerX: z.number().finite().optional(), centerY: z.number().finite().optional(),
      zoom: z.number().positive().max(20).optional(), worldRadius: z.number().positive().optional() }).refine((value) => !(value.zoom && value.worldRadius), { message: "Specify zoom or worldRadius, not both." }),
    annotations: readOnly }, async (args) => {
      const rendered = await renderHumanView(gateway, args);
      return { content: [{ type: "image" as const, data: rendered.png.toString("base64"), mimeType: "image/png" },
        { type: "text" as const, text: `Rendered ${rendered.metadata.dimension} view of ${rendered.metadata.universe} at authoritative tick ${rendered.metadata.tick}.` }],
        structuredContent: rendered.metadata };
    });
  if (enabled("orient")) server.registerTool("orient", { title: "Orient in ProtoUniverse", description: "Start here in an unfamiliar universe. Answers what is happening and where to look next using authoritative observations plus explainable derived perception.",
    inputSchema: z.object({ seed, observer: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/).optional() }), outputSchema: genericOutput, annotations: observerWrite }, async (args) => {
      const observer = options.fixedObserver ?? args.observer;
      const result = await gateway.get("/api/perception/orient", { seed: args.seed, observer });
      if (observer && bookmarks) result.sinceLast = await gateway.get("/api/perception/since-last", { observer, seed: args.seed });
      const identity = result.derived?.identity ?? {}; return output(result, `Universe ${identity.seed ?? "unavailable"} at tick ${identity.tick ?? "unknown"}: ${identity.population ?? 0} entities, ${identity.relationshipCount ?? 0} relationships; ${result.derived?.attentionSuggestions?.length ?? 0} attention suggestions.`, attentionLinks(result));
    });
  for (const [name, endpoint, description] of ([
    ["inspect", "/api/perception/inspect", options.targetKinds
      ? `Inspect a permitted present ${targetKinds.join(", ")} target with bounded surrounding context.`
      : "Inspect an entity, relationship, inferred region, checkpoint, or event with bounded surrounding context."],
    ["context", "/api/perception/context", "Zoom out from a target into its larger local neighborhood, connections, lineage, and activity."],
  ] as const).filter(([name]) => enabled(name))) server.registerTool(name, { title: name === "inspect" ? "Inspect target" : "Context of target", description, inputSchema: scopedTargetSchema, outputSchema: genericOutput, annotations: readOnly }, async (args) => {
    const result = await gateway.get(endpoint, targetParams(args)); const selectedSeed = args.seed ?? result.source?.seed ?? result.seed;
    const links: ResourceLink[] = selectedSeed ? [args.kind === "entity" ? link(entityUri(selectedSeed, String(args.id)), `Entity ${args.id}`, "Navigable entity resource")
      : args.kind === "relationship" ? link(relationshipUri(selectedSeed, String(args.id)), `Relationship ${args.id}`, "Navigable relationship resource")
      : args.kind === "checkpoint" ? link(checkpointUri(selectedSeed, Number(args.tick)), `Checkpoint ${args.tick}`, "Observational checkpoint")
      : args.kind === "event" ? link(eventUri(selectedSeed, Number(args.tick), args.sequence ?? "unknown"), `Event ${args.tick}/${args.sequence}`, "Archived occurrence")
      : link(regionUri(selectedSeed, Number(args.x), Number(args.y), Number(args.radius)), "Inferred region", "Geometric region, not an authoritative cluster")] : [];
    return output(result, `${name} ${args.kind}: ${result.summary ?? "context derived"}.`, links);
  });
  if (enabled("anomalies")) server.registerTool("anomalies", { title: "Find anomalies", description: "Find statistically unusual entities or relationships with explainable median/MAD scores and baselines.",
    inputSchema: z.object({ seed, kind: z.enum(["entity", "relationship"]).optional(), limit, x: z.number().optional(), y: z.number().optional(), radius: z.number().min(0).optional() }), outputSchema: genericOutput, annotations: readOnly }, async (args) => {
      const result = await gateway.get("/api/perception/anomalies", args); const selectedSeed = resolvedSeed(result) ?? args.seed;
      const links = selectedSeed ? (result.results ?? []).slice(0, 10).map((item: any) => item.kind === "entity" ? link(entityUri(selectedSeed, item.identifier), `Entity ${item.identifier}`, item.reason)
        : link(relationshipUri(selectedSeed, String(item.identifier)), `Relationship ${item.identifier}`, item.reason)) : [];
      return output(result, `${result.results?.length ?? 0} explainable anomalies found.`, links);
    });
  if (enabled("similar")) server.registerTool("similar", { title: "Find similar phenomena", description: "Find transparent structural or behavioral analogues using versioned normalized features.",
    inputSchema: z.object({ seed, kind: z.enum(["entity", "relationship", "region"]), id: z.string().optional(), x: z.number().optional(), y: z.number().optional(), radius: z.number().min(0).optional(), limit }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => output(await gateway.get("/api/perception/similar", args), `Nearest ${args.kind} analogues ranked by normalized feature similarity.`));
  const compareKinds = options.compareKinds ?? ["entity", "relationship", "region", "checkpoint", "universe"];
  if (enabled("compare")) server.registerTool("compare", { title: "Compare targets", description: "Compare two permitted present targets. Differences are observational, not causal.",
    inputSchema: z.object({ kind: z.enum(compareKinds as [typeof compareKinds[number], ...typeof compareKinds[number][]]), seed, compareSeed: z.string().optional(), idA: z.string().optional(), idB: z.string().optional(),
      tickA: z.number().int().min(0).optional(), tickB: z.number().int().min(0).optional(), xA: z.number().optional(), yA: z.number().optional(), radiusA: z.number().min(0).optional(), xB: z.number().optional(), yB: z.number().optional(), radiusB: z.number().min(0).optional() }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => output(await gateway.get("/api/perception/compare", args), `${args.kind} comparison; differences are observational, not causal.`));
  if (enabled("changes")) server.registerTool("changes", { title: "Detect changes", description: "Rank changes against a checkpoint, prior tick, or another universe. Reports association, never causation.",
    inputSchema: z.object({ seed, compareSeed: z.string().optional(), sinceTick: z.number().int().min(0).optional(), checkpoint: z.number().int().min(0).optional(), tick: z.number().int().min(0).optional() }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => output(await gateway.get("/api/perception/changes", args), "Changes ranked by normalized significance; no causal inference is implied."));
  if (bookmarks) server.registerTool("since_last", { title: "Changes since observer last looked", description: "Read changes since a persistent explicit observer bookmark. Does not update the bookmark.",
    inputSchema: z.object({ observer: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), seed }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => output(await gateway.get("/api/perception/since-last", args), `Changes since ${args.observer}'s prior bookmark.`));
  if (bookmarks) server.registerTool("mark_observed", { title: "Mark observer position", description: "Write observer metadata only. This never mutates simulation state or universe history.",
    inputSchema: z.object({ observer: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), seed: z.string().min(1).max(120), tick: z.number().int().min(0) }), outputSchema: genericOutput, annotations: observerWrite },
    async (args) => output(await gateway.post("/api/perception/mark-observed", args), `Observer ${args.observer} bookmarked ${args.seed} at tick ${args.tick}; universe unchanged.`));
  const reference = z.object({ kind: z.enum(["entity", "relationship", "event", "checkpoint", "region", "history", "uri"]), id: z.string().max(1000).optional(), tick: z.number().int().min(0).optional(), sequence: z.number().int().min(0).optional(), uri: z.string().max(1000).optional(), note: z.string().max(1000).optional(), evidenceRole: z.enum(["supports", "contradicts", "context", "target"]).optional() });
  if (observerMemory) server.registerTool("recall_observer_memory", { title: "Recall observer memory", description: "Retrieve this named observer's non-authoritative notebook for one universe, optionally filtered by kind and lifecycle status.",
    inputSchema: z.object({ observer: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), universe: z.string().min(1).max(120), kind: z.enum(OBSERVER_MEMORY_KINDS).optional(), status: z.enum(["open", "resolved", "superseded"]).optional(), limit }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => { const result = await gateway.get("/api/observer-memory", args); return output(result, `${result.resultCount ?? 0} observer-authored memories recalled for ${args.observer} in ${args.universe}.`); });
  if (observerMemory) server.registerTool("remember", { title: "Remember for this observer", description: "Record an observation, investigation, question, hypothesis, prediction, revisit intention, conclusion, or surprise. The record never becomes universe truth.",
    inputSchema: z.object({ observer: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), universe: z.string().min(1).max(120), kind: z.enum(OBSERVER_MEMORY_KINDS), content: z.string().min(1).max(8000), universeTick: z.number().int().min(0).optional(), tags: z.array(z.string().max(80)).max(30).optional(), references: z.array(reference).max(50).optional() }), outputSchema: genericOutput, annotations: observerWrite },
    async (args) => output(await gateway.post("/api/observer-memory", args), `Stored ${args.kind} in ${args.observer}'s notebook for ${args.universe}; universe unchanged.`));
  if (observerMemory) server.registerTool("update_observer_memory", { title: "Update or resolve observer inquiry", description: "Revise, resolve, reopen, or supersede an existing observer-authored memory while retaining revision provenance.",
    inputSchema: z.object({ observer: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), universe: z.string().min(1).max(120), id: z.string().uuid(), content: z.string().min(1).max(8000).optional(), status: z.enum(["open", "resolved", "superseded"]).optional(), resolution: z.string().min(1).max(8000).optional(), note: z.string().min(1).max(8000).optional(), references: z.array(reference).max(50).optional() }), outputSchema: genericOutput, annotations: observerWrite },
    async (args) => { const { id, ...body } = args; return output(await gateway.patch(`/api/observer-memory/${encodeURIComponent(id)}`, body), `Updated observer memory ${id}; universe unchanged.`); });
  if (enabled("list_universes")) server.registerTool("list_universes", { title: "List archived universes", description: "Discover valid persisted ProtoUniverse archives from manifest metadata.", inputSchema: z.object({}), outputSchema: genericOutput, annotations: readOnly },
    async () => { const result = await gateway.get("/api/universes"); return output(result, `${result.resultCount ?? 0} archived universes available.`, (result.results ?? []).map((item: any) => link(universeUri(item.seed), `Universe ${item.seed}`, "Archived universe"))); });
  if (enabled("history")) server.registerTool("history", { title: "Search archive history", description: "Page newest-first through persisted events. Return nextCursor unchanged for continuation.", inputSchema: historySchema, outputSchema: genericOutput, annotations: readOnly },
    async (args) => { const result = await gateway.get("/api/history", args); const links = (result.results ?? []).slice(0, 10).map((item: any) => link(eventUri(result.seed, item.tick, item.sequence), `Event ${item.tick}/${item.sequence}`, item.description)); return output(result, `${result.resultCount ?? 0} events; hasMore=${Boolean(result.hasMore)}.`, links); });
  if (enabled("checkpoints")) server.registerTool("checkpoints", { title: "List checkpoints", description: "List observational world-state fossils in a bounded tick range.",
    inputSchema: z.object({ seed, sinceTick: z.number().int().min(0).optional(), untilTick: z.number().int().min(0).optional(), limit }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => { const result = await gateway.get("/api/checkpoints", args); return output(result, `${result.resultCount ?? 0} checkpoints.`, (result.results ?? []).map((item: any) => link(checkpointUri(result.seed, item.tick), `Checkpoint ${item.tick}`, "Canonical observational snapshot"))); });
  if (enabled("checkpoint")) server.registerTool("checkpoint", { title: "Read checkpoint", description: "Read an exact or directionally nearest observational checkpoint.", inputSchema: z.object({ seed, tick: z.number().int().min(0), direction: z.enum(["exact", "before", "after", "nearest"]).optional() }), outputSchema: genericOutput, annotations: readOnly },
    async (args) => { const direction = args.direction ?? "exact", result = await gateway.get(direction === "exact" ? `/api/checkpoint/${args.tick}` : `/api/checkpoint/nearest/${args.tick}`, { seed: args.seed, direction }); const tick = result.checkpoint?.tick ?? result.metadata?.tick ?? args.tick; return output(result, `Checkpoint ${tick} (${direction}).`, [link(checkpointUri(result.seed, tick), `Checkpoint ${tick}`, "Canonical observational snapshot")]); });
}
