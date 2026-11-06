import { expect, it } from "vitest";
import {
  deleteLine,
  deleteStep,
  insertLine,
  insertStep,
  moveLine,
  moveStep,
  parseLine,
  setCommandArgs,
  setCondition,
  setTag,
  setText,
  updateLine,
  updateStepLine,
  type BodyLine,
  type CommandLine,
} from "../guide/index.ts";
import {
  applyRawDraft,
  changeRawDraft,
  discardRawDraft,
  editSection,
  hasRawDraft,
  NO_DRAFT,
  readDraft,
  STALE_RAW_DRAFT,
  writeDraft,
  type DraftOwner,
  type SectionEdit,
} from "./drafts.ts";
import { sectionText } from "./sections.ts";
import { EditorStore } from "./store.ts";

const SEQUENCES = 40;
const OPERATIONS = 120;
const STEP_FIELDS = ["Step condition", "#label", "raw"];
const LINE_FIELDS = ["arg 0", ">> text"];
const HEADER_FIELDS = ["raw"];
const HEADER_LINE_FIELDS = ["Line text"];
const TEXT =
  "#group T\n#name Seq\n#next Other\n#version 1\nstep\n.accept 1 >> A\n.accept 2 >> B\nstep\n.accept 3 >> C\nstep\n.accept 4 >> D\n";
const BUILTIN = "rxp:seq.lua#1";
const VERSION_LINE = 3;
const APPLIED = { ok: true };

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

interface ModelStep {
  id: number;
  lines: number[];
}

interface ModelState {
  stored: { id: string; layout: ModelStep[] } | null;
  builtinOpen: boolean;
}

