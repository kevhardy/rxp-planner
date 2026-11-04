import { describe, expect, it } from "vitest";
import { extractGuides, LuaExtractError } from "./lua.ts";

describe("extractGuides", () => {
  it("reads a one-string call and skips the newline after [[", () => {
    const source = "local x = 1\r\nRXPGuides.RegisterGuide([[\r\n#name A\r\nstep\r\n]])\r\n";
    const [guide] = extractGuides(source);
    expect(guide).toMatchObject({ text: "#name A\r\nstep\r\n", line: 3 });
    expect(source.slice(guide!.start, guide!.end)).toBe(guide!.text);
  });

  it("reads group plus text, and defaultFor", () => {
    expect(extractGuides('RXPGuides.RegisterGuide("My Group", [[#name A]], "Human")')).toMatchObject([
      { group: "My Group", text: "#name A", defaultFor: "Human" },
    ]);
  });

  it("reads long brackets of any level", () => {
    const [guide] = extractGuides("RegisterGuide([==[\n#name A\n.link x ]] y\n]==])");
    expect(guide!.text).toBe("#name A\n.link x ]] y\n");
  });

  it("reads long brackets past level 62", () => {
    for (const level of [63, 64, 200]) {
      const eq = "=".repeat(level);
      const source = `RegisterGuide([${eq}[#name A]]]${eq.slice(1)}]]${eq}])\n--[${eq}[ RegisterGuide([[#name B]]) ]${eq}]`;
      expect(extractGuides(source).map((g) => g.text)).toEqual([`#name A]]]${eq.slice(1)}]`]);
    }
  });

  it("reads call forms without parentheses", () => {
    expect(extractGuides("RXPGuides.RegisterGuide[[#name A]]\nRXPGuides.RegisterGuide'#name B'")).toMatchObject([
      { text: "#name A" },
      { text: "#name B" },
    ]);
  });

  it("decodes quoted strings", () => {
    expect(extractGuides('RegisterGuide("#name A\\nstep\\t\\"x\\"\\65")')[0]!.text).toBe('#name A\nstep\t"x"A');
  });

  it("ignores calls in comments and strings, and non-calls", () => {
    const source = [
      "--RXPGuides.RegisterGuide([[#name A]])",
      "--[==[ RXPGuides.RegisterGuide([[#name B]]) ]==]",
      'local s = "RegisterGuide([[#name C]])"',
      "local f = RXPGuides.RegisterGuide",
      "RXPGuides.RegisterGuide([[#name D]])",
    ].join("\n");
    expect(extractGuides(source).map((g) => g.text)).toEqual(["#name D"]);
  });

  it("reports calls it cannot read", () => {
    expect(() => extractGuides("\nRXPGuides.RegisterGuide(text)")).toThrow(LuaExtractError);
    expect(() => extractGuides("RXPGuides.RegisterGuide([[#name A]]")).toThrow(/line 1/);
  });
});
