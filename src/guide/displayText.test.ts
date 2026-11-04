import { describe, expect, it } from "vitest";
import { textureKey } from "../../packages/data-contract/guideIcons.ts";
import { guideText, guideTextPlain, textureSize } from "./displayText.ts";
import { plainText } from "./markup.ts";

const icon = (key: string) => ({ texture: { key: textureKey(key), args: ":0" }, written: key });

describe("guideText", () => {
  const names: Record<string, string> = { "item:6948": "Hearthstone", "npc:196": "Eagan Peltskinner" };
  const name = (type: string, id: number) => names[`${type}:${id}`];

  it("splits out each embedded reference in ordinary text and NPC markup", () => {
    const text = "Use Hearthstone (item #6948), sell to |cRXP_FRIENDLY_Eagan::196|r, npc:Old Name:240. Then (spell #133)";
    expect(guideText(text, name)).toEqual([
      "Use ",
      { type: "item", id: 6948, text: "Hearthstone (item #6948)" },
      ", sell to ",
      { type: "npc", id: 196, text: "Eagan Peltskinner" },
      ", ",
      // The index lacks this NPC, so the part keeps the name written in the guide, as RXP shows it.
      { type: "npc", id: 240, text: "Old Name" },
      ". Then ",
      { type: "spell", id: 133, text: "(spell #133)" },
    ]);
  });

  it("shows a colored Name::ID in place of the NPC references inside it, as RXP does", () => {
    const text = "Talk to npc: Foo:3, then |cRXP_FRIENDLY_Talk to npc:Eagan:196 and Bob::197|r";
    expect(guideText(text, (type, id) => (id === 197 ? "Marshal McBride" : name(type, id)))).toEqual([
      "Talk to ",
      { type: "npc", id: 3, text: " Foo" },
      ", then ",
      { type: "npc", id: 197, text: "Marshal McBride" },
    ]);
  });

  it("shows the colored NPC's written text with the inner NPC names that RXP resolves", () => {
    expect(guideText("|cffffffffTalk to npc:Eagan:196 and Bob::987654321|r", name)).toEqual([
      { type: "npc", id: 987654321, text: "Talk to Eagan Peltskinner and Bob" },
    ]);
  });

  it("keeps the spaces of a written NPC name, as RXP does", () => {
    expect(guideText("Talk to npc: Foo:987654321 now", name)).toEqual(["Talk to ", { type: "npc", id: 987654321, text: " Foo" }, " now"]);
    expect(guideText("Ask |cRXP_FRIENDLY_ Bob ::987654321|r", name)).toEqual(["Ask ", { type: "npc", id: 987654321, text: " Bob " }]);
  });

  it("takes in a label only when it is the indexed name", () => {
    expect(guideText("Use the stone (item #6948)", name)).toEqual(["Use the stone ", { type: "item", id: 6948, text: "(item #6948)" }]);
    expect(guideText("|cRXP_LOOT_Hearthstone|r (item #6948)", name)).toEqual([
      { type: "item", id: 6948, text: "Hearthstone (item #6948)" },
    ]);
    expect(guideText("Hearthstone (item #6948)", () => undefined)).toEqual([
      "Hearthstone ",
      { type: "item", id: 6948, text: "(item #6948)" },
    ]);
  });

  it("never takes colored names, textures, or malformed markers as references", () => {
    const text = "Loot |cRXP_LOOT_Hearthstone|r and |T134414:0|t[Hearthstone] (item #0) (thing #5) (item #12a)";
    expect(guideText(text, name)).toEqual(["Loot Hearthstone and ", icon("134414"), "[Hearthstone] (item #0) (thing #5) (item #12a)"]);
  });

  it("keeps each texture as a part, with its key as written and its exact arguments", () => {
    const text = "|cRXP_WARN_|TInterface/Icons/INV_Knife.blp:020|t Use|r |T0:0|t(item #6948)|T134414|t";
    expect(guideText(text, name)).toEqual([
      { texture: { key: textureKey("interface/icons/inv_knife"), args: ":020" }, written: "Interface/Icons/INV_Knife.blp" },
      " Use ",
      { texture: { key: undefined, args: ":0" }, written: "0" },
      { type: "item", id: 6948, text: "(item #6948)" },
      { texture: { key: textureKey("134414"), args: "" }, written: "134414" },
    ]);
    expect(guideTextPlain(guideText(text, name))).toBe(" Use (item #6948)");
  });

  it("leaves references as written text without names", () => {
    const text = "Talk to |cRXP_FRIENDLY_npc:Bob:240|r |T134414:0|t";
    expect(guideText(text)).toEqual(["Talk to npc:Bob:240 ", icon("134414")]);
    expect(guideTextPlain(guideText(text))).toBe(plainText(text));
  });

  it("strips markup around references as plainText does", () => {
    const text = "|cRXP_WARN_Use (item #6948)|rnow |cFF00FF00Eagan::196|r left|right";
    expect(guideText(text, name)).toEqual([
      "Use ",
      { type: "item", id: 6948, text: "(item #6948)" },
      "now ",
      { type: "npc", id: 196, text: "Eagan Peltskinner" },
      " left|right",
    ]);
  });
});

describe("guideText with colors", () => {
  const name = (type: string, id: number) => (type === "npc" && id === 196 ? "Eagan Peltskinner" : undefined);

  it("gives each named color its run, nested colors the innermost, and a reference the color it starts in", () => {
    const text = "|cRXP_WARN_Talk to |cRXP_FRIENDLY_Eagan::196|r now|r, then |T134414:0|t|cRXP_LOOT_[Hearthstone]|r";
    expect(guideText(text, name, { colors: true })).toEqual([
      { text: "Talk to ", color: "WARN" },
      { type: "npc", id: 196, text: "Eagan Peltskinner", color: "FRIENDLY" },
      { text: " now", color: "WARN" },
      ", then ",
      icon("134414"),
      { text: "[Hearthstone]", color: "LOOT" },
    ]);
  });

  it("shows a hex color, an unclosed named start, and plain text with no color", () => {
    const text = "|cRXP_ENEMY_Kill |cff00ff00 these|r boars|r and |cRXP_LOOT_more";
    expect(guideText(text, undefined, { colors: true })).toEqual([
      { text: "Kill ", color: "ENEMY" },
      " these",
      { text: " boars", color: "ENEMY" },
      " and more",
    ]);
    expect(guideText(text)).toEqual(["Kill  these boars and more"]);
  });
});

describe("textureSize", () => {
  it("draws at the text height for 0 or no size, at the height in pixels, and at a positive width", () => {
    expect(["", ":0", ":20", ":16:0", ":0:24", ":16:24:2:-3", ":-5"].map(textureSize)).toEqual([
      { width: 0, height: 0 },
      { width: 0, height: 0 },
      { width: 20, height: 20 },
      { width: 16, height: 16 },
      { width: 24, height: 0 },
      { width: 24, height: 16 },
      { width: 0, height: 0 },
    ]);
  });

  it("does not size a texture that crops its file", () => {
    expect(textureSize(":16:16:0:0:64:64:0:32:0:32")).toBeUndefined();
  });
});
