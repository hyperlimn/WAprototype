export type OperatorGroup = "Universe" | "Observation" | "Laboratory" | "Help";
export interface CommandOption { name: string; type: "string" | "number"; required?: boolean; default?: string | number; description: string }
export interface ProtoUniverseCommand { id: string; label: string; group: OperatorGroup; purpose: string; cli: string; options: CommandOption[];
  examples: string[]; safety: string; gui: boolean; longRunning: boolean }

export const COMMAND_REGISTRY: readonly ProtoUniverseCommand[] = [
  { id: "universe.save", label: "Save current universe", group: "Universe", purpose: "Write an immutable executable continuation point for the active universe.",
    cli: "npm run universe:save", options: [], examples: ["npm run universe:save"], safety: "Current authoritative state only; never overwrites or restarts.", gui: true, longRunning: false },
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
  { id: "help", label: "Command help", group: "Help", purpose: "Display ProtoUniverse command metadata without starting a process.",
    cli: "npm run help", options: [], examples: ["npm run help"], safety: "Metadata only; never executes a tool.", gui: true, longRunning: false },
] as const;

export function commandById(id: string): ProtoUniverseCommand | undefined { return COMMAND_REGISTRY.find((command) => command.id === id); }
export function formatCommand(command: ProtoUniverseCommand, args: Record<string, unknown> = {}): string {
  if (command.id === "lab.blind" || command.id === "lab.reveal") return command.cli.replace("<id>", String(args.experiment ?? "<id>"));
  const suffix = command.options.flatMap((option) => args[option.name] === undefined ? [] : [`--${option.name === "expeditionTimeout" ? "expedition-timeout" : option.name}`, String(args[option.name])]);
  return suffix.length ? `${command.cli} -- ${suffix.join(" ")}` : command.cli;
}

export function formatRegistryHelp(): string {
  return COMMAND_REGISTRY.map((command) => `${command.group.toUpperCase()} / ${command.label}\n  ${command.purpose}\n  ${command.cli}\n  Safety: ${command.safety}`).join("\n\n");
}
