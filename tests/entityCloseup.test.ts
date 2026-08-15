import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeupOscillationVisual, deriveMorphologyGenome, morphologyRadius, sampleSurfacePattern,
  SYMMETRY_ORDERS } from "../src/closeup/entityMorphology.js";
import { CloseupSession, type ExplorerObserverState } from "../src/closeup/closeupSession.js";
import { deriveIntrinsicOscillation, oscillationAtTick } from "../src/simulation/oscillation.js";
import { deriveSymmetryCameraBasis } from "../src/closeup/symmetryCamera.js";
import { morphologyInspectorEntries } from "../src/closeup/morphologyInspector.js";
import { buildConnectionParticleData, updateConnectionParticlePositions } from "../src/closeup/connectionParticles.js";
import { Camera } from "../src/rendering/camera.js";
import { CLOSEUP_INVITATION_ZOOM } from "../src/closeup/entityCloseupController.js";

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
const connections = Array.from({ length: 1_000 }, (_, index) => ({ id: `${index}:${index + 1}`, fingerprint: (index.toString(16).padStart(8,"0")+first).slice(0,64),
  state: index % 4 === 0 ? "dual" as const : index % 4 === 1 ? "spatial" as const : index % 4 === 2 ? "influence" as const : "dormant" as const,
  distance: 20 + index % 145, relationshipStrength: (index % 101)/100, coherence: ((index*7)%101)/100, synergy: ((index*13)%101)/100,
  connectedDirection: index * .173 }));
const connectionAuthority=JSON.stringify(connections),particles = buildConnectionParticleData(connections), repeatedParticles = buildConnectionParticleData(connections);
assert.equal(particles.ids.length, connections.length); assert.equal(particles.positions.length, connections.length * 3);
assert.deepEqual(particles.positions, repeatedParticles.positions); assert.ok(particles.positions.byteLength <= connections.length * 3 * 4);
assert.deepEqual(particles.orbitBasisU,repeatedParticles.orbitBasisU);assert.deepEqual(particles.angularSpeeds,repeatedParticles.angularSpeeds);
assert.notEqual(particles.radii[0],particles.radii[1]);assert.notEqual(particles.phases[0],particles.phases[1]);assert.notEqual(particles.glowIntensities[0],particles.glowIntensities[1]);
for(let index=0;index<particles.ids.length;index++){assert.ok(particles.radii[index]>=1.69999&&particles.radii[index]<=3.20001);assert.ok(particles.angularSpeeds[index]>=.01374&&particles.angularSpeeds[index]<=.11501);
  assert.ok(particles.glowIntensities[index]>=.23999&&particles.glowIntensities[index]<=1.00001);assert.ok(particles.glowScales[index]>=.89999&&particles.glowScales[index]<=1.75001);assert.ok(Math.abs(particles.rotationDirections[index])===1);}
const moved=updateConnectionParticlePositions(particles,12_000,new Float32Array(particles.positions.length));assert.notDeepEqual(moved,particles.positions);
assert.equal(JSON.stringify(connections),connectionAuthority,"particle projection must not mutate relationship inputs");
const changedCharacter=buildConnectionParticleData([{...connections[0],relationshipStrength:1,coherence:1,synergy:1}]);
assert.equal(changedCharacter.phases[0],particles.phases[0]);assert.deepEqual(changedCharacter.orbitBasisU.slice(0,3),particles.orbitBasisU.slice(0,3));
assert.ok(changedCharacter.angularSpeeds[0]>particles.angularSpeeds[0]);assert.ok(changedCharacter.glowIntensities[0]>particles.glowIntensities[0]);
assert.equal(Camera.MAX_ZOOM, 12); assert.ok(CLOSEUP_INVITATION_ZOOM >= Camera.MAX_ZOOM * .85 && CLOSEUP_INVITATION_ZOOM < Camera.MAX_ZOOM);

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
const [universeSource, rendererSource, threeSource, indexSource, collapsibleSource, bridgeClientSource] = await Promise.all([
  readFile(new URL("../src/simulation/universe.ts", import.meta.url), "utf8"), readFile(new URL("../src/rendering/renderer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/closeup/threeEntityCloseup.ts", import.meta.url), "utf8"), readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/collapsiblePanels.ts", import.meta.url), "utf8"), readFile(new URL("../src/interface/machineBridgeClient.ts", import.meta.url), "utf8")]);
assert.doesNotMatch(universeSource, /closeup|three/i); assert.doesNotMatch(rendererSource, /threeEntityCloseup|entityMorphology/);
assert.doesNotMatch(threeSource, /entity\.[a-zA-Z]+\s*=/, "close-up may not mutate entity state");
assert.match(threeSource, /CLOSEUP_WIDTH_SEGMENTS = 320/); assert.match(threeSource, /CLOSEUP_HEIGHT_SEGMENTS = 192/);
assert.match(threeSource, /CLOSEUP_CAMERA_DISTANCE = 10/); assert.match(threeSource, /particleGeometry/);
assert.match(indexSource, /aria-label="Entity selection"/); assert.doesNotMatch(indexSource, /id="morphologyInspector"[^>]*open/);
assert.match(collapsibleSource, /protouniverse\.sidebar\.collapsed\./);
assert.match(indexSource, /id="inspectorCloseup"/); assert.match(indexSource, /aria-label="Entity selection"/);
assert.match(threeSource, /ShaderMaterial/);assert.match(threeSource, /pointSize: \{ value: \.138 \}/);assert.doesNotMatch(threeSource,/new THREE\.Mesh\([^)]*particle/);
assert.match(await readFile(new URL("../src/closeup/entityCloseupController.ts", import.meta.url), "utf8"), /panelAction\.addEventListener\("click", \(\) => void enter\(\)\)/);
assert.match(rendererSource, /segmentVisible/); assert.match(rendererSource, /frameTimeMs/); assert.match(bridgeClientSource, /SNAPSHOT_INTERVAL_MS = 15_000/);
for (const cleanup of ["cancelAnimationFrame", "observer.disconnect", "controls.dispose", "geometry.dispose", "material.dispose", "renderer.dispose", "forceContextLoss"])
  assert.ok(threeSource.includes(cleanup), `close-up disposal must include ${cleanup}`);
console.log("Entity Close-Up Morphology v2 tests passed");