function runSequences(withBuiltin: boolean, seed: number) {
  const next = mulberry32(seed);
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  let counter = 0;
  let checks = 0;

  for (let seq = 0; seq < SEQUENCES; seq++) {
    let ids = 0;
    const header = { id: ids++, lines: [ids++, ids++, ids++, ids++] };
    const initial: ModelStep[] = [
      { id: ids++, lines: [ids++, ids++] },
      { id: ids++, lines: [ids++] },
      { id: ids++, lines: [ids++] },
    ];
    let store: EditorStore;
    let state: ModelState;
    if (withBuiltin) {
      store = new EditorStore(
        { guides: [], session: { guideId: BUILTIN, step: 0, line: null } },
        { version: "v1", guides: [{ id: BUILTIN, text: TEXT, order: 0 }] },
      );
      state = { stored: null, builtinOpen: true };
    } else {
      store = new EditorStore();
      const [id] = store.addGuides([{ text: TEXT }]);
      state = { stored: { id: id!, layout: initial }, builtinOpen: false };
    }
    const doc = () => store.getState().current!.doc;
    const guide = () => store.getState().current!.id;
    const layout = () => (state.builtinOpen ? initial : state.stored!.layout);
    const stepOwner = (i: number): DraftOwner => ({ object: doc().steps[i]!, guide: guide() });
    const lineOwner = (i: number, j: number): DraftOwner => ({ object: doc().steps[i]!.body[j]!, guide: guide() });
    const headerOwner = (j: number | null): DraftOwner => ({ object: j === null ? doc().header : doc().header[j]!, guide: guide() });

    let past: { before: ModelState; after: ModelState; moved: [string, Draft][] }[] = [];
    let future: typeof past = [];
    type Draft = { draft: string };
    const expected = new Map<string, Draft>();
    const at = (g: string, id: number, name: string) => `${g}\0${id}\0${name}`;
    const withLines = (i: number, lines: number[]) => layout().map((s, k) => (k === i ? { ...s, lines } : s));
    const newLine = () => parseLine(`.accept ${++counter} >> N${counter}`) as BodyLine;

    const settle = (result: SectionEdit, nextLayout: ModelStep[]): boolean => {
      if (state.builtinOpen && state.stored) {
        expect(result).toMatchObject({ ok: false, reason: "opened", notice: expect.stringMatching(/^Opened your copy/) });
        state = { ...state, builtinOpen: false };
        return false;
      }
      if (!result.ok) {
        expect(result.reason).toBe("failed");
        return false;
      }
      const id = guide();
      const moved: [string, Draft][] = [];
      if (state.builtinOpen) {
        for (const [key, draft] of [...expected]) {
          if (!key.startsWith(`${BUILTIN}\0`)) continue;
          expected.delete(key);
          expected.set(`${id}${key.slice(BUILTIN.length)}`, draft);
          moved.push([key, draft]);
        }
      }
      const before = state;
      state = { stored: { id, layout: nextLayout }, builtinOpen: false };
      past.push({ before, after: state, moved });
      future = [];
      return true;
    };

    const field = () => {
      if (next() < 0.15) {
        const j = next() < 0.3 ? null : int(header.lines.length);
        const id = j === null ? header.id : header.lines[j]!;
        return { i: null, j, owner: headerOwner(j), id, name: pick(j === null ? HEADER_FIELDS : HEADER_LINE_FIELDS) };
      }
      const i = int(layout().length);
      const lines = layout()[i]!.lines;
      if (lines.length === 0 || next() < 0.4) {
        return { i, j: null, owner: stepOwner(i), id: layout()[i]!.id, name: pick(STEP_FIELDS) };
      }
      const j = int(lines.length);
      return { i, j, owner: lineOwner(i, j), id: lines[j]!, name: pick(LINE_FIELDS) };
    };

    const allFields = () => [
      ...HEADER_FIELDS.map((name) => ({ owner: headerOwner(null), id: header.id, name })),
      ...header.lines.flatMap((id, j) => HEADER_LINE_FIELDS.map((name) => ({ owner: headerOwner(j), id, name }))),
      ...layout().flatMap((s, i) => [
        ...STEP_FIELDS.map((name) => ({ owner: stepOwner(i), id: s.id, name })),
        ...s.lines.flatMap((id, j) => LINE_FIELDS.map((name) => ({ owner: lineOwner(i, j), id, name }))),
      ]),
    ];

    const checkOpen = (where: string) => {
      expect(
        doc().steps.map((s) => s.body.length),
        where,
      ).toEqual(layout().map((s) => s.lines.length));
      for (const f of allFields()) {
        expect(readDraft(f.owner, f.name).draft, `${where}; ${f.name} on ${f.id}`).toBe(
          expected.get(at(guide(), f.id, f.name))?.draft ?? null,
        );
      }
    };

    for (let op = 0; op < OPERATIONS; op++) {
      const roll = int(10);
      let label: string;
      if (roll <= 1) {
        const f = field();
        const draft = `d${++counter}`;
        if (f.name === "raw") changeRawDraft(store, f.i, draft);
        else writeDraft(f.owner, f.name, { draft, error: next() < 0.3 ? "rejected" : null });
        expected.set(at(guide(), f.id, f.name), { draft });
        label = `draft ${f.name} on ${f.id}`;
      } else if (roll <= 3) {
        let f = field();
        if (f.i === null)
          f = { i: null, j: VERSION_LINE, owner: headerOwner(VERSION_LINE), id: header.lines[VERSION_LINE]!, name: "Line text" };
        const { i, j } = f;
        const g = guide();
        writeDraft(f.owner, f.name, NO_DRAFT);
        expected.delete(at(g, f.id, f.name));
        let result: SectionEdit;
        let value: string;
        if (i === null) {
          value = `#version ${++counter}`;
          result = editSection(
            store,
            null,
            (d) => updateLine(d, { step: null, index: VERSION_LINE }, () => parseLine(value) as BodyLine),
            undefined,
            VERSION_LINE,
          );
        } else if (j === null) {
          value = doc().steps[i]!.line.condition?.text === "Alliance" ? "Horde" : "Alliance";
          result = editSection(store, i, (d) => updateStepLine(d, i, (l) => setCondition(l, value)));
          f.name = "Step condition";
        } else if (f.name === "arg 0") {
          value = String(++counter);
          result = editSection(
            store,
            i,
            (d) => updateLine(d, { step: i, index: j }, (l) => setCommandArgs(l as CommandLine, [value])),
            undefined,
            j,
          );
        } else {
          // RXP reads `--` as the start of a comment, so a `bad --` text fails.
          value = counter % 4 === 0 ? `bad -- ${++counter}` : `t${++counter}`;
          result = editSection(
            store,
            i,
            (d) => updateLine(d, { step: i, index: j }, (l) => setText(l as CommandLine, value)),
            undefined,
            j,
          );
        }
        const message = result.ok ? null : result.reason === "opened" ? result.notice : result.error;
        if (!settle(result, layout()) && message !== null) {
          writeDraft(f.owner, f.name, { draft: value, error: message });
          expected.set(at(g, f.id, f.name), { draft: value });
        }
        label = `commit ${f.name} on ${f.id}${message === null ? "" : ` (${message})`}`;
      } else if (roll === 4) {
        const pending = allFields().filter((f) => expected.has(at(guide(), f.id, f.name)));
        const f = pending.length > 0 && next() < 0.5 ? pick(pending) : field();
        writeDraft(f.owner, f.name, NO_DRAFT);
        expected.delete(at(guide(), f.id, f.name));
        label = `discard ${f.name} on ${f.id}`;
      } else if (roll === 5) {
        const i = int(layout().length);
        const lines = layout()[i]!.lines;
        const kind = lines.length === 0 ? 0 : int(lines.length > 1 ? 3 : 2);
        const j = int(lines.length);
        if (kind === 0) {
          const k = int(lines.length + 1);
          settle(
            editSection(store, i, (d) => insertLine(d, { step: i, index: k }, newLine())),
            withLines(i, [...lines.slice(0, k), ids++, ...lines.slice(k)]),
          );
          label = `insert line ${k} in step ${i}`;
        } else if (kind === 1) {
          settle(
            editSection(store, i, (d) => deleteLine(d, { step: i, index: j })),
            withLines(
              i,
              lines.filter((_, k) => k !== j),
            ),
          );
          label = `delete line ${j} of step ${i}`;
        } else {
          const to = j === 0 ? 1 : j - 1;
          const moved = lines.filter((_, k) => k !== j);
          moved.splice(to, 0, lines[j]!);
          settle(
            editSection(store, i, (d) => moveLine(d, { step: i, index: j }, { step: i, index: to })),
            withLines(i, moved),
          );
          label = `move line ${j} to ${to} in step ${i}`;
        }
      } else if (roll === 6 && next() < 0.3) {
        const i = int(layout().length);
        const g = guide();
        const stepId = layout()[i]!.id;
        const lines = Array.from({ length: 1 + int(2) }, () => `.accept ${++counter}`);
        const split = next() < 0.3;
        const text = ["step", ...lines, ...(split ? ["step", `.accept ${++counter}`] : [])].join("\n");
        discardRawDraft(store, i);
        changeRawDraft(store, i, text);
        expected.delete(at(g, stepId, "raw"));
        const pieces = [{ id: stepId, lines: lines.map(() => ids++) }, ...(split ? [{ id: ids++, lines: [ids++] }] : [])];
        if (!settle(applyRawDraft(store, i), [...layout().slice(0, i), ...pieces, ...layout().slice(i + 1)])) {
          expected.set(at(g, stepId, "raw"), { draft: text });
        }
        label = `apply raw text to step ${i}${split ? ", split" : ""}`;
      } else if (roll === 6) {
        const n = layout().length;
        const kind = n === 1 ? int(2) * 3 : int(4);
        if (kind === 0) {
          const k = int(n + 1);
          settle(
            store.edit((d) => insertStep(d, k)),
            [...layout().slice(0, k), { id: ids++, lines: [] }, ...layout().slice(k)],
          );
          label = `insert step ${k}`;
        } else if (kind === 1) {
          const k = int(n);
          settle(
            store.edit((d) => deleteStep(d, k)),
            layout().filter((_, x) => x !== k),
          );
          label = `delete step ${k}`;
        } else if (kind === 2) {
          const from = int(n);
          const to = (from + 1 + int(n - 1)) % n;
          const moved = layout().filter((_, x) => x !== from);
          moved.splice(to, 0, layout()[from]!);
          settle(
            store.edit((d) => moveStep(d, from, to)),
            moved,
          );
          label = `move step ${from} to ${to}`;
        } else {
          const k = int(n + 1);
          const added = [
            { id: ids++, lines: [] },
            { id: ids++, lines: [] },
          ];
          settle(
            store.edit((d) => [0, 1].reduce((doc, x) => insertStep(doc, k + x), d)),
            [...layout().slice(0, k), ...added, ...layout().slice(k)],
          );
          label = `insert quest steps at ${k}`;
        }
      } else if (roll === 7 && withBuiltin) {
        const { stored } = state;
        if (!stored) continue;
        state = { ...state, builtinOpen: !state.builtinOpen };
        store.open(state.builtinOpen ? BUILTIN : stored.id);
        label = `open the ${state.builtinOpen ? "built-in" : "copy"}`;
      } else if (roll <= 8) {
        if (past.length === 0) continue;
        const all = next() < 0.2;
        do {
          const entry = past.pop()!;
          store.undo();
          future.push(entry);
          state = entry.before;
          for (const [key, draft] of entry.moved) if (!expected.has(key)) expected.set(key, draft);
        } while (all && past.length > 0);
        label = all ? "undo all" : "undo";
      } else {
        if (future.length === 0) continue;
        const all = next() < 0.2;
        do {
          const entry = future.pop()!;
          store.redo();
          past.push(entry);
          state = entry.after;
          for (const [key, draft] of entry.moved) if (expected.get(key) === draft) expected.delete(key);
        } while (all && future.length > 0);
        label = all ? "redo all" : "redo";
      }
      const where = `sequence ${seq}, operation ${op}: ${label}`;
      expect(guide(), where).toBe(state.builtinOpen ? BUILTIN : state.stored!.id);
      checkOpen(where);
      const { stored } = state;
      if (withBuiltin && stored) {
        const shown = guide();
        state = { ...state, builtinOpen: !state.builtinOpen };
        store.open(state.builtinOpen ? BUILTIN : stored.id);
        checkOpen(`${where}; other guide`);
        state = { ...state, builtinOpen: !state.builtinOpen };
        store.open(shown);
      }
      checks++;
    }
  }
  expect(checks).toBeGreaterThan(SEQUENCES * OPERATIONS * 0.7);
}

