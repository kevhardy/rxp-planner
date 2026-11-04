import { describe, expect, it } from "vitest";
import { MAX_LEVEL, readGameRules } from "./gameRules.ts";

describe("readGameRules", () => {
  const rules = readGameRules({
    races: {
      "1": { fileName: "Human", faction: "Alliance", maskBit: 0, startingFlightNodes: [2] },
      "2": { fileName: "Orc", faction: "Horde", maskBit: 1, startingFlightNodes: [23] },
      "3": { fileName: "Dwarf", faction: "Alliance", maskBit: 2, startingFlightNodes: [6] },
      "4": { fileName: "NightElf", faction: "Alliance", maskBit: 3, startingFlightNodes: [26, 27] },
      "5": { fileName: "Scourge", faction: "Horde", maskBit: 4, startingFlightNodes: [11] },
      "6": { fileName: "Tauren", faction: "Horde", maskBit: 5, startingFlightNodes: [22] },
      "7": { fileName: "Gnome", faction: "Alliance", maskBit: 6, startingFlightNodes: [6] },
      "8": { fileName: "Troll", faction: "Horde", maskBit: 7, startingFlightNodes: [23] },
      "95": { fileName: "Skyborne", faction: "Alliance", maskBit: 32, startingFlightNodes: [2] },
      "96": { fileName: "Skyborne", faction: "Horde", maskBit: 33, startingFlightNodes: [] },
    },
    professions: {},
    standings: [],
    xpToNextLevel: Array.from({ length: MAX_LEVEL - 1 }, () => 400),
  });

  it("reads each race's starting flight nodes, and tells the Skyborne races apart by faction", () => {
    expect(rules.startingFlightNodes).toEqual({
      Human: [2],
      Orc: [23],
      Dwarf: [6],
      NightElf: [26, 27],
      Scourge: [11],
      Tauren: [22],
      Gnome: [6],
      Troll: [23],
      HighOrder: [2],
      Windshaper: [],
    });
  });

  it("reads each race's mask bit, with the Skyborne bits above 32 bits", () => {
    expect(rules.raceBits).toEqual({
      Human: 1,
      Orc: 2,
      Dwarf: 4,
      NightElf: 8,
      Scourge: 16,
      Tauren: 32,
      Gnome: 64,
      Troll: 128,
      HighOrder: 4294967296,
      Windshaper: 8589934592,
    });
  });
});
