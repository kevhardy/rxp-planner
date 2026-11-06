import { expect, it } from "vitest";
import {
  deleteLine,
  deleteStep,
  GuideEditError,
  getLines,
  insertLine,
  insertStep,
  moveLine,
  moveStep,
  newStep,
  replaceLine,
  setCommandArgs,
  setCondition,
  setTag,
  setTagValue,
  setText,
  updateLine,
  updateStepLine,
} from "./edit.ts";
import type { BodyLine, GuideDocument, Step } from "./model.ts";
import { parseGuide, parseLine } from "./parse.ts";
import { serializeGuide } from "./serialize.ts";

const SEQUENCES = 400;
const OPERATIONS = 25;

const guides = [
  "",
  "-- header note",
  "step",
  "step -- note",
  "step\n.accept 1 >> do -- note",
  "#name G\n<< Alliance\nstep\n+a\n-- only a comment",
  "step << Mage\n    .goto Elwynn Forest,1,2 >> go -- x\nstep\n    *b -- y",
  "#classic\nstep\n    #completewith next\n    words >> shown -- z\n\n  ",
].flatMap((text) => (text === "" ? [text] : [text, `${text}\n`]));

const lineRaws = [
  ".accept 5 >> hi",
  "+x -- c",
  "-- lone",
  "",
  "  ",
  "#completewith next",
  "<< Horde",
  "words >> shown -- w",
  ".target A;B",
  "bare text -- v",
];
const newLines = lineRaws.flatMap((raw) => [false, true].map((unterminated) => parseLine(raw, { unterminated }) as BodyLine));
const newSteps = ["step\n+s -- t", "step << Druid -- d"].map((text) => parseGuide(text).steps[0]!);

const texts = ["x", "a -- b", "", "<< c", "line\nbreak"];
const argLists = [["1", "2"], ["", "a"], ["Elwynn Forest", "1", "2"], []];
const conditions = ["Mage", undefined, "", "(A", "Horde/ /Alliance"];

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const withoutRaw = (doc: GuideDocument): unknown =>
  JSON.parse(JSON.stringify(doc, (key, value: unknown) => (key === "raw" ? undefined : value)));

it(`keeps ${SEQUENCES} random edit sequences consistent with their text`, () => {
  const next = mulberry32(20260923);
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;

  let applied = 0;
  for (let sequence = 0; sequence < SEQUENCES; sequence++) {
    let doc = parseGuide(pick(guides));
    const log: string[] = [];

    const section = (min: number): number | null | undefined => {
      const all = [null, ...doc.steps.keys()].filter((s) => getLines(doc, s).length >= min);
      return all.length > 0 ? pick(all) : undefined;
    };
    const anyLine = (): BodyLine | undefined => {
      const s = section(1);
      return s === undefined ? undefined : pick(getLines(doc, s));
    };
    const someLine = () => (next() < 0.5 ? anyLine() : undefined) ?? pick(newLines);
    const someStep = (): Step => {
      const r = next();
      if (r < 0.2 || doc.steps.length === 0) return next() < 0.5 ? newStep() : pick(newSteps);
      return pick(doc.steps);
    };
    const setter = (line: BodyLine): BodyLine => {
      switch (line.kind) {
        case "command":
          return next() < 0.5 ? setCommandArgs(line, pick(argLists)) : setText(line, pick(texts));
        case "text":
        case "other":
          return next() < 0.5 ? setText(line, pick(texts)) : setCondition(line, pick(conditions));
        case "tag":
          return next() < 0.5 ? setTagValue(line, pick(texts)) : setCondition(line, pick(conditions));
        default:
          return setCondition(line, pick(conditions));
      }
    };

    const operations: [string, () => GuideDocument | undefined][] = [
      [
        "insertLine",
        () => {
          const s = section(0)!;
          return insertLine(doc, { step: s, index: int(getLines(doc, s).length + 1) }, someLine());
        },
      ],
      [
        "duplicateLine",
        () => {
          const s = section(1);
          if (s === undefined) return;
          const lines = getLines(doc, s);
          const index = int(lines.length);
          return insertLine(doc, { step: s, index: int(lines.length + 1) }, lines[index]!);
        },
      ],
      [
        "deleteLine",
        () => {
          const s = section(1);
          return s === undefined ? undefined : deleteLine(doc, { step: s, index: int(getLines(doc, s).length) });
        },
      ],
      [
        "moveLine",
        () => {
          const from = section(1);
          if (from === undefined) return;
          const index = int(getLines(doc, from).length);
          const to = section(0)!;
          const size = getLines(doc, to).length + (to === from ? 0 : 1);
          return moveLine(doc, { step: from, index }, { step: to, index: int(size) });
        },
      ],
      [
        "replaceLine",
        () => {
          const s = section(1);
          return s === undefined ? undefined : replaceLine(doc, { step: s, index: int(getLines(doc, s).length) }, someLine());
        },
      ],
      [
        "updateLine",
        () => {
          const s = section(1);
          return s === undefined ? undefined : updateLine(doc, { step: s, index: int(getLines(doc, s).length) }, setter);
        },
      ],
      ["insertStep", () => insertStep(doc, int(doc.steps.length + 1), someStep())],
      ["duplicateStep", () => (doc.steps.length === 0 ? undefined : insertStep(doc, int(doc.steps.length + 1), pick(doc.steps)))],
      ["deleteStep", () => (doc.steps.length === 0 ? undefined : deleteStep(doc, int(doc.steps.length)))],
      ["moveStep", () => (doc.steps.length === 0 ? undefined : moveStep(doc, int(doc.steps.length), int(doc.steps.length)))],
      [
        "updateStepLine",
        () => (doc.steps.length === 0 ? undefined : updateStepLine(doc, int(doc.steps.length), (l) => setCondition(l, pick(conditions)))),
      ],
      ["setTag", () => setTag(doc, section(0)!, pick(["name", "next"]), pick(["x", "", null]))],
    ];

    for (let i = 0; i < OPERATIONS; i++) {
      const [name, run] = pick(operations);
      let result: GuideDocument | undefined;
      try {
        result = run();
      } catch (error) {
        if (error instanceof GuideEditError) continue;
        throw error;
      }
      if (!result) continue;
      doc = result;
      applied++;
      log.push(name);
      const text = serializeGuide(doc);
      expect(withoutRaw(parseGuide(text)), `sequence ${sequence}: ${log.join(", ")}\n${text}`).toEqual(withoutRaw(doc));
    }
  }
  expect(applied).toBeGreaterThan(SEQUENCES * OPERATIONS * 0.7);
});
