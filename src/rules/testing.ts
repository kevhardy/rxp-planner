import { readGameRules } from "../data/gameRules.ts";
import type { SimQuest } from "./simulate.ts";

export const testRules = readGameRules({
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
    "96": { fileName: "Skyborne", faction: "Horde", maskBit: 33, startingFlightNodes: [23] },
  },
  professions: {
    "164": { name: "Blacksmithing", noSpecialization: true },
    "185": { name: "Cooking" },
    "202": { name: "Engineering", noSpecialization: true },
    "9787": { name: "Weaponsmith" },
  },
  standings: [
    { name: "Hated", min: -42000 },
    { name: "Hostile", min: -6000 },
    { name: "Unfriendly", min: -3000 },
    { name: "Neutral", min: 0 },
    { name: "Friendly", min: 3000 },
    { name: "Honored", min: 9000 },
    { name: "Revered", min: 21000 },
    { name: "Exalted", min: 42000 },
  ],
  xpToNextLevel: [
    400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200, 25200,
    27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, 50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700,
    95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500, 153900, 160400, 167100, 173900, 180800, 187900, 195000,
    202300, 209800,
  ],
});

export function simQuest(fields: Partial<SimQuest> & Pick<SimQuest, "name">): SimQuest {
  return {
    preAny: [],
    preAll: [],
    acceptOnTurnIn: false,
    level: 1,
    requiredLevel: 1,
    baseXp: 0,
    zoneIds: [],
    givers: [],
    enders: [],
    giverNpcs: [],
    enderNpcs: [],
    objectives: [],
    requiredRaceMask: 0,
    requiredClassMask: 0,
    requiredFaction: null,
    nextQuestInChain: null,
    exclusiveTo: [],
    parentQuest: 0,
    requiredMaxLevel: 0,
    requiredSkill: null,
    requiredMinRep: null,
    requiredMaxRep: null,
    requiredSpecialization: 0,
    event: false,
    ...fields,
  };
}
