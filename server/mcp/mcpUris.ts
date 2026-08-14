const component = (value: string): string => encodeURIComponent(value);
export const universeUri = (seed: string): string => `protouniverse://universe/${component(seed)}`;
export const entityUri = (seed: string, id: number): string => `${universeUri(seed)}/entity/${id}`;
export const relationshipUri = (seed: string, id: string): string => `${universeUri(seed)}/relationship/${component(id)}`;
export const checkpointUri = (seed: string, tick: number): string => `${universeUri(seed)}/checkpoint/${tick}`;
export const eventUri = (seed: string, tick: number, sequence: number): string => `${universeUri(seed)}/event/${tick}/${sequence}`;
export const regionUri = (seed: string, x: number, y: number, radius: number): string => `${universeUri(seed)}/region/${x}/${y}/${radius}`;
export const observerUri = (observer: string): string => `protouniverse://observer/${component(observer)}`;

export type ParsedProtoUniverseUri =
  | { kind: "universe"; seed: string }
  | { kind: "entity"; seed: string; id: number }
  | { kind: "relationship"; seed: string; id: string }
  | { kind: "checkpoint"; seed: string; tick: number }
  | { kind: "event"; seed: string; tick: number; sequence: number }
  | { kind: "region"; seed: string; x: number; y: number; radius: number }
  | { kind: "observer"; observer: string };

export function parseProtoUniverseUri(value: string): ParsedProtoUniverseUri {
  const url = new URL(value); if (url.protocol !== "protouniverse:") throw new Error("unsupported resource URI scheme");
  const parts = [url.hostname, ...url.pathname.split("/").filter(Boolean)].map(decodeURIComponent);
  if (parts[0] === "observer" && parts.length === 2 && /^[a-zA-Z0-9._-]{1,80}$/.test(parts[1])) return { kind: "observer", observer: parts[1] };
  if (parts[0] !== "universe" || !parts[1]) throw new Error("invalid ProtoUniverse resource URI");
  const seed = parts[1]; if (parts.length === 2) return { kind: "universe", seed };
  if (parts[2] === "entity" && /^\d+$/.test(parts[3] ?? "") && parts.length === 4) return { kind: "entity", seed, id: Number(parts[3]) };
  if (parts[2] === "relationship" && parts[3] && parts.length === 4) return { kind: "relationship", seed, id: parts[3] };
  if (parts[2] === "checkpoint" && /^\d+$/.test(parts[3] ?? "") && parts.length === 4) return { kind: "checkpoint", seed, tick: Number(parts[3]) };
  if (parts[2] === "event" && /^\d+$/.test(parts[3] ?? "") && /^\d+$/.test(parts[4] ?? "") && parts.length === 5) return { kind: "event", seed, tick: Number(parts[3]), sequence: Number(parts[4]) };
  if (parts[2] === "region" && parts.length === 6 && parts.slice(3).every((item) => Number.isFinite(Number(item))) && Number(parts[5]) >= 0) return { kind: "region", seed, x: Number(parts[3]), y: Number(parts[4]), radius: Number(parts[5]) };
  throw new Error("invalid ProtoUniverse resource URI");
}
