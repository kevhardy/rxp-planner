import { describe, expect, it } from "vitest";
import { GameData, mapToWorld, worldToCanvas, type QuestPoint, type WorldLocation } from "../../data/index.ts";
import { MAP_BOUNDS, plannerContext, plannerFile } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { questRow, zonePoint, ZONES } from "../testing.ts";
import { indexFeatures } from "./features.ts";
import { lineHasMapReference, resolveMapFocus, type FocusContext, type FocusResolution } from "./lineFocus.ts";
import { terrainSurface } from "./surfaces.ts";
import { canvasSize, canvasToView } from "./viewport.ts";

const DUSKWOOD = { id: 10, uiMapId: 1431 };
const DUROTAR = { id: 14, uiMapId: 1411 };
const ELWYNN = ZONES.elwynn;
const npc = (kind: QuestPoint["kind"], sourceId: number, sourceName: string) => ({ kind, sourceType: "npc", sourceId, sourceName });
const at = (zone: { id: number; uiMapId: number }, x: number, y: number) => zonePoint(zone, x, y, npc("mob", 1, "Spot")).world;
const UNMARKED_NPC = 900001;

const file = plannerFile();
const data = new GameData(
  {
    ...file,
    npcs: { ...file.npcs, [UNMARKED_NPC]: { spawns: [{ world: at(DUROTAR, 40, 40) }, { world: at(DUROTAR, 44, 40) }] } },
    npcNames: { ...file.npcNames, [UNMARKED_NPC]: "Lost Scout" },
    sellers: { ...file.sellers, "4540": [{ id: 6928 }] },
    droppers: { ...file.droppers, "4541": [{ type: "npc", id: UNMARKED_NPC }] },
    quests: [
      questRow(176, 'WANTED: "Hogger"', { endPoints: [zonePoint(ELWYNN, 42.11, 65.93, npc("turn-in", 240, "Marshal Dughan"))] }),
      questRow(783, "A Threat Within", { startPoints: [zonePoint(ELWYNN, 48.92, 41.61, npc("accept", 823, "Deputy Willem"))] }),
      questRow(226, "Wolves at Our Heels", {
        zoneIds: [DUSKWOOD.id],
        objectives: [{ index: 1, type: "monster", id: 213, ids: [213], name: "Starving Dire Wolf" }],
        objectivePoints: [
          zonePoint(ELWYNN, 78.8, 90.2, npc("mob", 213, "Starving Dire Wolf")),
          ...[60.8, 61.6, 64.4].map((x) => zonePoint(DUSKWOOD, x, 16.8, npc("mob", 213, "Starving Dire Wolf"))),
        ],
      }),
      questRow(300, "Crates", {
        objectives: [{ index: 1, type: "object", id: 7000, ids: [7000], name: "Crate" }],
        objectivePoints: [zonePoint(ELWYNN, 50, 50, { kind: "object", sourceType: "object", sourceId: 7000, sourceName: "Crate" })],
      }),
    ],
  },
  plannerContext,
);
const map = data.terrainMap(worldMap);
const surface = terrainSurface(data, map, new WeakMap());
const context: FocusContext = {
  data,
  features: indexFeatures(data, map),
  surface,
  map,
  faction: "Horde",
  sim: undefined,
  preferredMap: undefined,
};

const stage = (world: WorldLocation) => canvasToView(map, worldToCanvas(map, world)!);
const stageAt = (uiMapId: number, x: number, y: number) => {
  const bounds = MAP_BOUNDS.get(uiMapId)!;
  return stage({ instance: bounds.instance, ...mapToWorld(bounds, x, y) });
};
const LOCAL = ((240 * map.pxPerChunk) / map.yardsPerChunk / canvasSize(map).width) * 100;

