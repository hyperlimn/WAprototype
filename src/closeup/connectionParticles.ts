export type ConnectionDimensionState = "spatial" | "influence" | "dual" | "dormant";
export interface CloseupConnection { readonly id: string; readonly state: ConnectionDimensionState }
export interface ConnectionParticleData { readonly ids: readonly string[]; readonly states: readonly ConnectionDimensionState[];
  readonly positions: Float32Array; readonly phases: Float32Array; readonly radii: Float32Array; readonly speeds: Float32Array }

const unit = (text: string, salt: number): number => { let hash = (2166136261 ^ salt) >>> 0; for (let index = 0; index < text.length; index++) {
  hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0) / 0xffff_ffff; };

/** One deterministic, identity-addressable point per authoritative current relationship. */
export function buildConnectionParticleData(connections: readonly CloseupConnection[]): ConnectionParticleData {
  const ordered = [...connections].sort((a, b) => a.id.localeCompare(b.id)), positions = new Float32Array(ordered.length * 3);
  const phases = new Float32Array(ordered.length), radii = new Float32Array(ordered.length), speeds = new Float32Array(ordered.length);
  for (let index = 0; index < ordered.length; index++) {
    const id = ordered[index].id, y = unit(id, 1) * 2 - 1, phi = unit(id, 2) * Math.PI * 2, radius = 1.65 + unit(id, 3) * 1.45;
    const ring = Math.sqrt(Math.max(0, 1 - y * y)); positions[index * 3] = Math.cos(phi) * ring * radius;
    positions[index * 3 + 1] = y * radius; positions[index * 3 + 2] = Math.sin(phi) * ring * radius;
    phases[index] = phi; radii[index] = radius; speeds[index] = .035 + unit(id, 4) * .055;
  }
  return { ids: ordered.map((item) => item.id), states: ordered.map((item) => item.state), positions, phases, radii, speeds };
}
