import { factionData, placeText, warningText } from "../rules/index.ts";
import {
  CLASSES,
  PLAYABLE_RACES,
  yards,
  type ClassName,
  type GameData,
  type InstanceId,
  type PlayableRace,
  type Quest,
  type QuestPoint,
  type WorldLocation,
  type ZoneId,
} from "../data/index.ts";
import { parseGuide, splitArgs, type GuideDocument } from "../guide/index.ts";
import {
  createProfile,
  describeReason,
  simulateRoute,
  validateSimulation,
  type Faction,
  type Profile,
  type RouteSimulation,
  type Warning,
} from "../rules/index.ts";
import { worldToMap } from "../../packages/data-contract/geometry.ts";
import { ToolError, type AgentContext, type JsonSchema } from "./tool.ts";

export const MAX_GUIDE = 200_000;

export const CHARACTER = {
  race: { type: "string", enum: PLAYABLE_RACES, description: "Race file name, such as Human, NightElf, or Scourge." },
  class: { type: "string", enum: CLASSES, description: "Class token in capitals, such as WARRIOR." },
  level: { type: "integer", minimum: 1, maximum: 60, default: 1, description: "Start level." },
} as const satisfies Record<string, JsonSchema>;

export interface CharacterInput {
  race: PlayableRace;
  class: ClassName;
  level: number;
}

// Forever has no auction house, so the tools plan for a solo self-found character.
export const profileOf = (input: CharacterInput): Profile =>
  createProfile({ race: input.race, class: input.class, level: input.level, soloSelfFound: true });

export const POINT: JsonSchema = {
  type: "string",
  maxLength: 200,
  description:
    '`.goto` arguments: "Elwynn Forest,48.2,42.8" (zone percent) or "1429/0,-137.5,-8930.2" (world). Tools return points in this form.',
};

export function questsFor(game: GameData, faction: Faction | undefined): Quest[] {
  return game.quests.flatMap((q) => game.quest(q.id, faction) ?? []);
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Place {
  zone: string;
  goto: string;
  world: [map: InstanceId, x: number, y: number];
}

export function worldPlace(game: GameData, world: WorldLocation): Place {
  const zone = game.zoneAt(world);
  const at: Place["world"] = [world.instance, round1(world.x), round1(world.y)];
  if (zone?.bounds && zone.uiMapId !== undefined) {
    const { x, y } = worldToMap(zone.bounds, world);
    return { zone: zone.name, goto: game.formatLocation({ uiMapId: zone.uiMapId, x, y }).join(","), world: at };
  }
  const continent = game.continents.find((c) => c.instance === world.instance);
  const map = continent?.uiMapId ?? 0;
  return { zone: continent?.name ?? `map ${world.instance}`, goto: `${map}/${world.instance},${at[1]},${at[2]}`, world: at };
}

export function pointPlace(game: GameData, point: QuestPoint): Place {
  const located = game.locateQuestPoint(point);
  const { world } = point;
  return {
    zone: game.mapName(point.uiMapId),
    goto: game.formatLocation(located).join(","),
    world: [world.instance, round1(world.x), round1(world.y)],
  };
}

export function parsePoint(game: GameData, text: string): WorldLocation {
  const args = splitArgs("goto", text.replace(/^\s*\.?goto\s+/, "").trim()).map((a) => a.trim());
  const located = game.locateGoto(args);
  if (!located.ok) throw new ToolError(`Cannot read point "${text}": ${located.message}`);
  return located.world;
}

export interface Area {
  count: number;
  center: WorldLocation;
  radius: number;
}

const AREA_LINK_YARDS = 45;

function areas(points: readonly WorldLocation[]): Area[] {
  const parent = points.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const cells = new Map<string, number[]>();
  const key = (p: WorldLocation, dx = 0, dy = 0) =>
    `${p.instance}:${Math.floor(p.x / AREA_LINK_YARDS) + dx}:${Math.floor(p.y / AREA_LINK_YARDS) + dy}`;
  points.forEach((p, i) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(key(p, dx, dy)) ?? []) if (yards(p, points[j]!) <= AREA_LINK_YARDS) parent[root(i)] = root(j);
    const own = key(p);
    cells.set(own, [...(cells.get(own) ?? []), i]);
  });
  const groups = new Map<number, WorldLocation[]>();
  points.forEach((p, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), p]));
  return [...groups.values()]
    .map((group) => {
      const mean = { x: group.reduce((s, p) => s + p.x, 0) / group.length, y: group.reduce((s, p) => s + p.y, 0) / group.length };
      const center = group.reduce((best, p) =>
        Math.hypot(p.x - mean.x, p.y - mean.y) < Math.hypot(best.x - mean.x, best.y - mean.y) ? p : best,
      );
      const spread = group.map((p) => yards(p, center)).sort((a, b) => a - b);
      return { count: group.length, center, radius: Math.round(spread[Math.floor(0.9 * (spread.length - 1))]!) };
    })
    .sort((a, b) => b.count - a.count);
}

