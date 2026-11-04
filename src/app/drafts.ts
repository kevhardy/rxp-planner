import { getLines, type BodyLine, type GuideDocument, type Step } from "../guide/index.ts";
import { isCoordinateLine } from "../rules/points.ts";
import { replaceSection, sectionText } from "./sections.ts";
import type { DocOp, EditorStore, GuideEdit, Selection } from "./store.ts";

export interface DraftState {
  draft: string | null;
  error: string | null;
}

export const NO_DRAFT: DraftState = { draft: null, error: null };

interface UnscopedFieldKey {
  readonly unscoped: true;
}

export type DraftObject = Step | readonly BodyLine[] | BodyLine | UnscopedFieldKey;

export interface DraftOwner {
  object: DraftObject;
  guide: string;
}

type DraftEntry = { kind: "field"; state: DraftState } | { kind: "raw"; state: { draft: string; error: string | null }; base: string };

const drafts = new WeakMap<DraftObject, Map<string, DraftEntry>>();

const draftKey = (owner: DraftOwner, name: string) => `${owner.guide}\0${name}`;

const listeners = new Set<() => void>();

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readDraft(owner: DraftOwner, name: string): DraftState {
  return readEntry(owner, name)?.state ?? NO_DRAFT;
}

const readEntry = (owner: DraftOwner, name: string) => drafts.get(owner.object)?.get(draftKey(owner, name));

function writeEntry(owner: DraftOwner, name: string, entry: DraftEntry | undefined): void {
  let fields = drafts.get(owner.object);
  if (!fields) drafts.set(owner.object, (fields = new Map<string, DraftEntry>()));
  if (entry) fields.set(draftKey(owner, name), entry);
  else fields.delete(draftKey(owner, name));
  for (const listener of listeners) listener();
}

/** Sets a field's draft; `NO_DRAFT` drops it. Raw text drafts change through `changeRawDraft`. */
export function writeDraft(owner: DraftOwner, name: string, state: DraftState): void {
  writeEntry(owner, name, state.draft === null && state.error === null ? undefined : { kind: "field", state });
}

function link(from: DraftObject, to: DraftObject): void {
  if (from === to) return;
  let fields = drafts.get(from);
  if (!fields) drafts.set(from, (fields = new Map<string, DraftEntry>()));
  drafts.set(to, fields);
}

export interface DraftMove {
  undo(): void;
  redo(): void;
}

/**
 * Moves guide `from`'s drafts in `before` to guide `to`, at the same places
 * in `after`, a copy of `before` with the same lines.
 */
export function moveDrafts(before: GuideDocument, from: string, after: GuideDocument, to: string): DraftMove {
  const moved: { source: DraftOwner; name: string; entry: DraftEntry }[] = [];
  const move = (a: DraftObject, b: DraftObject | undefined) => {
    if (!b) return;
    for (const [key, entry] of [...(drafts.get(a) ?? [])]) {
      if (!key.startsWith(`${from}\0`)) continue;
      const draft = { source: { object: a, guide: from }, name: key.slice(from.length + 1), entry };
      writeEntry(draft.source, draft.name, undefined);
      writeEntry({ object: b, guide: to }, draft.name, entry);
      moved.push(draft);
    }
  };
  move(before.header, after.header);
  before.header.forEach((line, i) => move(line, after.header[i]));
  before.steps.forEach((step, i) => {
    move(step, after.steps[i]);
    step.body.forEach((line, j) => move(line, after.steps[i]?.body[j]));
  });
  return {
    undo() {
      for (const { source, name, entry } of moved) {
        if (!readEntry(source, name)) writeEntry(source, name, entry);
      }
    },
    redo() {
      for (const { source, name, entry } of moved) {
        if (readEntry(source, name) === entry) writeEntry(source, name, undefined);
      }
    },
  };
}

export function sectionOwner(doc: GuideDocument, step: number | null): DraftObject {
  return step === null ? doc.header : doc.steps[step]!;
}

export const RAW_DRAFT = "raw";

interface OpenGuide {
  id: string;
  doc: GuideDocument;
}

const rawOwner = (guide: OpenGuide, step: number | null): DraftOwner => ({ object: sectionOwner(guide.doc, step), guide: guide.id });

function readRaw(owner: DraftOwner) {
  const entry = readEntry(owner, RAW_DRAFT);
  return entry?.kind === "raw" ? entry : undefined;
}

export function hasRawDraft(guide: OpenGuide, step: number | null): boolean {
  return readRaw(rawOwner(guide, step)) !== undefined;
}

export const STALE_RAW_DRAFT =
  "This section changed after this Raw draft began. Copy the draft if needed, then Revert to load the current section.";

/**
 * Sets the raw text draft of section `step` of the open guide. The first
 * change keeps the section's text as the draft's base; an error stays until
 * the draft applies or is dropped.
 */
