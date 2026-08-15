import { commandById, formatCommand, formatRegistryHelp, type ProtoUniverseCommand } from "../operator/commandRegistry";
import { requestOperatorJson } from "./operatorApi";

interface ExperimentStatus { id: string; frozen: boolean; compared: boolean; blindAvailable: boolean; revealAvailable: boolean; revealUnavailableReason: string | null }
interface OperatorRun { id: string; commandId: string; command: string; startedAt: string; finishedAt: string | null; status: string; output: string; stoppable: boolean }
interface SaveSummary { id: string; universe: string; tick: number | null; createdAt: string | null; checksum: string | null;
  resumable: boolean; compatibility: string; reason: string | null }
interface Catalog { commands: ProtoUniverseCommand[]; experiments: ExperimentStatus[]; runtime: { connected: boolean; seed: string | null; currentTick: number | null;
  provenance: { mode: string; sourceSaveTick: number | null } | null }; saveStatePattern: string }
const API = "http://127.0.0.1:8787/api/operator";
const SUPERVISOR_API = "http://127.0.0.1:8790/api/supervisor";

export function bindOperatorConsole(root: HTMLElement): void {
  const output = root.querySelector<HTMLPreElement>("#operatorOutput")!, state = root.querySelector<HTMLElement>("#operatorRunState")!;
  const experimentSelect = root.querySelector<HTMLSelectElement>("#operatorExperiment")!, experimentStatus = root.querySelector<HTMLElement>("#operatorExperimentStatus")!;
  const blind = root.querySelector<HTMLButtonElement>("#operatorBlind")!, reveal = root.querySelector<HTMLButtonElement>("#operatorReveal")!;
  const stop = root.querySelector<HTMLButtonElement>("#operatorStop")!, observer = root.querySelector<HTMLInputElement>("#operatorObserver")!;
  const serviceControl = document.querySelector<HTMLButtonElement>("#bridgeApiControl")!, supervisorStatus = document.querySelector<HTMLElement>("#supervisorStatus")!;
  const restartEverything = document.querySelector<HTMLButtonElement>("#restartEverything")!;
  const saveSelect = root.querySelector<HTMLSelectElement>("#operatorSaveStates")!, resumeSave = root.querySelector<HTMLButtonElement>("#operatorResumeSave")!;
  const deleteSave = root.querySelector<HTMLButtonElement>("#operatorDeleteSave")!, copySave = root.querySelector<HTMLButtonElement>("#operatorCopySave")!;
  const saveStatus = root.querySelector<HTMLElement>("#operatorSaveStatus")!, saveDetails = root.querySelector<HTMLElement>("#operatorSaveDetails")!;
  const toast = document.querySelector<HTMLElement>("#operatorToast")!;
  let catalog: Catalog | null = null, activeRun: OperatorRun | null = null, clearedAt = Number(sessionStorage.getItem("protouniverse.operator.clearedAt") ?? 0);
  let operatorRuns: OperatorRun[] = [], serviceRuns: OperatorRun[] = [], toastTimer = 0;
  let saveRefreshAt = 0;
  const announced = new Map<string, string>();
  const show = (text: string) => { output.textContent = text || "No operator output in this browser session."; output.scrollTop = output.scrollHeight; };
  const request = (pathname: string, init?: RequestInit) => requestOperatorJson(API, pathname, "bridge", init);
  const supervisorRequest = (pathname: string, init?: RequestInit) => requestOperatorJson(SUPERVISOR_API, pathname, "supervisor", init);
  const notify = (message: string, failed = false) => { window.clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false; toast.classList.toggle("is-failed", failed);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3_500); };
  const renderRuns = () => { const visible = [...operatorRuns, ...serviceRuns].filter((run) => Date.parse(run.startedAt) >= clearedAt)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)); show(visible.map((run) => run.output).join("\n") || output.textContent || ""); };
  const observeCompletions = (runs: OperatorRun[]) => { for (const run of runs) { const previous = announced.get(run.id); announced.set(run.id, run.status);
      if (previous === "running" && run.status !== "running") {
        notify(`${run.commandId}: ${run.status}`, run.status !== "completed");
        if (run.commandId === "universe.save" && run.status === "completed") void loadSaves().catch((error) => {
          saveStatus.textContent = `Save succeeded, but library refresh failed: ${error instanceof Error ? error.message : error}`;
        });
      } } };
  const refreshExperiment = () => {
    const selected = catalog?.experiments.find((item) => item.id === experimentSelect.value); if (!selected) return;
    blind.disabled = !selected.blindAvailable; reveal.disabled = !selected.revealAvailable;
    experimentStatus.textContent = selected.revealAvailable ? "Frozen reconstruction ready for deliberate reveal."
      : selected.revealUnavailableReason ?? (selected.frozen ? "Blind reconstruction already frozen." : "Blind phase available.");
  };
  const refreshSaveSelection = (saves: readonly SaveSummary[]): void => {
    const prior = saveSelect.value; saveSelect.replaceChildren(...saves.map((save) => {
      const created = save.createdAt ? new Date(save.createdAt).toLocaleString() : "unknown date";
      const option = new Option(`${save.tick === null ? "invalid" : `tick ${save.tick.toLocaleString()}`} · ${save.id} · ${created} · ${save.checksum?.slice(0, 10) ?? "no hash"} · ${save.universe} · ${save.compatibility}`, save.id);
      option.disabled = !save.resumable; option.dataset.summary = JSON.stringify(save); return option;
    }));
    if ([...saveSelect.options].some((option) => option.value === prior && !option.disabled)) saveSelect.value = prior;
    else { const next = [...saveSelect.options].find(option => !option.disabled); if (next) saveSelect.value = next.value; }
    const selected = saves.find((save) => save.id === saveSelect.value); resumeSave.disabled = !selected?.resumable;
    deleteSave.disabled = !selected?.resumable; copySave.disabled = !selected;
    saveStatus.textContent = selected ? `${selected.universe} · ${selected.compatibility} · ${selected.createdAt ? new Date(selected.createdAt).toLocaleString() : selected.reason ?? "unavailable"}`
      : saves.length ? "Select a compatible save." : "No immutable saves found for this universe.";
    saveDetails.textContent = selected ? `${selected.id}\ntick ${selected.tick?.toLocaleString() ?? "unavailable"}\n${selected.universe}\ncreated ${selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "unavailable"}\nSHA-256 ${selected.checksum ?? "unavailable"}\n${selected.compatibility}` : "No save selected.";
  };
  const loadSaves = async () => { const value = await supervisorRequest("/save-states") as { saves: SaveSummary[] }; refreshSaveSelection(value.saves); };
  const loadCatalog = async () => {
    const loaded = await request("/catalog") as Catalog; catalog = loaded; experimentSelect.replaceChildren(...loaded.experiments.map((item) => new Option(item.id, item.id)));
    const runtime = loaded.runtime, provenance = runtime.provenance;
    root.querySelector<HTMLElement>("#operatorRuntime")!.textContent = !runtime.connected ? "No active authority" : provenance?.mode === "resumed"
      ? `Resumed @ ${provenance.sourceSaveTick?.toLocaleString()}` : `Fresh · tick ${runtime.currentTick?.toLocaleString()}`;
    root.querySelector<HTMLElement>("#operatorSavePattern")!.textContent = loaded.saveStatePattern; refreshExperiment();
  };
  const launch = async (commandId: string, args: Record<string, unknown> = {}) => {
    const definition = commandById(commandId); const command = definition ? formatCommand(definition, args) : commandId;
    state.textContent = "starting"; show(`${output.textContent}\n${new Date().toISOString()} $ ${command}\n${new Date().toISOString()} [starting] ${commandId}\n`);
    try { const value = await request("/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId, args }) });
      const run = value.run as OperatorRun; activeRun = run; state.textContent = "running"; stop.disabled = !run.stoppable; show(`${new Date().toISOString()} $ ${run.command}\n`);
    } catch (error) { state.textContent = "failed"; const message = error instanceof Error ? error.message : String(error); show(`${output.textContent}\n${new Date().toISOString()} [failed] ${message}`); notify(`${commandId}: failed`, true); }
  };
  root.querySelectorAll<HTMLButtonElement>("[data-operator-command]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.operatorCommand!; void launch(id, id.startsWith("observer.") ? { observer: observer.value } : {});
  }));
  blind.addEventListener("click", () => void launch("lab.blind", { experiment: experimentSelect.value }));
  reveal.addEventListener("click", () => { if (reveal.disabled || !confirm(`Reveal authoritative hidden history for ${experimentSelect.value}? The frozen reconstruction cannot be changed.`)) return;
    void launch("lab.reveal", { experiment: experimentSelect.value }); });
  serviceControl.addEventListener("click", async () => {
    const definition = commandById("service.bridge-api.restart")!; const command = formatCommand(definition);
    show(`${output.textContent}\n${new Date().toISOString()} $ ${command}\n${new Date().toISOString()} [starting] supervisor service action\n`);
    try { const value = await supervisorRequest("/run", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: definition.id }) }); serviceRuns = [value.run as OperatorRun, ...serviceRuns]; renderRuns(); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); show(`${output.textContent}\n${new Date().toISOString()} [failed] ${message}`); notify("Bridge + API action failed", true); }
  });
  restartEverything.addEventListener("click", async () => {
    const tick = catalog?.runtime.currentTick;
    if (!confirm(`Restart Everything?\n\nThe current universe at tick ${tick?.toLocaleString() ?? "unknown"} will be saved first. If saving fails, restart aborts.`)) return;
    const definition = commandById("runtime.restart-all")!;
    show(`${output.textContent}\n${new Date().toISOString()} $ ${definition.cli}\n${new Date().toISOString()} [starting] save-first runtime restart\n`);
    try { const value = await supervisorRequest("/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId: definition.id }) });
      serviceRuns = [value.run as OperatorRun, ...serviceRuns]; renderRuns(); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); show(`${output.textContent}\n${new Date().toISOString()} [failed] ${message}`); notify("Restart Everything failed", true); }
  });
  const selectedSave = (): SaveSummary | null => { const option = saveSelect.selectedOptions[0]; return option?.dataset.summary ? JSON.parse(option.dataset.summary) as SaveSummary : null; };
  saveSelect.addEventListener("change", () => { const save = selectedSave(); resumeSave.disabled = !save?.resumable; deleteSave.disabled = !save?.resumable; copySave.disabled = !save;
    saveStatus.textContent = save ? `${save.universe} · ${save.compatibility} · ${save.createdAt ? new Date(save.createdAt).toLocaleString() : save.reason ?? "unavailable"}` : "Select a compatible save.";
    saveDetails.textContent = save ? `${save.id}\ntick ${save.tick?.toLocaleString() ?? "unavailable"}\n${save.universe}\ncreated ${save.createdAt ? new Date(save.createdAt).toLocaleString() : "unavailable"}\nSHA-256 ${save.checksum ?? "unavailable"}\n${save.compatibility}` : "No save selected."; });
  copySave.addEventListener("click", () => void navigator.clipboard.writeText(saveDetails.textContent ?? ""));
  deleteSave.addEventListener("click", async () => { const save = selectedSave(); if (!save?.resumable || save.tick === null) return;
    if (!confirm(`Delete ${save.id}?\n\nTick: ${save.tick.toLocaleString()}\nUniverse: ${save.universe}\nCreated: ${save.createdAt ? new Date(save.createdAt).toLocaleString() : "unknown"}\n\nThis permanently deletes only this immutable save state.`)) return;
    const definition = commandById("universe.delete-save")!, command = formatCommand(definition, { saveId: save.id });
    show(`${output.textContent}\n${new Date().toISOString()} $ ${command}\n${new Date().toISOString()} [starting] selected save deletion\n`);
    try { const value = await supervisorRequest("/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId: definition.id, saveId: save.id }) });
      serviceRuns = [value.run as OperatorRun, ...serviceRuns]; renderRuns(); await loadSaves(); notify(`${save.id} deleted`); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); show(`${output.textContent}\n${new Date().toISOString()} [failed] ${message}`); notify("Delete Selected Save failed", true); }
  });
  resumeSave.addEventListener("click", async () => {
    const save = selectedSave();
    if (!save?.resumable || save.tick === null || !confirm(`Resume ${save.id}?\n\nThe currently running universe will be replaced by the immutable continuation from tick ${save.tick.toLocaleString()}. No new save will be created.`)) return;
    show(`${output.textContent}\n${new Date().toISOString()} $ Resume ${save.id}\n${new Date().toISOString()} [starting] selected save resume\n`);
    try { const value = await supervisorRequest("/run", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: "runtime.resume-save", saveId: save.id }) }); serviceRuns = [value.run as OperatorRun, ...serviceRuns]; renderRuns(); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); show(`${output.textContent}\n${new Date().toISOString()} [failed] ${message}`); notify("Resume Selected Save failed", true); }
  });
  stop.addEventListener("click", async () => { if (!activeRun) return; try { await request(`/runs/${encodeURIComponent(activeRun.id)}/stop`, { method: "POST" }); }
    catch (error) { show(`${output.textContent}\n${new Date().toISOString()} [stop refused] ${error instanceof Error ? error.message : error}`); } });
  root.querySelector<HTMLButtonElement>("#operatorHelp")!.addEventListener("click", () => { state.textContent = "help"; show(formatRegistryHelp()); });
  root.querySelector<HTMLButtonElement>("#operatorClear")!.addEventListener("click", () => { clearedAt = Date.now(); sessionStorage.setItem("protouniverse.operator.clearedAt", String(clearedAt)); show(""); });
  root.querySelector<HTMLButtonElement>("#operatorCopy")!.addEventListener("click", () => void navigator.clipboard.writeText(output.textContent ?? ""));
  experimentSelect.addEventListener("change", refreshExperiment);
  const poll = async () => { try { const value = await request("/runs") as { runs: OperatorRun[] }; operatorRuns = value.runs; observeCompletions(operatorRuns); const visible = operatorRuns.filter((run) => Date.parse(run.startedAt) >= clearedAt);
      activeRun = activeRun ? operatorRuns.find((run) => run.id === activeRun?.id) ?? null : visible.find((run) => run.status === "running") ?? null;
      if (activeRun) { state.textContent = activeRun.status; stop.disabled = activeRun.status !== "running" || !activeRun.stoppable; }
      renderRuns();
    } catch { /* Bridge status already communicates availability. */ }
    try { const value = await supervisorRequest("/runs") as { runs: OperatorRun[] }; serviceRuns = value.runs; observeCompletions(serviceRuns); renderRuns();
      const status = await supervisorRequest("/status") as { supervisorPid: number; duplicateProtoUniverseInstances: number;
        manifestPersistence: { healthy?: boolean; writerPid?: number; lastRetryCount?: number; reason?: string };
        services: Array<{ id: string; owned: boolean; pid: number | null; url: string }>; lastRestart: (OperatorRun & { phase?: string }) | null };
      const frontend = status.services.find((item) => item.id === "frontend"), bridge = status.services.find((item) => item.id === "bridge-api");
      document.querySelector<HTMLElement>("#supervisorFrontend")!.textContent = frontend?.owned ? `managed · PID ${frontend.pid}` : "not managed";
      document.querySelector<HTMLElement>("#supervisorBridge")!.textContent = bridge?.owned ? `managed · PID ${bridge.pid}` : "not managed";
      document.querySelector<HTMLElement>("#supervisorPid")!.textContent = `PID ${status.supervisorPid}`;
      document.querySelector<HTMLElement>("#runtimeDuplicates")!.textContent = status.duplicateProtoUniverseInstances === 0 ? "0"
        : status.duplicateProtoUniverseInstances < 0 ? "warning · scan unavailable" : `warning · ${status.duplicateProtoUniverseInstances}`;
      document.querySelector<HTMLElement>("#manifestPersistence")!.textContent = status.manifestPersistence.healthy
        ? `healthy · PID ${status.manifestPersistence.writerPid}${status.manifestPersistence.lastRetryCount ? ` · ${status.manifestPersistence.lastRetryCount} retries` : ""}`
        : `warning · ${status.manifestPersistence.reason ?? "write failure"}`;
      document.querySelector<HTMLElement>("#lastRestartResult")!.textContent = status.lastRestart ? `${status.lastRestart.status} · ${status.lastRestart.phase ?? ""}` : "none";
      supervisorStatus.textContent = "Supervisor ready · localhost:8790";
      if (Date.now() >= saveRefreshAt) { saveRefreshAt = Date.now() + 5_000; void loadSaves().catch(() => undefined); }
      const restart = serviceRuns.find((run) => run.commandId === "runtime.restart-all" || run.commandId === "runtime.resume-save") as (OperatorRun & { reloadReady?: boolean }) | undefined;
      if (restart?.reloadReady && !sessionStorage.getItem(`protouniverse.restart.reload.${restart.id}`)) {
        sessionStorage.setItem(`protouniverse.restart.reload.${restart.id}`, "true"); window.setTimeout(() => location.reload(), 150);
      }
    } catch { supervisorStatus.textContent = "Supervisor unavailable · run npm run dev:supervisor"; }
    window.setTimeout(poll, 750); };
  void loadCatalog().catch((error) => { experimentStatus.textContent = `Operator API unavailable: ${error instanceof Error ? error.message : error}`; });
  void loadSaves().catch((error) => { saveStatus.textContent = `Save library unavailable: ${error instanceof Error ? error.message : error}`; }); void poll();
}
