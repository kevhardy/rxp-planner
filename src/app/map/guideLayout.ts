import { pointLabel, type GameData } from "../../data/index.ts";
import type { GuideDocument } from "../../guide/index.ts";
import { commandRule } from "../../rules/commands.ts";
import type { Faction, SimData } from "../../rules/index.ts";
import { isOptionalPoint, isRouteStop, type PointProblem, type StepPoints } from "../../rules/points.ts";
import type { Selection } from "../store.ts";
import type { AreaRing } from "./areas.ts";
import { slices, type Area, type Pin, type Shape, type Spawn } from "./MapCanvas.tsx";
import type { StepShow } from "./mapSettings.ts";
import { DRAG_COMMANDS, objectiveColor, questSpots, type Placed, type QuestSpot, type SpotObjective, type ViewPoint } from "./points.ts";
import type { Surface } from "./surfaces.ts";

const NEARBY = 10;

const QUEST_ICONS = {
  start: ["quest-giver"],
  end: ["quest-turn-in"],
  both: ["quest-giver", "quest-turn-in"],
};

function pinKind(command: string): "waypoint" | "goto" {
  const run = commandRule(command)?.point?.run;
  return run === "waypoint" || run === "ingamewaypoint" ? "waypoint" : "goto";
}

interface StepLook {
  side: "previous" | "selected" | "upcoming";
  fade: number;
}

function stepLook(d: number, steps: { previousSteps: StepShow; upcomingSteps: StepShow }): StepLook | undefined {
  if (d === 0) return { side: "selected", fade: 1 };
  const side = d < 0 ? "previous" : "upcoming";
  const show = d < 0 ? steps.previousSteps : steps.upcomingSteps;
  if (show === "hidden") return undefined;
  if (show === "shown") return { side, fade: 1 };
  return { side, fade: d < 0 ? 0.4 : 0.8 - (d - 1) * 0.06 };
}

const allPoints = (p: StepPoints<Placed>): (Placed & { line: number })[] =>
  [...p.points, ...p.paths.flatMap((path) => path.points.map((q) => ({ ...q, line: path.line })))].sort((a, b) => a.line - b.line);

export type StepPoint = StepPoints<Placed>["points"][number];

export interface LayoutInput {
  data: GameData;
  doc: GuideDocument;
  selection: Selection;
  spots: QuestSpot[];
  areas: Area[];
  highlight: string | null;
  showGuide: boolean;
  previousSteps: StepShow;
  upcomingSteps: StepShow;
}

export type LaidPin = Omit<Pin, "activate" | "menu" | "move" | "drag"> & {
  target: { step: number; line: number | null; drag?: StepPoint | undefined } | { spot: QuestSpot; title: string };
};

export interface Layout {
  pins: LaidPin[];
  shapes: Shape[];
  spawns: Spawn[];
  dots: Spawn[];
  areas: Area[];
  problems: PointProblem[];
  placed: number;
  describe: (at: ViewPoint) => string;
}

