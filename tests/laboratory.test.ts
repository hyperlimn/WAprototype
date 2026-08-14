import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Gateway } from "../server/mcp/mcpGateway.js";
import { ExperimentStore, ExperimentDefinitionError } from "../server/laboratory/experimentStore.js";
import { LaboratoryGateway } from "../server/laboratory/laboratoryGateway.js";
import { buildLaboratoryMcpServer } from "../server/laboratory/laboratoryMcpServer.js";
import { VeilAccessError } from "../server/laboratory/veilPolicy.js";
import { veilFilter } from "../server/laboratory/veilFiltering.js";
import { LABORATORY_SCHEMA_VERSION, VEIL_PROFILE_VERSION, type ExperimentDefinition } from "../src/laboratory/experimentTypes.js";

const experiment: ExperimentDefinition = { schemaVersion: LABORATORY_SCHEMA_VERSION, id: "archaeology-001", revision: "archaeology-001/1", universe: "U0-000001",
  observer: "lab-archaeology-001-a", promptVersion: "test/1", profile: { version: VEIL_PROFILE_VERSION,
    history: { enabled: true, minimumAccessibleTick: 250_000 }, currentState: true, checkpoints: true, events: true,
    entities: true, relationships: true, ancestry: false, coordinates: true, energy: true, relationshipMetrics: true,
    regions: true, similarity: true, anomalyDetection: true, comparison: true, observerMemory: false, bookmarks: false,
    discloseExperimentalContext: false } };

class FixtureGateway implements Gateway {
  calls: Array<{ pathname: string; params: Record<string, unknown> }> = [];
  async get(pathname: string, params: Record<string, unknown> = {}): Promise<any> {
    this.calls.push({ pathname, params });
    if (pathname === "/api/universes") return { resultCount: 2, results: [{ seed: "U0-000001", firstTick: 0 }, { seed: "other", firstTick: 0 }] };
    if (pathname === "/api/history") return { seed: "U0-000001", query: params, resultCount: 2,
      results: [{ tick: 200_000, sequence: 1, description: "hidden" }, { tick: 260_000, sequence: 2, description: "visible" }] };
    if (pathname === "/api/checkpoints") return { seed: "U0-000001", results: [{ tick: 200_000 }, { tick: 275_000 }], resultCount: 2 };
    if (pathname.startsWith("/api/checkpoint/")) return { seed: "U0-000001", checkpoint: { tick: Number(pathname.split("/").at(-1)), snapshot: {} } };
    if (pathname === "/api/perception/orient") return { source: { seed: "U0-000001", tick: 400_000 }, derived: { identity: { seed: "U0-000001", tick: 400_000, population: 2 }, attentionSuggestions: [] }, memoryRange: { firstTick: 0 } };
    if (pathname === "/api/perception/inspect" || pathname === "/api/perception/context") return { source: { seed: "U0-000001", tick: 400_000 }, currentProperties: {
      id: 7, birthTick: 1_200, age: 398_800, origin: "reproduction", parentEntityIds: [1, 2], x: 4, y: 8, energy: 9,
      currentRelationshipIds: ["r-now"] }, history: [{ tick: 2_000 }, { tick: 280_000 }] };
    if (pathname === "/api/perception/anomalies") return { source: { seed: "U0-000001", tick: 400_000 }, results: [] };
    throw new Error(`unexpected ${pathname}`);
  }
  async post(): Promise<any> { throw new Error("write reached authoritative gateway"); }
  async patch(): Promise<any> { throw new Error("write reached authoritative gateway"); }
}

test("experiment definitions load persistently and malformed profiles are rejected", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lab-definitions-")); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "valid.json"), JSON.stringify({ ...experiment, id: "valid" }));
  assert.equal((await new ExperimentStore(directory).load("valid")).observer, experiment.observer);
  await writeFile(path.join(directory, "bad.json"), JSON.stringify({ ...experiment, id: "bad", profile: { history: { minimumAccessibleTick: -1 } } }));
  await assert.rejects(new ExperimentStore(directory).load("bad"), ExperimentDefinitionError);
  await assert.rejects(new ExperimentStore(directory).load("../escape"), ExperimentDefinitionError);
});

