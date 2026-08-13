import { rm } from "node:fs/promises";
import path from "node:path";

const target = path.resolve(".test-dist");
if (path.dirname(target) !== process.cwd() || path.basename(target) !== ".test-dist") {
  throw new Error("Refusing to clean a test directory outside the repository root");
}
await rm(target, { recursive: true, force: true });
