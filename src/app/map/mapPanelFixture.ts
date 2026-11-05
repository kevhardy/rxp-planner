import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { GameData, mapToWorld, worldToCanvas, type GameDataFile, type QuestPoint, type WorldLocation } from "../../data/index.ts";
import { MAP_BOUNDS, plannerContext, plannerFile } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { questRow, zonePoint, ZONES } from "../testing.ts";
import { canvasToView } from "./viewport.ts";

export const DUSKWOOD = { id: 10, uiMapId: 1431 };
const ZEPHRAS_ISLE = { id: 16593, uiMapId: 2521 };
export const STORMWIND = { id: 1519, uiMapId: 1453 };
export const ORGRIMMAR = { id: 1637, uiMapId: 1454 };
export const ELWYNN = ZONES.elwynn.uiMapId;

export const npc = (kind: QuestPoint["kind"], sourceId: number, sourceName: string) => ({ kind, sourceType: "npc", sourceId, sourceName });
export const spawns = (on: { id: number; uiMapId: number }, from: Parameters<typeof zonePoint>[3], ...xy: [number, number][]) =>
  xy.map(([x, y]) => zonePoint(on, x, y, from));
const viktori = (kind: string) => spawns(DUSKWOOD, npc(kind, 276, "Viktori Prism'Antras"), [79.8, 48.02]);
export const flank = { kind: "item", sourceType: "item", sourceId: 1015, sourceName: "Lean Wolf Flank" };
export const starving = npc("mob", 213, "Starving Dire Wolf");
export const rabid = npc("mob", 565, "Rabid Dire Wolf");

const HARMONY = questRow(92461, "Harmony in Balance", {
  startPoints: [zonePoint(ZEPHRAS_ISLE, 42, 23.4, npc("start", 251361, "Rorian the Dayseeker"))],
});

export const withQuests = (quests: GameDataFile["quests"]) => new GameData({ ...plannerFile(), quests }, plannerContext);

export const data = withQuests([
  questRow(174, "Look to the Stars", { questLevel: 25, requiredLevel: 20, startPoints: viktori("start"), endPoints: viktori("turn-in") }),
  questRow(90, "Seasoned Wolf Kabobs", {
    questLevel: 25,
    requiredLevel: 18,
    objectives: [{ index: 1, type: "item", id: 1015, ids: [1015], name: "Lean Wolf Flank" }],
    objectivePoints: spawns(DUSKWOOD, flank, [30, 30], [32, 30], [34, 30]),
  }),
  questRow(226, "Wolves at Our Heels", {
    questLevel: 21,
    requiredLevel: 19,
    objectives: [
      { index: 1, type: "monster", id: 213, ids: [213], name: "Starving Dire Wolf" },
      { index: 2, type: "monster", id: 565, ids: [565], name: "Rabid Dire Wolf" },
    ],
    objectivePoints: [
      ...spawns(DUSKWOOD, starving, [60.8, 16.8], [61.6, 16.8], [64.4, 18.1]),
      ...spawns(ZONES.elwynn, starving, [78.8, 90.2]),
      ...spawns(DUSKWOOD, rabid, [33.1, 29.1], [29.6, 28.6]),
    ],
  }),
  questRow(176, 'WANTED: "Hogger"', {
    questLevel: 11,
    requiredLevel: 5,
    endPoints: spawns(ZONES.elwynn, npc("turn-in", 240, "Marshal Dughan"), [42.11, 65.93]),
  }),
  HARMONY,
]);

const viewOf = (world: WorldLocation) => canvasToView(worldMap, worldToCanvas(worldMap, world)!);
export const stageAt = (uiMapId: number, x: number, y: number) => {
  const bounds = MAP_BOUNDS.get(uiMapId)!;
  return viewOf({ instance: bounds.instance, ...mapToWorld(bounds, x, y) });
};
export const clientAt = (uiMapId: number, x: number, y: number) => {
  const at = stageAt(uiMapId, x, y);
  return { clientX: at.x * 10, clientY: at.y * 10 };
};

export const mapShown = () => screen.getByRole<HTMLSelectElement>("combobox", { name: "Map shown" });
export const mapArea = () => screen.getByRole("group", { name: /^Map of / });
export const [O1, O2, O3] = ["var(--map-objective-1)", "var(--map-objective-2)", "var(--map-objective-3)"] as const;
export const spawnDots = () =>
  [...mapArea().querySelectorAll<HTMLElement | SVGElement>(".spawns g, .spawn")].flatMap((d) => {
    const segments = d instanceof SVGElement ? d.querySelector("path:not(.edge)")!.getAttribute("d")!.split("M").length - 1 : 1;
    return Array<string>(segments).fill(d.style.getPropertyValue("--fill"));
  });
export const dotCounts = () => {
  const counts: Record<string, number> = {};
  for (const dot of spawnDots()) counts[dot] = (counts[dot] ?? 0) + 1;
  return counts;
};
export const focusedFills = () => [...new Set(spawnDots())];
export const areas = () =>
  [...mapArea().querySelectorAll<SVGElement>(".areas g")].map((g) =>
    [g.style.getPropertyValue("--fill"), ...["focus", "dim"].filter((c) => g.classList.contains(c))].join(" "),
  );
export const transform = () => {
  const m = /^translate\(([-\d.]+)px, ([-\d.]+)px\)$/.exec(
    mapArea().querySelector<HTMLElement>(".map-stage")!.style.getPropertyValue("--pan"),
  )!;
  return [Number(m[1]), Number(m[2]), Number(mapArea().style.getPropertyValue("--zoom"))] as const;
};
export const view = () => {
  const [x, y, zoom] = transform();
  return [mapShown().value, Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(zoom * 1e4) / 1e4];
};
export async function addAt(user: ReturnType<typeof userEvent.setup>, uiMapId: number, x: number, y: number, item = "Add .goto") {
  await user.pointer({ keys: "[MouseRight]", target: mapArea(), coords: clientAt(uiMapId, x, y) });
  await user.click(screen.getByRole("menuitem", { name: item }));
}
