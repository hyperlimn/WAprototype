import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Entity } from "../simulation/entity.js";
import { oscillationAtTick } from "../simulation/oscillation.js";
import { closeupOscillationVisual, deriveMorphologyGenome, morphologyRadius, sampleSurfacePattern } from "./entityMorphology.js";
import type { MorphologyGenome } from "./entityMorphology.js";
import { deriveSymmetryCameraBasis, type CloseupCameraPreset } from "./symmetryCamera.js";
import { buildConnectionParticleData, type CloseupConnection, type ConnectionDimensionState } from "./connectionParticles.js";

export const CLOSEUP_WIDTH_SEGMENTS = 320;
export const CLOSEUP_HEIGHT_SEGMENTS = 192;
export const CLOSEUP_CAMERA_DISTANCE = 10;

export interface EntityCloseupHandle { readonly genome: Readonly<MorphologyGenome>; setCameraPreset(preset: CloseupCameraPreset): void; dispose(): void }
export function mountThreeEntityCloseup(host: HTMLElement, entity: Entity, currentTick: () => number,
  currentConnections: () => readonly CloseupConnection[]): EntityCloseupHandle {
  const parameters = deriveMorphologyGenome(entity.fingerprint), renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x030709, 1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(0, .2, CLOSEUP_CAMERA_DISTANCE);
  const geometry = new THREE.SphereGeometry(1, CLOSEUP_WIDTH_SEGMENTS, CLOSEUP_HEIGHT_SEGMENTS), positions = geometry.attributes.position as THREE.BufferAttribute;
  const patterns = new Float32Array(positions.count), colors = new Float32Array(positions.count * 3);
  const baseColor = new THREE.Color().setHSL(parameters.baseHue, parameters.saturation, parameters.luminance);
  const secondaryColor = new THREE.Color().setHSL((parameters.baseHue + parameters.secondaryHueOffset) % 1,
    parameters.saturation * .88, parameters.luminance + .06), sampleColor = new THREE.Color();
  for (let index = 0; index < positions.count; index++) { const vector = new THREE.Vector3().fromBufferAttribute(positions, index).normalize();
    const pattern = sampleSurfacePattern(parameters, vector.x, vector.y, vector.z); patterns[index] = pattern;
    sampleColor.copy(baseColor).lerp(secondaryColor, pattern * parameters.patternContrast); colors[index * 3] = sampleColor.r; colors[index * 3 + 1] = sampleColor.g; colors[index * 3 + 2] = sampleColor.b;
    vector.multiplyScalar(morphologyRadius(parameters, vector.x, vector.y, vector.z)); positions.setXYZ(index, vector.x, vector.y, vector.z); }
  positions.needsUpdate = true; geometry.setAttribute("morphPattern", new THREE.BufferAttribute(patterns, 1)); geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const emissive = new THREE.Color().setHSL(parameters.emissiveHue, parameters.saturation * .8, parameters.luminance * .55);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive, emissiveIntensity: parameters.emissiveIntensity,
    roughness: parameters.materialRoughness, metalness: parameters.metallicResponse });
  const patternEmission = { value: parameters.emissivePatternStrength };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPatternEmission = patternEmission;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float morphPattern;\nvarying float vMorphPattern;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMorphPattern = morphPattern;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vMorphPattern;\nuniform float uPatternEmission;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += emissive * vMorphPattern * uPatternEmission;");
  };
  material.customProgramCacheKey = () => "protouniverse-morphology-v2";
  const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0x9fc8c2, 0x071011, 1.15)); const key = new THREE.DirectionalLight(0xf2dfba, 2.4); key.position.set(3, 2, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x5d91a0, 1.2); rim.position.set(-4, .5, -2); scene.add(rim);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .07;
  controls.enablePan = false; controls.minDistance = 2; controls.maxDistance = 14; controls.rotateSpeed = .55; controls.zoomSpeed = .7;
  host.append(renderer.domElement); let frame = 0, disposed = false;
  const resize = () => { const width = host.clientWidth, height = host.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const cameraBasis = deriveSymmetryCameraBasis(parameters);
  const setCameraPreset = (preset: CloseupCameraPreset): void => {
    controls.enableRotate = preset === "free";
    if (preset === "free") return;
    const direction = preset === "pole" ? cameraBasis.poleDirection : cameraBasis.equatorDirection;
    const up = preset === "pole" ? cameraBasis.poleUp : cameraBasis.equatorUp;
    camera.position.set(direction.x * CLOSEUP_CAMERA_DISTANCE, direction.y * CLOSEUP_CAMERA_DISTANCE, direction.z * CLOSEUP_CAMERA_DISTANCE); camera.up.set(up.x, up.y, up.z);
    controls.target.set(0, 0, 0); camera.lookAt(controls.target); controls.update();
  };
  const particleMaterial = new THREE.PointsMaterial({ size: .138, vertexColors: true, transparent: true, opacity: .72, sizeAttenuation: true, depthWrite: false });
  let particleGeometry = new THREE.BufferGeometry(), particlePoints = new THREE.Points(particleGeometry, particleMaterial), particleData = buildConnectionParticleData([]);
  scene.add(particlePoints); let lastConnectionCheck = -Infinity, connectionSignature = "";
  const particleColor = (state: ConnectionDimensionState): THREE.Color => new THREE.Color(state === "dual" ? 0xb9c989 : state === "spatial" ? 0x7eb9b6 : state === "influence" ? 0x879ab9 : 0x52605f);
  const refreshParticles = () => { const now = performance.now(); if (now - lastConnectionCheck < 500) return; lastConnectionCheck = now; const connections = currentConnections();
    const signature = connections.map((item) => `${item.id}:${item.state}`).sort().join("|"); if (signature === connectionSignature) return; connectionSignature = signature;
    particleData = buildConnectionParticleData(connections); const colors = new Float32Array(particleData.states.length * 3);
    particleData.states.forEach((state, index) => { const color = particleColor(state); colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b; });
    const old = particleGeometry; particleGeometry = new THREE.BufferGeometry(); particleGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(particleData.positions), 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)); particlePoints.geometry = particleGeometry; old.dispose(); };
  const draw = () => { if (disposed) return; const tick = currentTick(); refreshParticles(); const visual = closeupOscillationVisual(oscillationAtTick(entity, tick)); mesh.scale.setScalar(visual.radialScale);
    material.emissiveIntensity = parameters.emissiveIntensity * visual.emissiveScale; patternEmission.value = parameters.emissivePatternStrength * visual.emissiveScale;
    const particlePositions = particleGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (particlePositions) { const time = tick / 1000; for (let index = 0; index < particleData.ids.length; index++) { const y = particleData.positions[index * 3 + 1], radial = Math.sqrt(Math.max(0, particleData.radii[index] ** 2 - y ** 2));
        const phi = particleData.phases[index] + time * particleData.speeds[index]; particlePositions.setXYZ(index, Math.cos(phi) * radial, y + Math.sin(phi * .7) * .04, Math.sin(phi) * radial); } particlePositions.needsUpdate = true; }
    controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(draw); }; draw();
  return { genome: parameters, setCameraPreset, dispose: () => { if (disposed) return; disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); geometry.dispose(); material.dispose(); particleGeometry.dispose(); particleMaterial.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); } };
}
