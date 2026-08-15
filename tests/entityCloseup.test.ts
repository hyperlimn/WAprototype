import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeupOscillationVisual, deriveMorphologyGenome, morphologyRadius, sampleSurfacePattern,
  SYMMETRY_ORDERS } from "../src/closeup/entityMorphology.js";
import { CloseupSession, type ExplorerObserverState } from "../src/closeup/closeupSession.js";
import { deriveIntrinsicOscillation, oscillationAtTick } from "../src/simulation/oscillation.js";
import { deriveSymmetryCameraBasis } from "../src/closeup/symmetryCamera.js";
import { morphologyInspectorEntries } from "../src/closeup/morphologyInspector.js";

const first = "0123456789abcdef".repeat(4), second = "fedcba9876543210".repeat(4);
const a = deriveMorphologyGenome(first), again = deriveMorphologyGenome(first), b = deriveMorphologyGenome(second);
assert.deepEqual(a, again, "genome must be stable across reconstruction/reload");
assert.notDeepEqual(a, b, "different fingerprints should vary symmetry and pattern parameters");
assert.ok(SYMMETRY_ORDERS.includes(a.primarySymmetry as typeof SYMMETRY_ORDERS[number]));
assert.ok(SYMMETRY_ORDERS.includes(a.secondarySymmetry as typeof SYMMETRY_ORDERS[number]));
assert.ok(a.motifAmplitude >= .035 && a.motifAmplitude <= .09); assert.ok(a.ringCount >= 3 && a.ringCount <= 12);
assert.ok(a.ridgeSharpness >= 2 && a.ridgeSharpness <= 12); assert.ok(a.depressionDepth >= .008 && a.depressionDepth <= .045);
assert.ok(a.asymmetry >= 0 && a.asymmetry <= .012); assert.ok(a.patternContrast >= .08 && a.patternContrast <= .28);
assert.ok(a.emissivePatternStrength >= .04 && a.emissivePatternStrength <= .22);
assert.notEqual(a.primarySymmetry, b.primarySymmetry); assert.notEqual(a.patternPhase, b.patternPhase);
const basis = deriveSymmetryCameraBasis(a), repeatedBasis = deriveSymmetryCameraBasis(again);
assert.deepEqual(basis, repeatedBasis, "same fingerprint genome must produce the same camera basis");
assert.deepEqual(basis.axis, { x: 0, y: 1, z: 0 });
const poleEquatorDot = basis.poleDirection.x * basis.equatorDirection.x + basis.poleDirection.y * basis.equatorDirection.y
  + basis.poleDirection.z * basis.equatorDirection.z;
assert.ok(Math.abs(poleEquatorDot) < Number.EPSILON, "pole and equator views must be perpendicular");
assert.ok(Math.abs(Math.hypot(basis.equatorDirection.x, basis.equatorDirection.y, basis.equatorDirection.z) - 1) < 1e-12);
const inspector = Object.fromEntries(morphologyInspectorEntries(a).map((entry) => [entry.label, entry.value]));
assert.equal(inspector.Scaffold, a.symmetryFamily); assert.equal(inspector["Primary order"], String(a.primarySymmetry));
assert.equal(inspector["Secondary motif"], a.secondaryMotif); assert.equal(inspector.Rings, String(a.ringCount));
assert.equal(inspector.Asymmetry, a.asymmetry.toFixed(4)); assert.equal(inspector.Roughness, a.materialRoughness.toFixed(3));

const surfaceSamples = (genome: typeof a): readonly [number, number][] => Array.from({ length: 128 }, (_, index) => {
  const theta = (index + .5) / 128 * Math.PI, phi = index * 2.399963229728653;
  const x = Math.sin(theta) * Math.cos(phi), y = Math.cos(theta), z = Math.sin(theta) * Math.sin(phi);
  return [morphologyRadius(genome, x, y, z), sampleSurfacePattern(genome, x, y, z)] as const;
});
const samples = surfaceSamples(a);
assert.deepEqual(samples, surfaceSamples(again), "surface samples must be deterministic");
assert.notDeepEqual(samples, surfaceSamples(b), "different genomes must produce different topography");
for (const [radius, pattern] of samples) { assert.ok(radius >= .78 && radius <= 1.22); assert.ok(pattern >= 0 && pattern <= 1); }

const originalRandom = Math.random;
try { Math.random = () => { throw new Error("runtime randomness used"); }; deriveMorphologyGenome(first); surfaceSamples(a); }
finally { Math.random = originalRandom; }
const oscillator = deriveIntrinsicOscillation(first), value = oscillationAtTick(oscillator, 12_345);
assert.deepEqual(closeupOscillationVisual(value), { radialScale: 1 + value * .006, emissiveScale: 1 + value * .08 });

const state: ExplorerObserverState = { cameraX: 12, cameraY: -7, zoom: 7.5, dimension: "frequency", entityId: first };
let disposed = 0, restored: ExplorerObserverState | null = null; const session = new CloseupSession(state, () => disposed++);
session.close((saved) => { restored = { ...saved }; }); session.close(() => { throw new Error("restored twice"); });
assert.equal(disposed, 1); assert.deepEqual(restored, state); assert.equal(session.isDisposed, true);
const [universeSource, rendererSource, threeSource] = await Promise.all([
  readFile(new URL("../src/simulation/universe.ts", import.meta.url), "utf8"), readFile(new URL("../src/rendering/renderer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/closeup/threeEntityCloseup.ts", import.meta.url), "utf8")]);
assert.doesNotMatch(universeSource, /closeup|three/i); assert.doesNotMatch(rendererSource, /threeEntityCloseup|entityMorphology/);
assert.doesNotMatch(threeSource, /entity\.[a-zA-Z]+\s*=/, "close-up may not mutate entity state");
assert.match(threeSource, /CLOSEUP_WIDTH_SEGMENTS = 320/); assert.match(threeSource, /CLOSEUP_HEIGHT_SEGMENTS = 192/);
for (const cleanup of ["cancelAnimationFrame", "observer.disconnect", "controls.dispose", "geometry.dispose", "material.dispose", "renderer.dispose", "forceContextLoss"])
  assert.ok(threeSource.includes(cleanup), `close-up disposal must include ${cleanup}`);
console.log("Entity Close-Up Morphology v2 tests passed");
