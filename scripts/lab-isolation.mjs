import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function createEmptyLaboratoryWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "protouniverse-lab-stage-"));
}

export async function removeLaboratoryWorkspace(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}