it(`keeps drafts with their own step or line through ${SEQUENCES} random edit sequences`, () => {
  runSequences(false, 20260923);
});

it(`keeps drafts with their own guide through ${SEQUENCES} random sequences that copy a built-in`, () => {
  runSequences(true, 20260924);
});

it("refuses an edit that changes a step's points while its raw text waits, from any path", () => {
  const store = new EditorStore();
  store.addGuides([
    {
      text: "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n.xp 2\n.waypoint Elwynn Forest,1,2\n.line Elwynn Forest,10,20,30,40\n.loop 20,Elwynn Forest,10,20,30,40\nstep\n.goto Durotar,50,50\n",
    },
  ]);
  const doc = () => store.getState().current!.doc;
  const step = (): DraftOwner => ({ object: doc().steps[0]!, guide: store.getState().current!.id });
  const goto = () => (doc().steps[0]!.body[0] as CommandLine).args.join(",");
  changeRawDraft(store, 0, "step\n.goto Elwynn Forest,48.94,40.16\n.xp 2\n.xp 3");

  const waits = {
    ok: false,
    reason: "waits",
    error: "Step 1 has raw text that is not applied. Apply or discard it before changing its points.",
  };
  const pos = { step: 0, index: 0 };
  const at = { step: 0, line: 0 };
  const before = doc();
  expect(
    editSection(store, 0, (d) => updateLine(d, pos, (l) => setCommandArgs(l as CommandLine, ["Elwynn Forest", "55", "40.16"])), at, 0),
  ).toEqual(waits);
  expect(editSection(store, 0, (d) => updateLine(d, pos, () => parseLine(".waypoint Elwynn Forest,55,40.16") as BodyLine), at, 0)).toEqual(
    waits,
  );
  expect(editSection(store, 0, (d) => insertLine(d, { step: 0, index: 3 }, parseLine(".goto Elwynn Forest,1,2") as BodyLine))).toEqual(
    waits,
  );
  expect(editSection(store, 0, (d) => deleteLine(d, pos))).toEqual(waits);
  expect(editSection(store, 0, (d) => moveLine(d, pos, { step: 0, index: 2 }))).toEqual(waits);
  expect(
    editSection(
      store,
      0,
      (d) => updateLine(d, { step: 0, index: 3 }, () => parseLine(".line Elwynn Forest,15,25,35,45") as BodyLine),
      { step: 0, line: 3 },
      3,
    ),
  ).toEqual(waits);
  expect(
    editSection(
      store,
      0,
      (d) => updateLine(d, { step: 0, index: 4 }, () => parseLine(".loop 20,Elwynn Forest,15,25,35,45") as BodyLine),
      { step: 0, line: 4 },
      4,
    ),
  ).toEqual(waits);
  expect(doc()).toBe(before);
  expect(
    editSection(store, 0, (d) => updateLine(d, { step: 0, index: 1 }, () => parseLine(".xp 4") as BodyLine), { step: 0, line: 1 }, 1),
  ).toEqual(APPLIED);
  expect(
    editSection(store, 1, (d) => updateLine(d, { step: 1, index: 0 }, (l) => setCommandArgs(l as CommandLine, ["Durotar", "51", "50"]))),
  ).toEqual(APPLIED);
  expect(readDraft(step(), "raw").draft).toBe("step\n.goto Elwynn Forest,48.94,40.16\n.xp 2\n.xp 3");

  discardRawDraft(store, 0);
  expect(
    editSection(store, 0, (d) => updateLine(d, pos, (l) => setCommandArgs(l as CommandLine, ["Elwynn Forest", "55", "40.16"])), at, 0),
  ).toEqual(APPLIED);
  expect(goto()).toBe("Elwynn Forest,55,40.16");
});

