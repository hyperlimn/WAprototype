import type { Universe } from "../simulation/universe";
import { buildWorldSnapshot } from "../interface/worldSnapshot";

export { buildWorldSnapshot as buildSimulationExport } from "../interface/worldSnapshot";

export async function copySimulationExport(universe: Universe): Promise<void> {
  const text = JSON.stringify(buildWorldSnapshot(universe), null, 2);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Restricted contexts may expose the API but reject it; use the legacy selection fallback.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy is unavailable");
}
