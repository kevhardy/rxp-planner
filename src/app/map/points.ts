import {
  canvasToWorld,
  centralSpawn,
  linkObjective,
  locatedSpawns,
  nearestSpawn,
  type CanvasPoint,
  type GameData,
  type MapLocation,
  type Quest,
  type QuestObjective,
  type QuestPoint,
  type UiMapId,
  type WorldMapData,
} from "../../data/index.ts";
import type { CommandLine, Step } from "../../guide/index.ts";
import type { Faction, SimData } from "../../rules/index.ts";
import { namedRow } from "../../rules/completeRows.ts";
import { stepMobs } from "../../rules/killTargets.ts";
import { lineQuest } from "../../rules/lineQuest.ts";
import { stepLocations } from "../../rules/points.ts";

export interface ViewPoint {
  x: number;
  y: number;
}

export function locateOnTerrain(data: GameData, map: WorldMapData, at: CanvasPoint, prefer?: UiMapId): MapLocation | undefined {
  const world = canvasToWorld(data.terrainMap(map), at);
  return world && data.locate(world, prefer);
}

export function movedArgs(data: GameData, line: CommandLine, to: MapLocation): string[] {
  return [...data.formatLocation(to), ...line.args.slice(3)];
}

export const ADD_COMMANDS = ["goto", "waypoint"] as const;

export type AddCommand = (typeof ADD_COMMANDS)[number];

export const DRAG_COMMANDS: ReadonlySet<string> = new Set(ADD_COMMANDS);

export type Placed = MapLocation & { at: ViewPoint };

export interface QuestSpot extends MapLocation {
  kind: "start" | "end" | "both" | "objective";
  label: string;
  quests?: { id: number; role: "start" | "end" }[];
  objectives?: SpotObjective[];
}

export interface SpotObjective extends Pick<StepObjective, "key" | "color"> {
  spawns: MapLocation[];
}

export interface StepObjective {
  key: string;
  quest: Quest;
  objective: QuestObjective;
  inferred: boolean;
  color: number;
}

const OBJECTIVE_COLORS = 6;

export const objectiveColor = (color: number): string => `var(--objective-${(color % OBJECTIVE_COLORS) + 1})`;

export function stepObjectives(data: GameData, step: Step, faction: Faction): Map<number, StepObjective> {
  const byLine = new Map<number, StepObjective>();
  const byKey = new Map<string, StepObjective>();
  step.body.forEach((line, index) => {
    if (line.kind !== "command" || line.name !== "complete") return;
    const id = lineQuest(line)?.questId;
    const quest = id === undefined ? undefined : data.quest(id, faction);
    if (!quest) return;
    const number = Number(line.args[1]);
    const row = namedRow(quest, number);
    if (!row) return;
    const objective = row.kind === "text" ? linkObjective(row.objective) : row.objective;
    if (!objective) return;
    const key = `${quest.id}:${number}`;
    let found = byKey.get(key);
    if (!found) byKey.set(key, (found = { key, quest, objective, inferred: row.kind === "text", color: byKey.size % OBJECTIVE_COLORS }));
    byLine.set(index, found);
  });
  return byLine;
}

export function questSpots(data: GameData, step: Step, faction: Faction, sim?: SimData): QuestSpot[] {
  const spots = new Map<string, QuestSpot>();
  const add = (key: string, kind: QuestSpot["kind"], label: string, at: MapLocation, objective?: SpotObjective) => {
    const spot = spots.get(key);
    if (!spot) spots.set(key, { kind, label, ...at, ...(objective && { objectives: [objective] }) });
    else {
      if (objective) spot.objectives!.push(objective);
      if (spot.label.split("; ").includes(label)) return;
      if (spot.kind !== kind) spot.kind = "both";
      spot.label += `; ${label}`;
    }
  };
  const objectives = stepObjectives(data, step, faction);
  const mobs = sim ? stepMobs(step, sim).mob : [];
  const stepPoints = stepLocations(data, step).points.map((p) => p.world);
  const marked = new Set<string>();
  step.body.forEach((line, index) => {
    if (line.kind !== "command") return;
    const id = lineQuest(line)?.questId;
    const quest = id === undefined ? undefined : data.quest(id, faction);
    if (!quest) return;
    const addPoints = (points: QuestPoint[], kind: "start" | "end", verb: string) => {
      for (const p of points) {
        const at = data.locateQuestPoint(p);
        const key = `${at.world.instance}:${at.world.x}:${at.world.y}`;
        add(key, kind, `${verb} ${quest.name}: ${p.sourceName}`, at);
        (spots.get(key)!.quests ??= []).push({ id: quest.id, role: kind });
      }
    };
    if (line.name === "accept") addPoints(quest.startPoints, "start", "Starts");
    else if (line.name === "turnin") addPoints(quest.endPoints, "end", "Turn in");
    else if (line.name === "complete") {
      const named = objectives.get(index);
      if (!named || marked.has(named.key)) return;
      marked.add(named.key);
      const { objective, key, color } = named;
      const located = locatedSpawns(data, quest, objective, faction, mobs);
      const narrowed = mobs.length > 0 && located.size < locatedSpawns(data, quest, objective, faction).size;
      const nearest = narrowed ? nearestSpawn([...located.keys()], stepPoints) : undefined;
      const center = nearest ?? centralSpawn([...located.keys()], quest.zoneIds);
      if (!center) return;
      const spawns = [...located.values()];
      const at = located.get(center)!;
      const label = `${quest.name}: ${objective.text ?? objective.name}${named.inferred ? " (inferred from page order)" : ""}, nearest ${nearest ? "the step's points among" : "the middle of"} ${spawns.length} ${spawns.length === 1 ? "location" : "locations"}`;
      const near = [...spots].find(
        ([, s]) => s.kind === "objective" && s.uiMapId === at.uiMapId && Math.hypot(s.x - at.x, s.y - at.y) < MERGE,
      );
      add(near?.[0] ?? key, "objective", label, at, { key, color, spawns });
    }
  });
  return [...spots.values()];
}

const MERGE = 3;
