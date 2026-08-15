import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { MemoryStore } from "../server/memory/memoryStore.js";
import type { MemoryPolicy } from "../src/memory/memoryPolicy.js";
import type { CanonicalSnapshot } from "../server/types.js";
import type { EntityRecord, OccurrenceRecord, RelationshipRecord } from "../src/query/queryTypes.js";
import { entityUri, checkpointUri } from "../server/mcp/mcpUris.js";
import { buildMcpServer } from "../server/mcp/mcpServer.js";
import { McpGateway } from "../server/mcp/mcpGateway.js";

const policy: MemoryPolicy = { mode: "complete", checkpointIntervalTicks: 100, segmentMaxEvents: 2, recentDetailTicks: 100_000, condensedEraTicks: 100_000 };
const identity = { seed: "mcp-seed", simulationVersion: "u0.6", interfaceVersion: "protouniverse-machine-interface/5" };
const entity = (id: number): EntityRecord => ({ id, creationIndex: id, fingerprint: `e${id}`, origin: "initial", birthTick: 0,
  parentRelationshipId: null, parentEntityIds: null, alpha: 1, beta: 1, gamma: 1, x: id * 10, y: id * 5, vx: 0, vy: 0,
  energy: id + 2, age: 200, neighborCount: 1, strongestRelationship: .8, strongestBond: .7, currentRelationshipIds: ["r0"] });
const relationship: RelationshipRecord = { id: "r0", fingerprint: "r0", parentAId: 0, parentBId: 1, creationTick: 10, age: 190,
  spatialActive: true, influenceActive: true, bondStrength: .7, relationshipStrength: .8, x: 5, y: 2.5, coherence: .9,
  localRelationshipDensity: 2, synergy: .5, localFieldPotential: .2, ruptureQualified: false };
const events: OccurrenceRecord[] = [1, 2, 3].map((sequence) => ({ sequence, tick: 100 + sequence * 10,
  type: sequence === 3 ? "rupture" : "reproduction", description: `event-${sequence}`, entityId: sequence < 3 ? 0 : undefined,
  relationshipId: "r0", x: 5, y: 2.5 }));
const snapshot: CanonicalSnapshot = { metadata: { currentTick: 150, seed: identity.seed, simulationVersion: identity.simulationVersion },
  entities: [entity(0), entity(1)], relationships: [relationship], recentOccurrences: events };