it("keeps a built-in's header draft through a header edit that changes nothing", () => {
  const store = new EditorStore(
    { guides: [], session: { guideId: BUILTIN, step: null, line: null } },
    { version: "v1", guides: [{ id: BUILTIN, text: TEXT, order: 0 }] },
  );
  const header = (): DraftOwner => ({ object: store.getState().current!.doc.header, guide: store.getState().current!.id });
  changeRawDraft(store, null, "#next Changed");

  expect(editSection(store, null, (d) => d)).toEqual(APPLIED);
  expect(store.getState().current!.id).toBe(BUILTIN);
  expect(store.getState().canUndo).toBe(false);
  expect(readDraft(header(), "raw").draft).toBe("#next Changed");
});

it("applies a section's raw text as one undo step, and undo and redo leave no draft", () => {
  const store = new EditorStore();
  store.addGuides([{ text: "#group T\n#name One\nstep\n.accept 1\n" }]);
  const open = () => store.getState().current!;
  changeRawDraft(store, 0, "step\n.accept 2");
  expect(hasRawDraft(open(), 0)).toBe(true);

  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 2");
  expect(hasRawDraft(open(), 0)).toBe(false);
  store.undo();
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 1");
  expect(hasRawDraft(open(), 0)).toBe(false);
  store.redo();
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 2");
  expect(hasRawDraft(open(), 0)).toBe(false);

  changeRawDraft(store, null, "#group T\n#name One\n#version 2");
  expect(applyRawDraft(store, null)).toEqual(APPLIED);
  expect(sectionText(open().doc, null)).toBe("#group T\n#name One\n#version 2");
  expect(hasRawDraft(open(), null)).toBe(false);
});

