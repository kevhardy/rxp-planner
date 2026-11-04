import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertRepresentable,
  bodyIndent,
  GuideEditError,
  deleteLine,
  deleteStep,
  edited,
  insertLine,
  insertStep,
  moveLine,
  moveStep,
  newGuideText,
  newStep,
  setCommandArgs,
  setComment,
  setCondition,
  setTag,
  setTagValue,
  setText,
  updateLine,
  updateStepLine,
} from "./edit.ts";
import type { BodyLine, CommandLine, GuideDocument, OtherLine, StepLine, TagLine, TextLine } from "./model.ts";
import { parseGuide, parseLine } from "./parse.ts";
import { lineText, serializeGuide } from "./serialize.ts";

const source = [
  "#classic",
  "#name  Test Guide   ",
  "<< Alliance",
  "step",
  "    #completewith next",
  "    .goto Elwynn Forest , 48.17,42.94 >>Go  there << Human --note",
  "    +Talk",
  "step << Mage",
  "\t.accept 1  >>  Accept",
  "",
].join("\r\n");

const lines = (doc: GuideDocument) => serializeGuide(doc).split("\r\n");
const at = (step: number | null, index: number) => ({ step, index });
const bodyLine = (raw: string) => parseLine(raw) as BodyLine;

describe("edit helpers", () => {
  const doc = parseGuide(source);
  const original = source.split("\r\n");

  it("does not change the input document", () => {
    setTag(doc, null, "name", "Other");
    expect(serializeGuide(doc)).toBe(source);
  });

  it("sets command arguments on one line only", () => {
    const next = updateLine(doc, at(0, 1), (l) => setCommandArgs(l as CommandLine, ["Duskwood", "1", "2"]));
    expect(lines(next)).toEqual(original.with(5, "    .goto Duskwood,1,2 >> Go  there << Human --note"));
  });

  it("sets and clears conditions", () => {
    let next = updateLine(doc, at(0, 2), (l) => setCondition(l, "!Human Mage"));
    next = updateStepLine(next, 1, (l) => setCondition(l, undefined));
    expect(lines(next)).toEqual(original.with(6, "    +Talk << !Human Mage").with(7, "step"));
  });

  it("sets text", () => {
    let next = updateLine(doc, at(1, 0), (l) => setText(l as CommandLine, "Take it"));
    next = updateLine(next, at(0, 2), (l) => setText(l as TextLine, "Speak"));
    expect(lines(next)).toEqual(original.with(8, "\t.accept 1 >> Take it").with(6, "    +Speak"));
    const cleared = updateLine(doc, at(1, 0), (l) => setText(l as CommandLine, undefined));
    expect(lines(cleared)[8]).toBe("\t.accept 1");
  });

  it("updates, adds, and removes tags", () => {
    expect(lines(setTag(doc, null, "name", "Renamed"))).toEqual(original.with(1, "#name Renamed"));
    expect(lines(setTag(doc, 1, "optional", ""))).toEqual(original.toSpliced(8, 0, "    #optional"));
    expect(lines(setTag(doc, 0, "completewith", null))).toEqual(original.toSpliced(4, 1));
  });

  it("inserts, deletes, and moves lines", () => {
    const hs = bodyLine("    .hs >> Hearth");
    expect(lines(insertLine(doc, at(1, 1), hs))).toEqual(original.toSpliced(9, 0, "    .hs >> Hearth"));
    expect(lines(deleteLine(doc, at(0, 2)))).toEqual(original.toSpliced(6, 1));
    expect(lines(moveLine(doc, at(0, 2), at(1, 1)))).toEqual(original.toSpliced(6, 1).toSpliced(8, 0, "    +Talk"));
  });

  it("inserts, deletes, and moves steps", () => {
    const step = newStep();
    step.body.push({ kind: "command", indent: bodyIndent(doc), name: "xp", args: ["5"] });
    expect(lines(insertStep(doc, 1, step))).toEqual(original.toSpliced(7, 0, "step", "    .xp 5"));
    expect(lines(deleteStep(doc, 0))).toEqual(original.toSpliced(3, 4));
    expect(lines(moveStep(doc, 1, 0))).toEqual([...original.slice(0, 3), ...original.slice(7, 9), ...original.slice(3, 7), ""]);
  });

  it("rejects positions out of range", () => {
    expect(() => deleteStep(doc, 2)).toThrow(RangeError);
    expect(() => insertLine(doc, at(0, 9), bodyLine("+x"))).toThrow(RangeError);
  });
});