export function areaPlaces(game: GameData, points: readonly WorldLocation[], near?: WorldLocation, limit = 3) {
  const found = areas(points);
  if (near) found.sort((a, b) => yards(a.center, near) - yards(b.center, near));
  return found.slice(0, limit).map((area) => ({
    spawns: area.count,
    radius: area.radius,
    ...(near && { yards: Math.round(yards(area.center, near)) }),
    ...worldPlace(game, area.center),
  }));
}

export interface NpcSpots {
  points: QuestPoint[];
  starts: number[];
  ends: number[];
}

const npcIndex = new WeakMap<GameData, Map<string, Map<number, NpcSpots>>>();

export function npcSpots(game: GameData, faction: Faction | undefined): Map<number, NpcSpots> {
  let byFaction = npcIndex.get(game);
  if (!byFaction) npcIndex.set(game, (byFaction = new Map<string, Map<number, NpcSpots>>()));
  const key = faction ?? "shared";
  let index = byFaction.get(key);
  if (index) return index;
  index = new Map();
  const seen = new Set<string>();
  const spot = (id: number) => {
    let entry = index.get(id);
    if (!entry) index.set(id, (entry = { points: [], starts: [], ends: [] }));
    return entry;
  };
  for (const quest of questsFor(game, faction))
    for (const [points, role] of [
      [quest.startPoints, "starts"],
      [quest.endPoints, "ends"],
      [quest.objectivePoints, undefined],
    ] as const)
      for (const point of points) {
        if (point.sourceType !== "npc" || point.sourceId === undefined) continue;
        const entry = spot(point.sourceId);
        if (role && !entry[role].includes(quest.id)) entry[role].push(quest.id);
        const where = `${point.sourceId}:${point.world.instance}:${Math.round(point.world.x)}:${Math.round(point.world.y)}`;
        if (!seen.has(where)) {
          seen.add(where);
          entry.points.push(point);
        }
      }
  byFaction.set(key, index);
  return index;
}

const followerIndex = new WeakMap<GameData, Map<number, number[]>>();

export function followers(game: GameData, id: number): number[] {
  let index = followerIndex.get(game);
  if (!index) {
    index = new Map();
    for (const quest of game.quests)
      for (const pre of new Set([...(quest.preQuestSingle ?? []), ...(quest.preQuestGroup ?? [])]))
        index.set(pre, [...(index.get(pre) ?? []), quest.id]);
    followerIndex.set(game, index);
  }
  return index.get(id) ?? [];
}

export const questRef = (game: GameData, id: number) => ({ id, name: game.quest(id)?.name ?? null });

export interface GuideRun {
  doc: GuideDocument;
  profile: Profile;
  simulation: RouteSimulation;
  warnings: Warning[];
  hidden?: string;
}

export function runGuide(ctx: AgentContext, text: string, character: CharacterInput, xp = 0): GuideRun {
  const profile = profileOf(character);
  const doc = parseGuide(text);
  const { sim, lookup } = factionData(ctx.game, ctx.entities, profile.faction);
  const simulation = simulateRoute([doc], 0, profile, sim, xp);
  const warnings = validateSimulation([doc], simulation, lookup);
  const reason = simulation.guides[0]?.hidden;
  return { doc, profile, simulation, warnings, ...(reason && { hidden: describeReason(reason, profile) }) };
}

const warningMessage = (game: GameData, warning: Warning) =>
  warningText(
    warning,
    (id) => game.quest(id),
    () => "another guide",
  );

export const warningLine = (game: GameData, warning: Warning) => `${placeText(warning.at)}: ${warningMessage(game, warning)}`;

export function groupedWarnings(game: GameData, warnings: readonly Warning[]): string[] {
  const places = new Map<string, string[]>();
  for (const w of warnings) {
    const message = warningMessage(game, w);
    places.set(message, [...(places.get(message) ?? []), placeText(w.at)]);
  }
  return [...places].map(
    ([message, at]) => `${at[0]}${at.length > 1 ? ` and ${at.length - 1} more place${at.length > 2 ? "s" : ""}` : ""}: ${message}`,
  );
}

export const isDataGap = (game: GameData, w: Warning) =>
  (w.kind === "unknownQuest" && game.quest(w.questId) !== undefined) || w.kind === "noQuestXp";

export function zoneId(game: GameData, name: string): ZoneId {
  const key = name.trim().toLowerCase();
  const exact = game.zoneByName(name) ?? game.zones.find((z) => z.name.toLowerCase() === key);
  if (exact) return exact.id;
  const close = game.zones.filter((z) => z.name.toLowerCase().includes(key) || key.includes(z.name.toLowerCase()));
  if (close.length === 1) return close[0]!.id;
  const hint = close.length
    ? `Did you mean ${close
        .slice(0, 5)
        .map((z) => z.name)
        .join(", ")}?`
    : "Use a zone name such as Elwynn Forest.";
  throw new ToolError(`No zone named "${name}". ${hint} Subzones such as Northshire Abbey belong to their zone.`);
}
