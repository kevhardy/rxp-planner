import { describe, expect, it } from "vitest";
import type { GuideRecord } from "../guide/index.ts";
import { createProfile } from "./profile.ts";
import { builtinIndex, guideKey, guideMeta, guideNamed, guidesClash, registrationClashes, resolvedGroup } from "./registration.ts";

let order = 0;
const guide = (text: string, group?: string): GuideRecord => {
  const stored: GuideRecord = { id: `g${order}`, text, order: order++ };
  if (group) stored.registerArgs = { group };
  return stored;
};
const humanWarrior = createProfile({ race: "Human", class: "WARRIOR" });
const named = (name: string, next?: string) => guide(`#group G\n#name ${name}\n${next ? `#next ${next}\n` : ""}step\n`);

describe("level range", () => {
  it("reads a level range from a leading N-M in #name", () => {
    expect(guideMeta(named("12-14 Loch Modan (Dwarf/Gnome)")).range).toEqual({ min: 12, max: 14 });
    expect(guideMeta(named("1-6 Northshire")).range).toEqual({ min: 1, max: 6 });
    expect(guideMeta(named("13-15 Westfall ")).range).toEqual({ min: 13, max: 15 });
  });

  it("gives no range without one", () => {
    for (const name of ["Random Stuff", "60 Molten Core", "14-12 Odd", "0-5 Odd", "Loch Modan 12-14"]) {
      expect(guideMeta(named(name)).range, name).toBeUndefined();
    }
  });
});

describe("guide selection by name", () => {
  it("selects the first group instead of a later dungeon wrapper", () => {
    const main = guide("#group Main\n#name Start\nstep\n.accept 92460\n");
    const dungeon = guide("#group Dungeon\n#name Start\nstep\n#include Main\\Start\n");
    expect(guideNamed([main, dungeon], "Start")).toBe(0);
    expect(guideNamed([main, dungeon], "Missing")).toBe(-1);
  });

  it("keeps the latest registration in the first matching group", () => {
    const main = guide("#group Main (A) << Alliance\n#group Main (H) << Horde\n#name Start\nstep\n");
    const override = guide("#group Ignored\n#name Start\nstep\n.accept 92460\n", "Main (A)");
    const dungeon = guide("#group Dungeon\n#name Start\nstep\n#include Main (A)\\Start\n");
    expect(guideNamed([main, override, dungeon], "Start")).toBe(1);
  });
});

describe("registration clashes", () => {
  it("reports unconditional guides with the same group and name", () => {
    const [a, b] = [named("Same"), named("Same")];
    expect(registrationClashes([a, b, named("Other")])).toEqual([[a, b]]);
  });

  it("allows copies that no character loads together", () => {
    const alliance = guide("<< Alliance\n#group G\n#name Same\nstep\n");
    const horde = guide("<< Horde\n#group G\n#name Same\nstep\n");
    const mage = guide("<< Mage\n#group G\n#name Same\nstep\n");
    expect(guidesClash(alliance, horde)).toBe(false);
    expect(guidesClash(alliance, mage)).toBe(true);
    expect(guidesClash(guide("<< Undead\n#group G\n#name Same\nstep\n"), alliance)).toBe(false);
  });

  it("treats the Skyborne races as races, one on each side", () => {
    const skyborne = guide("<< Skyborne\n#group G\n#name Same\nstep\n");
    const human = guide("<< Human\n#group G\n#name Same\nstep\n");
    const notSkyborne = guide("<< !Skyborne\n#group G\n#name Same\nstep\n");
    expect(guidesClash(skyborne, human)).toBe(false);
    expect(guidesClash(skyborne, notSkyborne)).toBe(false);
    expect(guidesClash(skyborne, guide("<< Alliance\n#group G\n#name Same\nstep\n"))).toBe(true);
    expect(guidesClash(skyborne, guide("<< Horde\n#group G\n#name Same\nstep\n"))).toBe(true);
    expect(
      guidesClash(guide("<< Skyborne Alliance\n#group G\n#name Same\nstep\n"), guide("<< Skyborne Horde\n#group G\n#name Same\nstep\n")),
    ).toBe(false);
  });

  it("reads names and groups the way the character sees them", () => {
    const a = guide("#group G\n#name Sod << sod\n#name Same\nstep\n");
    const b = guide("#group G\n#name Same << !sod\n#name Other\nstep\n");
    expect(guidesClash(a, b)).toBe(true);
    const c = guide("#group G\n#name Same << sod\n#name Other\nstep\n");
    expect(guidesClash(c, b)).toBe(false);
    expect(guidesClash(guide("#name Same\nstep\n", "G"), named("Same"))).toBe(true);
  });

  it("takes the last applying conditional #group over an earlier unconditional one", () => {
    // `addon.ParseGuide` in GuideLoader.lua sets the group on each applying
    // `#group ... <<` line in order, and falls back to the first `#group`.
    const a = guide("#group Main\n#group Alt << Alliance\n#name N\nstep\n");
    expect(guidesClash(a, guide("#group Alt\n#name N\nstep\n"))).toBe(true);
    expect(guidesClash(a, guide("<< Alliance\n#group Main\n#name N\nstep\n"))).toBe(false);
  });

  it("takes the group from RegisterGuide arguments over #group", () => {
    const registered = guide("#group Display\n#name Collision\nstep\n", "Actual");
    expect(guideMeta(registered).group).toBe("Actual");
    expect(guidesClash(registered, guide("#group Actual\n#name Collision\nstep\n"))).toBe(true);
    expect(guidesClash(registered, guide("#group Display\n#name Collision\nstep\n"))).toBe(false);
  });
});

describe("group choice", () => {
  const group = (header: string) => resolvedGroup(guide(`${header}\n#name N\nstep\n`), humanWarrior);

  it("takes the last applying conditional #group over an earlier unconditional one", () => {
    expect(group("#group Main\n#group A1 << Alliance\n#group A2 << Human\n#group Late")).toBe("A2");
  });

  it("takes the first #group when no conditional one applies", () => {
    expect(group("#group Main\n#group H << Horde\n#group Late")).toBe("Main");
  });

  it("passes over a conditional #group that does not apply", () => {
    expect(group("#group H << Horde\n#group Main")).toBe("Main");
  });

  it("takes a lone conditional #group that applies", () => {
    expect(guidesClash(guide("#group A << Alliance\n#name N\nstep\n"), guide("#group A\n#name N\nstep\n"))).toBe(true);
  });
});

describe("built-in index", () => {
  it("keeps the last built-in under a group and name, and finds it from each copy group", () => {
    const first = guide("#group F (A) << Alliance\n#group F (H) << Horde\n#name Z\nstep\n");
    const last = guide("#group F (A) << Alliance\n#group F (H) << Horde\n#name Z\nstep\n.xp 2\n");
    const { kept, copied } = builtinIndex([first, last]);
    expect(kept.get(guideKey({ group: "F (A)", name: "Z" }))).toBe(last);
    expect(kept.has(guideKey({ group: "F (H)", name: "Z" }))).toBe(false);
    const copies = ["F (A) (custom)", "F (H) (custom)", "F (custom)"].map((group) => copied.get(guideKey({ group, name: "Z" })));
    expect(copies).toEqual([last, last, undefined]);
  });
});
