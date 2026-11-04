import { describe, expect, it } from "vitest";
import { parseGuide, serializeGuide } from "../guide/index.ts";
import { addSimDone, formatLevelTarget, parseLevelTarget, simDirectives, setKillXpSetting, setSimValue } from "./simComments.ts";
import { targetXp } from "./xp.ts";
import { testRules } from "./testing.ts";

const read = (text: string) => simDirectives(parseGuide(text), 2);

describe("simDirectives", () => {
  it("reads a state= object with spaces up to its last brace, beside other keys", () => {
    const { directives, warnings } = read(
      'step -- @sim respawn=30 state={"level": 5, "log": {"33": "complete"}, "position": "Dun Morogh,46.7,53.6"} area=150\n',
    );
    expect(warnings).toEqual([]);
    expect(directives.map(({ key, ...rest }) => [key, "patch" in rest ? rest.patch : null])).toEqual([
      ["respawn", null],
      ["state", { level: 5, log: { 33: "complete" }, position: "Dun Morogh,46.7,53.6" }],
      ["area", null],
    ]);
  });

  it("rejects invalid XP values and placements while accepting zero and fractional multipliers", () => {
    const result = read(
      "-- @sim killmult=.5 killxp=10\nstep\n-- @sim killmult=-1 killxp=1.5\n.complete 1,1 -- @sim killmult=2\n-- @sim killxp=0\n",
    );
    expect(result.directives.map((d) => [d.key, "value" in d ? d.value : null])).toEqual([
      ["killmult", 0.5],
      ["killxp", 0],
    ]);
    expect(result.warnings.map((w) => [w.key, w.problem])).toEqual([
      ["killxp", "misplaced"],
      ["killmult", "badValue"],
      ["killxp", "badValue"],
      ["killmult", "misplaced"],
    ]);
  });

  it("edits and clears XP settings without losing neighboring comments, directives, or CRLF endings", () => {
    const original =
      "#name A\r\n-- ordinary note\r\nstep -- @sim killmult=2 level=2\r\n-- @sim extra=3 mob=100 killmult=3\r\n.mob 100 -- keep this\r\n";
    let doc = setKillXpSetting(parseGuide(original), 0, "killmult", 0.5);
    expect(serializeGuide(doc)).toBe(original.replace(" killmult=2", "").replace("killmult=3", "killmult=0.5"));
    doc = setKillXpSetting(doc, 0, "killmult", undefined);
    expect(serializeGuide(doc)).toBe(original.replace(" killmult=2", "").replace(" killmult=3", ""));
    doc = setKillXpSetting(doc, 0, "killxp", 0);
    expect(read(serializeGuide(doc)).directives).toContainEqual(expect.objectContaining({ key: "killxp", value: 0 }));
    expect(serializeGuide(setKillXpSetting(doc, 0, "killxp", undefined))).toBe(
      original.replace(" killmult=2", "").replace(" killmult=3", ""),
    );
  });
  it("sets and clears one key on a line, keeping its comment text and other directives", () => {
    const text = "step\r\n  .complete 179,1 --Tough Wolf Meat (8)\r\n  .complete 1,1\r\n  -- a few more @sim extra=3 mob=100\r\n";
    const lines = (doc: ReturnType<typeof parseGuide>) => serializeGuide(doc).split("\r\n").slice(1, 4);
    let doc = setSimValue(parseGuide(text), { step: 0, index: 0 }, "kills", 3);
    doc = setSimValue(doc, { step: 0, index: 0 }, "mob", 705);
    doc = setSimValue(doc, { step: 0, index: 0 }, "kills", 0);
    doc = setSimValue(doc, { step: 0, index: 1 }, "kills", 2);
    doc = setSimValue(doc, { step: 0, index: 2 }, "extra", undefined);
    expect(lines(doc)).toEqual([
      "  .complete 179,1 --Tough Wolf Meat (8) @sim kills=0 mob=705",
      "  .complete 1,1 -- @sim kills=2",
      "  -- a few more @sim mob=100",
    ]);
    expect(read(serializeGuide(doc)).directives.map((d) => d.key)).toEqual(["kills", "kills"]);
    for (const [index, key] of [
      [0, "kills"],
      [0, "mob"],
      [1, "kills"],
      [2, "mob"],
    ] as const) {
      doc = setSimValue(doc, { step: 0, index }, key, undefined);
    }
    expect(lines(doc)).toEqual(["  .complete 179,1 --Tough Wolf Meat (8)", "  .complete 1,1", "  -- a few more"]);
    expect(serializeGuide(setSimValue(parseGuide("step\n  \n"), { step: 0, index: 0 }, "level", 5))).toBe("step\n  -- @sim level=5\n");
    expect(serializeGuide(setSimValue(parseGuide("step\n-- @sim level=5\n.accept 1\n"), { step: 0, index: 0 }, "level", undefined))).toBe(
      "step\n.accept 1\n",
    );
    expect(serializeGuide(setSimValue(parseGuide("step\n.accept 1\n"), { step: 0 }, "level", 5))).toBe("step -- @sim level=5\n.accept 1\n");
    const last = setSimValue(parseGuide("step\n.complete 1,1 --Wolf (8)"), { step: 0, index: 0 }, "kills", 3);
    expect(serializeGuide(last)).toBe("step\n.complete 1,1 --Wolf (8) @sim kills=3\n");
  });

  it("reads each placement: after a line or its comment text, on its own in a step, and in the header", () => {
    const text =
      [
        "#name A",
        "-- @sim done=10,11 level=5",
        "step -- @sim level=6.5",
        "-- @sim extra=4 mob=300",
        ".complete 1,1 -- @sim kills=8 mob=200",
        ".complete 1,2 --@sim mob=201",
        ".complete 1,3 --Tough Wolf Meat (8) @sim kills=3",
        ".xp 7 -- see @simulate, not@sim level=9",
      ].join("\n") + "\n";
    expect(read(text)).toEqual({
      directives: [
        { at: { guide: 2, line: 1 }, scope: "guide", key: "done", questIds: [10, 11] },
        { at: { guide: 2, line: 1 }, scope: "guide", key: "level", target: { kind: "level", level: 5 } },
        { at: { guide: 2, step: 0 }, scope: "step", key: "level", target: { kind: "fraction", level: 6, fraction: 0.5 } },
        { at: { guide: 2, step: 0, line: 0 }, scope: "step", key: "extra", count: 4, mob: 300 },
        { at: { guide: 2, step: 0, line: 1 }, scope: "line", key: "kills", count: 8, mob: 200 },
        { at: { guide: 2, step: 0, line: 2 }, scope: "line", key: "mob", mob: 201 },
        { at: { guide: 2, step: 0, line: 3 }, scope: "line", key: "kills", count: 3 },
      ],
      warnings: [],
    });
  });

  it("reads kills= without a mob and done= after a header line", () => {
    expect(read("#name A -- @sim done=3\nstep\n.complete 1,1 -- @sim kills=0\n").directives).toEqual([
      { at: { guide: 2, line: 0 }, scope: "line", key: "done", questIds: [3] },
      { at: { guide: 2, step: 0, line: 0 }, scope: "line", key: "kills", count: 0 },
    ]);
  });

  it("reads the final line when no line ending follows, without changing the document", () => {
    const cases: [string, unknown][] = [
      ["step\n-- @sim level=8", { at: { guide: 2, step: 0, line: 0 }, scope: "step", key: "level", target: { kind: "level", level: 8 } }],
      ["-- @sim done=33", { at: { guide: 2, line: 0 }, scope: "guide", key: "done", questIds: [33] }],
      ["step\n.complete 1,1 -- @sim kills=12", { at: { guide: 2, step: 0, line: 0 }, scope: "line", key: "kills", count: 12 }],
    ];
    for (const [text, directive] of cases) {
      const doc = parseGuide(text);
      expect(simDirectives(doc, 2), text).toEqual({ directives: [directive], warnings: [] });
      expect(doc, text).toEqual(parseGuide(text));
    }
  });

  it("warns on unknown keys and bad values", () => {
    const text = "step\n-- @sim speed=2 level=61 level=8x extra=-1 mob=0 kills\n.complete 1,1 -- @sim kills=3 kills=4\n";
    expect(read(text).warnings.map(({ key, value, problem }) => [key, value, problem])).toEqual([
      ["speed", "2", "unknown"],
      ["level", "61", "badValue"],
      ["level", "8x", "badValue"],
      ["extra", "-1", "badValue"],
      ["mob", "0", "badValue"],
      ["kills", "", "badValue"],
      ["kills", "4", "badValue"],
    ]);
  });

  it("warns on done= outside the header and kills outside a step", () => {
    const text = "-- @sim kills=3 extra=2 mob=5\nstep\n-- @sim done=1\n.accept 1 -- @sim done=2,x\n";
    expect(read(text).warnings).toEqual([
      { kind: "unknownSimKey", at: { guide: 2, line: 0 }, key: "kills", value: "3", problem: "misplaced" },
      { kind: "unknownSimKey", at: { guide: 2, line: 0 }, key: "extra", value: "2", problem: "misplaced" },
      { kind: "unknownSimKey", at: { guide: 2, line: 0 }, key: "mob", value: "5", problem: "misplaced" },
      { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 0 }, key: "done", value: "1", problem: "misplaced" },
      { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 1 }, key: "done", value: "2,x", problem: "badValue" },
    ]);
  });

  it("reads party= in the header, and warns on another value or a party= outside the header", () => {
    const text = "-- @sim party=2\n-- @sim party=3\n-- @sim party=0.5\nstep -- @sim party=2\n-- @sim party=1\n.accept 1 -- @sim party=2\n";
    const { directives, warnings } = read(text);
    expect(directives).toEqual([{ at: { guide: 2, line: 0 }, scope: "guide", key: "party", size: 2 }]);
    expect(warnings.map(({ at, value, problem }) => [at, value, problem])).toEqual([
      [{ guide: 2, line: 1 }, "3", "badValue"],
      [{ guide: 2, line: 2 }, "0.5", "badValue"],
      [{ guide: 2, step: 0 }, "2", "misplaced"],
      [{ guide: 2, step: 0, line: 0 }, "1", "misplaced"],
      [{ guide: 2, step: 0, line: 1 }, "2", "misplaced"],
    ]);
  });

  it("warns on extra= without mob=, and on kills= or mob= alone off a .complete line", () => {
    const text = [
      "step -- @sim kills=1",
      ".complete 1,1 -- @sim extra=2",
      "-- @sim kills=3 mob=4",
      ".accept 33 -- @sim kills=12 mob=525",
      ".turnin 33 -- @sim mob=6",
      ".accept 34 -- @sim kills=7 extra=8 mob=9",
    ].join("\n");
    expect(read(`${text}\n`)).toEqual({
      directives: [{ at: { guide: 2, step: 0, line: 4 }, scope: "line", key: "extra", count: 8, mob: 9 }],
      warnings: [
        { kind: "unknownSimKey", at: { guide: 2, step: 0 }, key: "kills", value: "1", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 0 }, key: "extra", value: "2", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 1 }, key: "kills", value: "3", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 1 }, key: "mob", value: "4", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 2 }, key: "kills", value: "12", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 2 }, key: "mob", value: "525", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 3 }, key: "mob", value: "6", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 4 }, key: "kills", value: "7", problem: "misplaced" },
      ],
    });
  });

  it("reads drop= on a .complete line, and warns on a bad chance or another place", () => {
    const text = [
      ".complete 1,1 -- @sim drop=.35 kills=4",
      ".complete 1,2 -- @sim drop=1",
      ".complete 1,3 -- @sim drop=0.005",
      ".complete 1,3 -- @sim drop=1.5",
      ".complete 1,3 -- @sim drop=35%",
      ".turnin 1 -- @sim drop=0.5",
      "-- @sim drop=0.5",
    ].join("\n");
    expect(read(`-- @sim drop=0.5\nstep\n${text}\n`)).toEqual({
      directives: [
        { at: { guide: 2, step: 0, line: 0 }, scope: "line", key: "drop", chance: 0.35 },
        { at: { guide: 2, step: 0, line: 0 }, scope: "line", key: "kills", count: 4 },
        { at: { guide: 2, step: 0, line: 1 }, scope: "line", key: "drop", chance: 1 },
      ],
      warnings: [
        { kind: "unknownSimKey", at: { guide: 2, line: 0 }, key: "drop", value: "0.5", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 2 }, key: "drop", value: "0.005", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 3 }, key: "drop", value: "1.5", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 4 }, key: "drop", value: "35%", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 5 }, key: "drop", value: "0.5", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 6 }, key: "drop", value: "0.5", problem: "misplaced" },
      ],
    });
  });

  it("reads respawn=, area=, and near= in a step, and respawn= and area= in the header, and warns on bad values and places", () => {
    const text = [
      "-- @sim respawn=90 area=200 near=50,50",
      "step -- @sim respawn=30",
      "-- @sim area=150.5 near=47.3,48.7",
      "-- @sim respawn=0 area=-5 near=101,5",
      "-- @sim respawn=1m near=47",
      ".complete 1,1 -- @sim respawn=30 area=150 near=1,1",
    ].join("\n");
    expect(read(`${text}\n`)).toEqual({
      directives: [
        { at: { guide: 2, line: 0 }, scope: "guide", key: "respawn", seconds: 90 },
        { at: { guide: 2, line: 0 }, scope: "guide", key: "area", yards: 200 },
        { at: { guide: 2, step: 0 }, scope: "step", key: "respawn", seconds: 30 },
        { at: { guide: 2, step: 0, line: 0 }, scope: "step", key: "area", yards: 150.5 },
        { at: { guide: 2, step: 0, line: 0 }, scope: "step", key: "near", x: 47.3, y: 48.7 },
      ],
      warnings: [
        { kind: "unknownSimKey", at: { guide: 2, line: 0 }, key: "near", value: "50,50", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 1 }, key: "respawn", value: "0", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 1 }, key: "area", value: "-5", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 1 }, key: "near", value: "101,5", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 2 }, key: "respawn", value: "1m", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 2 }, key: "near", value: "47", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 3 }, key: "respawn", value: "30", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 3 }, key: "area", value: "150", problem: "misplaced" },
        { kind: "unknownSimKey", at: { guide: 2, step: 0, line: 3 }, key: "near", value: "1,1", problem: "misplaced" },
      ],
    });
  });

  it("leaves guide text unchanged", () => {
    const text =
      "#name A\r\n-- @sim done=1 level=5\r\nstep -- @sim level=6\r\n  -- @sim extra=2 mob=3\r\n.complete 1,1 -- @sim kills=8 mob=200\r\n.xp 7 --@sim level=7+10";
    const doc = parseGuide(text);
    simDirectives(doc, 0);
    expect(serializeGuide(doc)).toBe(text);
    expect(serializeGuide(parseGuide(`${text}\r\n`))).toBe(`${text}\r\n`);
  });
});

