import type { WorldPoint } from "../../../packages/data-contract/geometry.ts";
import type { Surface as Level } from "../../data/surfaces.ts";
import { formatWorldPoint } from "../../routing/plan.ts";
import { stacked, type StopLevel } from "./Interiors.tsx";
import type { StopPin } from "./RouteResult.tsx";

export const stopLabel = (i: number, last: number) => (i === 0 ? "Start" : i === last ? "Destination" : `Waypoint ${i}`);
export const stopName = (i: number, last: number) => (i > 0 && i < last ? `waypoint ${i}` : `the ${stopLabel(i, last).toLowerCase()}`);
export const stopPin = (i: number, last: number): StopPin =>
  i === 0 ? { kind: "route-start", text: "A" } : i === last ? { kind: "route-end", text: "B" } : { kind: "route-stop", text: String(i) };
const placeOf = (where: StopLevel | undefined) => {
  if (where?.onWorldMap) return "the world map";
  const level = where?.level;
  return level && (stacked(where) ? `${level.place}, level ${level.rank + 1} of ${level.of}` : level.place);
};
export const onLevel = (i: number, last: number, where: StopLevel | undefined) => {
  const place = placeOf(where);
  return `${stopLabel(i, last)}${place ? ` on ${place}` : ""}`;
};
export const pinLabel = (i: number, last: number, p: WorldPoint, where: StopLevel | undefined) =>
  `${onLevel(i, last, where)}${stacked(where) ? "," : ""} at ${yards(p)}`;
export const yards = (p: WorldPoint) => `world yards ${formatWorldPoint(p)}`;
const SHOWN = [" · ", "yd"] as const;
const SPOKEN = [", ", "yards"] as const;
const levelRow = (level: Level, chosen: Level | undefined, [sep, unit]: typeof SHOWN | typeof SPOKEN) => {
  const away = chosen && chosen.rank !== level.rank ? Math.round(level.height - chosen.height) : 0;
  const far = away ? `${sep}${Math.abs(away)} ${unit} ${away > 0 ? "above" : "below"}` : "";
  return `${level.place}${sep}${Math.round(level.height)} ${unit}${far}`;
};
export const levelOptions = (
  where: StopLevel,
): { shown: string; spoken?: string; checked: boolean; height: number | null; what: string }[] => [
  ...where.surfaces.toReversed().map((level) => ({
    shown: levelRow(level, where.level, SHOWN),
    spoken: levelRow(level, where.level, SPOKEN),
    checked: where.level?.rank === level.rank,
    height: level.height,
    what: `level ${level.rank + 1}`,
  })),
  { shown: "World map", checked: where.onWorldMap, height: null, what: "the world map" },
];
export const legName = (i: number, last: number) => `Leg ${i + 1} (${stopLabel(i, last)} → ${stopLabel(i + 1, last)})`;
