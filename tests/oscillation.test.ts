import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { deriveIntrinsicOscillation, MAX_NATURAL_FREQUENCY, MIN_NATURAL_FREQUENCY, oscillationAtTick } from "../src/simulation/oscillation.js";

const firstIdentity = "0123456789abcdef".repeat(4);
const secondIdentity = "fedcba9876543210".repeat(4);

test("fingerprint oscillation mapping is deterministic, independent, and bounded", () => {
  const first = deriveIntrinsicOscillation(firstIdentity), repeated = deriveIntrinsicOscillation(firstIdentity);
  const second = deriveIntrinsicOscillation(secondIdentity);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, second);
  for (const value of [first, second]) {
    assert.ok(value.naturalFrequency >= MIN_NATURAL_FREQUENCY && value.naturalFrequency <= MAX_NATURAL_FREQUENCY);
    assert.ok(value.phase >= 0 && value.phase <= Math.PI * 2);
  }
});

test("current oscillation is deterministic at a tick and advances only with tick time", () => {
  const oscillator = deriveIntrinsicOscillation(firstIdentity);
  assert.equal(oscillationAtTick(oscillator, 12_345), oscillationAtTick(oscillator, 12_345));
  assert.notEqual(oscillationAtTick(oscillator, 12_345), oscillationAtTick(oscillator, 12_346));
  assert.ok(Math.abs(oscillationAtTick(oscillator, 12_345)) <= 1);
});

test("oscillation remains absent from every simulation interaction law", async () => {
  for (const file of ["physics.ts", "higherOrderPhysics.ts", "influencePhysics.ts", "relationshipField.ts", "reproduction.ts", "rupture.ts"]) {
    const source = await readFile(path.resolve("src/simulation", file), "utf8");
    assert.doesNotMatch(source, /naturalFrequency|currentOscillation|oscillationAtTick|deriveIntrinsicOscillation/,
      `${file} must not couple oscillation into physics`);
  }
});
