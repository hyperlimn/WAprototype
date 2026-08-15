import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { SAVE_STATE_SCHEMA_VERSION, validateContinuation, type SaveStateArtifact, type UniverseContinuationState } from "../../src/simulation/saveState.js";

const safe = (value: string): string => { if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value)) throw new Error("Invalid save-state identifier"); return value; };
const canonical = (value: unknown): string => JSON.stringify(value);
export const continuationHash = (value: UniverseContinuationState): string => createHash("sha256").update(canonical(value)).digest("hex");
export interface SaveStateSummary { id: string; universe: string; tick: number | null; createdAt: string | null; checksum: string | null;
  simulationVersion: string | null; resumable: boolean; compatibility: "compatible" | "invalid"; reason: string | null }

export class SaveStateStore {
  constructor(readonly root = path.resolve(process.env.PROTOUNIVERSE_SAVE_ROOT ?? "data/universes")) {}
  file(universe: string, id: string): string { return path.join(this.root, safe(universe), "save-states", `${safe(id)}.json`); }
  async create(value: UniverseContinuationState): Promise<{ artifact: SaveStateArtifact; file: string }> {
    const continuation = validateContinuation(value), id = `save-${String(continuation.tick).padStart(12, "0")}`;
    const file = this.file(continuation.universe, id), artifact: SaveStateArtifact = { schemaVersion: SAVE_STATE_SCHEMA_VERSION, id,
      universe: continuation.universe, tick: continuation.tick, createdAt: new Date().toISOString(), simulationVersion: continuation.simulationVersion,
      checksum: { algorithm: "sha256", value: continuationHash(continuation) }, continuation };
    await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(artifact, null, 2), { encoding: "utf8", flag: "wx" }); await link(temporary, file); }
    catch (error) { try { const existing = await readFile(file, "utf8"); if (existing) throw new Error(`Save-state ${id} already exists and was not overwritten`); } catch (readError) { if (readError instanceof Error && readError.message.includes("not overwritten")) throw readError; } throw error; }
    finally { await unlink(temporary).catch(() => undefined); }
    return { artifact, file };
  }
  async load(fileOrId: string, universe?: string): Promise<SaveStateArtifact> {
    const file = fileOrId.endsWith(".json") || fileOrId.includes("/") || fileOrId.includes("\\") ? path.resolve(fileOrId)
      : universe ? this.file(universe, fileOrId) : (() => { throw new Error("A universe is required when loading by save ID"); })();
    const artifact = JSON.parse(await readFile(file, "utf8")) as SaveStateArtifact;
    if (artifact.schemaVersion !== SAVE_STATE_SCHEMA_VERSION || artifact.id === undefined || artifact.universe === undefined || artifact.tick !== artifact.continuation?.tick)
      throw new Error("Malformed or incompatible save-state artifact");
    validateContinuation(artifact.continuation, artifact.simulationVersion);
    if (continuationHash(artifact.continuation) !== artifact.checksum?.value) throw new Error("Save-state checksum mismatch");
    return artifact;
  }
  async list(universe: string): Promise<SaveStateSummary[]> {
    const directory = path.join(this.root, safe(universe), "save-states");
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const summaries = await Promise.all(names.filter((name) => /^save-[a-zA-Z0-9._-]+\.json$/.test(name)).map(async (name) => {
      const id = name.slice(0, -5);
      try { const artifact = await this.load(id, universe); return { id: artifact.id, universe: artifact.universe, tick: artifact.tick,
          createdAt: artifact.createdAt, checksum: artifact.checksum.value, simulationVersion: artifact.simulationVersion,
          resumable: true, compatibility: "compatible" as const, reason: null }; }
      catch (error) { return { id, universe, tick: null, createdAt: null, checksum: null, simulationVersion: null,
          resumable: false, compatibility: "invalid" as const, reason: error instanceof Error ? error.message : "Invalid save-state" }; }
    }));
    return summaries.sort((a, b) => (b.tick ?? -1) - (a.tick ?? -1) || b.id.localeCompare(a.id));
  }
}
