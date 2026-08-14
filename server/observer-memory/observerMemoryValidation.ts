import { OBSERVER_MEMORY_KINDS, type ObserverMemoryKind, type UniverseReference } from "../../src/observer-memory/observerMemoryTypes.js";

export class ObserverMemoryValidationError extends Error {
  constructor(readonly parameter: string, readonly value: unknown, message: string) { super(message); }
}

export const validateObserver = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(value)) throw new ObserverMemoryValidationError("observer", value, "must contain 1-80 letters, numbers, dots, underscores, or hyphens");
  return value;
};
export const validateUniverse = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 120 || /[\u0000-\u001f]/.test(value)) throw new ObserverMemoryValidationError("universe", value, "must be a non-empty universe identity of at most 120 characters");
  return value;
};
export const validateKind = (value: unknown): ObserverMemoryKind => {
  if (typeof value !== "string" || !(OBSERVER_MEMORY_KINDS as readonly string[]).includes(value)) throw new ObserverMemoryValidationError("kind", value, `must be one of ${OBSERVER_MEMORY_KINDS.join(", ")}`);
  return value as ObserverMemoryKind;
};
export const validateContent = (value: unknown, name = "content"): string => {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > 8_000) throw new ObserverMemoryValidationError(name, value, "must be non-empty and at most 8000 characters");
  return value.trim();
};
export const validateReferences = (value: unknown): UniverseReference[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new ObserverMemoryValidationError("references", value, "must be an array of at most 50 references");
  const kinds = ["entity", "relationship", "event", "checkpoint", "region", "history", "uri"];
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || !kinds.includes(String((item as any).kind))) throw new ObserverMemoryValidationError(`references[${index}]`, item, "has an unsupported reference kind");
    const reference = item as UniverseReference;
    if (reference.tick !== undefined && (!Number.isInteger(reference.tick) || reference.tick < 0)) throw new ObserverMemoryValidationError(`references[${index}].tick`, reference.tick, "must be a non-negative integer");
    if (reference.sequence !== undefined && (!Number.isInteger(reference.sequence) || reference.sequence < 0)) throw new ObserverMemoryValidationError(`references[${index}].sequence`, reference.sequence, "must be a non-negative integer");
    for (const key of ["id", "uri", "note"] as const) if (reference[key] !== undefined && (typeof reference[key] !== "string" || reference[key]!.length > 1000)) throw new ObserverMemoryValidationError(`references[${index}].${key}`, reference[key], "must be a string of at most 1000 characters");
    return { ...reference };
  });
};