it.each([
  { change: "inserts a line before it", text: "step\n#optional\n.accept 1\n.accept 2\n.accept 3", line: 2 },
  { change: "shortens the step", text: "step\n.accept 1", line: 0 },
  { change: "empties the step", text: "step", line: null },
])("keeps the selection at its index, clamped to the step, when Raw $change", ({ text, line }) => {
  const store = new EditorStore();
  store.addGuides([{ text: "#group T\n#name One\nstep\n.accept 1\n.accept 2\n.accept 3\n" }]);
  store.select({ step: 0, line: 2 });
  changeRawDraft(store, 0, text);

  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(sectionText(store.getState().current!.doc, 0)).toBe(text);
  expect(store.getState().selection).toEqual({ step: 0, line });
});

it("keeps the selection and field drafts on the first part when Raw splits a step", () => {
  const store = new EditorStore();
  store.addGuides([{ text: "#group T\n#name One\nstep\n.accept 1\n.accept 2\n.accept 3\n" }]);
  const open = () => store.getState().current!;
  writeDraft({ object: open().doc.steps[0]!, guide: open().id }, "#label", { draft: "waiting", error: null });
  store.select({ step: 0, line: 2 });
  changeRawDraft(store, 0, "step\n.accept 1\n.accept 2\nstep\n.accept 3");

  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(store.getState().selection).toEqual({ step: 0, line: 1 });
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 1\n.accept 2");
  expect(sectionText(open().doc, 1)).toBe("step\n.accept 3");
  expect(readDraft({ object: open().doc.steps[0]!, guide: open().id }, "#label")).toEqual({ draft: "waiting", error: null });
  expect(readDraft({ object: open().doc.steps[1]!, guide: open().id }, "#label")).toBe(NO_DRAFT);
});

