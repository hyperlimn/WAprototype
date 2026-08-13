import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { MEMORY_SCHEMA_VERSION, type UniverseManifest } from "../../src/memory/memoryTypes.js";

export interface ArchivedUniverse {
  seed: string;
  memorySchemaVersion: string;
  simulationVersionsSeen: string[];
  firstTick: number | null;
  latestTick: number | null;
  memoryMode: string;
  eventCount: number;
  checkpointCount: number;
  segmentCount: number;
  diskBytes: number;
  lastUpdatedAt: string;
}

export interface ArchiveDescriptor { directory: string; manifest: UniverseManifest; metadata: ArchivedUniverse }
export interface UniverseCatalog { universes: ArchiveDescriptor[]; warnings: Array<{ directory: string; error: string }> }

const validManifest = (value: unknown): value is UniverseManifest => {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<UniverseManifest>;
  return manifest.memorySchemaVersion === MEMORY_SCHEMA_VERSION && typeof manifest.seed === "string" && manifest.seed.length > 0
    && Array.isArray(manifest.simulationVersionsSeen) && manifest.simulationVersionsSeen.every((item) => typeof item === "string")
    && (manifest.firstTick === null || typeof manifest.firstTick === "number")
    && (manifest.latestTick === null || typeof manifest.latestTick === "number")
    && typeof manifest.memoryMode === "string" && typeof manifest.eventCount === "number"
    && typeof manifest.checkpointCount === "number" && typeof manifest.segmentCount === "number"
    && typeof manifest.lastUpdatedAt === "string" && Array.isArray(manifest.segments) && Array.isArray(manifest.checkpoints);
};

export async function listUniverses(root: string): Promise<UniverseCatalog> {
  const universesDir = path.join(root, "universes");
  let entries;
  try { entries = await readdir(universesDir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { universes: [], warnings: [] };
    return { universes: [], warnings: [{ directory: universesDir, error: "unreadable universe catalog" }] };
  }
  const universes: ArchiveDescriptor[] = [], warnings: UniverseCatalog["warnings"] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = path.join(universesDir, entry.name);
    try {
      const manifestFile = path.join(directory, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as unknown;
      if (!validManifest(manifest)) throw new Error("invalid or unsupported manifest");
      const manifestBytes = (await stat(manifestFile)).size;
      const diskBytes = manifestBytes + manifest.segments.reduce((sum, item) => sum + (Number.isFinite(item.bytes) ? item.bytes : 0), 0)
        + manifest.checkpoints.reduce((sum, item) => sum + (Number.isFinite(item.bytes) ? item.bytes : 0), 0);
      const metadata: ArchivedUniverse = { seed: manifest.seed, memorySchemaVersion: manifest.memorySchemaVersion,
        simulationVersionsSeen: [...manifest.simulationVersionsSeen], firstTick: manifest.firstTick, latestTick: manifest.latestTick,
        memoryMode: manifest.memoryMode, eventCount: manifest.eventCount, checkpointCount: manifest.checkpointCount,
        segmentCount: manifest.segmentCount, diskBytes, lastUpdatedAt: manifest.lastUpdatedAt };
      if (universes.some((archive) => archive.manifest.seed === manifest.seed)) {
        warnings.push({ directory: entry.name, error: `duplicate manifest seed ${manifest.seed}` });
        continue;
      }
      universes.push({ directory, manifest, metadata });
    } catch (error) {
      warnings.push({ directory: entry.name, error: error instanceof Error ? error.message : "unreadable archive" });
    }
  }
  universes.sort((a, b) => a.manifest.seed.localeCompare(b.manifest.seed));
  return { universes, warnings };
}