export function changeRawDraft(store: EditorStore, step: number | null, text: string): void {
  const open = store.getState().current;
  if (!open) return;
  const owner = rawOwner(open, step);
  const entry = readRaw(owner);
  writeEntry(owner, RAW_DRAFT, {
    kind: "raw",
    state: { draft: text, error: entry?.state.error ?? null },
    base: entry?.base ?? sectionText(open.doc, step),
  });
}

export type SectionEdit = GuideEdit | { ok: false; reason: "waits"; error: string };

function points(doc: GuideDocument, step: number | null): string {
  return getLines(doc, step)
    .flatMap((l) => (l.kind === "command" && isCoordinateLine(l) ? [`${l.name} ${l.args.join(",")}`] : []))
    .join("\n");
}

function lineAfterEdit(before: readonly BodyLine[], after: readonly BodyLine[], selected: number, replaced: number | undefined) {
  const moved = after.indexOf(before[selected]!);
  if (moved >= 0) return moved;
  return selected === replaced || before.length === after.length ? selected : null;
}

function previewEdit(doc: GuideDocument, step: number | null, op: DocOp, selected: Selection, replaced: number | undefined) {
  let next: GuideDocument;
  try {
    next = op(doc);
  } catch {
    return null;
  }
  const line = selected.step === step ? selected.line : null;
  return {
    movesPoints: points(next, step) !== points(doc, step),
    selection: line === null ? undefined : { step, line: lineAfterEdit(getLines(doc, step), getLines(next, step), line, replaced) },
  };
}

/**
 * Applies an edit of section `step` of guide `guide`, by default the open
 * guide. `line` names the line the edit changes in place. The section, and
 * that line, keep their drafts. When raw text splits a step, its first part
 * keeps them. An edit that removes a step would link nothing, but a section
 * edit cannot remove one. In the open guide, without `selection`, a selected
 * line of the section stays selected where the edit moves it.
 *
 * While the open guide's section has raw text that is not applied, an edit
 * that changes its points is refused with `waits`, from the map or a form
 * alike: the raw text, applied later, would put the old points back. Other
 * edits go through; the raw text keeps waiting.
 */
export function editSection(
  store: EditorStore,
  step: number | null,
  op: DocOp,
  selection?: Selection,
  line?: number,
  guide?: string,
): SectionEdit {
  const { current, selection: selected } = store.getState();
  const id = guide ?? current?.id;
  const open = current && current.id === id ? current : null;
  const preview = open ? previewEdit(open.doc, step, op, selected, line) : null;
  if (open && preview?.movesPoints && hasRawDraft(open, step)) {
    const where = step === null ? "The header" : `Step ${step + 1}`;
    return {
      ok: false,
      reason: "waits",
      error: `${where} has raw text that is not applied. Apply or discard it before changing its points.`,
    };
  }
  let before: GuideDocument | undefined;
  let after: GuideDocument | undefined;
  const edit: DocOp = (d) => (after = op((before = d)));
  const result = id === undefined ? store.edit(edit) : store.editGuide(id, edit, selection ?? preview?.selection);
  if (!result.ok) return result;
  if (before && after && after.steps.length >= before.steps.length) {
    link(sectionOwner(before, step), sectionOwner(after, step));
    const [from, to] = [getLines(before, step), getLines(after, step)];
    if (line !== undefined && from.length === to.length) link(from[line]!, to[line]!);
  }
  return { ok: true };
}

/**
 * Applies the raw text draft of section `step` of the open guide. A draft
 * that cannot apply comes back with the error. So does a draft whose
 * section changed since the draft began, since applying it would undo that
 * change. Without a draft, or with one equal to the section's text, nothing
 * applies and the result is `ok`.
 */
export function applyRawDraft(store: EditorStore, step: number | null): SectionEdit {
  const open = store.getState().current;
  if (!open) return { ok: true };
  const owner = rawOwner(open, step);
  const entry = readRaw(owner);
  writeEntry(owner, RAW_DRAFT, undefined);
  if (!entry) return { ok: true };
  const { draft } = entry.state;
  const text = sectionText(open.doc, step);
  if (draft === text) return { ok: true };
  const keep = (error: string) => writeEntry(owner, RAW_DRAFT, { ...entry, state: { draft, error } });
  if (entry.base !== text) {
    keep(STALE_RAW_DRAFT);
    return { ok: false, reason: "failed", error: STALE_RAW_DRAFT };
  }
  const result = editSection(store, step, (d) => replaceSection(d, step, draft), store.getState().selection);
  if (!result.ok) keep(result.reason === "opened" ? result.notice : result.error);
  return result;
}

export function discardRawDraft(store: EditorStore, step: number | null): void {
  const open = store.getState().current;
  if (open) writeEntry(rawOwner(open, step), RAW_DRAFT, undefined);
}
