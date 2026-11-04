import { describe, expect, it } from "vitest";
import { genericFile } from "./genericFixture.ts";
import { readRaceClasses } from "./races.ts";

describe("readRaceClasses", () => {
  const { raceClasses = {}, races = {}, classes = {} } = genericFile();

  it("names each race and class by its file name, and each Skyborne race by its faction", () => {
    expect(readRaceClasses(raceClasses, races, classes)).toEqual({
      Human: ["WARRIOR", "MAGE"],
      Orc: ["WARRIOR"],
      HighOrder: ["MAGE", "DRUID"],
      Windshaper: ["WARRIOR", "DRUID"],
      Dwarf: ["WARRIOR"],
      NightElf: ["DRUID"],
      Gnome: ["MAGE"],
      Scourge: ["MAGE"],
      Tauren: ["DRUID"],
      Troll: ["WARRIOR"],
    });
  });

  it("refuses race classes that leave out a race", () => {
    const { "4": _, ...partial } = raceClasses;
    expect(() => readRaceClasses(partial, races, classes)).toThrow("Race classes lack NightElf.");
  });

  it("refuses a file name the planner does not know and a race on the wrong faction", () => {
    expect(() => readRaceClasses(raceClasses, { ...races, "1": { fileName: "Murloc", faction: "Alliance" } }, classes)).toThrow(
      "Race 1 has unknown file name Murloc.",
    );
    expect(() => readRaceClasses(raceClasses, { ...races, "1": { fileName: "Human", faction: "Horde" } }, classes)).toThrow(
      "Race 1 is Human, which is not Horde.",
    );
    expect(() => readRaceClasses(raceClasses, races, { ...classes, "8": { fileName: "BARD" } })).toThrow(
      "Class 8 has unknown file name BARD.",
    );
  });
});
