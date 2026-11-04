import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coloredText, copyColoredText, editColoredText, unitBeside, type RxpColor, type RxpRange } from "./coloredText.ts";
import { extractGuides } from "./lua.ts";
import { parseGuide } from "./parse.ts";

const color = (source: string, range: RxpRange, to: RxpColor | null) =>
  editColoredText(coloredText(source), { kind: "color", range, color: to });
const replace = (source: string, range: RxpRange, text: string) => editColoredText(coloredText(source), { kind: "replace", range, text });
const at = (source: string, part: string, from = 0): RxpRange => {
  const start = source.indexOf(part, from);
  return [start, start + part.length];
};

describe("coloredText", () => {
  it("reads named colors, their text, and the hidden delimiters", () => {
    expect(coloredText("Kill |cRXP_ENEMY_Boars|r").pieces).toEqual([
      { kind: "text", range: [0, 5], color: null },
      { kind: "delimiter", range: [5, 17], color: "ENEMY", edge: "open", partner: 3 },
      { kind: "text", range: [17, 22], color: "ENEMY" },
      { kind: "delimiter", range: [22, 24], color: "ENEMY", edge: "close", partner: 1 },
    ]);
  });

  it("shows the outer color again after a nested color ends", () => {
    const pieces = coloredText("|cRXP_WARN_Kill |cRXP_ENEMY_Boars|r now|r").pieces;
    expect(pieces.flatMap((p) => (p.kind === "text" ? [p.color] : []))).toEqual(["WARN", "ENEMY", "WARN"]);
  });

  it("keeps hex colors, unknown names, textures, pipes, and stray ends opaque", () => {
    const source = "|cFFfa9602Hi|r |cRXP_FOO_x|r |T134414:0|t a||b|r |cRXP_LOOT_open";
    expect(coloredText(source).pieces.map((p) => [p.kind === "opaque" ? p.lexeme : p.kind, source.slice(...p.range)])).toEqual([
      ["color", "|cFFfa9602"],
      ["text", "Hi"],
      ["reset", "|r"],
      ["text", " "],
      ["color", "|cRXP_FOO_"],
      ["text", "x"],
      ["reset", "|r"],
      ["text", " "],
      ["texture", "|T134414:0|t"],
      ["text", " a"],
      ["pipe", "||"],
      ["text", "b"],
      ["reset", "|r"],
      ["text", " "],
      ["color", "|cRXP_LOOT_"],
      ["text", "open"],
    ]);
  });

  it("gives each texture its key and the arguments as written", () => {
    const source = "|T0134414:0|t |TInterface\\Icons\\INV_Misc_Rune_01.BLP:20:016|t |T0:0|t |Tinterface/icons/x|t";
    expect(coloredText(source).pieces.flatMap((p) => (p.kind === "opaque" && p.lexeme === "texture" ? [p.texture] : []))).toEqual([
      { key: "134414", args: ":0" },
      { key: "interface/icons/inv_misc_rune_01", args: ":20:016" },
      { key: undefined, args: ":0" },
      { key: "interface/icons/x", args: "" },
    ]);
  });

  it("keeps a pipe before a digit as text", () => {
    expect(coloredText("Kill 6|6 wolves").pieces).toEqual([{ kind: "text", range: [0, 15], color: null }]);
  });

  it("recolors any part of every bundled line and keeps the text, the opaque markup, and the other colors", () => {
    const dir = join(import.meta.dirname, "../../guides/rxp-forever");
    const texts = readdirSync(dir)
      .filter((f) => f.endsWith(".lua"))
      .flatMap((f) => extractGuides(readFileSync(join(dir, f), "utf8")))
      .flatMap((g) => parseGuide(g.text).steps.flatMap((s) => s.body))
      .flatMap((l) => (l.kind === "text" || (l.kind === "command" && l.text) ? [l.text!] : []));
    expect(texts).toContain("Kill |cRXP_ENEMY_Moonkin|r. Loot them for their |T132832:0|t|cRXP_LOOT_[Small Eggs]|r");
    const look = (source: string) => {
      const { pieces } = coloredText(source);
      const chars = pieces.flatMap((p) =>
        p.kind === "text" ? Array.from(source.slice(...p.range)).map((c) => [c, p.color] as const) : [],
      );
      const opaque = pieces.flatMap((p) => (p.kind === "opaque" ? [source.slice(...p.range)] : []));
      return { chars, opaque };
    };
    for (const source of texts) {
      const text = coloredText(source);
      expect(text.pieces.map((p) => source.slice(...p.range)).join(""), source).toBe(source);
      const before = look(source);
      let at = 0;
      for (const piece of text.pieces) {
        if (piece.kind !== "text") continue;
        const length = Array.from(source.slice(...piece.range)).length;
        const to = piece.color === "LOOT" ? "WARN" : "LOOT";
        const after = editColoredText(text, { kind: "color", range: piece.range, color: to }).text;
        const expected = before.chars.map(([c, was], i) => [c, i >= at && i < at + length ? to : was] as const);
        // A color end after a lone `|` would form an escaped pipe, so the edit must leave that source unchanged.
        if (source.endsWith("|", piece.range[1])) expect(after).toBe(source);
        else expect(JSON.stringify(look(after)), source).toBe(JSON.stringify({ chars: expected, opaque: before.opaque }));
        at += length;
      }
      const cleared = look(editColoredText(text, { kind: "color", range: [0, source.length], color: null }).text);
      expect(JSON.stringify(cleared), source).toBe(JSON.stringify({ chars: before.chars.map(([c]) => [c, null]), opaque: before.opaque }));
    }
  });
});

