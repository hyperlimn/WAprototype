import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CanonicalSnapshot } from "../server/types.js";
import type { Gateway } from "../server/mcp/mcpGateway.js";
import { buildMcpServer } from "../server/mcp/mcpServer.js";
import { buildLaboratoryMcpServer } from "../server/laboratory/laboratoryMcpServer.js";
import { ExperimentStore } from "../server/laboratory/experimentStore.js";
import { buildHumanViewScene, defaultViewport } from "../server/mcp/humanViewScene.js";
import { rasterizePng } from "../server/mcp/pngRaster.js";
import type { EntityRecord, RelationshipRecord } from "../src/query/queryTypes.js";

const entities: EntityRecord[] = [
  { id: 7, creationIndex: 7, fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", origin: "initial", birthTick: 0,
    parentRelationshipId: null, parentEntityIds: null, alpha: .2, beta: .4, gamma: .6, naturalFrequency: .75, phase: .4, currentOscillation: 0,
    x: -20, y: 5, vx: 0, vy: 0, energy: 5, age: 50, neighborCount: 1, strongestRelationship: .8, strongestBond: .7, currentRelationshipIds: ["r"] },
  { id: 11, creationIndex: 11, fingerprint: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", origin: "reproduction", birthTick: 20,
    parentRelationshipId: "r", parentEntityIds: [7, 9], alpha: .8, beta: .6, gamma: .3, naturalFrequency: 1.4, phase: 2.1, currentOscillation: 0,
    x: 25, y: -8, vx: 0, vy: 0, energy: 4, age: 30, neighborCount: 1, strongestRelationship: .8, strongestBond: .7, currentRelationshipIds: ["r"] },
];
const relationships: RelationshipRecord[] = [{ id: "r", fingerprint: "r", parentAId: 7, parentBId: 11, creationTick: 10, age: 40,
  spatialActive: false, influenceActive: true, bondStrength: .7, relationshipStrength: .8, x: 2, y: 0, coherence: .9,
  localRelationshipDensity: 1, synergy: .5, localFieldPotential: .2, ruptureQualified: false }];
const snapshot: CanonicalSnapshot = { metadata: { seed: "human-view-test", currentTick: 100, simulationVersion: "test" }, entities, relationships };
class FixtureGateway implements Gateway {
  gets = 0; async get(pathname: string): Promise<any> { assert.equal(pathname, "/api/state"); this.gets++; return structuredClone(snapshot); }
  async post(): Promise<any> { throw new Error("write forbidden"); } async patch(): Promise<any> { throw new Error("write forbidden"); }
}
const digest = (value: unknown) => createHash("sha256").update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");

test("rendered scenes and PNG output are deterministic and dimension-specific", () => {
  const viewport = defaultViewport(entities, 480, 320);
  const influenceA = buildHumanViewScene(entities, relationships, 100, "influence", viewport);
  const influenceB = buildHumanViewScene(entities, relationships, 100, "influence", viewport);
  assert.equal(digest(influenceA), digest(influenceB));
  assert.notEqual(digest(influenceA), digest(buildHumanViewScene(entities, relationships, 100, "spatial", viewport)));
  assert.notEqual(digest(buildHumanViewScene(entities, relationships, 100, "frequency", viewport)),
    digest(buildHumanViewScene(entities, relationships, 200, "frequency", viewport)), "frequency view uses authoritative tick");
  const pngA = rasterizePng(480, 320, influenceA), pngB = rasterizePng(480, 320, influenceB);
  assert.equal(digest(pngA), digest(pngB)); assert.deepEqual([...pngA.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
});

test("normal MCP exposes read-only human_view as image without general-purpose capture tools", async () => {
  const gateway = new FixtureGateway(), before = JSON.stringify(snapshot), server = buildMcpServer(gateway);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "human-view-test", version: "1" });
  try {
    await server.connect(serverTransport); await client.connect(clientTransport); const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("human_view")); for (const lawFaculty of ["law_epoch", "laws", "law_history", "law_inspect"]) assert.ok(names.includes(lawFaculty));
    for (const forbidden of ["shell", "filesystem", "browser", "desktop", "screenshot"]) assert.ok(!names.includes(forbidden));
    const result = await client.callTool({ name: "human_view", arguments: { dimension: "influence", width: 480, height: 320 } });
    const image = result.content.find((item: any) => item.type === "image") as any; assert.equal(image.mimeType, "image/png"); assert.ok(image.data.length > 100);
    assert.equal((result.structuredContent as any).tick, 100); assert.equal((result.structuredContent as any).renderKind, "rendered_view");
    assert.equal((result.structuredContent as any).authoritativeUniverseChanged, false); assert.equal(JSON.stringify(snapshot), before); assert.equal(gateway.gets, 1);
  } finally { await client.close(); await server.close(); }
});

test("all existing archaeology profiles default Human View closed", async () => {
  const store = new ExperimentStore();
  for (const id of ["archaeology-001", "archaeology-002", "archaeology-003", "archaeology-004", "archaeology-005"]) {
    const experiment = await store.load(id); assert.equal(experiment.profile.humanView, undefined);
    const server = buildLaboratoryMcpServer(experiment, new FixtureGateway()); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: id, version: "1" }); try { await server.connect(serverTransport); await client.connect(clientTransport);
      const names=(await client.listTools()).tools.map((tool)=>tool.name); assert.ok(!names.includes("human_view"));
      for (const lawFaculty of ["law_epoch", "laws", "law_history", "law_inspect"]) assert.ok(!names.includes(lawFaculty));
    } finally { await client.close(); await server.close(); }
  }
});
