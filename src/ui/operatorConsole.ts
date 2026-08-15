import { formatRegistryHelp, type ProtoUniverseCommand } from "../operator/commandRegistry";

interface ExperimentStatus { id: string; frozen: boolean; compared: boolean; blindAvailable: boolean; revealAvailable: boolean; revealUnavailableReason: string | null }
interface OperatorRun { id: string; commandId: string; command: string; startedAt: string; finishedAt: string | null; status: string; output: string; stoppable: boolean }
interface Catalog { commands: ProtoUniverseCommand[]; experiments: ExperimentStatus[]; runtime: { connected: boolean; seed: string | null; currentTick: number | null;
  provenance: { mode: string; sourceSaveTick: number | null } | null }; saveStatePattern: string }
const API = "http://127.0.0.1:8787/api/operator";

export function bindOperatorConsole(root: HTMLElement): void {
  const output = root.querySelector<HTMLPreElement>("#operatorOutput")!, state = root.querySelector<HTMLElement>("#operatorRunState")!;
  const experimentSelect = root.querySelector<HTMLSelectElement>("#operatorExperiment")!, experimentStatus = root.querySelector<HTMLElement>("#operatorExperimentStatus")!;
  const blind = root.querySelector<HTMLButtonElement>("#operatorBlind")!, reveal = root.querySelector<HTMLButtonElement>("#operatorReveal")!;
  const stop = root.querySelector<HTMLButtonElement>("#operatorStop")!, observer = root.querySelector<HTMLInputElement>("#operatorObserver")!;
  let catalog: Catalog | null = null, activeRun: OperatorRun | null = null, clearedAt = Number(sessionStorage.getItem("protouniverse.operator.clearedAt") ?? 0);
  const show = (text: string) => { output.textContent = text || "No operator output in this browser session."; output.scrollTop = output.scrollHeight; };
  const request = async (pathname: string, init?: RequestInit) => { const response = await fetch(`${API}${pathname}`, init); const value = await response.json();
    if (!response.ok) throw new Error(value.message ?? value.error); return value; };
  const refreshExperiment = () => {
    const selected = catalog?.experiments.find((item) => item.id === experimentSelect.value); if (!selected) return;
    blind.disabled = !selected.blindAvailable; reveal.disabled = !selected.revealAvailable;
    experimentStatus.textContent = selected.revealAvailable ? "Frozen reconstruction ready for deliberate reveal."
      : selected.revealUnavailableReason ?? (selected.frozen ? "Blind reconstruction already frozen." : "Blind phase available.");
  };
  const loadCatalog = async () => {
    const loaded = await request("/catalog") as Catalog; catalog = loaded; experimentSelect.replaceChildren(...loaded.experiments.map((item) => new Option(item.id, item.id)));
    const runtime = loaded.runtime, provenance = runtime.provenance;
    root.querySelector<HTMLElement>("#operatorRuntime")!.textContent = !runtime.connected ? "No active authority" : provenance?.mode === "resumed"
      ? `Resumed @ ${provenance.sourceSaveTick?.toLocaleString()}` : `Fresh · tick ${runtime.currentTick?.toLocaleString()}`;
    root.querySelector<HTMLElement>("#operatorSavePattern")!.textContent = loaded.saveStatePattern; refreshExperiment();
  };
  const launch = async (commandId: string, args: Record<string, unknown> = {}) => {
    try { const value = await request("/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId, args }) });
      const run = value.run as OperatorRun; activeRun = run; state.textContent = "running"; stop.disabled = !run.stoppable; show(`${new Date().toISOString()} $ ${run.command}\n`);
    } catch (error) { state.textContent = "failed"; show(`${new Date().toISOString()} [failed] ${error instanceof Error ? error.message : error}`); }
  };
  root.querySelectorAll<HTMLButtonElement>("[data-operator-command]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.operatorCommand!; void launch(id, id.startsWith("observer.") ? { observer: observer.value } : {});
  }));
  blind.addEventListener("click", () => void launch("lab.blind", { experiment: experimentSelect.value }));
  reveal.addEventListener("click", () => { if (reveal.disabled || !confirm(`Reveal authoritative hidden history for ${experimentSelect.value}? The frozen reconstruction cannot be changed.`)) return;
    void launch("lab.reveal", { experiment: experimentSelect.value }); });
  stop.addEventListener("click", async () => { if (!activeRun) return; try { await request(`/runs/${encodeURIComponent(activeRun.id)}/stop`, { method: "POST" }); }
    catch (error) { show(`${output.textContent}\n${new Date().toISOString()} [stop refused] ${error instanceof Error ? error.message : error}`); } });
  root.querySelector<HTMLButtonElement>("#operatorHelp")!.addEventListener("click", () => { state.textContent = "help"; show(formatRegistryHelp()); });
  root.querySelector<HTMLButtonElement>("#operatorClear")!.addEventListener("click", () => { clearedAt = Date.now(); sessionStorage.setItem("protouniverse.operator.clearedAt", String(clearedAt)); show(""); });
  root.querySelector<HTMLButtonElement>("#operatorCopy")!.addEventListener("click", () => void navigator.clipboard.writeText(output.textContent ?? ""));
  experimentSelect.addEventListener("change", refreshExperiment);
  const poll = async () => { try { const value = await request("/runs") as { runs: OperatorRun[] }; const visible = value.runs.filter((run) => Date.parse(run.startedAt) >= clearedAt);
      activeRun = activeRun ? value.runs.find((run) => run.id === activeRun?.id) ?? null : visible.find((run) => run.status === "running") ?? null;
      if (activeRun) { state.textContent = activeRun.status; stop.disabled = activeRun.status !== "running" || !activeRun.stoppable; }
      show(visible.reverse().map((run) => run.output).join("\n") || output.textContent || "");
    } catch { /* Bridge status already communicates availability. */ } window.setTimeout(poll, 750); };
  void loadCatalog().catch((error) => { experimentStatus.textContent = `Operator API unavailable: ${error instanceof Error ? error.message : error}`; }); void poll();
}