describe("edits that RXP would read differently", () => {
  const doc = parseGuide(source);
  const accept = doc.steps[1]!.body[0] as CommandLine;

  it("rejects text that RXP would split", () => {
    const warrior = setCondition(bodyLine("+Talk"), "Warrior") as TextLine;
    expect(() => setText(warrior, "hello -- world")).toThrow(GuideEditError);
    expect(() => setText(warrior, "a << Mage")).toThrow(GuideEditError);
    expect(() => setText(accept, "a >> b")).not.toThrow();
    expect(() => setText(bodyLine("+x") as TextLine, "a >> b")).toThrow(GuideEditError);
    expect(() => setText(bodyLine("words") as OtherLine, "#tag")).toThrow(GuideEditError);
    expect(() => setTagValue(bodyLine("#label x") as TagLine, "y -- z")).toThrow(GuideEditError);
  });

  it("rejects arguments that RXP would drop, trim, or split", () => {
    const goto = bodyLine(".goto Elwynn Forest,1,2") as CommandLine;
    expect(() => setCommandArgs(goto, ["Elwynn Forest", "1", "2", "", "1"])).toThrow(GuideEditError);
    expect(() => setCommandArgs(goto, ["Elwynn Forest ", "1", "2"])).toThrow(GuideEditError);
    expect(() => setCommandArgs(goto, ["Elwynn Forest", "1,5", "2"])).toThrow(GuideEditError);
    expect(() => setCommandArgs(bodyLine(".target A") as CommandLine, ["Korfax, Champion"])).not.toThrow();
    expect(() => setCommandArgs(bodyLine(".target A") as CommandLine, ["A;B"])).toThrow(GuideEditError);
  });

  it("rejects line breaks", () => {
    expect(() => setText(accept, "a\nstep")).toThrow(/line break/);
    expect(() => setCondition(accept, "Mage\r\nstep")).toThrow(GuideEditError);
  });

  it("rejects inserted lines that do not match their text", () => {
    const bad: CommandLine = { kind: "command", indent: "", name: "xp", args: ["5"], text: "a -- b" };
    expect(() => insertLine(doc, at(0, 0), bad)).toThrow(GuideEditError);
    expect(() => insertLine(doc, at(0, 0), parseLine("step") as BodyLine)).toThrow(GuideEditError);
    expect(() => assertRepresentable({ kind: "tag", indent: "", name: "a b", value: "", assign: false })).toThrow(
      'RXP would read "#a b" differently',
    );
  });
});

describe("condition edits that change the line kind", () => {
  it("turns a cleared standalone condition into a blank or comment line", () => {
    expect(setCondition(bodyLine("<< Mage"), undefined)).toEqual({ kind: "blank", indent: "" });
    expect(setCondition(bodyLine("  << Mage --x"), undefined)).toEqual({ kind: "comment", indent: "  ", comment: "x" });
  });

  it("turns a blank or comment line with a condition into a condition line", () => {
    const line = setCondition(bodyLine(""), "Alliance");
    expect(line).toMatchObject({ kind: "condition", condition: { text: "Alliance" } });
    const next = insertLine(parseGuide("#name A\nstep"), at(null, 1), line);
    expect(serializeGuide(next)).toBe("#name A\n<< Alliance\nstep");
    expect(setCondition(bodyLine("--x"), "Horde")).toMatchObject({ kind: "condition", comment: "x" });
  });
});

describe("comment edits", () => {
  it("sets and clears a comment, changing a blank or comment line to the other kind", () => {
    expect(lineText(setComment(parseLine("  "), " note"))).toBe("  -- note");
    expect(lineText(setComment(parseLine("step --old"), undefined))).toBe("step");
    expect(lineText(setComment(bodyLine(".accept 1 >>Take"), " later"))).toBe(".accept 1 >> Take -- later");
    expect(setComment(bodyLine("  --old"), undefined)).toEqual({ kind: "blank", indent: "" });
  });

  it("refuses a comment with a line break", () => {
    expect(() => setComment(bodyLine(".accept 1"), "bad\nstep")).toThrow(GuideEditError);
  });
});

