export { worldToMap, mapToWorld, worldToCanvas, canvasToWorld, locateCanvas } from "../../packages/data-contract/geometry.ts";
export type { WorldBounds, WorldPoint, WorldLocation, CanvasPoint } from "../../packages/data-contract/geometry.ts";
export type { InstanceId, UiMapId, ZoneId } from "../../packages/data-contract/shared.ts";
import type { WorldLocation } from "../../packages/data-contract/geometry.ts";

export function yards(a: WorldLocation, b: WorldLocation): number {
  return a.instance === b.instance ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
}

export function within(p: WorldLocation, at: WorldLocation, radius: number): boolean {
  return p.instance === at.instance && Math.hypot(p.x - at.x, p.y - at.y) <= radius;
}

export function nearest<T extends WorldLocation>(points: readonly T[], from: WorldLocation | null): T | undefined {
  if (!from) return undefined;
  const near = points.filter((p) => p.instance === from.instance);
  return near.length ? near.reduce((a, b) => (yards(b, from) < yards(a, from) ? b : a)) : undefined;
}

/**
 * Zone names RXP accepts in `.goto` and other zone arguments, from
 * RXPGuides `DB/forever/db.lua` (`addon.mapId`). The dataset
 * gives each name's UI map ID. It also names maps that RXP rejects, such as
 * Warsong Gulch, so the selection stays here. Where names share a UI map,
 * the first listed is the canonical name used when formatting.
 */
export const RXP_ZONE_NAMES = [
  "Durotar",
  "Mulgore",
  "The Barrens",
  "Alterac Mountains",
  "Arathi Highlands",
  "Badlands",
  "Blasted Lands",
  "Tirisfal Glades",
  "Silverpine Forest",
  "Western Plaguelands",
  "Eastern Plaguelands",
  "Hillsbrad Foothills",
  "The Hinterlands",
  "Dun Morogh",
  "Searing Gorge",
  "Burning Steppes",
  "Elwynn Forest",
  "Deadwind Pass",
  "Duskwood",
  "Loch Modan",
  "Redridge Mountains",
  "Stranglethorn Vale",
  "Swamp of Sorrows",
  "Westfall",
  "Wetlands",
  "Teldrassil",
  "Darkshore",
  "Ashenvale",
  "Thousand Needles",
  "Stonetalon Mountains",
  "Desolace",
  "Feralas",
  "Dustwallow Marsh",
  "Tanaris",
  "Azshara",
  "Felwood",
  "Un'Goro Crater",
  "Moonglade",
  "Silithus",
  "Winterspring",
  "Stormwind City",
  "Orgrimmar",
  "Ironforge",
  "Thunder Bluff",
  "Darnassus",
  "Undercity",
  "Alterac Valley",
  "Kalimdor",
  "Eastern Kingdoms",
  "Zephras Isle",
] as const;

type RxpZoneName = (typeof RXP_ZONE_NAMES)[number];

interface PercentTransform {
  xScale: number;
  xOffset: number;
  yScale: number;
  yOffset: number;
}

export interface ZoneAlias {
  zone: RxpZoneName;
  transform: PercentTransform;
}

// RXP's reference points (`addon.classicToWrathSW` and the EPL tables in map.lua): the same
// place as [Classic x, Classic y, Wrath x, Wrath y].
type Reference = readonly [number, number, number, number];
const SW: [Reference, Reference] = [
  [25, 25, 39.02232393772481, 43.7789069363158],
  [75, 75, 77.70637435364208, 82.47040384981797],
];
const EPL: [Reference, Reference] = [
  [81.5169, 59.23138, 75.75077, 53.32378],
  [48.12616, 21.96377, 43.67876, 17.52954],
];
const swap = ([x, y, xb, yb]: Reference): Reference => [xb, yb, x, y];
const classicToWrath = ([p1, p2]: [Reference, Reference]) => coefficients(p1, p2);
const wrathToClassic = ([p1, p2]: [Reference, Reference]) => coefficients(swap(p1), swap(p2));

/**
 * The linear maps that RXP's `GetMapInfo` in map.lua applies to `.goto`
 * percentages for its Stormwind and Eastern Plaguelands aliases on Forever.
 * Every client before 3.0, Forever included, turns `StormwindNew` and
 * `EPLNew` (Wrath maps) into Classic percentages. `StormwindClassic` and
 * `EPLClassic` (Classic maps) become Wrath percentages on clients from 3.0
 * or when `WOW_PROJECT_ID` is `WOW_PROJECT_MAINLINE`. Blizzard's UI for
 * Forever leaves `WOW_PROJECT_ID` at Blizzard_BNet's default,
 * `WOW_PROJECT_MAINLINE`, and only Plunderstorm sets another, so Forever
 * converts all four. No one has checked this in game.
 *
 * https://github.com/Gethe/wow-ui-source/blob/bd2470aed543f72697a044e989285b6c83e63f73/Interface/AddOns/Blizzard_BNet/Mainline/BNet.lua#L10
 */
export const RXP_ZONE_ALIASES: Readonly<Record<string, ZoneAlias>> = {
  StormwindClassic: { zone: "Stormwind City", transform: classicToWrath(SW) },
  StormwindNew: { zone: "Stormwind City", transform: wrathToClassic(SW) },
  EPLClassic: { zone: "Eastern Plaguelands", transform: classicToWrath(EPL) },
  EPLNew: { zone: "Eastern Plaguelands", transform: wrathToClassic(EPL) },
};

export const RXP_ZONE_TOKENS: readonly string[] = [...RXP_ZONE_NAMES, ...Object.keys(RXP_ZONE_ALIASES)];

/** Coefficients mapping p[0..1] to p[2..3] for two points, as RXP's GetMapCoefficients. */
function coefficients(p1: Reference, p2: Reference): PercentTransform {
  const [x1, y1, x1b, y1b] = p1;
  const [x2, y2, x2b, y2b] = p2;
  const xScale = (x1b - x2b) / (x1 - x2);
  const yScale = (y1b - y2b) / (y1 - y2);
  return { xScale, xOffset: x1b - x1 * xScale, yScale, yOffset: y1b - y1 * yScale };
}
