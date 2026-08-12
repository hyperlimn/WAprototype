import type { Occurrence } from "../simulation/occurrenceLog";
import type { Universe } from "../simulation/universe";

const item = (record: Occurrence, newest: boolean): string =>
  `<li${newest ? ' class="newest"' : ""}><span>tick ${record.tick}</span> — ${record.description}</li>`;

export function updateOccurrences(element: HTMLElement, universe: Universe): void {
  const records = universe.occurrences.records;
  element.innerHTML = records.length
    ? [...records].reverse().map((record, index) => item(record, index === 0)).join("")
    : `<li class="empty">No occurrences recorded.</li>`;
}
