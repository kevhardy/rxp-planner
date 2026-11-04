import { describe, expect, it } from "vitest";
import type { QuestPoint } from "./model.ts";
import { plannerData, questRow, zoneData, zonePoint, ZONES } from "./plannerFixture.ts";
import { locatedSpawns, objectivePoints } from "./spawns.ts";

const data = plannerData();

describe("objectivePoints", () => {
  const dunMorogh = { id: 1, uiMapId: 1426 };
  const point = (
    zone: { id: number; uiMapId: number },
    x: number,
    kind: string,
    sourceType: string,
    sourceName: string,
    association?: number,
  ): QuestPoint => ({
    ...zonePoint(zone, x, 50, { kind, sourceType, sourceId: 2676, sourceName }),
    ...(association !== undefined && { association }),
  });
  const seerDrop = point(dunMorogh, 40, "item", "item", "Shimmerweed");
  const basketDrop = point(dunMorogh, 60, "item", "item", "Shimmerweed");
  const reaperSpawn = point({ id: 40, uiMapId: 1436 }, 50, "mob", "npc", "Compact Harvest Reaper");
  const spanSpawn = point(ZONES.arathi, 50, "object", "object", "Thandol Span");
  const points = [seerDrop, basketDrop, reaperSpawn, spanSpawn, point(dunMorogh, 70, "extra", "extra", "Shimmerweed", 1)];
  const objective = (type: string, index: number, name: string, id = 2676) => ({ index, type, id, ids: [id], name });
  const shimmerweed = objective("item", 1, "Shimmerweed");
  const reaper = objective("monster", 2, "Compact Harvest Reaper");
  const found = (objectives: ReturnType<typeof objective>[]) => {
    const row = questRow(315, "The Perfect Stout", { questLevel: 9, zoneIds: [1], objectives, objectivePoints: points });
    const quest = zoneData([row], { sources: [...data.sources] }).quest(315)!;
    return objectives.map((o) => objectivePoints(data, quest, o, "Alliance"));
  };

  it("matches points by target type and ID, and an item wherever it drops", () => {
    expect(found([shimmerweed, reaper, objective("object", 3, "Thandol Span")])).toEqual([
      [seerDrop, basketDrop],
      [reaperSpawn],
      [spanSpawn],
    ]);
  });

  it("gives a quest's only objective only the points of its type and IDs, and extra points to none", () => {
    expect(found([{ ...reaper, index: 1 }])).toEqual([[reaperSpawn]]);
    expect(found([objective("reputation", 1, "Ironforge", 47)])).toEqual([[]]);
  });
});

describe("item objective droppers", () => {
  const at = (x: number, kind: string, sourceType: string, sourceId: number, sourceName: string) =>
    zonePoint(ZONES.teldrassil, x, 40, { kind, sourceType, sourceId, sourceName });
  const grellkin = at(40, "item", "npc", 1989, "Grellkin");
  const grell = at(50, "item", "npc", 1988, "Grell");
  const mushroom = at(60, "item", "object", 152094, "Hyacinth Mushroom");
  const spider = at(70, "item", "npc", 1986, "Webwood Spider");
  const grellkinKill = at(80, "mob", "npc", 1989, "Grellkin");
  const mushrooms = { index: 1, type: "item", id: 10639, ids: [10639], name: "Hyacinth Mushroom" };
  const ichor = { index: 3, type: "item", id: 10640, ids: [10640], name: "Webwood Ichor" };
  const game = (grellExcluded = false) =>
    zoneData(
      [
        questRow(3521, "Iverron's Antidote", {
          objectives: [mushrooms, ichor],
          objectivePoints: [grellkin, grell, mushroom, spider, grellkinKill],
        }),
      ],
      {
        droppers: {
          "10639": [
            { type: "npc", id: 1989 },
            { type: "npc", id: 1988, ...(grellExcluded && { objectiveExcluded: true as const }) },
            { type: "object", id: 152094 },
          ],
          "10640": [{ type: "npc", id: 1986 }],
        },
      },
    );

  it("gives an item objective the item points of its droppers, and no other objective's", () => {
    const d = game();
    const quest = d.quest(3521, "Alliance")!;
    expect(quest.objectives.map((o) => objectivePoints(d, quest, o, "Alliance"))).toEqual([[grellkin, grell, mushroom], [spider]]);
  });

  it("collapses NPC observations after item selection and keeps nearby object locations", () => {
    const near = { ...grellkin, world: { ...grellkin.world, x: grellkin.world.x + 6 } };
    const mob = { ...grellkin, kind: "mob", world: { ...grellkin.world, x: grellkin.world.x - 6 } };
    const object = { ...mushroom, world: { ...mushroom.world, x: mushroom.world.x + 1 } };
    const d = game();
    const quest = { ...d.quest(3521, "Alliance")!, objectivePoints: [mob, grellkin, near, mushroom, object] };
    expect([...locatedSpawns(d, quest, mushrooms, "Alliance").keys()]).toEqual([grellkin, mushroom, object]);
  });
});
