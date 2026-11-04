import { describe, expect, it } from "vitest";
import { EntityIndex } from "../data/index.ts";
import { plannerData, plannerNames } from "../data/plannerFixture.ts";
import { factionData } from "./simData.ts";

describe("factionData", () => {
  const game = plannerData();
  const names = new EntityIndex(plannerNames);
  const probe = (id: number) =>
    new EntityIndex({ version: 2, entities: { npc: [[id, "Probe NPC"]], item: [], object: [], quest: [], spell: [] } });

  it("gives the same view while the game data, names, and faction stay", () => {
    expect(factionData(game, names, "Alliance")).toBe(factionData(game, names, "Alliance"));
  });

  it("gives a new view for new game data, new names, or another faction", () => {
    const view = factionData(game, names, "Alliance");
    const others = [
      factionData(plannerData(), names, "Alliance"),
      factionData(game, new EntityIndex(plannerNames), "Alliance"),
      factionData(game, names, "Horde"),
    ];
    expect(others.map((other) => other === view)).toEqual([false, false, false]);
  });

  it("finds entities by name in its own names", () => {
    const found = [1, 2].map((id) => factionData(game, probe(id), "Alliance").sim.entityByName("Probe NPC"));
    expect(found).toEqual([
      { kind: "npc", id: 1 },
      { kind: "npc", id: 2 },
    ]);
  });
});
