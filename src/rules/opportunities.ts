import { linkObjective, locatedSpawns, yards, type GameData, type WorldLocation, type ZoneId } from "../data/index.ts";
import { luaNumber, type GuideDocument, type Step } from "../guide/index.ts";
import type { StepPreview } from "./preview.ts";
import type { Faction, Profile } from "./profile.ts";
import { questAccess, trivialQuest } from "./questAccess.ts";
import { objectiveRef } from "./character.ts";
import { completeIndex, completeRows } from "./completeRows.ts";
import { objectiveTargets } from "./killTargets.ts";
import { lineQuest } from "./lineQuest.ts";
import {
  collectLine,
  refKey,
  windowEnds,
  windowOpen,
  type ObjectiveRef,
  type QuestProgress,
  type RouteSimulation,
  type SimData,
} from "./simulate.ts";

/** How the player works on an objective: kill its mobs, kill mobs for a drop, or loot objects or items on the ground. */
type OpportunityKind = "kill" | "drop" | "object";

export interface Spawn {
  /** The zone that the source lists the point under. */
  zoneId: ZoneId;
  world: WorldLocation;
  /** The NPC to kill, for `kill` and `drop` spawns. */
  npc?: number;
}

export interface ObjectiveArea {
  ref: ObjectiveRef;
  kind: OpportunityKind;
  name: string;
  spawns: readonly Spawn[];
}

export interface OpportunityData extends Pick<SimData, "quest" | "locateGoto" | "rules"> {
  /** The areas of the quest's objective rows that need kills or loot, numbered as `SimQuest` numbers its rows. */
  areas(questId: number): readonly ObjectiveArea[];
  /** Quests with an objective spawn in the zone. */
  questsInZone(zoneId: ZoneId): readonly number[];
  npcName(id: number): string | undefined;
  /** The name of the quest's first giver. */
  giverName(questId: number): string | undefined;
}

interface Opportunity {
  questId: number;
  /** `index` is the number `.complete` takes; null when the data does not establish it. */
  objective: { row: number; index: number | null; name: string };
  kind: OpportunityKind;
  /** `log`: the quest is in the log. `pickup`: the character can take the quest now. */
  source: "log" | "pickup";
  /**
   * The shortest distance from the step's area to a spawn of the objective, in yards. For a pickup, this does not include
   * the trip to the giver.
   */
  distanceYards: number;
  /** The share of the step's area points that have a spawn of the objective within the radius. */
  overlapShare: number;
  /** Kills or items still needed; null when the required count is unknown. */
  remaining: number | null;
  /** NPCs near the step's area that give the objective, most spawns first. */
  mobs: readonly number[];
  /** An active `#completewith` or `#sticky` step already works on the objective. */
  covered: boolean;
  /** The next step in the guide that works on the objective, or accepts the quest for a pickup; null when none does. */
  plannedStep: number | null;
  /** RXP text to paste before the step. */
  suggestion: string;
}

export interface StepOpportunities {
  /** `GuidePreview.source` and the index into `doc.steps`. */
  guide: number;
  step: number;
  zoneId: ZoneId;
  /** How many spawns make the step's area. */
  points: number;
  /**
   * Uncovered first, then quests in the log before pickups, which need a
   * visit to the giver, then by overlap share times the remaining share,
   * then by distance. The ranking ignores drop chances, so a rare drop that guide authors skip can rank high.
   */
  opportunities: Opportunity[];
}

export interface OpportunityOptions {
  /** Yards from the step's area that count as near. */
  radius?: number;
  /** Yards from the step's `.goto` points within which its own objective spawns make its area. */
  focus?: number;
  /** The least overlap share to report. */
  minShare?: number;
}

/**
 * The opportunities at each shown step that works on objectives with
 * `.complete` or `.collect` lines. The step's area is the spawns of its own
 * objectives within `focus` yards of its `.goto` points, or all of them for
 * a step without places, in the zone that holds most of them. A candidate is an
 * objective, not complete in the log before the step, of a quest in the log
 * or of a quest the character can take and that is not gray, that is not the
 * step's own and has spawns in the zone. Steps that are themselves
 * `#completewith` or `#sticky` give none.
 */
