import { describe, expect, it } from "vitest";
import { adjustedKillXp, killXp, questXp, xpToNextLevel } from "./xp.ts";
import { testRules } from "./testing.ts";

describe("questXp", () => {
  it("scales The Boar Hunter down as the player outlevels it", () => {
    expect([8, 9, 10, 11, 12, 13].map((level) => questXp(250, 3, level))).toEqual([250, 200, 150, 100, 50, 25]);
  });

  it("rounds to 5 up to 100, 10 up to 500, 25 up to 1,000, and 50 above", () => {
    const at = (base: number) => questXp(base, 20, 20);
    expect([97, 98, 100].map(at)).toEqual([95, 100, 100]);
    expect([104, 105, 500].map(at)).toEqual([100, 110, 500]);
    expect([504, 513, 1000].map(at)).toEqual([500, 525, 1000]);
    expect([1024, 1025].map(at)).toEqual([1000, 1050]);
  });

  it("rounds half a step down for steps of 5 and 25, and up for 10 and 50", () => {
    const at = (base: number) => questXp(base, 20, 20);
    expect([2.5, 512.5, 105, 1025].map(at)).toEqual([0, 500, 110, 1050]);
  });

  it("scales by fractional levels and keeps a negative reward", () => {
    expect(questXp(1000, 20, 25.5)).toBe(900);
    expect(questXp(-3, 20, 20)).toBe(-5);
  });

  it("gives no quest XP at the level cap", () => {
    expect(questXp(250, 60, 60)).toBe(0);
    expect(questXp(250, 3, 59)).toBe(25);
  });

  it("gives the full reward for no player level, even for a level 60 quest", () => {
    expect(questXp(1000, 60, null)).toBe(1000);
    expect(questXp(1010, 20, null)).toBe(1000);
  });
});

describe("adjustedKillXp", () => {
  it("rounds the multiplied XP, then splits it for a duo", () => {
    expect(adjustedKillXp(101)).toBe(101);
    expect(adjustedKillXp(101, { party: 2 })).toBe(51);
    expect(adjustedKillXp(101, { multiplier: 1.5, party: 2 })).toBe(76);
    expect(adjustedKillXp(-1, { party: 2 })).toBe(-0);
  });

  it("uses an exact value over the multiplier and still rounds it", () => {
    expect(adjustedKillXp(101, { multiplier: 3, exact: 7, party: 2 })).toBe(4);
    expect(adjustedKillXp(100, { exact: 1.5 })).toBe(2);
  });

  it("caps a multiplied value at the largest safe integer", () => {
    expect(adjustedKillXp(1e20)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("killXp", () => {
  it("adds 5% per level for a higher mob, up to 4 levels", () => {
    expect([10, 11, 14, 20].map((mob) => killXp(10, mob, false))).toEqual([95, 100, 114, 114]);
  });

  it("scales a lower mob down toward the zero difference", () => {
    expect(killXp(10, 8, false)).toBe(68);
    expect(killXp(10, 5, false)).toBe(27);
  });

  it("gives nothing at or below the gray level", () => {
    const cutoffs: [number, number, number][] = [
      [5, 0, 14],
      [6, 1, 15],
      [39, 31, 100],
      [40, 31, 94],
      [59, 47, 106],
      [60, 51, 183],
    ];
    for (const [player, gray, above] of cutoffs) {
      expect([killXp(player, gray, false), killXp(player, gray + 1, false)]).toEqual([0, above]);
    }
  });

  it("multiplies elite XP by 2.5", () => {
    expect(killXp(10, 10, true)).toBe(238);
    expect(killXp(10, 4, true)).toBe(0);
  });

  it("rounds 32-bit floats half to even", () => {
    // In doubles, 50 × 1.15 falls just under 57.5 and 95 × 1.1 just over 104.5.
    expect(killXp(1, 4, false)).toBe(58);
    expect(killXp(10, 12, false)).toBe(104);
    // 65 × 2.5 is exactly 162.5.
    expect(killXp(4, 4, true)).toBe(162);
  });
});

describe("xpToNextLevel", () => {
  it("reads the dataset's XP to leave a level, and is 0 from the highest level on", () => {
    expect([1, 59, 60, 61, 0].map((level) => xpToNextLevel(testRules, level))).toEqual([400, 209800, 0, 0, 0]);
  });
});
