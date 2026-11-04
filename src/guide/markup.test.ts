import { describe, expect, it } from "vitest";
import { plainText } from "./markup.ts";

describe("plainText", () => {
  it("drops color codes and keeps the names inside them", () => {
    expect(plainText("Hunt |cRXP_ENEMY_Stonetusk Boars|r in |cFFfa9602Burning Steppes|r")).toBe("Hunt Stonetusk Boars in Burning Steppes");
  });

  it("drops an icon texture tag and keeps the item name beside it", () => {
    expect(plainText("Discard |T134414:0|t[Hearthstone] to free a bag slot")).toBe("Discard [Hearthstone] to free a bag slot");
  });

  it("drops a texture tag and a color code side by side", () => {
    expect(plainText("Gather |T133970:0|t|cRXP_LOOT_[Chunk of Boar Meat]|r")).toBe("Gather [Chunk of Boar Meat]");
  });

  it("drops a texture tag with a file path", () => {
    expect(plainText("|Tinterface/worldmap/chatbubble_64grey.blp:20|tSpeak with |cRXP_FRIENDLY_Marshal|r")).toBe("Speak with Marshal");
  });

  it("leaves the spaces around texture tags that have no name beside them", () => {
    expect(plainText("Buy |T132815:0|t and |T133971:0|t")).toBe("Buy  and ");
  });

  it.each(["Kill 6|6 wolves", "left|right", "group||route", "||cRXP_WARN_x||r", "A |Tuesday|then B", "|Tname:0|t"])(
    "keeps %j, which only looks like markup",
    (text) => {
      expect(plainText(text)).toBe(text);
    },
  );

  it("drops a color code and keeps a plain pipe later in the line", () => {
    expect(plainText("|cRXP_WARN_warn|r then left|right")).toBe("warn then left|right");
  });

  it("drops a stray color end before a space or punctuation", () => {
    expect(plainText(">>Talk to|r Doras, then quest|r")).toBe(">>Talk to Doras, then quest");
  });

  it("keeps a stray color end only before a letter or digit", () => {
    expect(plainText("a|r|r, 2|r5")).toBe("a, 2|r5");
  });
});