export function findOpportunities(
  guides: readonly GuideDocument[],
  simulation: RouteSimulation,
  profile: Profile,
  data: OpportunityData,
  { radius = 100, focus = 150, minShare = 0.1 }: OpportunityOptions = {},
): StepOpportunities[] {
  const grids = new Map<string, Grid>();
  const gridOf = (area: ObjectiveArea) => {
    const key = refKey(area.ref);
    return grids.get(key) ?? grids.set(key, grid(area.spawns, radius)).get(key)!;
  };
  const areaOf = (ref: ObjectiveRef) => data.areas(ref.questId).find((a) => refKey(a.ref) === refKey(ref));
  const result: StepOpportunities[] = [];

  for (const g of simulation.guides) {
    if (g.hidden) continue;
    const doc = guides[g.source]!;
    const ends = windowEnds(doc.steps, profile);
    const work = g.steps.map((snap, s) => (snap.preview.shown ? stepWork(doc.steps[s]!, snap.preview, data) : undefined));

    g.steps.forEach((snap, s) => {
      const own = work[s];
      if (!own?.targets.length || asYouGo(snap.preview)) return;
      const { before } = snap;
      const spawns = own.targets.flatMap((ref) => areaOf(ref)?.spawns ?? []);
      const places = own.gotos.map((args) => data.locateGoto(args)).filter((p) => p !== undefined);
      const located = stepArea(spawns, places, focus);
      if (!located) return;
      const { zoneId, area } = located;
      const ownKeys = new Set(own.targets.map(refKey));
      const firstCoverStep = firstCoverSteps(g.steps, work, s, ends);
      // The window's kills, or a `#sticky` step's `.complete` line, can mark a covered objective done while the window
      // still works on it.
      const progressBeforeCover = (ref: ObjectiveRef, progress: QuestProgress | undefined) => {
        const cover = firstCoverStep.get(refKey(ref));
        return (cover === undefined ? undefined : g.steps[cover]!.before.log.get(ref.questId)) ?? progress;
      };
      const found: { opportunity: Opportunity; score: number }[] = [];

      const consider = (questId: number, source: Opportunity["source"], progress?: QuestProgress) => {
        const quest = data.quest(questId);
        if (!quest) return;
        for (const candidate of data.areas(questId)) {
          const { ref } = candidate;
          if (ownKeys.has(refKey(ref))) continue;
          const read = progressBeforeCover(ref, progress);
          const row = read?.objectives[ref.row];
          if (row?.complete) continue;
          const overlap = measure(area, gridOf(candidate), zoneId);
          if (overlap.share < minShare) continue;
          const objective = quest.objectives[ref.row]!;
          const required = objective.count;
          const opportunity: Omit<Opportunity, "suggestion"> = {
            questId,
            objective: { row: ref.row, index: completeIndex(objective, ref.row), name: candidate.name },
            kind: candidate.kind,
            source,
            distanceYards: Math.round(overlap.distance),
            overlapShare: Math.round(overlap.share * 100) / 100,
            remaining: required === null ? null : required - (row?.count ?? 0),
            mobs: overlap.mobs,
            covered: firstCoverStep.has(refKey(ref)),
            plannedStep: plannedStep(
              work,
              s,
              source === "log" ? (w) => w.targets.some((t) => refKey(t) === refKey(ref)) : (w) => w.accepts.includes(questId),
            ),
          };
          const left = opportunity.remaining === null || !required ? 1 : opportunity.remaining / required;
          found.push({
            opportunity: { ...opportunity, suggestion: suggestion(opportunity, quest.name, required, data) },
            score: overlap.share * left,
          });
        }
      };
      for (const [questId, progress] of before.log) consider(questId, "log", progress);
      for (const questId of data.questsInZone(zoneId)) {
        if (before.log.has(questId) || before.done.has(questId)) continue;
        const quest = data.quest(questId);
        if (!quest || quest.acceptOnTurnIn || (quest.level !== null && trivialQuest(quest.level, before.level))) continue;
        const access = questAccess(quest, before, profile, data);
        if (!access.excluded && access.locked.length === 0) consider(questId, "pickup");
      }
      if (!found.length) return;
      found.sort(
        (a, b) =>
          Number(a.opportunity.covered) - Number(b.opportunity.covered) ||
          Number(a.opportunity.source === "pickup") - Number(b.opportunity.source === "pickup") ||
          b.score - a.score ||
          a.opportunity.distanceYards - b.opportunity.distanceYards,
      );
      result.push({ guide: g.source, step: s, zoneId, points: area.length, opportunities: found.map((f) => f.opportunity) });
    });
  }
  return result;
}

const UNKNOWN_COUNT = Infinity;

interface StepWork {
  targets: ObjectiveRef[];
  /** By `refKey`, the objective progress at which the step's lines are done, capped at the objective's count. */
  needs: Map<string, number>;
  accepts: number[];
  gotos: (readonly string[])[];
  preview: StepPreview;
}

