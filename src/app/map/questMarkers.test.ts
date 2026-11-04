import { plannerContext, plannerNames } from "../../data/plannerFixture.ts";
import { describe, expect, it } from "vitest";
import { EntityIndex, GameData, type QuestPoint } from "../../data/index.ts";
import { parseGuide } from "../../guide/index.ts";
import { createProfile, type QuestProgress } from "../../rules/index.ts";
import { simData } from "../../rules/index.ts";
import { testRules } from "../../rules/testing.ts";
import { EASTERN_KINGDOMS, questRow, zonePoint, ZONES } from "../testing.ts";
import { questSpots } from "./points.ts";
import type { LockNames } from "../quests/lockText.ts";
import {
  dimmed,
  markerLabel,
  questActions,
  questMarkers,
  questRows,
  type AvailableQuest,
  type QuestMarker,
  type TurnInQuest,
} from "./questMarkers.ts";

const npc = (kind: string, sourceId: number, sourceName: string) => ({ kind, sourceType: "npc", sourceId, sourceName });
const at = (x: number, y: number, from: Pick<QuestPoint, "kind" | "sourceType" | "sourceId" | "sourceName">) =>
  zonePoint(ZONES.elwynn, x, y, from);
const dughan = (kind: string, x = 42.2, y = 65.8) => at(x, y, npc(kind, 240, "Marshal Dughan"));
const mcBride = at(48.8, 41.6, npc("start", 197, "Marshal McBride"));
const HILLSBRAD = { id: 267, uiMapId: 1424, name: "Hillsbrad Foothills", category: "zone", instance: 0 } as const;
const PLAGUELANDS = { id: 139, uiMapId: 1423, name: "Eastern Plaguelands", category: "zone", instance: 0 } as const;

const data = new GameData(
  {
    source: { name: "test", version: "0", pack: "forever" },
    maxLevel: 60,
    zones: [ZONES.elwynn, ZONES.ironforge, HILLSBRAD, PLAGUELANDS],
    continents: [EASTERN_KINGDOMS],
    npcNames: {},
    quests: [
      questRow(76, "The Jasperlode Mine", {
        requiredLevel: 4,
        questLevel: 10,
        startPoints: [dughan("start", 42.11, 65.93), dughan("start")],
      }),
      questRow(6403, "The Great Masquerade", {
        requiredLevel: 50,
        questLevel: 60,
        types: ["raid"],
        startPoints: [at(32, 49.2, npc("start", 12580, "Reginald Windsor")), at(34.6, 53.2, npc("start", 12580, "Reginald Windsor"))],
      }),
      questRow(109, "Report to Gryan Stoutmantle", { questLevel: 10, requiredLevel: 9, startPoints: [dughan("start")] }),
      questRow(7, "Kobold Camp Cleanup", { questLevel: 2, startPoints: [mcBride] }),
      questRow(5628, "Returning Home", {
        questLevel: 10,
        requiredLevel: 10,
        requiredRaceMask: 8,
        requiredClassMask: 16,
        startPoints: [at(43.4, 65.6, npc("start", 377, "Priestess Josetta"))],
      }),
      questRow(123, "The Collector", {
        requiredLevel: 7,
        questLevel: 10,
        startPoints: [at(69.8, 37.6, { kind: "start", sourceType: "item", sourceId: 1307, sourceName: "Gold Pickup Schedule" })],
      }),
      questRow(40, "A Fishy Peril", { requiredLevel: 7, questLevel: 10, endPoints: [dughan("turn-in")] }),
      questRow(52, "Protect the Frontier", {
        requiredLevel: 7,
        questLevel: 10,
        endPoints: [at(74, 72.2, npc("turn-in", 261, "Guard Thomas"))],
      }),
      questRow(16, "Give Gerard a Drink", {
        questLevel: 1,
        types: ["repeatable"],
        startPoints: [at(43, 85.6, npc("start", 255, "Gerard Tiller"))],
      }),
      questRow(62, "The Fargodeep Mine", { requiredLevel: 4, questLevel: 7, startPoints: [dughan("start")] }),
      questRow(91738, "An Apple Treat", {
        requiredLevel: 7,
        questLevel: 10,
        requiredRaceMask: null,
        requiredClassMask: null,
        preQuestSingle: null,
        startPoints: [at(24, 73, npc("start", 955, "Sergeant De Vries"))],
      }),
      questRow(91740, "Croaky's Head", {
        requiredLevel: 7,
        questLevel: 10,
        requiredRaceMask: null,
        requiredClassMask: null,
        preQuestSingle: null,
        endPoints: [at(84.6, 79.2, npc("turn-in", 248277, "Merell Ross"))],
      }),
      questRow(1658, "Crashing the Wickerman Festival", {
        requiredLevel: 25,
        questLevel: 60,
        types: ["pvp", "seasonal"],
        startPoints: [zonePoint(HILLSBRAD, 50, 57.6, npc("start", 15199, "Sergeant Hartman"))],
      }),
      questRow(8492, "The Alliance Needs Copper Bars!", {
        questLevel: 60,
        types: ["war-effort"],
        startPoints: [zonePoint(ZONES.ironforge, 64.6, 67.6, npc("start", 15383, "Sergeant Stonebrow"))],
      }),
      questRow(9153, "Under the Shadow", {
        requiredLevel: 50,
        questLevel: 60,
        types: ["invasion"],
        startPoints: [zonePoint(PLAGUELANDS, 80.91, 60.4, npc("start", 16361, "Commander Thomas Helleran"))],
      }),
      questRow(8493, "The Alliance Needs More Copper Bars!", {
        questLevel: 60,
        types: ["repeatable", "war-effort"],
        startPoints: [zonePoint(ZONES.ironforge, 64.1, 65.5, npc("start", 15383, "Sergeant Stonebrow"))],
      }),
    ],
  },
  plannerContext,
);
const sim = simData(data, new EntityIndex(plannerNames), "Alliance");
const human = createProfile({ race: "Human", class: "WARRIOR" });
const progress = (status: QuestProgress["status"]): QuestProgress => ({ status, objectives: [] });
const state = {
  level: 8,
  log: new Map([
    [40, progress("partial")],
    [52, progress("complete")],
    [91740, progress("partial")],
  ]),
  done: new Set([62]),
};
const markers = (all: boolean, step?: string) =>
  questMarkers(state, data, sim, human, {
    all,
    spots: step ? questSpots(data, parseGuide(`#name T\nstep\n${step}\n`).steps[0]!, "Alliance") : [],
  });
