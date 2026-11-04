import { describe, expect, it } from "vitest";
import { parseGuide } from "../guide/index.ts";
import { lineQuest } from "./lineQuest.ts";

const read = (text: string) => lineQuest(parseGuide(`#group T\n#name One\nstep\n    ${text}\n`).steps[0]!.body[0]!);

describe("lineQuest", () => {
  it("reads a positive ID as a quest the line needs", () => {
    expect(read(".accept 176")).toEqual({ questId: 176, skipIfMissing: false });
  });

  it("reads a negative .turnin or .complete ID as its quest, skipped while missing", () => {
    expect(read(".turnin -94774 >> Turn in Divine Grace")).toEqual({ questId: 94774, skipIfMissing: true });
    expect(read(".complete -176,1")).toEqual({ questId: 176, skipIfMissing: true });
  });

  it("names no quest for a negative .accept ID", () => {
    expect(read(".accept -176")).toBeUndefined();
  });

  // `tonumber` reads Lua numerals and space around them, but not JavaScript's binary prefix.
  it("reads the ID as Lua's tonumber does", () => {
    expect(read(".turnin 0xB0")).toEqual({ questId: 176, skipIfMissing: false });
    expect(read(".turnin 176.0")).toEqual({ questId: 176, skipIfMissing: false });
    expect(read(".turnin 0b10110000")).toBeUndefined();
  });

  it("names no quest for an ID no quest can have", () => {
    expect(read(".accept 0")).toBeUndefined();
    expect(read(".accept 1.5")).toBeUndefined();
    expect(read(".accept")).toBeUndefined();
  });

  it("names no quest for another command", () => {
    expect(read(".abandon 176")).toBeUndefined();
  });
});