it("keeps raw text that cannot apply, with its error, and discards it", () => {
  const store = new EditorStore();
  store.addGuides([{ text: "#group T\n#name One\nstep\n.accept 1\n" }]);
  const owner = (): DraftOwner => ({ object: store.getState().current!.doc.steps[0]!, guide: store.getState().current!.id });
  const before = store.getState().current!.doc;
  changeRawDraft(store, 0, "nonsense");

  const error = "Step text must start with a step line.";
  expect(applyRawDraft(store, 0)).toEqual({ ok: false, reason: "failed", error });
  expect(readDraft(owner(), "raw")).toEqual({ draft: "nonsense", error });
  expect(store.getState().current!.doc).toBe(before);

  discardRawDraft(store, 0);
  expect(readDraft(owner(), "raw")).toBe(NO_DRAFT);
  expect(store.getState().current!.doc).toBe(before);
});

it("applies a built-in's raw text to its first copy, and keeps the built-in's later raw text when that opens the copy", () => {
  const store = new EditorStore(
    { guides: [], session: { guideId: BUILTIN, step: 0, line: null } },
    { version: "v1", guides: [{ id: BUILTIN, text: TEXT, order: 0 }] },
  );
  const open = () => store.getState().current!;
  const raw = (draft: string) => changeRawDraft(store, 0, draft);
  raw("step\n.accept 9 >> Z");

  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  const copy = open().id;
  expect(copy).not.toBe(BUILTIN);
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 9 >> Z");
  expect(hasRawDraft(open(), 0)).toBe(false);
  store.undo();
  expect(open().id).toBe(BUILTIN);
  expect(hasRawDraft(open(), 0)).toBe(false);
  store.redo();
  expect(open().id).toBe(copy);

  store.open(BUILTIN);
  raw(sectionText(open().doc, 0));
  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(open().id).toBe(BUILTIN);
  expect(hasRawDraft(open(), 0)).toBe(false);

  raw("step\n.accept 8");
  const result = applyRawDraft(store, 0);
  expect(result).toMatchObject({ ok: false, reason: "opened", notice: expect.stringMatching(/^Opened your copy/) });
  expect(open().id).toBe(copy);
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 9 >> Z");
  expect(hasRawDraft(open(), 0)).toBe(false);
  store.open(BUILTIN);
  expect(readDraft({ object: open().doc.steps[0]!, guide: BUILTIN }, "raw")).toEqual({
    draft: "step\n.accept 8",
    error: expect.stringMatching(/^Opened your copy/),
  });
});