function objectiveSpawns(surface: Surface, spots: QuestSpot[], highlight: string | null): { spawns: Spawn[]; dots: Spawn[] } {
  const places = new Map<string, { at: ViewPoint; objectives: SpotObjective[] }>();
  for (const spot of spots) {
    for (const o of spot.objectives ?? []) {
      for (const p of o.spawns) {
        const key = `${p.world.instance}:${p.world.x}:${p.world.y}`;
        const place = places.get(key);
        if (place) {
          if (!place.objectives.includes(o)) place.objectives.push(o);
          continue;
        }
        const at = surface.project(p);
        if (at) places.set(key, { at, objectives: [o] });
      }
    }
  }
  const spawns: Spawn[] = [];
  const dots: Spawn[] = [];
  for (const [key, { at, objectives }] of places) {
    const spawn = { key, at, colors: objectives.map((o) => objectiveColor(o.color)) };
    spawns.push(spawn);
    if (objectives.some((o) => o.key === highlight)) dots.push(spawn);
  }
  return { spawns, dots };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function projectAreas(surface: Surface, areas: { key: string; color: number; rings: AreaRing[] }[]): Area[] {
  return areas.flatMap(({ key, color, rings }) => {
    const d = rings
      .map(({ instance, points }) => points.map((p) => surface.projectOutline({ instance, ...p })))
      .filter((ats): ats is ViewPoint[] => {
        if (!ats.every((at) => at !== undefined)) return false;
        const [xs, ys] = [ats.map((at) => at.x), ats.map((at) => at.y)];
        return Math.max(...xs) >= 0 && Math.min(...xs) <= 100 && Math.max(...ys) >= 0 && Math.min(...ys) <= 100;
      })
      .map((ats) => `M${ats.map((at) => `${round(at.x)} ${round(at.y)}`).join("L")}Z`)
      .join("");
    return d ? [{ key, color: objectiveColor(color), d }] : [];
  });
}

function objectiveAreas(areas: Area[], highlight: string | null): Area[] {
  if (highlight === null) return areas;
  const states = areas.map((a): Area => ({ ...a, state: a.key === highlight ? "focus" : "dim" }));
  return [...states.filter((a) => a.state === "dim"), ...states.filter((a) => a.state === "focus")];
}

export function guideLayout(surface: Surface, input: LayoutInput): Layout {
  const { data, doc, selection } = input;
  const step = selection.step;
  const current = step === null ? undefined : surface.place(doc.steps[step]!);
  const placed = current ? allPoints(current) : [];
  const faint: LaidPin[] = [];
  const pins: LaidPin[] = [];
  const spotPins: LaidPin[] = [];
  const faintShapes: Shape[] = [];
  const shapes: Shape[] = [];
  if (doc.steps.length > 0 && input.showGuide) {
    const origin = step ?? -1;
    let last: ViewPoint | undefined;
    for (let i = Math.max(0, origin - NEARBY); i <= Math.min(doc.steps.length - 1, origin + NEARBY); i++) {
      const { points, paths, loop } = surface.place(doc.steps[i]!);
      const look = stepLook(i - origin, input);
      const body = doc.steps[i]!.body;
      const optional = points.map((p) => isOptionalPoint(body[p.line]!));
      const stops = points.filter((p) => isRouteStop(body[p.line]!)).map((p) => p.at);
      const from = last;
      if (stops.length > 0) last = look && stops.at(-1);
      if (!look) continue;
      const into = look.side === "selected" ? shapes : faintShapes;
      const route = { className: `route ${look.side}`, fade: look.fade, cased: true };
      if (loop && stops.length > 2) {
        if (from) into.push({ key: `link${i}`, points: [from, stops[0]!], closed: false, ...route });
        into.push({ key: `loop${i}`, points: stops, closed: true, ...route });
      } else {
        const run = from ? [from, ...stops] : stops;
        if (run.length > 1) into.push({ key: `route${i}:0`, points: run, closed: false, ...route });
      }
      for (const [k, p] of points.entries()) {
        const { at } = p;
        const where = `${surface.describe(p)}${optional[k] ? " (optional)" : ""}`;
        const fade = look.fade * (optional[k] ? 0.45 : 1);
        if (look.side === "selected") {
          pins.push({
            key: `p${i}:${p.line}`,
            at,
            kind: pinKind(p.command),
            text: String(i + 1),
            label: `Selected step ${i + 1}, line ${p.line + 1}: .${p.command} ${where}`,
            fade,
            selected: selection.line === p.line,
            target: { step: i, line: p.line, drag: DRAG_COMMANDS.has(p.command) ? p : undefined },
          });
        } else {
          faint.push({
            key: `p${i}:${p.line}`,
            at,
            kind: look.side,
            text: String(i + 1),
            label: `${look.side === "previous" ? "Previous" : "Upcoming"} step ${i + 1}: .${p.command} ${where}`,
            fade,
            target: { step: i, line: null },
          });
        }
      }
      for (const path of paths) {
        into.push({
          key: `line${i}:${path.line}`,
          points: path.points.map((p) => p.at),
          closed: path.command === "loop",
          className: `rxp-line ${look.side}`,
          fade: look.fade,
        });
      }
    }

    if (step !== null) {
      const { highlight } = input;
      input.spots.forEach((spot, s) => {
        const objectives = spot.objectives ?? [];
        const at = surface.project(spot);
        if (!at) return;
        const title = `${spot.label} (${data.mapName(spot.uiMapId)} ${pointLabel(spot.x, spot.y)})`;
        spotPins.push({
          key: `q${s}`,
          at,
          kind: spot.kind,
          label: title,
          ...(objectives.length > 0 && { fill: slices(objectives.map((o) => objectiveColor(o.color))) }),
          ...(highlight !== null && objectives.length > 0 && !objectives.some((o) => o.key === highlight) && { fade: 0.12 }),
          ...(spot.kind !== "objective" && { icons: QUEST_ICONS[spot.kind] }),
          target: { spot, title },
        });
      });
    }
  }
  const ordered = [...faint, ...pins, ...spotPins];
  return {
    pins: ordered,
    shapes: [...faintShapes, ...shapes],
    ...(step === null ? { spawns: [], dots: [] } : objectiveSpawns(surface, input.spots, input.highlight)),
    areas: step === null ? [] : objectiveAreas(input.areas, input.highlight),
    problems: current?.problems ?? [],
    placed: placed.length,
    describe: (at) => {
      const p = surface.locate(at);
      return p ? surface.describe(p) : `${surface.name} ${at.x.toFixed(2)}, ${at.y.toFixed(2)}`;
    },
  };
}

export function followedMap(
  surface: Surface,
  data: GameData,
  doc: GuideDocument,
  selection: Selection,
  faction: Faction,
  sim?: SimData,
): number | undefined {
  const from = selection.step ?? 0;
  if (doc.steps.length === 0) return undefined;
  const own = allPoints(surface.place(doc.steps[from]!));
  const hit = (selection.step === null ? undefined : own.find((p) => p.line === selection.line)) ?? own[0];
  if (hit) return surface.mapOf(hit);
  const spot = questSpots(data, doc.steps[from]!, faction, sim).find((s) => surface.fitMap(s.uiMapId));
  if (spot) return spot.uiMapId;
  for (let d = 1; d < doc.steps.length; d++) {
    for (const i of [from - d, from + d]) {
      const p = i >= 0 && i < doc.steps.length ? allPoints(surface.place(doc.steps[i]!))[0] : undefined;
      if (p) return surface.mapOf(p);
    }
  }
  return undefined;
}