test("official v2 STDIO client navigates ProtoUniverse MCP tools and resources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "protouniverse-mcp-"));
  process.env.PROTOUNIVERSE_MEMORY_ROOT = root; process.env.PROTOUNIVERSE_BRIDGE_PORT = "18788";
  process.env.PROTOUNIVERSE_CHECKPOINT_INTERVAL_TICKS = "100";
  const memory = new MemoryStore(root, policy); await memory.ingestEvents(events, identity); await memory.ingestSnapshot(snapshot, identity);
  const { server } = await import("../server/index.js");
  let client = new Client({ name: "protouniverse-test", version: "1" });
  let transport: { close(): Promise<void> } = new StdioClientTransport({ command: process.execPath, args: [path.resolve(".test-dist/server/mcp/index.js")], cwd: process.cwd(),
    env: { ...process.env, PROTOUNIVERSE_BRIDGE_URL: "http://127.0.0.1:18788" } as Record<string, string>, stderr: "pipe" });
  let inMemoryServer: ReturnType<typeof buildMcpServer> | null = null;
  try {
    try { await client.connect(transport as StdioClientTransport); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      client = new Client({ name: "protouniverse-test-fallback", version: "1" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); transport = clientTransport;
      inMemoryServer = buildMcpServer(new McpGateway("http://127.0.0.1:18788")); await inMemoryServer.connect(serverTransport); await client.connect(clientTransport);
    }
    assert.match(client.getInstructions() ?? "", /Begin unfamiliar investigations with orient/);
    const tools = await client.listTools(); assert.ok(tools.tools.some((item) => item.name === "orient")); assert.ok(tools.tools.some((item) => item.name === "mark_observed"));
    assert.ok(tools.tools.some((item) => item.name === "recall_observer_memory")); assert.ok(tools.tools.some((item) => item.name === "remember"));
    for(const name of ["counterfactual_interventions","counterfactual_create","counterfactual_status","counterfactual_compare","counterfactual_inspect","counterfactual_terminate"])assert.ok(tools.tools.some(item=>item.name===name),`${name} should be available to the normal observer`);
    const interventions=await client.callTool({name:"counterfactual_interventions",arguments:{}});assert.deepEqual((interventions.structuredContent as any).kinds,["entity-impulse","cluster-impulse","entity-displace","cluster-displace","cluster-expand","cluster-compress","cluster-spin-clockwise","cluster-spin-counterclockwise","relationship-sever"]);
    const injection=await client.callTool({name:"counterfactual_create",arguments:{kind:"entity-impulse",entityId:0,x:.1,y:0,command:"rm",continuation:{}}});assert.equal(injection.isError,true,"unknown commands and caller-supplied continuation are schema errors");
    const templates = await client.listResourceTemplates(); assert.ok(templates.resourceTemplates.length >= 7);
    const universes = await client.callTool({ name: "list_universes", arguments: {} }); assert.equal((universes.structuredContent as any).resultCount, 1);
    const orient = await client.callTool({ name: "orient", arguments: { seed: identity.seed } }); assert.equal((orient.structuredContent as any).source.mode, "archived");
    const inspect = await client.callTool({ name: "inspect", arguments: { kind: "entity", id: "0", seed: identity.seed } }); assert.equal((inspect.structuredContent as any).target.id, 0);
    const first = await client.callTool({ name: "history", arguments: { seed: identity.seed, limit: 1 } }); const cursor = (first.structuredContent as any).nextCursor; assert.ok(cursor);
    const second = await client.callTool({ name: "history", arguments: { seed: identity.seed, limit: 1, cursor } }); assert.equal((second.structuredContent as any).results[0].sequence, 2);
    assert.equal((second.structuredContent as any).query.cursor, undefined, "archive normalized query does not alter opaque cursor payload");
    const entityResource = await client.readResource({ uri: entityUri(identity.seed, 0) }); assert.match((entityResource.contents[0] as any).text, /"resourceType":"entity"/);
    const checkpointResource = await client.readResource({ uri: checkpointUri(identity.seed, 150) }); assert.match((checkpointResource.contents[0] as any).text, /"resourceType":"checkpoint"/);
    const offlineGateway = new McpGateway("http://127.0.0.1:1"); assert.equal((await offlineGateway.get("/api/universes")).resultCount, 1);
    assert.equal((await offlineGateway.get("/api/history", { seed: identity.seed, limit: 1 })).results[0].sequence, 3);
    const invalid = await client.callTool({ name: "inspect", arguments: { kind: "entity", id: "999", seed: identity.seed } }); assert.equal(invalid.isError, true);
    const before = JSON.stringify((await (await fetch("http://127.0.0.1:18788/api/checkpoint/150?seed=mcp-seed")).json()).checkpoint.snapshot);
    await client.callTool({ name: "mark_observed", arguments: { observer: "mcp-test", seed: identity.seed, tick: 150 } });
    const bookmark = JSON.parse(await readFile(path.join(root, "observers", "mcp-test.json"), "utf8")); assert.equal(bookmark.lastOrientationTickBySeed[identity.seed], 150);
    const remembered = await client.callTool({ name: "remember", arguments: { observer: "mcp-test", universe: identity.seed, kind: "question", content: "Will r0 rupture again?", universeTick: 150,
      references: [{ kind: "relationship", id: "r0", evidenceRole: "target" }] } });
    const entryId = (remembered.structuredContent as any).entry.id; assert.ok(entryId); assert.equal((remembered.structuredContent as any).entry.epistemic.authoritativeUniverseTruth, false);
    await client.callTool({ name: "update_observer_memory", arguments: { observer: "mcp-test", universe: identity.seed, id: entryId, status: "resolved", resolution: "The archive cannot answer a future prediction." } });
    const recalled = await client.callTool({ name: "recall_observer_memory", arguments: { observer: "mcp-test", universe: identity.seed, kind: "question", status: "resolved" } });
    assert.equal((recalled.structuredContent as any).resultCount, 1);
    const returningOrient = await client.callTool({ name: "orient", arguments: { seed: identity.seed, observer: "mcp-test" } });
    assert.equal((returningOrient.structuredContent as any).observerContinuity.visitCount, 0, "first named orientation exposes the notebook before recording its first visit");
    const after = JSON.stringify((await (await fetch("http://127.0.0.1:18788/api/checkpoint/150?seed=mcp-seed")).json()).checkpoint.snapshot); assert.equal(after, before);
  } finally {
    await client.close().catch(() => undefined); await transport.close().catch(() => undefined); await inMemoryServer?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  }
});
