import assert from "node:assert/strict";
import test from "node:test";
import { baseRelationOpacity, entityOpacity, frequencyVisual, projectRelationship } from "../src/rendering/dimensionProjection.js";

const relationship = (spatialActive: boolean, influenceActive: boolean) => ({ spatialActive, influenceActive });

test("dimension projections emphasize only existing relationship dimensions", () => {
  const spatial = relationship(true, false), influence = relationship(false, true), dual = relationship(true, true);
  assert.ok(projectRelationship("spatial", spatial).alpha > projectRelationship("spatial", influence).alpha);
  assert.ok(projectRelationship("influence", influence).alpha > projectRelationship("influence", spatial).alpha);
  assert.equal(projectRelationship("influence", influence).visible, true, "influence-only relationships remain visible");
  assert.equal(projectRelationship("influence", dual).visible, true);
  assert.ok(projectRelationship("lineage", dual).alpha < projectRelationship("spatial", dual).alpha);
  assert.equal(projectRelationship("composite", dual).visible, false, "composite delegates to the unchanged renderer");
});

test("frequency projection is a bounded view-only pulse with minimal relationship clutter", () => {
  assert.ok(projectRelationship("frequency", relationship(true, true)).alpha < projectRelationship("lineage", relationship(true, true)).alpha);
  assert.deepEqual(frequencyVisual(-1), { radiusScale: .89, lightOffset: -6 });
  assert.deepEqual(frequencyVisual(1), { radiusScale: 1.11, lightOffset: 6 });
  assert.deepEqual(frequencyVisual(5), frequencyVisual(1), "presentation input remains bounded");
});

test("lineage projection prioritizes actual participants without hiding present positions", () => {
  assert.ok(entityOpacity("lineage", true) > entityOpacity("lineage", false));
  assert.equal(entityOpacity("composite", false), .9);
  assert.equal(baseRelationOpacity("composite"), 1);
  assert.ok(baseRelationOpacity("lineage") < baseRelationOpacity("spatial"));
});
