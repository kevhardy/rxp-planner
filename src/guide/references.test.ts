import { describe, expect, it } from "vitest";
import { ENTITY_TYPES } from "../data/entities.ts";
import { setText, updateLine } from "./edit.ts";
import { parseGuide } from "./parse.ts";
import {
  argumentEntities,
  argumentIdSlot,
  commandEntities,
  findEntityReferences,
  formatEntityReference,
  hasEntityArguments,
  insertEntityReference,
  parseEntityReference,
  type EntityReference,
} from "./references.ts";
import { serializeGuide } from "./serialize.ts";

const hearth: EntityReference = { type: "item", id: 6948, label: "Hearthstone" };

describe("plain entity references", () => {
  it.each(ENTITY_TYPES)("retains %s identity through changed-line serialization and reimport", (type) => {
    const ref = { type, id: 6948, label: "<Unused> Name (with parentheses): O'Brien & Co., #2" };
    const notation = formatEntityReference(ref);
    expect(parseEntityReference(notation)).toEqual(ref);
    const source = "#name Test\r\nstep\r\n    .vendor 196 >>Old\r\n    .unknown  x  -- keep  \r\n";
    const doc = parseGuide(source);
    const changed = updateLine(doc, { step: 0, index: 0 }, (line) => {
      if (line.kind !== "command") throw new Error("Expected command");
      return setText(line, notation);
    });
    expect(changed.steps[0]!.body[0]!.raw).toBeUndefined();
    const serialized = serializeGuide(changed);
    expect(serialized).toContain("    .unknown  x  -- keep  \r\n");
    const line = parseGuide(serialized).steps[0]!.body[0]!;
    expect(line.kind === "command" && parseEntityReference(line.text!)).toEqual(ref);
    expect(serializeGuide(doc)).toBe(source);
  });

  it("replaces only the selected UTF-16 range and returns the caret", () => {
    const text = "Use 🧙 this now.";
    const start = text.indexOf("this");
    const result = insertEntityReference(text, start, start + 4, hearth);
    expect(result).toEqual({ text: "Use 🧙 Hearthstone (item #6948) now.", caret: start + 24 });
    expect(insertEntityReference("", 0, 0, hearth).text).toBe("Hearthstone (item #6948)");
    for (const [from, to] of [
      [-1, 0],
      [2, 1],
      [0, 100],
      [0.5, 1],
      [NaN, 1],
    ]) {
      expect(() => insertEntityReference(text, from!, to!, hearth)).toThrow(RangeError);
    }
  });

  it("recognizes only explicit NPC IDs in existing notation", () => {
    const npc = { type: "npc", id: 196, label: "Eagan Peltskinner" };
    for (const text of [
      "npc:Eagan Peltskinner:196",
      "|cRXP_FRIENDLY_npc:Eagan Peltskinner:196|r",
      "|cRXP_FRIENDLY_Eagan Peltskinner::196|r",
      "|cRXP_ENEMY_Eagan Peltskinner::196|r",
      "|cFF00FF00Eagan Peltskinner::196|r",
    ]) {
      expect(parseEntityReference(text)).toEqual(npc);
    }
    for (const text of [
      "Eagan Peltskinner::196",
      "|cRXP_FRIENDLY_Eagan Peltskinner|r",
      "|T6948:0|tHearthstone",
      "npc:Name:0",
      "npc:Name:12junk",
    ]) {
      expect(parseEntityReference(text)).toBeUndefined();
    }
  });

  it("rejects malformed identity, controls, and RXP syntax without sanitizing labels", () => {
    for (const text of [
      "Name (item #1)\n",
      "npc:Name:1\n",
      "Name\u2028New (item #1)",
      "Name (pet #1)",
      "Name (item #-1)",
      "Name (item #0)",
      "Name (item #1.5)",
      "Name (item #01)",
      "Name (item #9007199254740992)",
      "Name (item #12junk)",
      "Name\nNew (item #1)",
      "|cRXP_LOOT_Name|r (item #1)",
      "Name--rest (item #1)",
      "Name << Mage (item #1)",
      "Name (quest #2) (item #1)",
    ]) {
      expect(parseEntityReference(text)).toBeUndefined();
    }
    for (const label of ["", " padded", "Name\nNew", "Name--rest", "Name |r", "Name >>Other"]) {
      expect(() => formatEntityReference({ ...hearth, label })).toThrow("Invalid entity reference");
    }
    for (const id of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatEntityReference({ ...hearth, id })).toThrow("Invalid entity reference");
    }
    expect(parseEntityReference("Unknown (item #9007199254740991)")?.id).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("reference scanning", () => {
  it("finds markers after insertion in prose without guessing labels", () => {
    const inserted = insertEntityReference("Use this now.", 4, 8, hearth);
    expect(findEntityReferences(inserted.text)).toEqual([{ type: "item", id: 6948, start: 16, end: 28 }]);
    const text = "🧙 Talk to Eagan (npc #196), then use Hearthstone (item #6948) now.";
    expect(findEntityReferences(text)).toEqual([
      { type: "npc", id: 196, start: text.indexOf("(npc"), end: text.indexOf("(npc") + 10 },
      { type: "item", id: 6948, start: text.indexOf("(item"), end: text.indexOf("(item") + 12 },
    ]);
    expect(findEntityReferences(text).map((span) => text.slice(span.start, span.end))).toEqual(["(npc #196)", "(item #6948)"]);
    expect(parseEntityReference("Use Hearthstone (item #6948)")?.label).toBe("Use Hearthstone");
    expect(findEntityReferences("|cRXP_LOOT_Hearthstone (item #6948)|r")[0]?.type).toBe("item");
  });

  it("rejects malformed markers while preserving unresolved positive IDs", () => {
    for (const id of ["0", "-1", "+1", "01", "1.5", "1e3", "12junk", "9007199254740992", "", " 1"]) {
      expect(findEntityReferences(`Name (item #${id}) now.`)).toEqual([]);
      expect(findEntityReferences(`Talk to npc:Name:${id} now.`)).toEqual([]);
    }
    expect(findEntityReferences("Unknown (pet #1) or (ITEM #2) now.")).toEqual([]);
    expect(findEntityReferences("Unknown (object #9007199254740991)")).toEqual([
      { type: "object", id: Number.MAX_SAFE_INTEGER, start: 8, end: 34 },
    ]);
    for (const type of ENTITY_TYPES) expect(findEntityReferences(`Name (${type} #1)`)[0]?.type).toBe(type);
  });

  it("follows RXP explicit NPC syntax regardless of color meaning", () => {
    // RXP's `addon.ReplaceNpcIds` in functions.lua accepts hex colors, and `addon.DrawArrow` in map.lua converts every
    // RXP_[A-Z]+_ color, including unknown colors, to hex.
    for (const color of ["RXP_LOOT_", "RXP_CUSTOM_", "1234ABcd"]) {
      const token = `|c${color}Hearthstone::6948|r`;
      expect(parseEntityReference(token)).toEqual({ type: "npc", id: 6948, label: "Hearthstone" });
      expect(findEntityReferences(`Before ${token} after.`)).toEqual([{ type: "npc", id: 6948, start: 7, end: 7 + token.length }]);
    }
    const token = "npc:Name:With:Colons:196";
    expect(parseEntityReference(token)).toEqual({ type: "npc", id: 196, label: "Name:With:Colons" });
    expect(findEntityReferences(`Talk to ${token}. Use Hearthstone (item #6948).`).map((s) => [s.type, s.id])).toEqual([
      ["npc", 196],
      ["item", 6948],
    ]);
    expect(findEntityReferences("|cRXP_FRIENDLY_Talk to npc:Name:196|r")[0]?.id).toBe(196);
    expect(findEntityReferences("Name::196 |T6948:0|t |Tnpc:Name:196|t |cRXP_LOOT_Name|r")).toEqual([]);
  });

  it("follows the two passes of RXP's ReplaceNpcIds", () => {
    // `addon.ReplaceNpcIds` is in RXP's functions.lua.
    expect(findEntityReferences("Talk to npc: Foo:3")).toEqual([{ type: "npc", id: 3, start: 8, end: 18 }]);
    expect(parseEntityReference("npc: Foo :3")).toEqual({ type: "npc", id: 3, label: " Foo " });
    expect(parseEntityReference("|cRXP_FRIENDLY_ Bob ::197|r")).toEqual({ type: "npc", id: 197, label: " Bob " });
    expect(findEntityReferences("npc: :3")).toEqual([]);
    // The first pass puts names in place of npc:Name:ID, so the second pass reads the whole colored text as `Name::ID`.
    const text = "|cRXP_FRIENDLY_Talk to npc:Name:196 and Bob::197|r";
    expect(parseEntityReference(text)).toEqual({ type: "npc", id: 197, label: "Talk to Name and Bob" });
    expect(findEntityReferences(text)).toEqual([
      { type: "npc", id: 197, start: 0, end: 50 },
      { type: "npc", id: 196, start: 23, end: 35 },
    ]);
    expect(findEntityReferences("|cRXP_FRIENDLY_npc:Name:196|r")).toEqual([{ type: "npc", id: 196, start: 0, end: 29 }]);
    // The second pass reads only colored text.
    expect(findEntityReferences("npc:Name:196 and Bob::197")).toEqual([{ type: "npc", id: 196, start: 0, end: 12 }]);
  });

  it("keeps angle brackets as plain label text through editing and serialization", () => {
    for (const label of ["<UNUSED> NPC", "<img src=x onerror=alert(1)>"]) {
      const ref = { type: "npc", id: 15349, label } as const;
      const text = formatEntityReference(ref);
      expect(parseEntityReference(text)).toEqual(ref);
      const doc = parseGuide("step\n>>Old\n");
      const changed = updateLine(doc, { step: 0, index: 0 }, (line) => {
        if (line.kind !== "text") throw new Error("Expected text");
        return setText(line, text);
      });
      expect(serializeGuide(changed)).toBe(`step\n>>${text}\n`);
    }
  });
});

describe("command argument entities", () => {
  const at = (command: string, args: string, index: number) => argumentEntities(command, args.split(","), index);

  it("reads IDs by argument kind, including the optional turn-in quest", () => {
    expect(at("accept", "5,0x2,77", 0)).toEqual([{ type: "quest", id: 5 }]);
    expect(at("accept", "5,0x2,77", 1)).toEqual([]);
    expect(at("accept", "5,0x2,77", 2)).toEqual([{ type: "quest", id: 77 }]);
    expect(at("vendor", "196", 0)).toEqual([{ type: "npc", id: 196 }]);
    expect(at("destroy", "6948", 0)).toEqual([{ type: "item", id: 6948 }]);
    expect(at("train", "133,0x1", 0)).toEqual([{ type: "spell", id: 133 }]);
    expect(at("emote", "KNEEL,208309", 1)).toEqual([{ type: "npc", id: 208309 }]);
    expect(at("goto", "Elwynn Forest,49,38", 1)).toEqual([]);
    expect(at("buy", "159,5,783,1", 0)).toEqual([{ type: "item", id: 159 }]);
    expect(at("buy", "159,5,783,1", 2)).toEqual([{ type: "quest", id: 783 }]);
    expect(at("daily", "100,101", 1)).toEqual([{ type: "quest", id: 101 }]);
  });

  it("reads the ID inside argument syntax without taking flags, names, or indexes as IDs", () => {
    expect(at("turnin", "-33", 0)).toEqual([{ type: "quest", id: 33 }]);
    expect(at("complete", "-33,1", 0)).toEqual([{ type: "quest", id: 33 }]);
    expect(at("complete", "-33,1", 1)).toEqual([]);
    expect(at("accept", "-33", 0)).toEqual([]);
    // Quest IDs read with Lua's `tonumber`, which takes a `+` sign and hexadecimal.
    expect(at("accept", "+33", 0)).toEqual([{ type: "quest", id: 33 }]);
    expect(at("abandon", "0x21", 0)).toEqual([{ type: "quest", id: 33 }]);
    expect(at("turnin", "-0x21", 0)).toEqual([{ type: "quest", id: 33 }]);
    expect(at("complete", "+33,1", 0)).toEqual([{ type: "quest", id: 33 }]);
    expect(at("abandon", "-33", 0)).toEqual([]);
    expect(at("aura", "-9991", 0)).toEqual([{ type: "spell", id: 9991 }]);
    expect(at("use", "6948:p", 0)).toEqual([{ type: "item", id: 6948 }]);
    expect(at("usespell", "133:p", 0)).toEqual([{ type: "spell", id: 133 }]);
    expect(at("target", "+196", 0)).toEqual([{ type: "npc", id: 196 }]);
    expect(at("target", "Marshal Dughan::240", 0)).toEqual([{ type: "npc", id: 240 }]);
    expect(argumentEntities("target", ["Name: With Colon::240"], 0)).toEqual([{ type: "npc", id: 240 }]);
    expect(at("target", "Brother Danil", 0)).toEqual([]);
    // Only unit lists read `Name::id`; other handlers read a number, which may have a sign or leading zeros.
    for (const command of ["vendor", "trainer", "stable", "tame", "skipgossip"]) {
      expect(at(command, "Old Name::196", 0)).toEqual([]);
      expect(at(command, "+196", 0)).toEqual([{ type: "npc", id: 196 }]);
    }
    expect(at("emote", "KNEEL,Old Name::196", 1)).toEqual([]);
    expect(at("vendor", "0196", 0)).toEqual([{ type: "npc", id: 196 }]);
    expect(argumentEntities("mob", ["Young Wolf", "Old Name::196", "+197"], 1)).toEqual([{ type: "npc", id: 196 }]);
    expect(argumentEntities("unitscan", ["+Old Name::196"], 0)).toEqual([{ type: "npc", id: 196 }]);
    expect(at("bankdeposit", "Linen Cloth", 0)).toEqual([]);
    expect(at("cast", "player", 0)).toEqual([]);
  });

  it("follows RXP's multi-ID items, gossip options, and cooldown types", () => {
    expect(at("collect", "123/456,3,418", 0)).toEqual([
      { type: "item", id: 123 },
      { type: "item", id: 456 },
    ]);
    expect(at("collect", "123/456,3,418", 2)).toEqual([{ type: "quest", id: 418 }]);
    expect(at("itemcount", "4471;4470,1", 0)).toEqual([
      { type: "item", id: 4471 },
      { type: "item", id: 4470 },
    ]);
    // Alone, 1 to 9 is an option index; 0 means any NPC.
    for (const index of ["3", "03", "+3", "9"]) expect(at("skipgossip", index, 0)).toEqual([]);
    expect(at("skipgossip", "10", 0)).toEqual([{ type: "npc", id: 10 }]);
    expect(at("skipgossip", "11866", 0)).toEqual([{ type: "npc", id: 11866 }]);
    expect(at("skipgossip", "0,1", 0)).toEqual([]);
    expect(at("skipgossip", "5570,2,1", 0)).toEqual([{ type: "npc", id: 5570 }]);
    expect(at("skipgossip", "5570,2,1", 1)).toEqual([]);
    expect(at("skipgossipid", "123456", 0)).toEqual([]);
    expect(at("cooldown", "item,6948,<0", 1)).toEqual([{ type: "item", id: 6948 }]);
    expect(at("cooldown", "spell,133,<0", 1)).toEqual([{ type: "spell", id: 133 }]);
    expect(at("cooldown", "action,5,<0", 1)).toEqual([]);
  });

  it("rejects sentinel, unsafe, and malformed IDs and unknown commands", () => {
    expect(at("accept", "0", 0)).toEqual([]);
    expect(at("accept", "9007199254740993", 0)).toEqual([]);
    expect(at("accept", "12a", 0)).toEqual([]);
    expect(at("turnin", "--33", 0)).toEqual([]);
    expect(at("nosuchcommand", "6948", 0)).toEqual([]);
    expect(commandEntities("collect", ["0/6948", "2", "0"])).toEqual([{ type: "item", id: 6948, arg: 0 }]);
  });
});

describe("command argument ID slots", () => {
  const slot = (command: string, args: string, index: number, caret?: number) => {
    const value = args.split(",");
    const found = argumentIdSlot(command, value, index, caret);
    return found && [found.type, value[index]!.slice(found.start, found.end)];
  };

  it("finds the ID part inside signs, parent markers, names, and suffixes", () => {
    expect(slot("turnin", "-wolves", 0)).toEqual(["quest", "wolves"]);
    expect(slot("complete", "-33,1", 0)).toEqual(["quest", "33"]);
    // Of the quest commands, only .complete and .turnin read a sign.
    expect(slot("accept", "-33", 0)).toEqual(["quest", "-33"]);
    expect(slot("aura", "-133", 0)).toEqual(["spell", "133"]);
    expect(slot("target", "196,+Old Name::240", 1)).toEqual(["npc", "240"]);
    expect(slot("target", "+eagan", 0)).toEqual(["npc", "eagan"]);
    expect(slot("vendor", "+196", 0)).toEqual(["npc", "196"]);
    expect(slot("vendor", "Old::196", 0)).toEqual(["npc", "Old::196"]);
    expect(slot("use", "6948:p", 0)).toEqual(["item", "6948"]);
    expect(slot("usespell", "fire:p", 0)).toEqual(["spell", "fire"]);
    expect(slot("cooldown", "item,6948,<0", 1)).toEqual(["item", "6948"]);
    expect(slot("cooldown", "spell,133,<0", 1)).toEqual(["spell", "133"]);
  });

  it("takes the part at the caret in multi-ID items and refuses parts with several IDs", () => {
    expect(slot("collect", "6948/lin,3", 0)).toEqual(["item", "lin"]);
    expect(slot("collect", "6948/lin,3", 0, 2)).toEqual(["item", "6948"]);
    expect(slot("collect", "6948/lin,3", 0, 5)).toEqual(["item", "lin"]);
    expect(slot("itemcount", "4471;4470,1", 0)).toBeUndefined();
    expect(slot("collect", "6948,3,33", 2)).toEqual(["quest", "33"]);
  });

  it("has none for gossip options, other arguments, and unknown commands", () => {
    expect(slot("skipgossip", "3", 0)).toBeUndefined();
    expect(slot("skipgossip", "+03", 0)).toBeUndefined();
    expect(slot("skipgossip", "3,1", 0)).toEqual(["npc", "3"]);
    expect(slot("skipgossip", "5570,2", 1)).toBeUndefined();
    expect(slot("cooldown", "action,5,<0", 1)).toBeUndefined();
    expect(slot("goto", "Elwynn Forest,49,38", 0)).toBeUndefined();
    expect(slot("nosuchcommand", "6948", 0)).toBeUndefined();
  });

  it("knows which commands have ID arguments", () => {
    for (const command of ["accept", "use", "collect", "cast", "target", "cooldown", "useitem"]) {
      expect(hasEntityArguments(command)).toBe(true);
    }
    for (const command of ["goto", "fp", "xp", "nosuchcommand"]) expect(hasEntityArguments(command)).toBe(false);
  });
});
