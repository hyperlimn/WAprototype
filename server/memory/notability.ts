import type { OccurrenceRecord } from "../../src/query/queryTypes.js";

export function classifyNotability(event: OccurrenceRecord, firstTypeOccurrence: boolean): string[] {
  const reasons: string[] = [];
  if (firstTypeOccurrence) reasons.push("first-occurrence-of-type");
  if (event.type === "reproduction") reasons.push("reproduction");
  if (event.type === "rupture") reasons.push("rupture");
  if (event.type === "dimensional-transition") reasons.push("dimensional-transition");
  return reasons;
}
