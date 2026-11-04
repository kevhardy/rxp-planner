import { describe, expect, it } from "vitest";
import { coloredText } from "./coloredText.ts";
import { parseGuide } from "./parse.ts";
import { guideTextures, shownTexts, textureAt, textureNames, writeTexture } from "./textures.ts";

describe("guideTextures", () => {
  it("collects the shown escapes and the macro icons, and skips comments", () => {
    const guide = parseGuide(
      [
        "#name |T134414:0|t Test",
        "step",
        "    >>Talk to |Tinterface/worldmap/chatbubble_64grey.blp:20|t Gazlowe",
        "    .goto Durotar,50,50 >>Use |T0134414:16|t[Hearthstone] -- |T2576094:0|t in a comment",
        "    .macro Sit,134400 >>/sit",
        "    .macro Walk on Air, 132845 >>/cancelaura Walk on Air",
        "    .macro Named,INV_Misc_QuestionMark >>/sit",
        "    -- >>Loot |T132801:0|t[Salve]",
        "    +Wave |TInterface/WorldMap/ChatBubble_64Grey:20|t and |T0:0|t",
      ].join("\n"),
    );
    const textures = guideTextures(guide);
    expect(textures.keys).toEqual(["132845", "134400", "134414", "interface/worldmap/chatbubble_64grey"]);
    expect(textures.invalidKeys).toEqual(["0"]);
    expect(Object.fromEntries(textures.uses)).toEqual({
      "132845": { escapes: 0, macros: 1 },
      "134400": { escapes: 0, macros: 1 },
      "134414": { escapes: 2, macros: 0 },
      "interface/worldmap/chatbubble_64grey": { escapes: 2, macros: 0 },
    });
  });
});

describe("textureNames", () => {
  const text = [
    "#name Names",
    "step",
    "    >>Use |T134414:0|t[ Hearthstone ]",
    "    .collect 1 >>Loot |cRXP_LOOT_|T133970:0|t[Stringy Meat]|r and |T133970:0|t|cRXP_LOOT_[Chunk of Boar Meat]|r",
    "    +Buy |T133964:0|t [Bread] and |T133964:0|t|cRXP_BUY_Bread|r and |T133970:0|t[Stringy Meat]",
    "    -- >>Use |T134400:0|t[Commented]",
    "",
  ].join("\n");

  it("reads the bracketed name right after each texture, through hidden colors, and skips comments", () => {
    const expected = { "134414": ["Hearthstone"], "133970": ["Stringy Meat", "Chunk of Boar Meat"] };
    expect(Object.fromEntries(textureNames(shownTexts(text)))).toEqual(expected);
    expect(Object.fromEntries(textureNames(shownTexts(parseGuide(text))))).toEqual(expected);
  });
});

describe("writeTexture", () => {
  const text = coloredText("Talk to |cRXP_FRIENDLY_|TInterface/WorldMap/ChatBubble_64Grey.blp:020:16|t Gazlowe|r");
  const bubble = textureAt(text, [23, 23 + "|TInterface/WorldMap/ChatBubble_64Grey.blp:020:16|t".length])!;

  it("changes only the key of a texture and keeps its arguments byte for byte", () => {
    expect(writeTexture(text, bubble, 134414)).toEqual({
      text: "Talk to |cRXP_FRIENDLY_|T134414:020:16|t Gazlowe|r",
      selection: [40, 40],
    });
  });

  it("finds the texture that the caret follows or the selection holds, and nothing else", () => {
    expect(textureAt(text, [bubble.range[1], bubble.range[1]])).toBe(bubble);
    expect(textureAt(text, [bubble.range[0], bubble.range[0]])).toBeUndefined();
    expect(textureAt(text, [0, bubble.range[1]])).toBeUndefined();
  });

  it("inserts an icon at the text height", () => {
    expect(writeTexture(coloredText("Use  now"), [4, 4], 7792229)).toEqual({ text: "Use |T7792229:0|t now", selection: [17, 17] });
  });
});
