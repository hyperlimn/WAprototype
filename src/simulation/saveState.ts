import type { Entity } from "./entity";
import type { Bond } from "./physics";
import type { RelationshipEntity } from "./relationshipEntity";
import type { Occurrence } from "./occurrenceLog";
import type { RuptureEvent } from "./rupture";
import type { WorldState } from "./worldState";

export const SAVE_STATE_SCHEMA_VERSION = "protouniverse-save-state/1";
export interface RuntimeProvenance { mode: "fresh" | "resumed"; sourceSaveId: string | null; sourceSaveHash: string | null; sourceSaveTick: number | null }
export interface UniverseContinuationState {
  schemaVersion: typeof SAVE_STATE_SCHEMA_VERSION;
  simulationVersion: string;
  universe: string;
  tick: number;
  runtime: RuntimeProvenance;
  state: WorldState;
  entities: Entity[];
  bonds: [string, Bond][];
  relationships: RelationshipEntity[];
  relationshipCandidates: [string, number][];
  reproductionBirthTicks: number[];
  rupture: { recentEvents: RuptureEvent[]; eventTicks: number[] };
  occurrences: { records: Occurrence[]; nextSequence: number };
  randomState: number;
}

export interface SaveStateArtifact {
  schemaVersion: typeof SAVE_STATE_SCHEMA_VERSION;
  id: string;
  universe: string;
  tick: number;
  createdAt: string;
  simulationVersion: string;
  checksum: { algorithm: "sha256"; value: string };
  continuation: UniverseContinuationState;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function validateContinuation(value: unknown, expectedSimulationVersion?: string): UniverseContinuationState {
  const v = value as UniverseContinuationState;
  if (!v || v.schemaVersion !== SAVE_STATE_SCHEMA_VERSION || typeof v.universe !== "string" || !Number.isInteger(v.tick) || v.tick < 0
    || !v.state || v.state.ticks !== v.tick || !Array.isArray(v.entities) || !Array.isArray(v.bonds) || !Array.isArray(v.relationships)
    || !Array.isArray(v.relationshipCandidates) || !Array.isArray(v.reproductionBirthTicks) || !v.rupture || !v.occurrences
    || !Number.isInteger(v.occurrences.nextSequence) || !finite(v.randomState)) throw new Error("Malformed or incompatible ProtoUniverse save-state continuation");
  if (expectedSimulationVersion && v.simulationVersion !== expectedSimulationVersion)
    throw new Error(`Save simulation version ${v.simulationVersion} is incompatible with ${expectedSimulationVersion}`);
  if (v.entities.some((entity, index) => entity.creationIndex !== index)) throw new Error("Save entity identity/order is invalid");
  const invalidNumber = (record: object): boolean => Object.values(record).some((item) => typeof item === "number" && !Number.isFinite(item));
  if (invalidNumber(v.state) || v.entities.some((entity) => typeof entity.fingerprint !== "string" || invalidNumber(entity))
    || v.relationships.some((relationship) => typeof relationship.id !== "string" || relationship.parentAId < 0 || relationship.parentAId >= v.entities.length
      || relationship.parentBId < 0 || relationship.parentBId >= v.entities.length || invalidNumber(relationship))
    || v.bonds.some((entry) => !Array.isArray(entry) || typeof entry[0] !== "string" || !finite(entry[1]?.strength) || typeof entry[1]?.touched !== "boolean")
    || v.relationshipCandidates.some((entry) => typeof entry[0] !== "string" || !Number.isInteger(entry[1]))
    || v.reproductionBirthTicks.some((tick) => !Number.isInteger(tick)) || v.rupture.eventTicks.some((tick) => !Number.isInteger(tick)))
    throw new Error("Save-state contains invalid continuation values");
  return v;
}
