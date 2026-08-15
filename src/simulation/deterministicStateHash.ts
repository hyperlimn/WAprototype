import { createHash } from "node:crypto";
import type { UniverseContinuationState } from "./saveState";
import { compareEntityIdentity, compareRelationshipIdentity, compareStringEntryKey } from "./deterministicOrdering";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalize(item)]));
  return value;
};

/** Canonical meaningful continuation surface. Runtime provenance and other
 * operational metadata are intentionally excluded from replay identity. */
export function canonicalContinuationPayload(value: UniverseContinuationState): unknown {
  return canonicalize({
    schemaVersion: value.schemaVersion,
    simulationVersion: value.simulationVersion,
    universe: value.universe,
    tick: value.tick,
    state: value.state,
    entities: [...value.entities].sort(compareEntityIdentity),
    bonds: [...value.bonds].sort(compareStringEntryKey),
    relationships: [...value.relationships].sort(compareRelationshipIdentity),
    relationshipCandidates: [...value.relationshipCandidates].sort(compareStringEntryKey),
    reproductionBirthTicks: value.reproductionBirthTicks,
    rupture: value.rupture,
    occurrences: value.occurrences,
    randomState: value.randomState,
  });
}
export function deterministicStateHash(value: UniverseContinuationState): string {
  return createHash("sha256").update(JSON.stringify(canonicalContinuationPayload(value))).digest("hex");
}