describe("a final line with no line ending", () => {
  const doc = parseGuide("step\n.accept 1 >> do -- note");

  const withoutRaw = (d: GuideDocument) => JSON.parse(JSON.stringify(d, (k, v) => (k === "raw" ? undefined : v)));
  const expectStable = (d: GuideDocument) => expect(withoutRaw(parseGuide(serializeGuide(d)))).toEqual(withoutRaw(d));

  it("keeps its meaning while it stays last", () => {
    const next = insertStep(doc, 0);
    expect(serializeGuide(next)).toBe("step\nstep\n.accept 1 >> do -- note");
  });

  it("is reparsed when another line follows it", () => {
    const next = insertLine(doc, at(0, 1), bodyLine("+x"));
    expect(serializeGuide(next)).toBe("step\n.accept 1 >> do -- note\n+x");
    expect(next.steps[0]!.body[0]).toMatchObject({ text: "do", comment: " note" });
    expectStable(next);
  });

  it("drops the flag when edited", () => {
    const next = updateLine(doc, at(0, 0), (l) => setText(l as CommandLine, "done"));
    expect(serializeGuide(next)).toBe("step\n.accept 1 >> done");
    expectStable(next);
  });

  it("is reparsed when moved", () => {
    const next = moveLine(parseGuide("step\n+a\n.accept 1 >> b -- c"), at(0, 1), at(0, 0));
    expect(next.steps[0]!.body[0]).toMatchObject({ text: "b", comment: " c" });
    expect(next.steps[0]!.body[0]!.unterminated).toBeUndefined();
    expectStable(next);
  });

  it("keeps its meaning when moved back to its place", () => {
    const source = parseGuide("step\n+a\n.accept 1 >> b -- c");
    const next = moveLine(source, at(0, 1), at(0, 1));
    expect(serializeGuide(next)).toBe("step\n+a\n.accept 1 >> b -- c");
    expectStable(next);
  });

  it("is reparsed when copied into another document", () => {
    const line = doc.steps[0]!.body[0]!;
    expectStable(insertLine(parseGuide("step\n+a\n"), at(0, 0), line));
    expectStable(insertLine(parseGuide("step\n+a"), at(0, 0), line));
    expectStable(insertStep(parseGuide("step\n+a\n"), 0, doc.steps[0]));
    expect(insertLine(parseGuide("step\n+a"), at(0, 0), line).steps[0]!.body[0]).toMatchObject({ text: "do" });
  });

  it("is reparsed on the earlier copy when duplicated", () => {
    const next = insertLine(doc, at(0, 0), doc.steps[0]!.body[0]!);
    expect(serializeGuide(next)).toBe("step\n.accept 1 >> do -- note\n.accept 1 >> do -- note");
    expect(next.steps[0]!.body[0]).toMatchObject({ text: "do", comment: " note" });
    expect(next.steps[0]!.body[1]).toMatchObject({ text: "do -- note", unterminated: true });
    expectStable(next);
  });

  it("is reparsed on the earlier copy when its step is duplicated", () => {
    const next = insertStep(doc, 0, doc.steps[0]);
    expect(next.steps[0]!.body[0]).toMatchObject({ text: "do", comment: " note" });
    expect(next.steps[1]!.body[0]).toMatchObject({ text: "do -- note", unterminated: true });
    expectStable(next);

    const stepOnly = parseGuide("step << Mage -- note");
    const twice = insertStep(stepOnly, 1, stepOnly.steps[0]);
    expect(twice.steps[0]!.line).toMatchObject({ comment: " note" });
    expect(twice.steps[1]!.line).toMatchObject({ unterminated: true });
    expectStable(twice);
  });

  it("gets a line ending only when the last line needs one", () => {
    const comment = insertLine(parseGuide("step\n+a"), at(0, 1), bodyLine("+b -- c"));
    expect(serializeGuide(comment)).toBe("step\n+a\n+b -- c\n");
    const empty = insertLine(parseGuide("step\n+a"), at(0, 1), bodyLine(""));
    expect(serializeGuide(empty)).toBe("step\n+a\n\n");
    const none = deleteStep(parseGuide("step\n"), 0);
    expect(serializeGuide(none)).toBe("");
    [comment, empty, none].forEach(expectStable);
  });
});

describe("edit result types", () => {
  const text: TextLine & { raw: string; text: "old" } = { kind: "text", marker: ">>", indent: "", text: "old", raw: ">>old" };
  const command: CommandLine & { raw: string; text: "Take" } = {
    kind: "command",
    indent: "",
    name: "accept",
    args: ["1"],
    text: "Take",
    raw: ".accept 1 >>Take",
  };

  it("drops the source text from an edited line and its type", () => {
    const next = edited(text);
    expect(next).toEqual({ kind: "text", marker: ">>", indent: "", text: "old" });
    expectTypeOf(next).not.toHaveProperty("raw");
    expectTypeOf(next.text).toEqualTypeOf<"old">();
  });

  it("widens the text that setText changed to the type of its kind", () => {
    const next = setText(text, "new");
    expect(next).toEqual({ kind: "text", marker: ">>", indent: "", text: "new" });
    expectTypeOf(next).not.toHaveProperty("raw");
    expectTypeOf(next.text).toEqualTypeOf<string>();
    const cleared = setText(command, undefined);
    expect(cleared).toEqual({ kind: "command", indent: "", name: "accept", args: ["1"] });
    expectTypeOf(cleared.text).toEqualTypeOf<string | undefined>();
  });

  it("types a step line that setComment changed as a step line without its source text", () => {
    const step: StepLine & { raw: string } = { kind: "step", indent: "", raw: "step" };
    const next = setComment(step, " note");
    expect(next).toEqual({ kind: "step", indent: "", comment: " note" });
    expectTypeOf(next).not.toHaveProperty("raw");
    expectTypeOf(next.kind).toEqualTypeOf<"step">();
    const cleared = setComment({ kind: "step", indent: "", comment: " old" }, undefined);
    expect(cleared).toEqual({ kind: "step", indent: "" });
    expectTypeOf(cleared.comment).toEqualTypeOf<string | undefined>();
  });

  it("drops the source text from the type of a line that setCondition changed", () => {
    const next = setCondition(command, "Alliance");
    expect(next).toEqual({ ...edited(command), condition: parseLine(".accept 1 >>Take << Alliance").condition });
    expectTypeOf(next).not.toHaveProperty("raw");
  });
});

describe("newGuideText", () => {
  it("writes a group and name in the format of the bundled guides", () => {
    expect(newGuideText("Mine", "First")).toBe("#group Mine\n#name First\nstep\n");
    expect(() => newGuideText("Test -- keep this", "First")).toThrow(GuideEditError);
  });
});
