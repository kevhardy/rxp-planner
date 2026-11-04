import { describe, expect, it } from "vitest";
import { GameData } from "../../data/gameData.ts";
import { genericFile } from "../../data/genericFixture.ts";
import { plannerContext, plannerFile } from "../../data/plannerFixture.ts";
import { lockText, type LockNames } from "./lockText.ts";

const data = new GameData({ ...plannerFile(), factionNames: genericFile().factionNames ?? {} }, plannerContext);
const QUESTS: Record<number, string> = {
  6: "Bounty on Garrick Padfoot",
  7: "Kobold Camp Cleanup",
  15: "Investigate Echo Ridge",
  18: "Brotherhood of Thieves",
  33: "Wolves Across the Border",
  783: "A Threat Within",
  886: "The Barrens Oases",
  887: "Southsea Freebooters",
  890: "The Missing Shipment",
  1522: "Call of Fire",
  1523: "Call of Fire",
  2983: "Call of Fire",
  5261: "Eagan Peltskinner",
};
const names: LockNames = { quest: (id) => QUESTS[id]!, faction: (id) => data.factionName(id), rules: data.rules };
const standing = (name: string) => data.rules.standings.find((s) => s.name === name)!;

describe("lockText", () => {
  it("names the quests a quest waits on or is closed by", () => {
    expect(lockText([{ kind: "prerequisite", allOf: [783, 7], anyOf: [33, 15] }], names)).toBe(
      "after A Threat Within and Kobold Camp Cleanup and one of Wolves Across the Border, Investigate Echo Ridge",
    );
    expect(lockText([{ kind: "parent", quest: 5261 }], names)).toBe("with Eagan Peltskinner in the log");
    expect(lockText([{ kind: "exclusive", quests: [18, 6] }], names)).toBe("closed by Brotherhood of Thieves, Bounty on Garrick Padfoot");
    expect(lockText([{ kind: "nextInChain", quest: 890 }], names)).toBe("closed by next quest The Missing Shipment");
  });

  it("names quests that share a name once", () => {
    expect(lockText([{ kind: "prerequisite", allOf: [], anyOf: [1522, 1523, 2983] }], names)).toBe("after Call of Fire");
    expect(lockText([{ kind: "prerequisite", allOf: [1522, 1523, 887], anyOf: [2983, 886] }], names)).toBe(
      "after Call of Fire and Southsea Freebooters and one of Call of Fire, The Barrens Oases",
    );
    expect(lockText([{ kind: "exclusive", quests: [1522, 1523] }], names)).toBe("closed by Call of Fire");
  });

  it("gives levels, standings with faction names, professions, and events", () => {
    const text = lockText(
      [
        { kind: "level", requiredLevel: 20 },
        { kind: "maxLevel", maxLevel: 29 },
        { kind: "reputation", faction: 72, value: 9000, standing: standing("Honored") },
        { kind: "reputation", faction: 470, value: 1500, standing: standing("Neutral") },
        { kind: "profession", skill: 164, value: 250 },
        { kind: "profession", specialization: 9787 },
        { kind: "event" },
      ],
      names,
    );
    expect(text).toBe(
      "level 20 · level 29 or lower · Honored with Stormwind · Neutral +1500 with Ratchet · Blacksmithing 250 · Weaponsmith · world event",
    );
  });

  it("gives a reputation maximum as the highest standing or value below it", () => {
    expect(lockText([{ kind: "maxReputation", faction: 470, value: 0, standing: standing("Neutral") }], names)).toBe(
      "Unfriendly or lower with Ratchet",
    );
    expect(lockText([{ kind: "maxReputation", faction: 72, value: -5999, standing: standing("Hostile") }], names)).toBe(
      "−6000 reputation or lower with Stormwind",
    );
    expect(lockText([{ kind: "maxReputation", faction: 72, value: -42000, standing: standing("Hated") }], names)).toBe(
      "−42001 reputation or lower with Stormwind",
    );
  });

  it("shows the ID of a faction or profession it has no name for", () => {
    expect(lockText([{ kind: "reputation", faction: 1, value: 3000, standing: standing("Friendly") }], names)).toBe(
      "Friendly with faction 1",
    );
    expect(lockText([{ kind: "profession", skill: 2, value: 1 }], names)).toBe("profession 2 1");
  });
});