describe("parseLevelTarget", () => {
  it("reads .xp's level forms", () => {
    expect(["8", "8+1200", "8.5", "8.25", "8-300"].map(parseLevelTarget)).toEqual([
      { kind: "level", level: 8 },
      { kind: "plus", level: 8, xp: 1200 },
      { kind: "fraction", level: 8, fraction: 0.5 },
      { kind: "fraction", level: 8, fraction: 0.25 },
      { kind: "minus", level: 8, xp: 300 },
    ]);
  });

  it("rejects other text", () => {
    expect(["", "0", "61", "<8", "8+", "8.", "+8", "8+1.5", "eight"].map(parseLevelTarget)).toEqual(Array(9).fill(undefined));
  });
});

describe("addSimDone", () => {
  it("adds a line after the header's last non-blank line when no @sim comment has done=", () => {
    const text = ["#name  A ", "-- see done=3", "-- @sim level=5", "", "step", "    .accept 1", ""].join("\r\n");
    const next = addSimDone(parseGuide(text), [7, 8, 7]);
    expect(serializeGuide(next).split("\r\n")).toEqual(text.split("\r\n").toSpliced(3, 0, "-- @sim done=7,8"));
  });

  it("adds IDs to the first @sim comment with done=, keeping the rest of it", () => {
    const text = "#name A\n-- @sim level=5  done=3,4 \n-- @sim done=9\nstep\n    .accept 1";
    const next = addSimDone(parseGuide(text), [4, 7]);
    expect(serializeGuide(next)).toBe("#name A\n-- @sim level=5  done=3,4,7 \n-- @sim done=9\nstep\n    .accept 1");
  });

  it("adds a line rather than extend a list the simulator rejects or may skip", () => {
    for (const header of [
      "-- @sim done=abc",
      "-- @sim done=",
      "-- @sim done=1,0",
      "-- @sim done done=1",
      "#group H << Horde -- @sim done=1",
      "#name A -- @sim done=1",
    ]) {
      const next = addSimDone(parseGuide(`${header}\nstep\n`), [1, 3]);
      expect(serializeGuide(next)).toBe(`${header}\n-- @sim done=1,3\nstep\n`);
    }
    const text = "-- @sim done=abc\n-- @sim done=2\nstep\n";
    expect(serializeGuide(addSimDone(parseGuide(text), [2, 3]))).toBe("-- @sim done=abc\n-- @sim done=2,3\nstep\n");
  });

  it("reuses any list the parser reads for the guide, as it reads it", () => {
    const text = "#name A\n--@sim  done=01,2 level=4\nstep\n";
    expect(read(text).warnings).toEqual([]);
    expect(serializeGuide(addSimDone(parseGuide(text), [1, 3]))).toBe("#name A\n--@sim  done=01,2,3 level=4\nstep\n");
    const noted = "#name A\n-- skip these @sim done=2\nstep\n";
    expect(serializeGuide(addSimDone(parseGuide(noted), [3]))).toBe("#name A\n-- skip these @sim done=2,3\nstep\n");
  });

  it("returns the document when every ID is listed", () => {
    const doc = parseGuide("-- @sim done=3,4\nstep\n");
    expect(addSimDone(doc, [4, 3])).toBe(doc);
  });

  it("gives a header-only guide the final line ending its new comment needs", () => {
    expect(serializeGuide(addSimDone(parseGuide("#name A"), [5]))).toBe("#name A\n-- @sim done=5\n");
    expect(serializeGuide(addSimDone(parseGuide("#name A\n-- @sim done=1"), [2]))).toBe("#name A\n-- @sim done=1,2\n");
  });
});

describe("formatLevelTarget", () => {
  it("writes each target form as parseLevelTarget reads it", () => {
    for (const text of ["8", "8+1200", "8-300", "8.5", "8.25", "8.05", "8.0000001"])
      expect(formatLevelTarget(parseLevelTarget(text)!)).toBe(text);
  });

  it("writes fractions that print in exponent notation or round to 0 or 1 as equal targets", () => {
    for (const text of ["8.0", "8.00000000000000000001", "8.0000000000000123", "8.99999999999999999999"]) {
      const target = parseLevelTarget(text)!;
      const written = parseLevelTarget(formatLevelTarget(target));
      expect(written).toBeDefined();
      expect(targetXp(testRules, written!)).toBe(targetXp(testRules, target));
    }
    expect(formatLevelTarget(parseLevelTarget("8.99999999999999999999")!)).toBe("9");
    expect(formatLevelTarget(parseLevelTarget("60.99999999999999999999")!)).toBe("60");
  });
});