const summary = (list: QuestMarker[]) =>
  list
    .map((m) => [m.source, m.available.map((q) => q.id).sort((a, b) => a - b), m.turnIns.map((q) => [q.id, q.complete])] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
const markerOf = (list: QuestMarker[], source: string) => list.find((m) => m.source === source)!;
const names: LockNames = { quest: (id) => data.quest(id)!.name, faction: (id) => data.factionName(id), rules: testRules };

describe("questMarkers", () => {
  it("marks each giver and ender once with its quests, and hides locked and gray quests by default", () => {
    expect(summary(markers(false))).toEqual([
      ["Guard Thomas", [], [[52, true]]],
      ["Marshal Dughan", [76], [[40, false]]],
      ["Merell Ross", [], [[91740, false]]],
      ["Sergeant De Vries", [91738], []],
    ]);
    expect(summary(markers(true))).toEqual([
      ["Commander Thomas Helleran", [9153], []],
      ["Guard Thomas", [], [[52, true]]],
      ["Marshal Dughan", [76, 109], [[40, false]]],
      ["Marshal McBride", [7], []],
      ["Merell Ross", [], [[91740, false]]],
      ["Reginald Windsor", [6403], []],
      ["Reginald Windsor", [6403], []],
      ["Sergeant De Vries", [91738], []],
      ["Sergeant Hartman", [1658], []],
      ["Sergeant Stonebrow", [8492], []],
    ]);
  });

  it("keeps why a quest is locked or gray, and what data it lacks", () => {
    const all = markers(true);
    const [dughan, old, deVries] = ["Marshal Dughan", "Marshal McBride", "Sergeant De Vries"].map((s) => markerOf(all, s));
    const [open, high] = [76, 109].map((id) => dughan!.available.find((q) => q.id === id)!);
    expect([open, high].map((q) => dimmed(q!))).toEqual([false, true]);
    expect(open).toMatchObject({ locked: [], trivial: false, unknown: [] });
    expect(high).toMatchObject({ locked: [{ kind: "level", requiredLevel: 9 }], trivial: false, unknown: [] });
    expect(old!.available[0]).toMatchObject({ locked: [], trivial: true });
    expect(deVries!.available[0]).toMatchObject({ locked: [], trivial: false, unknown: ["race", "class", "prerequisites"] });
    dughan!.available = [open!, high!];
    const both = { available: true, turnIns: true };
    expect(markerLabel([dughan!], both, names)).toBe(
      "Marshal Dughan\nAvailable: The Jasperlode Mine (level 10)\nAvailable: Report to Gryan Stoutmantle (level 10): level 9\nTurn in: A Fishy Peril (level 10): not complete",
    );
    expect(markerLabel([old!], both, names)).toBe("Marshal McBride\nAvailable: Kobold Camp Cleanup (level 2): low level");
    expect(markerLabel([dughan!], { available: false, turnIns: true }, names)).toBe(
      "Marshal Dughan\nTurn in: A Fishy Peril (level 10): not complete",
    );
    expect(markerLabel([deVries!], both, names)).toBe("Sergeant De Vries\nAvailable: An Apple Treat (level 10): Data incomplete");
    expect(markerLabel([markerOf(all, "Merell Ross")], both, names)).toBe(
      "Merell Ross\nTurn in: Croaky's Head (level 10): not complete · Data incomplete",
    );
  });

  it("locks seasonal, war-effort, and invasion quests as world events", () => {
    const all = markers(true);
    const givers = ["Sergeant Hartman", "Sergeant Stonebrow", "Commander Thomas Helleran"].map((s) => markerOf(all, s));
    expect(givers.map((m) => m.available.map((q) => q.locked))).toEqual([
      [[{ kind: "level", requiredLevel: 25 }, { kind: "event" }]],
      [[{ kind: "event" }]],
      [[{ kind: "level", requiredLevel: 50 }, { kind: "event" }]],
    ]);
    expect(givers.map((m) => markerLabel([m], { available: true, turnIns: true }, names))).toEqual([
      "Sergeant Hartman\nAvailable: Crashing the Wickerman Festival (level 60): level 25 · world event",
      "Sergeant Stonebrow\nAvailable: The Alliance Needs Copper Bars! (level 60): world event",
      "Commander Thomas Helleran\nAvailable: Under the Shadow (level 60): level 50 · world event",
    ]);
  });

  it("keeps a description short however many quests or places share it, and lists every quest for the card", () => {
    const giver = (from: QuestPoint, quests: [id: number, name: string, level: number][]): QuestMarker => ({
      key: from.sourceName,
      source: from.sourceName,
      uiMapId: from.uiMapId,
      x: from.x,
      y: from.y,
      world: from.world,
      available: quests.map(([id, name, level]) => ({ id, name, level, locked: [], trivial: false, unknown: [] })),
      turnIns: [],
    });
    const mcBrideQuests: [number, string, number][] = [
      [7, "Kobold Camp Cleanup", 2],
      [15, "Investigate Echo Ridge", 3],
      [21, "Skirmish at Echo Ridge", 5],
      [54, "Report to Goldshire", 5],
      [3100, "Simple Letter", 1],
    ];
    const both = { available: true, turnIns: true };
    expect(markerLabel([giver(mcBride, mcBrideQuests.slice(0, 4))], both, names).split("\n")).toHaveLength(5);
    const mcBrideAll = giver(mcBride, mcBrideQuests);
    expect(markerLabel([mcBrideAll], both, names)).toBe("Marshal McBride: 5 to accept\nSelect for every quest");
    expect(questRows(mcBrideAll, both, names).map((r) => r.id)).toEqual([7, 15, 21, 54, 3100]);
    const places = [
      giver(at(48.8, 40.2, npc("start", 196, "Eagan Peltskinner")), [[33, "Wolves Across the Border", 2]]),
      giver(at(48.2, 42.8, npc("start", 823, "Deputy Willem")), [
        [783, "A Threat Within", 1],
        [5261, "Eagan Peltskinner", 2],
      ]),
      giver(mcBride, mcBrideQuests.slice(0, 3)),
      giver(at(49.6, 40.4, npc("start", 951, "Brother Paxton")), [[91743, "Rascally Rodents", 2]]),
      giver(at(49.8, 39.6, npc("start", 375, "Priestess Anetta")), [[5623, "In Favor of the Light", 4]]),
    ];
    places[0]!.turnIns = [{ id: 5261, name: "Eagan Peltskinner", level: 2, complete: true, unknown: [] }];
    expect(markerLabel(places, both, names)).toBe(
      "Eagan Peltskinner: 1 to accept, 1 to turn in\nDeputy Willem: 2 to accept\nMarshal McBride: 3 to accept\nand 2 more\nSelect for every quest",
    );
    expect(markerLabel(places, { available: false, turnIns: true }, names)).toMatch(/^Eagan Peltskinner: 1 to turn in\n/);
  });

  it("offers each quest's accept or turn-in once, telling apart quests and places whose names match", () => {
    const westfall = (x: number, y: number, id: number, name: string) => zonePoint({ id: 40, uiMapId: 1436 }, x, y, npc("start", id, name));
    const marker = (from: QuestPoint, available: AvailableQuest[], turnIns: TurnInQuest[] = []): QuestMarker => ({
      key: from.sourceName,
      source: from.sourceName,
      uiMapId: from.uiMapId,
      x: from.x,
      y: from.y,
      world: from.world,
      available,
      turnIns,
    });
    const accept = (id: number, name: string, level: number, after?: number): AvailableQuest => ({
      id,
      name,
      level,
      locked: after ? [{ kind: "prerequisite", allOf: [after], anyOf: [] }] : [],
      trivial: false,
      unknown: [],
    });
    const militia = [
      accept(12, "The People's Militia", 12),
      accept(13, "The People's Militia", 14, 12),
      accept(14, "The People's Militia", 17, 13),
    ];
    const gryan = marker(westfall(56.2, 47.6, 234, "Gryan Stoutmantle"), militia, [
      { id: 109, name: "Report to Gryan Stoutmantle", level: 10, complete: false, unknown: [] },
    ]);
    const both = { available: true, turnIns: true };
    const labels = (list: QuestMarker[], show = both) => questActions(list, show).map((a) => `${a.command} ${a.id}: ${a.label}`);
    expect(labels([gryan])).toEqual([
      "accept 12: Accept The People's Militia",
      "accept 13: Accept The People's Militia (locked) (#13)",
      "accept 14: Accept The People's Militia (locked) (#14)",
      "turnin 109: Turn in Report to Gryan Stoutmantle (not complete)",
    ]);
    expect(questActions([gryan], both).map((a) => a.muted)).toEqual([false, true, true, true]);
    const danuvin = marker(westfall(56.4, 47.6, 821, "Captain Danuvin"), [militia[0]!, accept(102, "Patrolling Westfall", 14)]);
    expect(labels([gryan, danuvin], { available: true, turnIns: false })).toEqual([
      "accept 12: Accept The People's Militia · Gryan Stoutmantle",
      "accept 13: Accept The People's Militia (locked) · Gryan Stoutmantle (#13)",
      "accept 14: Accept The People's Militia (locked) · Gryan Stoutmantle (#14)",
      "accept 102: Accept Patrolling Westfall · Captain Danuvin",
    ]);
  });

  it("leaves out what the selected step's own quest locations show", () => {
    expect(summary(markers(true, ".accept 76\n.turnin 52\n.turnin 91740"))).toEqual([
      ["Commander Thomas Helleran", [9153], []],
      ["Marshal Dughan", [109], [[40, false]]],
      ["Marshal McBride", [7], []],
      ["Reginald Windsor", [6403], []],
      ["Reginald Windsor", [6403], []],
      ["Sergeant De Vries", [91738], []],
      ["Sergeant Hartman", [1658], []],
      ["Sergeant Stonebrow", [8492], []],
    ]);
    expect(summary(markers(false, ".accept 40"))).toEqual(summary(markers(false)));
  });
});
