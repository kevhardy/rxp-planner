import {
  checkTagValue,
  newGuideText,
  parseGuide,
  serializeGuide,
  setTag,
  type GuideDocument,
  type GuideRecord,
  type RegisterArgs,
} from "../guide/index.ts";
import {
  builtinIndex,
  copyGroups,
  copyOf,
  guideGroups,
  guideKey,
  guideMeta,
  guidesByKey,
  guideTargets,
  resolvedGroup,
  type BuiltinIndex,
  type NextTarget,
} from "../rules/registration.ts";
import type { Builtins } from "../io/index.ts";
import { loadedKey, SPEEDRUN_GROUP, type Profile } from "../rules/index.ts";
import type { AutosaveSource, StoredLibrary, StoredSession } from "../storage/index.ts";
import { moveDrafts, type DraftMove } from "./drafts.ts";
import { mapNext, orderedGuides } from "./library.ts";

export interface Selection {
  step: number | null;
  line: number | null;
}

export interface CurrentGuide {
  id: string;
  record: GuideRecord;
  doc: GuideDocument;
  name: string;
  group: string;
  builtin: boolean;
  /**
   * The ID that the editor keys its fields by: the built-in's ID for a
   * copy made or opened from a built-in this session, else `id`. The field
   * being edited then stays in place when an edit of a built-in opens its
   * copy, and after later edits of the copy's name or group.
   */
  viewId: string;
  copyOf?: string;
}

export interface EditorState {
  guides: ReadonlyMap<string, GuideRecord>;
  builtins: ReadonlyMap<string, GuideRecord>;
  builtinVersion: string | null;
  current: CurrentGuide | null;
  selection: Selection;
  /** Why an edit opened another guide instead of changing this one, or why the guide open last time did not open. */
  notice: string | null;
  canUndo: boolean;
  canRedo: boolean;
  jumps: number;
}

export type EditResult = { ok: true } | { ok: false; reason: "failed"; error: string };

export type GuideEdit = EditResult | { ok: false; reason: "opened"; notice: string };

export type DocOp = (doc: GuideDocument) => GuideDocument;

/** A guide to add to the library; `replaceId` replaces that guide's text instead. */
export interface NewGuide {
  text: string;
  registerArgs?: RegisterArgs;
  fileName?: string;
  replaceId?: string;
}

interface Snapshot {
  guides: ReadonlyMap<string, GuideRecord>;
  currentId: string | null;
  selection: Selection;
}

interface HistoryEntry {
  before: Snapshot;
  after: Snapshot;
  drafts?: DraftMove;
}

const HISTORY_LIMIT = 300;

const A = "RestedXP Forever Guide (A)";
const H = "RestedXP Forever Guide (H)";
const DA = "RestedXP Forever Dungeon Guide (A)";
const DH = "RestedXP Forever Dungeon Guide (H)";
/**
 * `#next` targets of built-ins that RXP renamed or moved to its dungeon
 * group, by `guideKey` of the old target. Saved guides can still name the
 * old target.
 */
const MOVED_TARGETS = new Map(
  (
    [
      [A, "1-6 Coldridge Valley", A, "1-5 Coldridge Valley"],
      [A, "6-11 Dun Morogh", A, "5-11 Dun Morogh"],
      [A, "6-11 Dun Morogh (Hunter)", A, "5-11 Dun Morogh"],
      [H, "10-12 Tirisfal", H, "10-12 Tirisfal (Orc/Troll)"],
      [H, "13-20 The Barrens", DH, "13-20 The Barrens"],
      [H, "20-24 Stonetalon/Barrens", DH, "20-24 Stonetalon/Barrens"],
      [A, "1-14 Zephras Isle", A, "1-9 Zephras Isle"],
      [DA, "1-14 Zephras Isle", DA, "1-9 Zephras Isle"],
      [DH, "12-17 The Barrens", DH, "12-16 The Barrens"],
    ] as const
  ).map(([group, name, newGroup, newName]) => [guideKey({ group, name }), { group: newGroup, name: newName }] as const),
);

