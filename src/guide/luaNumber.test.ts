import { describe, expect, it } from "vitest";
import { luaNumber } from "./luaNumber.ts";

describe("luaNumber", () => {
  it("reads numbers as Lua tonumber does", () => {
    expect([" 12 ", "+4124", "-3", "0x1f", "1e2", ".5"].map(luaNumber)).toEqual([12, 4124, -3, 31, 100, 0.5]);
    expect(["", "12a", "0x", "1-2"].map(luaNumber)).toEqual([undefined, undefined, undefined, undefined]);
  });

  // Lua 5.1's `luaO_str2d` in lobject.c reads a number with C's `strtod`.
  it("reads the hexadecimal fractions, binary exponents, inf, and nan that strtod reads", () => {
    expect(["0x1p2", "0x1.8", "-0x.8", "0X1P-1", "inf", "-Infinity", "NaN", "nan(1)"].map(luaNumber)).toEqual([
      4,
      1.5,
      -0.5,
      0.5,
      Infinity,
      -Infinity,
      NaN,
      NaN,
    ]);
    expect(["0x.", "0x1p", "0x1.8p+", "infin", "nan("].map(luaNumber)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  // `strtod` rounds the exact value once, to the even neighbor on a tie, so a part that is out of range on its own
  // does not matter. Lua 5.1.5 gives these values.
  it("rounds a hexadecimal number once, as strtod does", () => {
    const long = `0x${"f".repeat(270)}p-1080`;
    expect(
      ["0x0p1024", "-0x0p1024", "0x1.8p-1074", "0x2p-1075", long, "0x200000000000011", "0x1.fffffffffffff8p1023"].map(luaNumber),
    ).toEqual([0, -0, 2 ** -1073, 2 ** -1074, 1, 2 ** 57 + 32, Infinity]);
  });
});
