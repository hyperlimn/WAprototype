export type OperatorGroup = "Universe" | "Observation" | "Laboratory" | "Runtime" | "Help";
export interface CommandOption { name: string; type: "string" | "number"; required?: boolean; default?: string | number; description: string }
export interface ProtoUniverseCommand { id: string; label: string; group: OperatorGroup; purpose: string; cli: string; options: CommandOption[];
  examples: string[]; safety: string; gui: boolean; longRunning: boolean }

export const COMMAND_REGISTRY: readonly ProtoUniverseCommand[] = [
  { id: "universe.save", label: "Save current universe", group: "Universe", purpose: "Write an immutable executable continuation point for the active universe.",
    cli: "npm run universe:save", options: [], examples: ["npm run universe:save"], safety: "Current authoritative state only; never overwrites or restarts.", gui: true, longRunning: false },
  { id: "universe.delete-save", label: "Delete selected save", group: "Universe", purpose: "Delete exactly one selected immutable save artifact by canonical ID.",
    cli: "Delete <saveId>", options: [{ name: "saveId", type: "string", required: true, description: "Canonical immutable save ID" }], examples: ["Delete save-000000201118"],
    safety: "Irreversible and confirmation-gated; the supervisor resolves the ID and refuses the active resume source.", gui: true, longRunning: false },
  { id: "observer.once", label: "Run observer once", group: "Observation", purpose: "Launch one autonomous observer expedition and exit.",
    cli: "npm run observer:once", options: [{ name: "observer", type: "string", default: "codex-first-entry", description: "Observer identity" },
      { name: "expeditionTimeout", type: "number", default: 3600, description: "Maximum expedition seconds" }],
    examples: ["npm run observer:once -- --observer codex-first-entry"], safety: "Observational Codex process; no universe mutation.", gui: true, longRunning: true },
  { id: "observer.loop", label: "Start observer loop", group: "Observation", purpose: "Run serialized observer expeditions with a wait after each completion.",
    cli: "npm run observer:loop", options: [{ name: "observer", type: "string", default: "codex-first-entry", description: "Observer identity" },
      { name: "interval", type: "number", default: 300, description: "Post-expedition wait seconds" }, { name: "expeditionTimeout", type: "number", default: 3600, description: "Maximum expedition seconds" }],
    examples: ["npm run observer:loop -- --observer codex-first-entry --interval 300"], safety: "One expedition at a time; GUI Stop targets only its owned loop.", gui: true, longRunning: true },
  { id: "lab.blind", label: "Launch blind experiment", group: "Laboratory", purpose: "Run an experiment's sealed blind phase through the existing Laboratory runner.",
    cli: "npm run lab:once -- --experiment <id>", options: [{ name: "experiment", type: "string", required: true, description: "Experiment ID" }],
    examples: ["npm run lab:once -- --experiment archaeology-005"], safety: "Existing immutable-result and sealed-observer safeguards apply.", gui: true, longRunning: true },
  { id: "lab.reveal", label: "Launch reveal", group: "Laboratory", purpose: "Reveal and compare only after a valid frozen reconstruction exists.",
    cli: "npm run lab:reveal -- --experiment <id>", options: [{ name: "experiment", type: "string", required: true, description: "Experiment ID" }],
    examples: ["npm run lab:reveal -- --experiment archaeology-005"], safety: "Deliberate action; existing chamber integrity checks cannot be bypassed.", gui: true, longRunning: true },
  { id: "service.bridge-api.restart", label: "Start / Restart Bridge + API", group: "Runtime", purpose: "Start or restart the combined bridge and Operator API through the loopback supervisor.",
    cli: "npm run dev:bridge", options: [], examples: ["npm run dev:supervisor", "npm run dev:bridge"],
    safety: "Supervisor controls only its own repo-scoped bridge child and refuses an occupied unmanaged port.", gui: true, longRunning: false },
  { id: "runtime.restart-all", label: "Restart Everything", group: "Runtime", purpose: "Save the live universe, stop the supervisor-owned runtime, and resume the exact save.",
    cli: "Restart Everything (save → stop → resume)", options: [], examples: ["npm run dev"],
    safety: "Save-first is mandatory; failure aborts before shutdown. Supervisor itself remains alive.", gui: true, longRunning: true },
  { id: "runtime.resume-save", label: "Resume Selected Save", group: "Runtime", purpose: "Replace the live runtime with a validated immutable save selected by ID.",
    cli: "Resume <saveId>", options: [{ name: "saveId", type: "string", required: true, description: "Canonical immutable save ID" }], examples: ["Resume save-000000186465"],
    safety: "Deliberate timeline replacement; the supervisor resolves and validates the ID internally and never accepts a path.", gui: true, longRunning: true },
  { id: "help", label: "Command help", group: "Help", purpose: "Display ProtoUniverse command metadata without starting a process.",
    cli: "npm run help", options: [], examples: ["npm run help"], safety: "Metadata only; never executes a tool.", gui: true, longRunning: false },
] as const;

export function commandById(id: string): ProtoUniverseCommand | undefined { return COMMAND_REGISTRY.find((command) => command.id === id); }
export function formatCommand(command: ProtoUniverseCommand, args: Record<string, unknown> = {}): string {
  if (command.id === "lab.blind" || command.id === "lab.reveal") return command.cli.replace("<id>", String(args.experiment ?? "<id>"));
  if (command.id === "universe.delete-save") return command.cli.replace("<saveId>", String(args.saveId ?? "<saveId>"));
  const suffix = command.options.flatMap((option) => args[option.name] === undefined ? [] : [`--${option.name === "expeditionTimeout" ? "expedition-timeout" : option.name}`, String(args[option.name])]);
  return suffix.length ? `${command.cli} -- ${suffix.join(" ")}` : command.cli;
}

export function formatRegistryHelp(): string {
  return COMMAND_REGISTRY.map((command) => `${command.group.toUpperCase()} / ${command.label}\n  ${command.purpose}\n  ${command.cli}\n  Safety: ${command.safety}`).join("\n\n");
}