test("Veil enforces history, checkpoint, event, universe, memory, and bookmark access", async () => {
  const source = new FixtureGateway(), gateway = new LaboratoryGateway(source, experiment);
  const history = await gateway.get("/api/history", { sinceTick: 0 });
  assert.equal(source.calls.at(-1)?.params.sinceTick, 250_000); assert.deepEqual(history.results.map((item: any) => item.tick), [260_000]); assert.equal(history.resultCount, 1);
  await assert.rejects(gateway.get("/api/history", { untilTick: 249_999 }), (error: unknown) => error instanceof VeilAccessError
    && /inaccessible/.test(error.message) && !/250000|profile|experiment|Veil/i.test(error.message));
  await assert.rejects(gateway.get("/api/checkpoint/200000"), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/inspect", { kind: "event", tick: 200_000, sequence: 1 }), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/orient", { seed: "other" }), VeilAccessError);
  await assert.rejects(gateway.get("/api/observer-memory", { observer: experiment.observer }), VeilAccessError);
  await assert.rejects(gateway.get("/api/perception/since-last", { observer: experiment.observer }), VeilAccessError);
  await assert.rejects(gateway.post("/api/perception/mark-observed", {}), VeilAccessError);
});

test("current state remains available without obvious temporal, ancestry, or hidden-link leakage", async () => {
  const source = new FixtureGateway(), gateway = new LaboratoryGateway(source, experiment);
  const orient = await gateway.get("/api/perception/orient", { observer: "codex-first-entry" });
  assert.equal(orient.derived.identity.tick, 400_000); assert.equal(orient.memoryRange, undefined);
  assert.deepEqual(source.calls.at(-1)?.params, { seed: "U0-000001" }, "orient does not inherit any observer continuity");
  const entity = await gateway.get("/api/perception/inspect", { kind: "entity", id: "7" });
  assert.equal(entity.currentProperties.id, 7); assert.equal(entity.currentProperties.x, 4); assert.equal(entity.currentProperties.energy, 9);
  assert.equal(entity.currentProperties.birthTick, undefined); assert.equal(entity.currentProperties.age, undefined);
  assert.equal(entity.currentProperties.parentEntityIds, undefined); assert.equal(entity.history, undefined);
  const filtered = veilFilter({ links: ["protouniverse://universe/U0-000001/event/1200/1", "protouniverse://universe/U0-000001/event/280000/2",
    "protouniverse://universe/U0-000001/checkpoint/1000"] }, gateway.policy) as any;
  assert.deepEqual(filtered.links, ["protouniverse://universe/U0-000001/event/280000/2"]);
});

test("laboratory MCP omits memory and bookmark faculties while current resources remain readable", async () => {
  const authoritative = new FixtureGateway(), server = buildLaboratoryMcpServer(experiment, authoritative);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); const client = new Client({ name: "lab-test", version: "1" }); await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("orient") && names.includes("history"));
    for (const hidden of ["since_last", "mark_observed", "recall_observer_memory", "remember", "update_observer_memory"]) assert.ok(!names.includes(hidden));
    const orient = await client.callTool({ name: "orient", arguments: {} });
    assert.equal((orient.structuredContent as any).experimentalContext, undefined);
    const resource = await client.readResource({ uri: "protouniverse://universe/U0-000001/entity/7" });
    const value = JSON.parse((resource.contents[0] as any).text); assert.equal(value.authoritative.id, 7); assert.equal(value.authoritative.birthTick, undefined);
    const templates = await client.listResourceTemplates(); assert.ok(!templates.resourceTemplates.some((item) => item.uriTemplate.includes("observer")));
  } finally { await client.close(); await server.close(); }
});