/** Built-in IDs that RXP moved to its dungeon guides, to their new IDs. Saved state can still hold an old ID. */
const MOVED_BUILTINS = new Map([["rxp:RestedXP-Skyborne.lua#4", "rxp:dungeon/RestedXP-Skyborne.lua#5"]]);

export class EditorStore implements AutosaveSource {
  #state: EditorState;
  readonly #builtins: ReadonlyMap<string, GuideRecord>;
  readonly #index: BuiltinIndex;
  #profile: ((guide: GuideRecord) => Profile) | null = null;
  readonly #viewIds = new Map<string, string>();
  readonly #docs = new WeakMap<GuideRecord, GuideDocument>();
  #selections = new Map<string, Selection>();
  readonly #past: HistoryEntry[] = [];
  #future: HistoryEntry[] = [];
  readonly #listeners = new Set<() => void>();
  #jumps = 0;
  #nextOrder: number;

  /** `builtins` is null when they failed to load; the editor works without them. */
  constructor(library: StoredLibrary = { guides: [] }, builtins: Builtins | null = null) {
    const guides = new Map(library.guides.map((g) => [g.id, g]));
    this.#builtins = new Map(builtins?.guides.map((g) => [g.id, g]));
    this.#index = builtinIndex(this.#builtins.values());
    const savedKeys = new Set(library.guides.flatMap(guideTargets).map((t) => loadedKey(t.group, t.name)));
    for (const guide of guides.values()) {
      const group = guideMeta(guide).group;
      const doc = this.#doc(guide);
      const next = mapNext(doc, group, group, (target) => {
        const key = guideKey(target);
        const replacement = MOVED_TARGETS.get(key);
        if (!replacement || savedKeys.has(loadedKey(target.group, target.name)) || this.#index.kept.has(key)) return;
        return this.#index.kept.has(guideKey(replacement)) ? replacement : undefined;
      });
      if (next !== doc) guides.set(guide.id, this.#withDoc(guide, next));
    }
    this.#nextOrder = Math.max(0, ...library.guides.map((g) => g.order + 1));
    this.#state = {
      guides,
      builtins: this.#builtins,
      builtinVersion: builtins?.version ?? null,
      current: null,
      selection: { step: null, line: null },
      notice: null,
      canUndo: false,
      canRedo: false,
      jumps: 0,
    };
    const saved = library.session?.guideId;
    const found = saved ? this.#saved(guides, saved) : null;
    if (found) this.#selections.set(found, library.session!);
    const notice = saved && !found ? `The guide open last time (${saved}) is no longer in the library.` : null;
    this.#publish(guides, found ?? orderedGuides(guides.values())[0]?.id ?? null, notice);
  }

  getState = (): EditorState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  snapshot(): { guides: ReadonlyMap<string, GuideRecord>; session: StoredSession } {
    const { guides, current, selection } = this.#state;
    return { guides, session: { guideId: current?.id ?? null, ...selection } };
  }

  /** The ID that saved state holding `id` now opens, or null when the guide is gone. */
  savedGuide(id: string): string | null {
    return this.#saved(this.#state.guides, id);
  }

  /**
   * Sets the preview character, which can differ by guide, as its start
   * level can. A built-in's first copy goes in the custom group of its group
   * for this character; without one, of its first `#group`.
   */
  setProfile(profile: (guide: GuideRecord) => Profile): void {
    this.#profile = profile;
  }

  open(id: string | null): void {
    if (id !== null && !this.#find(this.#state.guides, id)) return;
    this.#publish(this.#state.guides, id);
  }

  select(selection: Selection): void {
    const current = this.#state.current;
    if (!current) return;
    const next = clampSelection(current.doc, selection);
    if (next.step === this.#state.selection.step && next.line === this.#state.selection.line) return;
    this.#selections.set(current.id, next);
    if (next.step !== this.#state.selection.step) this.#jumps++;
    this.#publish(this.#state.guides, current.id);
  }

  edit(op: DocOp, selection?: Selection): GuideEdit {
    const current = this.#state.current;
    if (!current) return failure("No guide is open.");
    return this.editGuide(current.id, op, selection);
  }

  editGuide(id: string, op: DocOp, selection?: Selection): GuideEdit {
    const record = this.#state.guides.get(id);
    if (!record) {
      const builtin = this.#builtins.get(id);
      return builtin ? this.#editBuiltin(builtin, op, selection) : failure("No such guide.");
    }
    return this.#change(() => {
      const guides = new Map(this.#state.guides);
      const doc = this.#doc(record);
      const next = op(doc);
      if (next !== doc) guides.set(id, this.#withDoc(record, next));
      if (selection && id === this.#state.current?.id) this.#selections.set(id, clampSelection(next, selection));
      return guides;
    });
  }

  undo(): void {
    this.#travel(this.#past, this.#future, "before");
  }

  redo(): void {
    this.#travel(this.#future, this.#past, "after");
  }

  /** Adds or replaces guides and returns their IDs. Opens the first if none is open. */
  addGuides(items: NewGuide[]): string[] {
    let ids: string[] = [];
    this.#change(
      () => {
        const guides = new Map(this.#state.guides);
        ids = this.#add(guides, items);
        return guides;
      },
      () => (this.#state.current ? undefined : ids[0]),
    );
    return ids;
  }

  /** Creates a guide and opens it. Fails for names RXP would misread or not load. */
  createGuide(group: string, name: string): EditResult {
    let id: string | undefined;
    return this.#change(
      () => {
        this.#checkName(group, name, true);
        const guides = new Map(this.#state.guides);
        [id] = this.#add(guides, [{ text: newGuideText(group, name) }]);
        this.#selections.set(id!, { step: 0, line: null });
        return guides;
      },
      () => id,
    );
  }

  duplicate(ids: string[], group: string): EditResult {
    let first: string | undefined;
    return this.#change(
      () => {
        const guides = new Map(this.#state.guides);
        // Built-ins that share a group and name are copied once, as the one that RXP keeps.
        const records = [...new Set(ids.map((id) => this.#find(guides, id)!).map((r) => this.#kept(r) ?? r))];
        const kept = records.map((r) =>
          this.#builtins.get(r.id) === r && copyGroups(r, this.#profileOf(r)).includes(group) ? this.#copyOf(guides, r) : undefined,
        );
        const copies = this.#copy(
          guides,
          records.filter((_, i) => !kept[i]),
          group,
        );
        first = kept[0]?.id ?? copies[0]?.id;
        return guides;
      },
      () => first,
    );
  }

  renameGuide(id: string, name: string): EditResult {
    const record = this.#state.guides.get(id);
    if (!record) return failure("No such guide.");
    const old = guideMeta(record);
    return this.#retarget(
      (t) => (t.group === old.group && t.name === old.name ? { group: t.group, name } : undefined),
      (guide, doc) => {
        if (guide !== record) return doc;
        this.#checkName(old.group, name, false);
        return setTag(doc, null, "name", name);
      },
    );
  }

  /**
   * Renames a group in every member's `RegisterGuide` group argument, else its
   * `#group` line, and points `#next` items across the library at the new name.
   */
  renameGroup(from: string, to: string): EditResult {
    const isMember = (g: GuideRecord) => guideMeta(g).group === from;
    return this.#retarget(
      (t) => (t.group === from ? { group: to, name: t.name } : undefined),
      (guide, doc) => {
        if (!isMember(guide)) return doc;
        this.#checkName(to, guideMeta(guide).name, true);
        return guide.registerArgs ? doc : setTag(doc, null, "group", to);
      },
      (guide) => (isMember(guide) ? to : undefined),
      (guide) => {
        if (!isMember(guide) || !guide.registerArgs) return guide;
        checkTagValue("group", to);
        return { ...guide, registerArgs: { ...guide.registerArgs, group: to } };
      },
    );
  }

  deleteGuides(ids: string[]): void {
    const order = orderedGuides(this.#state.guides.values());
    let currentId = this.#state.current?.id ?? null;
    this.#change(
      () => {
        const guides = new Map(this.#state.guides);
        for (const id of ids) guides.delete(id);
        if (currentId && !this.#find(guides, currentId)) {
          const at = order.findIndex((g) => g.id === currentId);
          currentId = [...order.slice(at), ...order.slice(0, at).reverse()].find((g) => guides.has(g.id))?.id ?? null;
        }
        return guides;
      },
      () => currentId,
    );
  }

  #saved(guides: ReadonlyMap<string, GuideRecord>, id: string): string | null {
    if (this.#find(guides, id)) return id;
    const moved = MOVED_BUILTINS.get(id);
    return moved && this.#find(guides, moved) ? moved : null;
  }

  #find(guides: ReadonlyMap<string, GuideRecord>, id: string): GuideRecord | undefined {
    return guides.get(id) ?? this.#builtins.get(id);
  }

  /** Throws when RXP would not load a guide in `group` named `name` as the user's own. */
  #checkName(group: string, name: string, newGroup: boolean): void {
    if (newGroup && SPEEDRUN_GROUP.test(group)) {
      throw new Error(
        "RXP treats groups that start with “RestedXP Alliance” or “RestedXP Horde” as its speedrun guides. Choose another group name.",
      );
    }
    if (this.#index.kept.has(guideKey({ group, name }))) {
      throw new Error(`A built-in RestedXP guide is named “${name}” in “${group}”. Choose another name.`);
    }
  }

  /** The built-in that RXP keeps under `record`'s group and name, if `record` is a built-in. */
  #kept(record: GuideRecord): GuideRecord | undefined {
    if (this.#builtins.get(record.id) !== record) return undefined;
    return this.#index.kept.get(guideKey(guideMeta(record)));
  }

  #profileOf(guide: GuideRecord): Profile | null {
    return this.#profile?.(guide) ?? null;
  }

  #builtinOf(guide: GuideRecord): GuideRecord | undefined {
    return this.#index.copied.get(guideKey(guideMeta(guide)));
  }

  #copyOf(guides: ReadonlyMap<string, GuideRecord>, builtin: GuideRecord): GuideRecord | undefined {
    return copyOf(guidesByKey(guides.values()), builtin, this.#profileOf(builtin));
  }

  #editBuiltin(builtin: GuideRecord, op: DocOp, selection?: Selection): GuideEdit {
    const shown = selection ?? this.#selections.get(builtin.id);
    const kept = this.#kept(builtin)!;
    const existing = this.#copyOf(this.#state.guides, builtin);
    if (existing || kept !== builtin) {
      const target = existing ?? kept;
      if (shown) this.#selections.set(target.id, clampSelection(this.#doc(target), shown));
      if (existing && !this.#viewIds.has(existing.id)) this.#viewIds.set(existing.id, kept.id);
      const notice = existing
        ? `Opened your copy in “${guideMeta(existing).group}”. Make the change there.`
        : "RXP loads a later built-in guide with this group and name. Opened that guide; make the change there.";
      this.#publish(this.#state.guides, target.id, notice);
      return { ok: false, reason: "opened", notice };
    }
    let id: string | undefined;
    let moved: DraftMove | undefined;
    const result = this.#change(
      () => {
        const guides = new Map(this.#state.guides);
        let before: GuideDocument | undefined;
        const [copy] = this.#copy(guides, [builtin], copyGroups(builtin, this.#profileOf(builtin))[0]!, (d) => op((before = d)));
        if (!copy) return guides;
        id = copy.id;
        if (shown) this.#selections.set(copy.id, clampSelection(this.#doc(copy), shown));
        this.#viewIds.set(copy.id, builtin.id);
        moved = moveDrafts(this.#doc(builtin), builtin.id, before!, copy.id);
        return guides;
      },
      () => id,
    );
    if (moved) this.#past.at(-1)!.drafts = moved;
    return result;
  }

  #copy(guides: Map<string, GuideRecord>, records: GuideRecord[], group: string, edit?: DocOp): GuideRecord[] {
    checkTagValue("group", group);
    const keysOf = (record: GuideRecord) => {
      const { name } = guideMeta(record);
      if (this.#builtins.get(record.id) !== record) return [guideKey(guideMeta(record))];
      return guideGroups(record).map((g) => guideKey({ group: g, name }));
    };
    const copied = new Set(records.flatMap(keysOf));
    const copyTargets = new Map<string, NextTarget>();
    for (const guide of guides.values()) {
      const builtin = this.#builtinOf(guide);
      if (builtin) for (const key of keysOf(builtin)) copyTargets.set(key, guideMeta(guide));
    }
    const moved = new Map<string, NextTarget>();
    for (const record of records) {
      const meta = guideMeta(record);
      this.#checkName(group, meta.name, true);
      if (this.#builtins.get(record.id) === record && copyGroups(record, this.#profileOf(record)).includes(group)) {
        for (const key of keysOf(record)) {
          copyTargets.set(key, { group, name: meta.name });
          moved.set(key, { group, name: meta.name });
        }
      }
    }

    const items = records.map((record, i) => {
      const builtin = this.#builtins.get(record.id) === record;
      // Unqualified `#next` items name guides in the group RXP files this one under.
      const from = builtin ? resolvedGroup(record, this.#profileOf(record)) : guideMeta(record).group;
      const before = this.#doc(record);
      let doc = mapNext(before, from, group, (t) => {
        if (copied.has(guideKey(t))) return { group, name: t.name };
        return builtin ? (copyTargets.get(guideKey(t)) ?? t) : undefined;
      });
      if (edit && i === 0) {
        const edited = edit(doc);
        if (edited === doc) return undefined;
        doc = edited;
      }
      // A `RegisterGuide` group argument wins over every `#group` line, so
      // only it changes. Copies of built-ins always get one: some built-ins
      // pick their `#group` line by faction.
      if (!record.registerArgs && !builtin) doc = setTag(doc, null, "group", group);
      const registerArgs = record.registerArgs || builtin ? { ...record.registerArgs, group } : undefined;
      const item: NewGuide = { text: doc === before ? record.text : serializeGuide(doc) };
      if (registerArgs) item.registerArgs = registerArgs;
      return { doc, item };
    });
    if (items.some((x) => !x)) return [];

    for (const guide of [...guides.values()]) {
      if (!this.#builtinOf(guide)) continue;
      const own = guideMeta(guide).group;
      const doc = this.#doc(guide);
      const next = mapNext(doc, own, own, (t) => moved.get(guideKey(t)));
      if (next !== doc) guides.set(guide.id, this.#withDoc(guide, next));
    }

    return this.#add(
      guides,
      items.map((x) => x!.item),
    ).map((id, i) => {
      const record = guides.get(id)!;
      this.#docs.set(record, items[i]!.doc);
      return record;
    });
  }

  #doc(record: GuideRecord): GuideDocument {
    let doc = this.#docs.get(record);
    if (!doc) {
      doc = parseGuide(record.text);
      this.#docs.set(record, doc);
    }
    return doc;
  }

  #withDoc(record: GuideRecord, doc: GuideDocument): GuideRecord {
    const next = { ...record, text: serializeGuide(doc) };
    this.#docs.set(next, doc);
    return next;
  }

  #add(guides: Map<string, GuideRecord>, items: NewGuide[]): string[] {
    return items.map((item) => {
      const old = item.replaceId ? guides.get(item.replaceId) : undefined;
      const record: GuideRecord = { id: old?.id ?? crypto.randomUUID(), text: item.text, order: old?.order ?? this.#nextOrder++ };
      if (item.registerArgs) record.registerArgs = item.registerArgs;
      if (item.fileName) record.fileName = item.fileName;
      this.#selections.delete(record.id);
      guides.set(record.id, record);
      return record.id;
    });
  }

  #retarget(
    map: (target: NextTarget) => NextTarget | undefined,
    edit: (guide: GuideRecord, doc: GuideDocument) => GuideDocument,
    groupAfter: (guide: GuideRecord) => string | undefined = () => undefined,
    record: (guide: GuideRecord) => GuideRecord = (g) => g,
  ): EditResult {
    return this.#change(() => {
      const guides = new Map(this.#state.guides);
      for (const guide of this.#state.guides.values()) {
        const group = guideMeta(guide).group;
        const doc = this.#doc(guide);
        const next = edit(guide, mapNext(doc, group, groupAfter(guide) ?? group, map));
        const updated = record(guide);
        if (next !== doc) guides.set(guide.id, this.#withDoc(updated, next));
        else if (updated !== guide) guides.set(guide.id, updated);
      }
      return guides;
    });
  }

  #change(build: () => Map<string, GuideRecord>, open?: string | (() => string | null | undefined)): EditResult {
    const before = this.#view();
    const selections = new Map(this.#selections);
    let guides: Map<string, GuideRecord>;
    try {
      guides = build();
    } catch (error) {
      this.#selections = selections;
      return failure(error);
    }
    const target = typeof open === "function" ? open() : open;
    const currentId = target ?? (before.currentId && this.#find(guides, before.currentId) ? before.currentId : null);
    const changed = guides.size !== before.guides.size || [...guides].some(([id, g]) => before.guides.get(id) !== g);
    if (changed) {
      this.#past.push({ before, after: before });
      if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
      this.#future = [];
    }
    this.#publish(changed ? guides : before.guides, currentId);
    if (changed) this.#past.at(-1)!.after = this.#view();
    return { ok: true };
  }

  #view(): Snapshot {
    return { guides: this.#state.guides, currentId: this.#state.current?.id ?? null, selection: this.#state.selection };
  }

  #travel(from: HistoryEntry[], to: HistoryEntry[], side: "before" | "after"): void {
    const entry = from.pop();
    if (!entry) return;
    to.push(entry);
    if (side === "before") entry.drafts?.undo();
    else entry.drafts?.redo();
    const { guides, currentId, selection } = entry[side];
    if (currentId) this.#selections.set(currentId, selection);
    this.#jumps++;
    this.#publish(guides, currentId);
  }

  #publish(guides: ReadonlyMap<string, GuideRecord>, currentId: string | null, notice: string | null = null): void {
    let current: CurrentGuide | null = null;
    let selection: Selection = { step: null, line: null };
    const record = currentId ? this.#find(guides, currentId) : undefined;
    if (record) {
      const doc = this.#doc(record);
      const meta = guideMeta(record);
      const builtin = !guides.has(record.id);
      const viewId = this.#viewIds.get(record.id) ?? record.id;
      const copyOf = builtin ? undefined : this.#builtinOf(record)?.id;
      current = { id: record.id, record, doc, name: meta.name, group: meta.group, builtin, viewId, ...(copyOf && { copyOf }) };
      selection = clampSelection(doc, this.#selections.get(record.id) ?? { step: doc.steps.length > 0 ? 0 : null, line: null });
      this.#selections.set(record.id, selection);
    }
    this.#state = {
      ...this.#state,
      guides,
      current,
      selection,
      notice,
      canUndo: this.#past.length > 0,
      canRedo: this.#future.length > 0,
      jumps: this.#jumps,
    };
    for (const listener of this.#listeners) listener();
  }
}

function clampSelection(doc: GuideDocument, selection: Selection): Selection {
  let step = selection.step;
  if (step !== null) step = doc.steps.length === 0 ? null : Math.max(0, Math.min(step, doc.steps.length - 1));
  const count = step === null ? doc.header.length : doc.steps[step]!.body.length;
  const line = selection.line === null || count === 0 ? null : Math.max(0, Math.min(selection.line, count - 1));
  return { step, line };
}

function failure(error: unknown): EditResult {
  return { ok: false, reason: "failed", error: error instanceof Error ? error.message : String(error) };
}