describe("editColoredText", () => {
  it("colors part of plain text", () => {
    expect(color("Kill the Boar now", [9, 13], "ENEMY")).toEqual({ text: "Kill the |cRXP_ENEMY_Boar|r now", selection: [21, 25] });
  });

  it("colors over a part that has another color", () => {
    const source = "|cRXP_ENEMY_Red Boar|r";
    expect(color(source, at(source, "Boar"), "LOOT")).toEqual({ text: "|cRXP_ENEMY_Red |r|cRXP_LOOT_Boar|r", selection: [29, 33] });
  });

  it("colors across a color boundary", () => {
    const source = "Kill |cRXP_ENEMY_Boars|r now";
    expect(color(source, [0, 22], "ENEMY")).toEqual({ text: "|cRXP_ENEMY_Kill Boars|r now", selection: [12, 22] });
  });

  it("returns the same text for the color the selection already has", () => {
    const source = "|cRXP_ENEMY_Red Boar|r";
    expect(color(source, at(source, "Boar"), "ENEMY")).toEqual({ text: source, selection: [16, 20] });
    expect(color(source, [12, 20], "ENEMY")).toEqual({ text: source, selection: [12, 20] });
  });

  it("clears a part inside a colored span", () => {
    const source = "|cRXP_ENEMY_Red Boar|r";
    expect(color(source, at(source, "Boar"), null)).toEqual({ text: "|cRXP_ENEMY_Red |rBoar", selection: [18, 22] });
  });

  it("clears the middle of a span and opens the color again after it", () => {
    const source = "|cRXP_WARN_Be aware of it|r";
    expect(color(source, at(source, "aware"), null)).toEqual({ text: "|cRXP_WARN_Be |raware|cRXP_WARN_ of it|r", selection: [16, 21] });
  });

  it("clears a whole nested span", () => {
    const source = "|cRXP_WARN_Be aware of |cRXP_ENEMY_Greymist Oracles|r'|r";
    expect(color(source, [11, 54], null)).toEqual({ text: "Be aware of Greymist Oracles'", selection: [0, 29] });
  });

  it("colors a word inside a nested color and keeps the outer colors", () => {
    const source = "|cRXP_WARN_Be aware of |cRXP_ENEMY_Greymist Oracles|r'|r";
    expect(color(source, at(source, "Greymist"), "WARN").text).toBe("|cRXP_WARN_Be aware of Greymist|cRXP_ENEMY_ Oracles|r'|r");
    expect(color(source, at(source, "aware"), "ENEMY").text).toBe("|cRXP_WARN_Be |cRXP_ENEMY_aware|r of |cRXP_ENEMY_Greymist Oracles|r'|r");
  });

  it("joins a color with the same color next to it", () => {
    const source = "|cRXP_ENEMY_Boars|r and Wolves";
    expect(color(source, at(source, " and Wolves"), "ENEMY").text).toBe("|cRXP_ENEMY_Boars and Wolves|r");
  });

  it("keeps a texture, a hex color, and an escaped pipe byte for byte", () => {
    const source = "Use |T134414:0|t[Hearthstone] in |cFFfa9602Burning Steppes|r a||b";
    expect(color(source, [0, source.length], "WARN").text).toBe(
      "|cRXP_WARN_Use |T134414:0|t[Hearthstone] in |r|cFFfa9602|cRXP_WARN_Burning Steppes|r|r|cRXP_WARN_ a||b|r",
    );
    expect(replace(source, at(source, " in"), " at").text).toBe("Use |T134414:0|t[Hearthstone] at |cFFfa9602Burning Steppes|r a||b");
    expect(replace(source, [source.length, source.length], "!").text).toBe(`${source}!`);
  });

  it("clears named colors and leaves a hex color", () => {
    const source = "x |cFF112233a |cRXP_ENEMY_b|r|r y";
    expect(color(source, [0, source.length], null)).toEqual({ text: "x |cFF112233a b|r y", selection: [0, 19] });
  });

  it("keeps a stray color end outside the new color", () => {
    expect(color("as you quest|r", [0, 14], "WARN")).toEqual({ text: "|cRXP_WARN_as you quest|r|r", selection: [11, 23] });
  });

  it("types inside a color and keeps the color end", () => {
    const source = "a|cRXP_ENEMY_bc|rde";
    expect(replace(source, [14, 18], "X")).toEqual({ text: "a|cRXP_ENEMY_bX|re", selection: [15, 15] });
  });

  it("removes a color that a deletion leaves empty", () => {
    expect(replace("x |cRXP_ENEMY_B|r y", [14, 15], "")).toEqual({ text: "x  y", selection: [2, 2] });
  });

  it("writes a typed pipe before markup as an escaped pipe", () => {
    expect(replace("a |T1:0|t", [2, 2], "|")).toEqual({ text: "a |||T1:0|t", selection: [4, 4] });
    expect(replace("|cRXP_LOOT_a|r", [12, 12], "b|")).toEqual({ text: "|cRXP_LOOT_ab|||r", selection: [15, 15] });
    expect(replace("a b", [1, 1], "|")).toEqual({ text: "a| b", selection: [2, 2] });
  });

  it("changes nothing when a color end would join a lone pipe", () => {
    const source = "Talk to |cRXP_FRIENDLY_Boarton|";
    expect(color(source, at(source, "Boarton|"), "LOOT")).toEqual({ text: source, selection: [23, 31] });
  });

  it("deletes a selected texture whole", () => {
    expect(replace("a |T134414:0|t b", [2, 14], "")).toEqual({ text: "a  b", selection: [2, 2] });
  });

  it("colors text with surrogate pairs", () => {
    expect(color("a 😀 b", [2, 4], "LOOT")).toEqual({ text: "a |cRXP_LOOT_😀|r b", selection: [13, 15] });
  });

  it.each([
    ["a range that ends before it starts", [3, 1]],
    ["a range past the end", [0, 99]],
    ["a range inside a delimiter", [3, 8]],
    ["a range inside a texture", [0, 4]],
    ["a range that splits a surrogate pair", [3, 5]],
  ] as const)("refuses %s", (_, range) => {
    expect(() => color("a |cRXP_ENEMY_😀|r |T1:0|t", range, "LOOT")).toThrow(RangeError);
  });
});

