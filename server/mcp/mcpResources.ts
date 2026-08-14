import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { Gateway } from "./mcpGateway.js";
import { checkpointUri, entityUri, eventUri, observerUri, regionUri, relationshipUri, universeUri } from "./mcpUris.js";

const result = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) }] });
const template = (value: string) => new ResourceTemplate(value, { list: undefined });

export function registerMcpResources(server: McpServer, gateway: Gateway, options: { bookmarks?: boolean } = {}): void {
  server.registerResource("universe", template("protouniverse://universe/{seed}"), { title: "ProtoUniverse archive or live orientation", description: "Compact universe identity, archive metadata, and perception orientation.", mimeType: "application/json" },
    async (uri, variables) => { const seed = String(variables.seed); const [summary, orientation] = await Promise.all([gateway.get(`/api/universe/${encodeURIComponent(seed)}`), gateway.get("/api/perception/orient", { seed })]); return result(uri, { resourceType: "universe", authoritative: summary, perception: orientation }); });
  server.registerResource("entity", template("protouniverse://universe/{seed}/entity/{id}"), { title: "ProtoUniverse entity", description: "Authoritative entity record with derived inspection, context, lineage, and relationship links.", mimeType: "application/json" },
    async (uri, variables) => { const seed = String(variables.seed), id = Number(variables.id); if (!Number.isInteger(id) || id < 0) throw new Error("invalid entity id");
      const inspection = await gateway.get("/api/perception/inspect", { seed, kind: "entity", id, depth: 2 }); const context = await gateway.get("/api/perception/context", { seed, kind: "entity", id });
      return result(uri, { resourceType: "entity", seed, authoritative: inspection.currentProperties, derived: inspection, inferredContext: context,
        relationshipResources: (inspection.currentProperties?.currentRelationshipIds ?? []).map((relationshipId: string) => relationshipUri(seed, relationshipId)),
        parentResources: (inspection.currentProperties?.parentEntityIds ?? []).map((parentId: number) => entityUri(seed, parentId)) }); });
  server.registerResource("relationship", template("protouniverse://universe/{seed}/relationship/{id}"), { title: "ProtoUniverse relationship", description: "Authoritative relationship record, parent resources, context, and rupture history.", mimeType: "application/json" },
    async (uri, variables) => { const seed = String(variables.seed), id = String(variables.id); const inspection = await gateway.get("/api/perception/inspect", { seed, kind: "relationship", id, depth: 2 });
      return result(uri, { resourceType: "relationship", seed, authoritative: inspection.currentProperties, derived: inspection,
        parentResources: [inspection.currentProperties.parentAId, inspection.currentProperties.parentBId].map((parentId: number) => entityUri(seed, parentId)) }); });
  server.registerResource("checkpoint", template("protouniverse://universe/{seed}/checkpoint/{tick}"), { title: "ProtoUniverse checkpoint", description: "Canonical observational checkpoint; not simulation resume authority.", mimeType: "application/json" },
    async (uri, variables) => { const seed = String(variables.seed), tick = Number(variables.tick); return result(uri, { resourceType: "checkpoint", seed, authoritative: await gateway.get(`/api/checkpoint/${tick}`, { seed }) }); });
  server.registerResource("event", template("protouniverse://universe/{seed}/event/{tick}/{sequence}"), { title: "ProtoUniverse occurrence", description: "Persisted authoritative occurrence with connected resource URIs.", mimeType: "application/json" },
    async (uri, variables) => { const seed = String(variables.seed), tick = Number(variables.tick), sequence = Number(variables.sequence);
      const page = await gateway.get("/api/history", { seed, sinceTick: tick, untilTick: tick, limit: 100 }); const event = page.results.find((item: any) => item.sequence === sequence); if (!event) throw new Error("event not found");
      return result(uri, { resourceType: "event", seed, authoritative: event, entityResource: event.entityId === undefined ? null : entityUri(seed, event.entityId),
        relationshipResource: event.relationshipId === undefined ? null : relationshipUri(seed, event.relationshipId) }); });
  server.registerResource("region", template("protouniverse://universe/{seed}/region/{x}/{y}/{radius}"), { title: "ProtoUniverse inferred region", description: "Geometric regional perception. This is inferred context, not authoritative cluster identity.", mimeType: "application/json" },
    async (uri, variables) => { const seed = String(variables.seed), x = Number(variables.x), y = Number(variables.y), radius = Number(variables.radius); return result(uri, { resourceType: "region", classification: "inferred", seed,
      perception: await gateway.get("/api/perception/inspect", { seed, kind: "region", x, y, radius, depth: 2 }) }); });
  if (options.bookmarks ?? true) server.registerResource("observer", template("protouniverse://observer/{observer}"), { title: "ProtoUniverse observer bookmark", description: "Observer metadata only; transport sessions are not observer identity.", mimeType: "application/json" },
    async (uri, variables) => { const observer = String(variables.observer); return result(uri, { resourceType: "observer", observer,
      metadata: await gateway.get("/api/perception/since-last", { observer }), limitation: "Observer resource resolves against the active universe unless a tool supplies a seed." }); });
}

export const exampleResourceUris = { universeUri, entityUri, relationshipUri, checkpointUri, eventUri, regionUri, observerUri };
