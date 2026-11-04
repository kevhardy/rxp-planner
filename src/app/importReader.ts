import type { GuideRecord } from "../guide/index.ts";
import { importGuides, type ImportedGuide } from "../io/index.ts";
import { builtinIndex, guideKey, guideMeta } from "../rules/registration.ts";

export type ImportSource = File | { text: string };

export interface FoundGuide {
  key: `${number}:${number}`;
  guide: ImportedGuide;
  fileName?: string;
  probe: GuideRecord;
  matchesBuiltin: boolean;
}

export interface ImportReading {
  sources: readonly ImportSource[];
  done: number;
  found: readonly FoundGuide[];
  errors: readonly { source: number; label: string; message: string }[];
}

export const sourceLabel = (source: ImportSource): string => (source instanceof File ? source.name : "Pasted text");

export class ImportReader {
  readonly #kept: ReadonlyMap<string, GuideRecord>;
  #state: ImportReading = { sources: [], done: 0, found: [], errors: [] };
  #closed = false;
  readonly #listeners = new Set<() => void>();

  constructor(builtins: ReadonlyMap<string, GuideRecord>) {
    this.#kept = builtinIndex(builtins.values()).kept;
  }

  getState = (): ImportReading => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  add(sources: readonly ImportSource[]): void {
    if (this.#closed || sources.length === 0) return;
    const idle = this.#state.done === this.#state.sources.length;
    this.#publish({ ...this.#state, sources: [...this.#state.sources, ...sources] });
    if (idle) this.#readNext();
  }

  close(): void {
    this.#closed = true;
  }

  #readNext(): void {
    const { sources, done } = this.#state;
    const source = sources[done];
    if (!source) return;
    const fileName = source instanceof File ? source.name : undefined;
    const read = async () => {
      const input = source instanceof File ? new Uint8Array(await source.arrayBuffer()) : source.text;
      const result = await importGuides(input, fileName === undefined ? {} : { fileName });
      return result.guides.map((guide, g): FoundGuide => {
        const probe: GuideRecord = { id: "", text: guide.text, order: 0 };
        if (guide.registerArgs) probe.registerArgs = guide.registerArgs;
        const entry: FoundGuide = { key: `${done}:${g}`, guide, probe, matchesBuiltin: this.#kept.has(guideKey(guideMeta(probe))) };
        if (fileName !== undefined) entry.fileName = fileName;
        return entry;
      });
    };
    read().then(
      (found) => this.#finish(found, found.length === 0 ? "No guides found." : undefined),
      (error: unknown) => this.#finish([], error instanceof Error ? error.message : String(error)),
    );
  }

  #finish(found: readonly FoundGuide[], error: string | undefined): void {
    if (this.#closed) return;
    const { sources, done } = this.#state;
    const errors =
      error === undefined
        ? this.#state.errors
        : [...this.#state.errors, { source: done, label: sourceLabel(sources[done]!), message: error }];
    this.#publish({ sources, done: done + 1, found: [...this.#state.found, ...found], errors });
    this.#readNext();
  }

  #publish(state: ImportReading): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
