import type { ArchiveDescriptor, UniverseCatalog } from "./universeCatalog.js";

export class ArchiveNotFoundError extends Error {
  constructor(readonly seed: string | null, message: string) { super(message); }
}

export function resolveUniverse(catalog: UniverseCatalog, requestedSeed: string | undefined,
  activeSeed: string | null): ArchiveDescriptor {
  const seed = requestedSeed ?? activeSeed;
  if (!seed) throw new ArchiveNotFoundError(null, "No seed was requested and no live bridge universe is active");
  const archive = catalog.universes.find((candidate) => candidate.manifest.seed === seed);
  if (!archive) throw new ArchiveNotFoundError(seed, `Archived universe ${seed} was not found`);
  return archive;
}