function stepWork(step: Step, preview: StepPreview, data: OpportunityData): StepWork {
  const targets = new Map<string, ObjectiveRef>();
  const needs = new Map<string, number>();
  const accepts: number[] = [];
  const gotos: (readonly string[])[] = [];
  // RXP caps a `.complete` line's count at the objective's (`addon.UpdateQuestCompletionData` in functions.lua). A
  // `.collect` line waits for its own quantity (`addon.functions.collect`), but the window covers only the objective,
  // so the planner caps that count too.
  const target = (ref: ObjectiveRef, count?: number) => {
    const key = refKey(ref);
    const full = data.quest(ref.questId)?.objectives[ref.row]?.count ?? UNKNOWN_COUNT;
    targets.set(key, ref);
    needs.set(key, Math.max(needs.get(key) ?? 0, Math.min(count ?? full, full)));
  };
  step.body.forEach((line, i) => {
    if (!preview.lines[i] || line.kind !== "command") return;
    const id = lineQuest(line)?.questId;
    if (line.name === "goto") gotos.push(line.args);
    else if (line.name === "accept" && id) accepts.push(id);
    else if (line.name === "complete" && id) {
      const ref = objectiveRef(data.quest(id), id, luaNumber(line.args[1] ?? "") ?? NaN);
      const count = luaNumber(line.args[2] ?? "");
      if (ref) target(ref, count !== undefined && count > 0 ? count : undefined);
    } else if (line.name === "collect") {
      const collect = collectLine(line);
      const quest = collect && data.quest(collect.questId);
      if (!collect || !quest) return;
      for (const ref of data.areas(collect.questId).map((a) => a.ref)) {
        if (objectiveTargets(quest.objectives[ref.row]!).items.includes(collect.item)) target(ref, collect.count);
      }
    }
  });
  return { targets: [...targets.values()], needs, accepts, gotos, preview };
}

const asYouGo = (preview: StepPreview) => preview.tags.has("completewith") || preview.tags.has("sticky");

// `#completewith next` lasts through a run of `#completewith` and `#sticky`
// steps to the next other step. `#sticky` alone covers each objective until
// its line is done, as RXP keeps the step active until each line is done
// (`addon.UpdateStepCompletion` in GuideWindow.lua). The simulation credits
// such a step's objectives at the step itself, so the finder estimates the
// end from the guide: the first later step, not as you go, that needs at least
// as many of the objective.
function firstCoverSteps(
  snaps: readonly { preview: StepPreview }[],
  work: readonly (StepWork | undefined)[],
  s: number,
  ends: ReadonlyMap<string, number>,
): Map<string, number> {
  const firstNamed = new Map<string, number>();
  const firstCover = new Map<string, number>();
  for (let p = 0; p < s; p++) {
    const w = work[p];
    if (!w || !asYouGo(w.preview)) continue;
    for (const ref of w.targets) if (!firstNamed.has(refKey(ref))) firstNamed.set(refKey(ref), p);
    const until = w.preview.tags.get("completewith")?.value;
    const covers = (key: string) =>
      until === undefined
        ? !work.slice(p + 1, s).some((q) => q && !asYouGo(q.preview) && (q.needs.get(key) ?? -1) >= w.needs.get(key)!)
        : until === "next"
          ? snaps.slice(p + 1, s).every((q) => !q.preview.shown || asYouGo(q.preview))
          : windowOpen(ends.get(until) ?? -1, s);
    for (const ref of w.targets) if (covers(refKey(ref))) firstCover.set(refKey(ref), firstNamed.get(refKey(ref))!);
  }
  return firstCover;
}

function stepArea(spawns: readonly Spawn[], places: readonly WorldLocation[], focus: number) {
  const nearPlaces = places.length ? spawns.filter((p) => places.some((at) => yards(at, p.world) <= focus)) : spawns;
  const zoneId = mostCommon(nearPlaces.map((p) => p.zoneId));
  return zoneId === undefined ? undefined : { zoneId, area: nearPlaces.filter((p) => p.zoneId === zoneId) };
}

function plannedStep(work: readonly (StepWork | undefined)[], s: number, does: (w: StepWork) => boolean): number | null {
  for (let q = s + 1; q < work.length; q++) if (work[q] && does(work[q]!)) return q;
  return null;
}

interface Grid {
  radius: number;
  cells: Map<string, Spawn[]>;
}

const cellKey = (instance: number, cx: number, cy: number) => `${instance}:${cx}:${cy}`;

function grid(spawns: readonly Spawn[], radius: number): Grid {
  const cells = new Map<string, Spawn[]>();
  for (const spawn of spawns) {
    const key = cellKey(spawn.world.instance, Math.floor(spawn.world.x / radius), Math.floor(spawn.world.y / radius));
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(spawn);
  }
  return { radius, cells };
}