it("refuses raw text whose section changed after it began, keeps both texts, and applies new raw text after Revert", () => {
  const store = new EditorStore();
  store.addGuides([{ text: "#group T\n#name One\nstep\n.accept 1\n.xp 2\n" }]);
  const open = () => store.getState().current!;
  const owner = (): DraftOwner => ({ object: open().doc.steps[0]!, guide: open().id });
  changeRawDraft(store, 0, "step\n.accept 1\n.xp 3");
  expect(editSection(store, 0, (d) => setTag(d, 0, "optional", ""))).toEqual(APPLIED);

  expect(applyRawDraft(store, 0)).toEqual({ ok: false, reason: "failed", error: STALE_RAW_DRAFT });
  expect(sectionText(open().doc, 0)).toBe("step\n#optional\n.accept 1\n.xp 2");
  expect(readDraft(owner(), "raw")).toEqual({ draft: "step\n.accept 1\n.xp 3", error: STALE_RAW_DRAFT });

  discardRawDraft(store, 0);
  changeRawDraft(store, 0, "step\n#optional\n.accept 1\n.xp 3");
  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(sectionText(open().doc, 0)).toBe("step\n#optional\n.accept 1\n.xp 3");
  changeRawDraft(store, 0, "step\n.accept 1\n.xp 3");
  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 1\n.xp 3");
});

it("keeps a raw draft's base through a built-in's copy and through undo", () => {
  const store = new EditorStore(
    { guides: [], session: { guideId: BUILTIN, step: 0, line: null } },
    { version: "v1", guides: [{ id: BUILTIN, text: TEXT, order: 0 }] },
  );
  const open = () => store.getState().current!;
  changeRawDraft(store, 0, "step\n.accept 9");
  expect(editSection(store, 1, (d) => setTag(d, 1, "optional", ""))).toEqual(APPLIED);
  expect(open().id).not.toBe(BUILTIN);
  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 9");

  changeRawDraft(store, 0, "step\n.accept 8");
  expect(editSection(store, 0, (d) => updateStepLine(d, 0, (l) => setCondition(l, "Alliance")))).toEqual(APPLIED);
  expect(applyRawDraft(store, 0)).toMatchObject({ ok: false, error: STALE_RAW_DRAFT });
  store.undo();
  expect(applyRawDraft(store, 0)).toEqual(APPLIED);
  expect(sectionText(open().doc, 0)).toBe("step\n.accept 8");
});

it("keeps the selected line, with its drafts, when a step setting adds or removes a line before it", () => {
  const store = new EditorStore();
  store.addGuides([{ text: "#group T\n#name One\nstep\n.accept 1\n.xp 2\n" }]);
  const open = () => store.getState().current!;
  const line = (i: number): DraftOwner => ({ object: open().doc.steps[0]!.body[i]!, guide: open().id });
  store.select({ step: 0, line: 1 });
  writeDraft(line(1), "Line text", { draft: ".xp 3", error: null });

  expect(editSection(store, 0, (d) => setTag(d, 0, "optional", ""))).toEqual(APPLIED);
  expect(store.getState().selection).toEqual({ step: 0, line: 2 });
  expect(readDraft(line(2), "Line text").draft).toBe(".xp 3");
  expect(editSection(store, 0, (d) => setTag(d, 0, "optional", null))).toEqual(APPLIED);
  expect(store.getState().selection).toEqual({ step: 0, line: 1 });
  expect(readDraft(line(1), "Line text").draft).toBe(".xp 3");

  expect(editSection(store, 0, (d) => insertLine(d, { step: 0, index: 0 }, parseLine(".xp 9") as BodyLine), { step: 0, line: 0 })).toEqual(
    APPLIED,
  );
  expect(store.getState().selection).toEqual({ step: 0, line: 0 });
  expect(editSection(store, 0, (d) => setTag(d, 0, "optional", ""))).toEqual(APPLIED);
  store.select({ step: 0, line: 0 });
  expect(editSection(store, 0, (d) => setTag(d, 0, "optional", null))).toEqual(APPLIED);
  expect(store.getState().selection).toEqual({ step: 0, line: null });
});