describe("copyColoredText", () => {
  const copy = (source: string, range: RxpRange) => copyColoredText(coloredText(source), range);

  it("copies a whole color with its start and end", () => {
    expect(copy("Kill |cRXP_ENEMY_Boars|r now", [5, 24])).toBe("|cRXP_ENEMY_Boars|r");
  });

  it("leaves behind a color start or end whose partner is outside the range, as a cut does", () => {
    const source = "|cRXP_ENEMY_a |r|T1:0|t[B] |cFF112233c|r";
    expect(copy(source, [14, 26])).toBe("|T1:0|t[B]");
    expect(copy(source, [12, 38])).toBe("a |T1:0|t[B] c");
    expect(replace(source, [12, 38], "").text).toBe("|cFF112233|r");
  });
});

describe("unitBeside", () => {
  const source = "x |cRXP_ENEMY_B|r|T1:0|t😀";

  it("steps past hidden delimiters to the character", () => {
    expect(unitBeside(coloredText(source), 17, "backward")).toEqual([14, 15]);
    expect(unitBeside(coloredText(source), 2, "forward")).toEqual([14, 15]);
  });

  it("takes an opaque piece whole", () => {
    expect(unitBeside(coloredText(source), 24, "backward")).toEqual([17, 24]);
    expect(unitBeside(coloredText(source), 15, "forward")).toEqual([17, 24]);
  });

  it("takes a surrogate pair whole, and nothing at the ends", () => {
    expect(unitBeside(coloredText(source), 26, "backward")).toEqual([24, 26]);
    expect(unitBeside(coloredText(source), 26, "forward")).toBeNull();
    expect(unitBeside(coloredText(source), 0, "backward")).toBeNull();
  });
});