function measure(area: readonly Spawn[], { radius, cells }: Grid, zoneId: ZoneId) {
  let hits = 0;
  let distance = Infinity;
  const near = new Map<Spawn, true>();
  for (const { world } of area) {
    const cx = Math.floor(world.x / radius);
    const cy = Math.floor(world.y / radius);
    let hit = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const spawn of cells.get(cellKey(world.instance, cx + dx, cy + dy)) ?? []) {
          if (spawn.zoneId !== zoneId) continue;
          const d = yards(world, spawn.world);
          if (d > radius) continue;
          hit = true;
          distance = Math.min(distance, d);
          near.set(spawn, true);
        }
    if (hit) hits++;
  }
  const counts = new Map<number, number>();
  for (const spawn of near.keys()) if (spawn.npc !== undefined) counts.set(spawn.npc, (counts.get(spawn.npc) ?? 0) + 1);
  const mobs = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([npc]) => npc);
  return { share: area.length ? hits / area.length : 0, distance, mobs };
}

function mostCommon(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

const MOB_LINES = 3;

function suggestion(o: Omit<Opportunity, "suggestion">, questName: string, required: number | null, data: OpportunityData): string {
  const names = o.mobs
    .slice(0, MOB_LINES)
    .map((id) => data.npcName(id))
    .filter((name) => name !== undefined);
  const work =
    o.kind === "object"
      ? `Loot ${o.objective.name} as you go`
      : `Kill ${names.join(", ") || o.objective.name} as you go${o.kind === "drop" ? `. Loot them for ${o.objective.name}` : ""}`;
  if (o.source === "pickup") {
    const giver = data.giverName(o.questId);
    return `>>Pick up ${questName} (${o.questId})${giver ? ` from ${giver}` : ""}. ${work}`;
  }
  const lines = ["step", "    #completewith next", `    >>${work}`];
  if (o.objective.index !== null)
    lines.push(`    .complete ${o.questId},${o.objective.index} --${o.objective.name}${required === null ? "" : ` (${required})`}`);
  if (o.kind !== "object") lines.push(...names.map((name) => `    .mob ${name}`));
  return lines.join("\n");
}

/**
 * `OpportunityData` from the dataset, as `faction` sees it. An objective's
 * spawns are the spawns that `locatedSpawns` gives its monster or item
 * objective. A text row's objective is the one its link stands for. Object
 * objectives get no spawns.
 */
export function opportunityData(game: GameData, sim: SimData, faction: Faction): OpportunityData {
  const areas = new Map<number, ObjectiveArea[]>();
  let zones: Map<ZoneId, number[]> | undefined;
  const build = (questId: number): ObjectiveArea[] => {
    const quest = sim.quest(questId);
    const record = game.quest(questId, faction);
    if (!quest || !record) return [];
    const rows = completeRows(record);
    return quest.objectives.flatMap((o, row): ObjectiveArea[] => {
      if (o.need === "action" || o.need === "providedItem") return [];
      const at = rows[row];
      const objective = at?.kind === "text" ? linkObjective(at.objective) : at?.objective;
      if (objective?.type !== "monster" && objective?.type !== "item") return [];
      const spawns = [...locatedSpawns(game, record, objective, faction).keys()].map((p): Spawn => ({
        zoneId: p.zoneId,
        world: p.world,
        ...(p.sourceType === "npc" && p.sourceId !== undefined && { npc: p.sourceId }),
      }));
      if (!spawns.length) return [];
      const kind = objectiveTargets(o).npcs.length ? "kill" : spawns.some((p) => p.npc !== undefined) ? "drop" : "object";
      return [{ ref: { questId, row }, kind, name: o.name, spawns }];
    });
  };
  return {
    quest: (id) => sim.quest(id),
    locateGoto: (args) => sim.locateGoto(args),
    rules: sim.rules,
    areas: (questId) => areas.get(questId) ?? areas.set(questId, build(questId)).get(questId)!,
    questsInZone(zoneId) {
      if (!zones) {
        zones = new Map();
        for (const { id } of game.quests)
          for (const zone of new Set(game.quest(id, faction)?.objectivePoints.map((p) => p.zoneId)))
            (zones.get(zone) ?? zones.set(zone, []).get(zone)!).push(id);
      }
      return zones.get(zoneId) ?? [];
    },
    npcName: (id) => game.npcName(id),
    giverName: (questId) => game.quest(questId, faction)?.startPoints[0]?.sourceName,
  };
}
