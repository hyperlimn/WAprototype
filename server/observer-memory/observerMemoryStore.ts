import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { OBSERVER_MEMORY_SCHEMA_VERSION, type ObserverMemoryContinuity, type ObserverMemoryEntry, type ObserverMemoryKind, type ObserverMemoryStatus, type ObserverUniverseMemory, type UniverseReference } from "../../src/observer-memory/observerMemoryTypes.js";
import { ObserverMemoryValidationError, validateContent, validateKind, validateObserver, validateReferences, validateUniverse } from "./observerMemoryValidation.js";

const fresh = (observer: string, universe: string): ObserverUniverseMemory => { const now = new Date().toISOString(); return { schemaVersion: OBSERVER_MEMORY_SCHEMA_VERSION, observer, universe, createdAt: now, updatedAt: now, visits: { count: 0, firstVisitedAt: null, lastVisitedAt: null, lastVisitedTick: null }, entries: [] }; };
const epistemic = (kind: ObserverMemoryKind) => ({ authority: "observer-authored" as const, authoritativeUniverseTruth: false as const, classification: "observer-record" as const, kind, notice: "Observer-authored memory; references may identify evidence, but this record is not authoritative universe truth." });

export class ObserverMemoryNotFoundError extends Error {}

export class ObserverMemoryStore {
  private queue = Promise.resolve();
  constructor(readonly root: string) {}
  private file(observer: string, universe: string): string { return path.join(this.root, validateObserver(observer), "universes", `${encodeURIComponent(validateUniverse(universe))}.json`); }
  private async load(observer: string, universe: string): Promise<ObserverUniverseMemory> {
    observer = validateObserver(observer); universe = validateUniverse(universe);
    try {
      const parsed = JSON.parse(await readFile(this.file(observer, universe), "utf8")) as ObserverUniverseMemory;
      if (parsed.schemaVersion !== OBSERVER_MEMORY_SCHEMA_VERSION || parsed.observer !== observer || parsed.universe !== universe || !Array.isArray(parsed.entries)) return fresh(observer, universe);
      return parsed;
    } catch { return fresh(observer, universe); }
  }
  private async save(value: ObserverUniverseMemory): Promise<void> {
    const file = this.file(value.observer, value.universe); await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2), "utf8"); await rename(temporary, file);
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> { const result = this.queue.then(operation, operation); this.queue = result.then(() => undefined, () => undefined); return result; }
  async recall(observer: string, universe: string, options: { kind?: ObserverMemoryKind; status?: ObserverMemoryStatus; limit?: number } = {}): Promise<{ memory: Omit<ObserverUniverseMemory, "entries">; resultCount: number; entries: ObserverMemoryEntry[] }> {
    const value = await this.load(observer, universe); let entries = value.entries;
    if (options.kind) entries = entries.filter((entry) => entry.kind === options.kind);
    if (options.status) entries = entries.filter((entry) => entry.status === options.status);
    entries = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, options.limit ?? 100);
    const { entries: _entries, ...memory } = value; return { memory, resultCount: entries.length, entries };
  }
  async remember(input: { observer: string; universe: string; kind: ObserverMemoryKind; content: string; universeTick?: number; tags?: string[]; references?: UniverseReference[] }): Promise<ObserverMemoryEntry> {
    return this.mutate(async () => {
      const value = await this.load(input.observer, input.universe), kind = validateKind(input.kind), now = new Date().toISOString();
      if (input.universeTick !== undefined && (!Number.isInteger(input.universeTick) || input.universeTick < 0)) throw new ObserverMemoryValidationError("universeTick", input.universeTick, "must be a non-negative integer");
      const tags = input.tags ?? []; if (!Array.isArray(tags) || tags.length > 30 || tags.some((tag) => typeof tag !== "string" || tag.length > 80)) throw new ObserverMemoryValidationError("tags", input.tags, "must contain at most 30 strings of at most 80 characters");
      const entry: ObserverMemoryEntry = { id: randomUUID(), kind, content: validateContent(input.content), status: "open", createdAt: now, updatedAt: now,
        ...(input.universeTick === undefined ? {} : { universeTick: input.universeTick }), tags: [...new Set(tags)], references: validateReferences(input.references), epistemic: epistemic(kind), revisions: [] };
      value.entries.push(entry); value.updatedAt = now; await this.save(value); return entry;
    });
  }
  async update(observer: string, universe: string, id: string, input: { content?: string; status?: ObserverMemoryStatus; resolution?: string; references?: UniverseReference[]; note?: string }): Promise<ObserverMemoryEntry> {
    return this.mutate(async () => {
      const value = await this.load(observer, universe), entry = value.entries.find((item) => item.id === id); if (!entry) throw new ObserverMemoryNotFoundError(`observer memory ${id} was not found`);
      const now = new Date().toISOString(), statuses = ["open", "resolved", "superseded"];
      if (input.status !== undefined && !statuses.includes(input.status)) throw new ObserverMemoryValidationError("status", input.status, "must be open, resolved, or superseded");
      entry.revisions.push({ revisedAt: now, ...(input.content === undefined ? {} : { previousContent: entry.content }), ...(input.status === undefined ? {} : { previousStatus: entry.status }), ...(input.note ? { note: validateContent(input.note, "note") } : {}) });
      if (input.content !== undefined) entry.content = validateContent(input.content);
      if (input.references !== undefined) entry.references = validateReferences(input.references);
      if (input.status !== undefined) { entry.status = input.status; entry.resolvedAt = input.status === "resolved" ? now : undefined; }
      if (input.resolution !== undefined) entry.resolution = validateContent(input.resolution, "resolution");
      entry.updatedAt = now; value.updatedAt = now; await this.save(value); return entry;
    });
  }
  async visit(observer: string, universe: string, tick: number | null): Promise<void> { await this.mutate(async () => { const value = await this.load(observer, universe), now = new Date().toISOString(); value.visits.count++; value.visits.firstVisitedAt ??= now; value.visits.lastVisitedAt = now; value.visits.lastVisitedTick = tick; value.updatedAt = now; await this.save(value); }); }
  async continuity(observer: string, universe: string): Promise<ObserverMemoryContinuity | null> {
    const value = await this.load(observer, universe); if (value.entries.length === 0 && value.visits.count === 0) return null;
    const priority = new Set(["investigation", "question", "hypothesis", "prediction", "revisit"]), selected = [...value.entries].filter((entry) => entry.status === "open" && priority.has(entry.kind)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
    return { observer, universe, lastVisitedAt: value.visits.lastVisitedAt, lastVisitedTick: value.visits.lastVisitedTick, visitCount: value.visits.count,
      openInquiryCount: value.entries.filter((entry) => entry.status === "open" && priority.has(entry.kind)).length, whereYouLeftOff: selected, deeperRecall: "Use recall_observer_memory for the full or filtered notebook." };
  }
}
