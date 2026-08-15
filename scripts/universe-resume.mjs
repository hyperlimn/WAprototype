import { spawn } from "node:child_process";
import path from "node:path";
import { SaveStateStore } from "../server/save-state/saveStateStore.js";

const args = process.argv.slice(2), at = args.indexOf("--save"), selected = at >= 0 ? args[at + 1] : undefined;
if (!selected) { process.stderr.write("Usage: npm run universe:resume -- --save <save-state.json>\n"); process.exit(1); }
const bridge = process.env.PROTOUNIVERSE_BRIDGE_URL ?? "http://127.0.0.1:8787";
try {
  try {
    const status = await (await fetch(new URL("/api/status", bridge), { signal: AbortSignal.timeout(1_500) })).json();
    if (status.connected) throw new Error(`Authoritative runtime ${status.seed} is already active at tick ${status.currentTick}`);
  } catch (error) { if (error instanceof Error && error.message.startsWith("Authoritative runtime")) throw error; }
  const file = path.resolve(selected), artifact = await new SaveStateStore().load(file);
  process.stdout.write(`Validated ${artifact.id} for ${artifact.universe} at tick ${artifact.tick}; starting the existing runtime in resume mode.\n`);
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], { stdio: "inherit", env: { ...process.env,
    PROTOUNIVERSE_RESUME_SAVE: file, VITE_PROTOUNIVERSE_RESUME: "1" }, windowsHide: true });
  child.on("exit", (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
} catch (error) { process.stderr.write(`Universe resume refused: ${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; }
