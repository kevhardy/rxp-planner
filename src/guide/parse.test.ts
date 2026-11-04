import { describe, expect, it } from "vitest";
import { parseGuide, parseLine, splitArgs } from "./parse.ts";
import { serializeGuide } from "./serialize.ts";

describe("parseLine", () => {
  it("reads a step with a condition and comment", () => {
    expect(parseLine("step << !Human --note")).toMatchObject({
      kind: "step",
      condition: { text: "!Human" },
      comment: "note",
    });
  });

  it("treats any line starting with step as a step, as RXP does", () => {
    expect(parseLine("  steps").kind).toBe("step");
  });

  it("reads tags, flags, and assignments", () => {
    expect(parseLine("    #completewith next")).toMatchObject({
      kind: "tag",
      indent: "    ",
      name: "completewith",
      value: "next",
      assign: false,
    });
    expect(parseLine("#classic")).toMatchObject({ kind: "tag", name: "classic", value: "" });
    expect(parseLine("#era/som << Hunter")).toMatchObject({
      kind: "tag",
      name: "era/som",
      value: "",
      condition: { text: "Hunter" },
    });
    expect(parseLine("#next =nextGuide")).toMatchObject({ kind: "tag", value: "nextGuide", assign: true });
    expect(parseLine("#season 1 >> Rogue")).toMatchObject({ kind: "tag", value: "1 >> Rogue" });
  });

  it("reads commands with display text and condition", () => {
    expect(parseLine("    .accept 456 >> Pick up The Balance of Nature << Druid")).toMatchObject({
      kind: "command",
      name: "accept",
      args: ["456"],
      text: "Pick up The Balance of Nature",
      condition: { text: "Druid" },
    });
    expect(parseLine(".use 1972>>Use it")).toMatchObject({ name: "use", args: ["1972"], text: "Use it" });
    expect(parseLine(".disablecheckbox")).toMatchObject({ kind: "command", args: [] });
    expect(parseLine(".goto X,1,2 >>")).not.toHaveProperty("text");
  });

  it("reads text lines", () => {
    expect(parseLine("+Talk to him << Mage")).toMatchObject({ kind: "text", marker: "+", text: "Talk to him" });
    expect(parseLine("*Note\\nMore")).toMatchObject({ kind: "text", marker: "*", text: "Note\\nMore" });
    expect(parseLine(">> Kill boars")).toMatchObject({ kind: "text", marker: ">>", text: "Kill boars" });
  });

  it("reads condition, comment, blank, and other lines", () => {
    expect(parseLine("<< Alliance")).toMatchObject({ kind: "condition", condition: { text: "Alliance" } });
    expect(parseLine("--#groupid RXP")).toMatchObject({ kind: "comment", comment: "#groupid RXP" });
    expect(parseLine("   ")).toMatchObject({ kind: "blank", indent: "   " });
    expect(parseLine("just words")).toMatchObject({ kind: "other", text: "just words" });
    expect(parseLine("words >>")).toMatchObject({ kind: "other", text: "words >>" });
  });

  it("takes >> text before reading + and * lines, as RXP does", () => {
    expect(parseLine("+a >> b")).toMatchObject({ kind: "text", marker: ">>", text: "b", prefix: "+a" });
    expect(parseLine("*a>>b")).toMatchObject({ kind: "text", marker: ">>", text: "b", prefix: "*a" });
    expect(parseLine("words >> shown")).toMatchObject({ kind: "text", marker: ">>", text: "shown", prefix: "words" });
    const plus = parseLine("+a >>");
    expect(plus).toMatchObject({ kind: "text", marker: "+", text: "a" });
    expect(plus).not.toHaveProperty("prefix");
  });

  it("strips the comment before reading the condition", () => {
    expect(parseLine("step << skip --a note << Warrior")).toMatchObject({
      condition: { text: "skip" },
      comment: "a note << Warrior",
    });
  });

  it("keeps a second << in the condition text", () => {
    expect(parseLine(".goto A,1,2 << << skip")).toMatchObject({
      condition: { text: "<< skip", expr: { type: "token", value: "skip" } },
    });
  });
});

describe("splitArgs", () => {
  it("ignores inherited property names", () => {
    expect(splitArgs("constructor", "hello,world")).toEqual(["hello", "world"]);
    expect(splitArgs("toString", "hello")).toEqual(["hello"]);
    expect(parseLine(".__proto__ a;b")).toMatchObject({ name: "__proto__", args: ["a;b"] });
  });

  it("splits on commas, trimming spaces and dropping empty arguments", () => {
    expect(splitArgs("goto", "Tirisfal Glades , 32.37,64.37,")).toEqual(["Tirisfal Glades", "32.37", "64.37"]);
  });

  it("splits target, mob, and unitscan on semicolons", () => {
    expect(splitArgs("target", "Korfax, Champion of the Light")).toEqual(["Korfax, Champion of the Light"]);
    expect(splitArgs("unitscan", "Moonstalker ; Moonstalker Runt")).toEqual(["Moonstalker", "Moonstalker Runt"]);
    expect(splitArgs("mob", "+Scorpashi Snapper;Scorpashi Lasher")).toEqual(["+Scorpashi Snapper", "Scorpashi Lasher"]);
  });

  it("keeps link and clicknext text whole", () => {
    expect(splitArgs("link", "https://a.example/x?a=1,b=2  ")).toEqual(["https://a.example/x?a=1,b=2"]);
    expect(splitArgs("link", "")).toEqual([]);
    expect(splitArgs("clicknext", "Group\\Guide, part 2")).toEqual(["Group\\Guide, part 2"]);
  });
});

describe("parseGuide", () => {
  const text = "#classic\r\n#name Test\r\n<< Alliance\r\n\r\nstep\r\n    .accept 1\r\nstep << Mage\r\n    +Go\r\n";

  it("splits the header from steps", () => {
    const doc = parseGuide(text);
    expect(doc.header.map((l) => l.kind)).toEqual(["tag", "tag", "condition", "blank"]);
    expect(doc.steps).toHaveLength(2);
    expect(doc.steps[1]!.line.condition?.text).toBe("Mage");
    expect(doc.steps[1]!.body).toMatchObject([{ kind: "text", text: "Go" }]);
    expect(doc).toMatchObject({ eol: "\r\n", finalNewline: true });
  });

  it("keeps -- on a final line with no line ending, as RXP does", () => {
    const open = parseGuide("step\n.accept 1 >> do -- note");
    expect(open.steps[0]!.body[0]).toMatchObject({ text: "do -- note", unterminated: true });
    expect(open.steps[0]!.body[0]).not.toHaveProperty("comment");
    const closed = parseGuide("step\n.accept 1 >> do -- note\n");
    expect(closed.steps[0]!.body[0]).toMatchObject({ text: "do", comment: " note" });
    expect(closed.steps[0]!.body[0]).not.toHaveProperty("unterminated");
    expect(parseGuide("step -- a\n+b").steps[0]!.line).toMatchObject({ comment: " a" });
    expect(serializeGuide(open)).toBe("step\n.accept 1 >> do -- note");
  });

  it("serializes exactly, with or without a final newline", () => {
    expect(serializeGuide(parseGuide(text))).toBe(text);
    expect(serializeGuide(parseGuide("#name A\nstep"))).toBe("#name A\nstep");
    expect(serializeGuide(parseGuide(""))).toBe("");
    expect(serializeGuide(parseGuide("\n\n"))).toBe("\n\n");
  });
});
