import { describe, expect, it } from "vitest";
import { parseCondition } from "../guide/index.ts";
import { GAME, holds, suspiciousToken, tokenHolds } from "./condition.ts";
import { createProfile, xpRate, xpRateOptions } from "./profile.ts";

const humanWarrior = createProfile({ race: "Human", class: "WARRIOR", level: 10 });
const undeadMage = createProfile({ race: "Scourge", class: "MAGE", sex: "female" });
const check = (text: string, profile = humanWarrior) => holds(parseCondition(text), profile);

describe("tokenHolds", () => {
  it("compares classes without case", () => {
    expect(["Warrior", "WARRIOR", "warrior"].map((t) => tokenHolds(t, humanWarrior))).toEqual([true, true, true]);
    expect(tokenHolds("Mage", humanWarrior)).toBe(false);
  });

  it("compares races and factions with case", () => {
    expect(tokenHolds("Human", humanWarrior)).toBe(true);
    expect(tokenHolds("human", humanWarrior)).toBe(false);
    expect(tokenHolds("Alliance", humanWarrior)).toBe(true);
    expect(tokenHolds("alliance", humanWarrior)).toBe(false);
    expect(tokenHolds("Horde", undeadMage)).toBe(true);
  });

  it("matches both Skyborne races by the Skyborne token, with their own faction", () => {
    const highOrder = createProfile({ race: "HighOrder", class: "MAGE" });
    const windshaper = createProfile({ race: "Windshaper", class: "SHAMAN" });
    for (const profile of [highOrder, windshaper]) {
      expect(["Skyborne", "skyborne", "SKYBORNE", "HighOrder", "Windshaper", "Human", "Orc"].map((t) => tokenHolds(t, profile))).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    }
    expect(["Alliance", "Horde"].map((t) => tokenHolds(t, highOrder))).toEqual([true, false]);
    expect(["Alliance", "Horde"].map((t) => tokenHolds(t, windshaper))).toEqual([false, true]);
    expect(tokenHolds("Skyborne", humanWarrior) || tokenHolds("Skyborne", undeadMage)).toBe(false);
  });

  it("reads Undead as Scourge", () => {
    expect(tokenHolds("Undead", undeadMage)).toBe(true);
    expect(tokenHolds("Scourge", undeadMage)).toBe(true);
    expect(tokenHolds("Undead", humanWarrior)).toBe(false);
  });

  it("reads DF in any case as RETAIL, but Undead and Haranir only as written", () => {
    const withLocale = (locale: string) => createProfile({ race: "Human", class: "WARRIOR", locale });
    expect(["df", "Df", "dF", "DF"].map((t) => check(t, withLocale("RETAIL")))).toEqual([true, true, true, true]);
    expect(["df", "Df", "dF"].map((t) => check(t, withLocale(t)))).toEqual([false, false, false]);
    expect(check("df", withLocale("retail"))).toBe(false);
    expect(["Undead", "undead"].map((t) => check(t, withLocale("undead")))).toEqual([false, true]);
    expect(["Haranir", "haranir", "Harronir"].map((t) => check(t, withLocale("Harronir")))).toEqual([true, false, true]);
  });

  it("checks sex without case", () => {
    expect(tokenHolds("MALE", humanWarrior)).toBe(true);
    expect(tokenHolds("Female", humanWarrior)).toBe(false);
    expect(tokenHolds("female", undeadMage)).toBe(true);
  });

  it("holds a number at or below the player's level", () => {
    expect(["9", "10", "0x0A", "9.5"].map((t) => tokenHolds(t, humanWarrior))).toEqual([true, true, true, true]);
    expect(["11", "0x0B", "10.5"].map((t) => tokenHolds(t, humanWarrior))).toEqual([false, false, false]);
  });

  it("matches the Forever game without case, but not Classic or other expansions", () => {
    expect(["FOREVER", "Forever", "forever"].map((t) => tokenHolds(t, humanWarrior))).toEqual([true, true, true]);
    expect(["CLASSIC", "classic", "TBC", "WOTLK", "RETAIL", "DF"].some((t) => tokenHolds(t, humanWarrior))).toBe(false);
    expect(check("!CLASSIC")).toBe(true);
  });

  it("holds SOD only in Season of Discovery", () => {
    expect(tokenHolds("SOD", humanWarrior)).toBe(false);
    expect(tokenHolds("SOD", { ...humanWarrior, season: 2 })).toBe(true);
  });

  it("matches the locale with case", () => {
    expect(tokenHolds("enUS", humanWarrior)).toBe(true);
    expect(tokenHolds("deDE", humanWarrior)).toBe(false);
  });

  it("does not hold for skip or DK", () => {
    expect(tokenHolds("skip", humanWarrior)).toBe(false);
    expect(tokenHolds("DK", humanWarrior)).toBe(false);
  });
});

describe("holds", () => {
  it("applies a line without a condition", () => {
    expect(holds(undefined, humanWarrior)).toBe(true);
  });

  it("evaluates negation, alternatives, and groups", () => {
    expect(check("!Mage")).toBe(true);
    expect(check("!Warrior")).toBe(false);
    expect(check("Human Mage/Human Warrior")).toBe(true);
    expect(check("Dwarf Warrior/Gnome")).toBe(false);
    expect(check("(Human/Dwarf) Warrior")).toBe(true);
    expect(check("!(Human/Dwarf) Warrior")).toBe(false);
    expect(check("Alliance !Warrior 11")).toBe(false);
  });

  it("treats a group joined to a token as false", () => {
    expect(check("Warrior(Human)")).toBe(false);
    expect(check("!Warrior(Human)")).toBe(true);
  });
});

describe("suspiciousToken", () => {
  it("accepts tokens RXP checks", () => {
    for (const token of ["mage", "Undead", "Scourge", "Skyborne", "DK", "Horde", "female", "SOD", "TBC", "skip", "enGB", "0x10"]) {
      expect(suspiciousToken(token)).toBeUndefined();
    }
    expect(["Forever", "CLASSIC"].map(suspiciousToken)).toEqual([undefined, undefined]);
  });

  it("suggests the cased name for a race or faction", () => {
    expect(suspiciousToken("Nightelf")).toBe("NightElf");
    expect(suspiciousToken("horde")).toBe("Horde");
    expect(suspiciousToken("skyborne")).toBe("Skyborne");
  });

  it("flags a token that names nothing", () => {
    expect(suspiciousToken("fRogue")).toBe("");
  });
});

describe("xpRate", () => {
  it("defaults to 1 in every season and applies the chosen rate", () => {
    expect(xpRate(humanWarrior)).toBe(1);
    expect(xpRate({ ...humanWarrior, season: 1, phase: 2 })).toBe(1);
    expect(xpRate({ ...humanWarrior, season: 2 })).toBe(1);
    expect(xpRate({ ...humanWarrior, season: 2, xpRate: 1.5 })).toBe(1.5);
  });

  it("offers the rates RXP's slider allows on each game (v4.11.26 SettingsPanel.lua:1175-1199)", () => {
    const forever = xpRateOptions(GAME);
    expect(forever).toHaveLength(21);
    expect([forever[0], forever[1], forever[10], forever.at(-1)]).toEqual([1, 1.05, 1.5, 2]);
    expect(xpRateOptions("RETAIL")).toHaveLength(81);
    expect(xpRateOptions("RETAIL").at(-1)).toBe(5);
    expect(xpRateOptions("CLASSIC")).toEqual([]);
  });
});
