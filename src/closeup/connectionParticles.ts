export type ConnectionDimensionState = "spatial" | "influence" | "dual" | "dormant";
export interface CloseupConnection {
  readonly id: string;
  readonly fingerprint: string;
  readonly state: ConnectionDimensionState;
  readonly distance: number;
  readonly relationshipStrength: number;
  readonly coherence: number;
  readonly synergy: number;
  /** Current direction from the selected entity toward its connected entity. */
  readonly connectedDirection: number;
}
export interface ConnectionParticleData {
  readonly ids: readonly string[];
  readonly states: readonly ConnectionDimensionState[];
  readonly positions: Float32Array;
  readonly phases: Float32Array;
  readonly radii: Float32Array;
  readonly angularSpeeds: Float32Array;
  readonly rotationDirections: Int8Array;
  readonly orbitBasisU: Float32Array;
  readonly orbitBasisV: Float32Array;
  readonly glowIntensities: Float32Array;
  readonly glowScales: Float32Array;
}

const unit = (text: string, salt: number): number => { let hash = (2166136261 ^ salt) >>> 0; for (let index = 0; index < text.length; index++) {
  hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0) / 0xffff_ffff; };
const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const stateSpeed = (state: ConnectionDimensionState): number => state === "dual" ? 1.15 : state === "spatial" ? 1 : state === "influence" ? .85 : .55;

/**
 * One deterministic descriptor per authoritative current relationship.
 * Orbits are an observer projection: distance selects a bounded shell; current
 * relationship metrics select speed/glow; direction plus identity selects plane.
 */
export function buildConnectionParticleData(connections: readonly CloseupConnection[]): ConnectionParticleData {
  const ordered = [...connections].sort((a, b) => a.id.localeCompare(b.id)), count = ordered.length;
  const positions = new Float32Array(count * 3), phases = new Float32Array(count), radii = new Float32Array(count);
  const angularSpeeds = new Float32Array(count), rotationDirections = new Int8Array(count);
  const orbitBasisU = new Float32Array(count * 3), orbitBasisV = new Float32Array(count * 3);
  const glowIntensities = new Float32Array(count), glowScales = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const connection = ordered[index], identity = connection.fingerprint || connection.id;
    const strength = clamp01(connection.relationshipStrength), coherence = clamp01(connection.coherence), synergy = clamp01(connection.synergy);
    const radius = 1.7 + clamp01(connection.distance / 145) * 1.5;
    const phase = unit(identity, 11) * Math.PI * 2, tilt = .32 + unit(identity, 12) * .9, azimuth = connection.connectedDirection;
    const axisX = Math.cos(azimuth) * Math.sin(tilt), axisY = Math.cos(tilt), axisZ = Math.sin(azimuth) * Math.sin(tilt);
    let ux = -axisZ, uy = 0, uz = axisX, length = Math.hypot(ux, uz);
    if (length < 1e-6) { ux = 1; uz = 0; length = 1; } ux /= length; uz /= length;
    const vx = axisY * uz, vy = axisZ * ux - axisX * uz, vz = -axisY * ux;
    const at = index * 3; orbitBasisU[at] = ux; orbitBasisU[at + 1] = uy; orbitBasisU[at + 2] = uz;
    orbitBasisV[at] = vx; orbitBasisV[at + 1] = vy; orbitBasisV[at + 2] = vz;
    phases[index] = phase; radii[index] = radius;
    angularSpeeds[index] = (.025 + .075 * ((strength + coherence + synergy) / 3)) * stateSpeed(connection.state);
    rotationDirections[index] = unit(identity, 13) < .5 ? -1 : 1;
    glowIntensities[index] = .24 + .36 * strength + .28 * coherence + .12 * synergy;
    glowScales[index] = .9 + .65 * strength + .2 * synergy;
    const cosine = Math.cos(phase), sine = Math.sin(phase);
    positions[at] = radius * (ux * cosine + vx * sine); positions[at + 1] = radius * (uy * cosine + vy * sine); positions[at + 2] = radius * (uz * cosine + vz * sine);
  }
  return { ids: ordered.map(item => item.id), states: ordered.map(item => item.state), positions, phases, radii, angularSpeeds,
    rotationDirections, orbitBasisU, orbitBasisV, glowIntensities, glowScales };
}

export function updateConnectionParticlePositions(data: ConnectionParticleData, tick: number, target = data.positions): Float32Array {
  const time = tick / 1000;
  for (let index = 0; index < data.ids.length; index++) { const angle = data.phases[index] + time * data.angularSpeeds[index] * data.rotationDirections[index];
    const cosine = Math.cos(angle), sine = Math.sin(angle), at = index * 3, radius = data.radii[index];
    target[at] = radius * (data.orbitBasisU[at] * cosine + data.orbitBasisV[at] * sine);
    target[at + 1] = radius * (data.orbitBasisU[at + 1] * cosine + data.orbitBasisV[at + 1] * sine);
    target[at + 2] = radius * (data.orbitBasisU[at + 2] * cosine + data.orbitBasisV[at + 2] * sine);
  }
  return target;
}