const focus = (body: string, options: Partial<FocusContext> & { line?: number } = {}): FocusResolution => {
  const doc = parseGuide(`#group T\n#name One\nstep\n${body}\n`);
  return resolveMapFocus({ kind: "line", doc, at: { step: 0, index: options.line ?? 0 } }, { ...context, ...options });
};
const located = (resolution: FocusResolution) => {
  if (resolution.kind !== "located") throw new Error(resolution.message);
  return resolution.focus;
};
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("resolveMapFocus", () => {
  it("shows a lone coordinate with 120 yards around it", () => {
    const shown = located(focus(".goto Elwynn Forest,48.94,40.16"));
    expect(shown.caption).toBe("Elwynn Forest 48.94, 40.16");
    expect(shown.map).toBe(1429);
    expect(shown.marks.map((m) => m.label)).toEqual(["Elwynn Forest 48.94, 40.16"]);
    close(shown.marks[0]!.at, stageAt(1429, 48.94, 40.16));
    if (!("x" in shown.fit)) throw new Error("Expected a centered fit");
    close(shown.fit, stageAt(1429, 48.94, 40.16));
    expect(shown.fit.width).toBeCloseTo(LOCAL, 9);
  });

  it("frames a whole path in its zone", () => {
    const shown = located(focus(".line Elwynn Forest,40,40,50,60"));
    expect(shown.caption).toBe(".line path, 2 points in Elwynn Forest");
    expect(shown.marks).toEqual([]);
    expect(shown.paths).toHaveLength(1);
    const [a, b] = [stageAt(1429, 40, 40), stageAt(1429, 50, 60)];
    expect(shown.paths[0]!.points).toHaveLength(2);
    shown.paths[0]!.points.forEach((p, i) => close(p, [a, b][i]!));
    const fit = shown.fit;
    if (!("left" in fit)) throw new Error("Expected a rectangular fit");
    expect(fit.left).toBeLessThan(Math.min(a.x, b.x));
    expect(fit.left + fit.width).toBeGreaterThan(Math.max(a.x, b.x));
    expect(fit.top).toBeLessThan(Math.min(a.y, b.y));
    expect(fit.top + fit.height).toBeGreaterThan(Math.max(a.y, b.y));
    expect(fit.width).toBeCloseTo(Math.abs(b.x - a.x) * 1.3, 9);
  });

  it("reports a coordinate it cannot place instead of an NPC the line names", () => {
    expect(focus(".goto Nowhere,40,40 >>Talk to Innkeeper Grosk (npc #6928)")).toEqual({
      kind: "unavailable",
      message: '.goto is not on the map: RXP has no zone named "Nowhere".',
    });
    expect(focus(".goto 2524,50,50")).toEqual({ kind: "unavailable", message: "The terrain map does not show Darkspear Islands." });
  });

  it("focuses a quest's giver for .accept and its ender for .turnin, over an NPC the line names", () => {
    const giver = located(focus(".accept 783 >>Talk to Innkeeper Grosk (npc #6928)"));
    expect(giver.caption).toBe("Starts A Threat Within: 1 location in Elwynn Forest");
    expect(giver.marks.map((m) => m.label)).toEqual(["Starts A Threat Within: Deputy Willem"]);
    close(giver.marks[0]!.at, stageAt(1429, 48.92, 41.61));
    const ender = located(focus(".turnin 176 >>Talk to Innkeeper Grosk (npc #6928)"));
    expect(ender.caption).toBe('Turn in WANTED: "Hogger": 1 location in Elwynn Forest');
    expect(ender.marks.map((m) => m.label)).toEqual(['Turn in WANTED: "Hogger": Marshal Dughan']);
    close(ender.marks[0]!.at, stageAt(1429, 42.11, 65.93));
    expect(focus(".accept 176")).toEqual({ kind: "unavailable", message: 'The dataset has no giver location for WANTED: "Hogger".' });
    expect(focus(".accept 999999")).toEqual({ kind: "unavailable", message: "The dataset has no quest #999999." });
  });

  it("frames every objective spawn in the quest's zone, or in the map shown when it has some", () => {
    const wolves = located(focus(".complete 226,1"));
    expect(wolves.caption).toBe("Wolves at Our Heels: Starving Dire Wolf: 3 locations in Duskwood, more in 1 other zone");
    expect(wolves.map).toBe(1431);
    expect(wolves.objective).toBe("226:1");
    expect(wolves.marks).toHaveLength(3);
    wolves.marks.forEach((m, i) => close(m.at, stageAt(1431, [60.8, 61.6, 64.4][i]!, 16.8)));

    const shown = located(focus(".complete 226,1", { preferredMap: 1429 }));
    expect(shown.caption).toBe("Wolves at Our Heels: Starving Dire Wolf: 1 location in Elwynn Forest, more in 1 other zone");
    expect(shown.marks).toHaveLength(1);
    close(shown.marks[0]!.at, stageAt(1429, 78.8, 90.2));
    expect(shown.fit.width).toBeCloseTo(LOCAL, 9);
  });

  it("prefers the zone of the step's coordinates among an NPC's markers", () => {
    const emissary = located(focus(">>See the Defilers Emissary (npc #14990)\n.goto Undercity,50,50"));
    expect(emissary.caption).toBe("Defilers Emissary: 1 location in Undercity, more in 2 other zones");
    expect(emissary.marks.map((m) => [m.label, m.pois.map((p) => p.entity?.id)])).toEqual([["Defilers Emissary", [14990]]]);
    expect(located(focus(">>See the Defilers Emissary (npc #14990)")).map).toBe(1454);
  });

  it("finds an NPC that no terrain marker shows by its recorded spawns, named by the dataset", () => {
    const lost = located(focus(`>>Find the scout (npc #${UNMARKED_NPC})`));
    expect(lost.caption).toBe("Lost Scout: 2 locations in Durotar");
    expect(lost.marks.map((m) => m.pois)).toEqual([[], []]);
    lost.marks.forEach((m, i) => close(m.at, stageAt(1411, [40, 44][i]!, 40)));
  });

  it("places an item by its sellers, then by the NPCs that drop it", () => {
    const sold = located(focus(".collect 4540,5"));
    expect(sold.caption).toBe("Sellers of item #4540: 1 location in Durotar");
    expect(sold.marks.map((m) => m.label)).toEqual(["Innkeeper Grosk sells item #4540"]);
    const dropped = located(focus(".collect 4541,5"));
    expect(dropped.caption).toBe("Droppers of item #4541: 2 locations in Durotar");
    expect(dropped.marks.map((m) => m.label)).toEqual(["Lost Scout drops item #4541", "Lost Scout drops item #4541"]);
    expect(focus(".collect 4542,5")).toEqual({ kind: "unavailable", message: "The dataset has no location for item #4542." });
  });

  it("places an object only by an objective of the step that names it", () => {
    const crate = located(focus(">>Open the Crate (object #7000)\n.complete 300,1"));
    expect(crate.caption).toBe("Crates: Crate: 1 location in Elwynn Forest");
    expect(crate.objective).toBe("300:1");
    expect(focus(">>Open the Crate (object #7000)")).toEqual({
      kind: "unavailable",
      message: "The dataset has no location for object #7000.",
    });
  });

  it("ignores inherited object names as quest commands", () => {
    const doc = parseGuide("step\n.toString 176\n");
    const line = doc.steps[0]?.body[0];
    if (!line) throw new Error("Expected the unknown command");
    expect(lineHasMapReference(line)).toBe(false);
    expect(focus(".toString 176")).toEqual({ kind: "unavailable", message: "This line names no place." });
  });

  it("says when a line names no place", () => {
    expect(focus(">>Train your skills")).toEqual({ kind: "unavailable", message: "This line names no place." });
    expect(focus(".goto Elwynn Forest,40,40", { line: 3 })).toEqual({
      kind: "unavailable",
      message: "That line is no longer in the guide.",
    });
  });
});
