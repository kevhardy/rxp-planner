import {
  linkObjective,
  nearest,
  objectivePoints,
  yards,
  type GameData,
  type Quest,
  type WorldLocation,
  type Zone,
  type ZoneId,
} from "../data/index.ts";
import type { GuideDocument } from "../guide/index.ts";
import { completeIndex, completeRows } from "./completeRows.ts";
import { objectiveKills, objectiveTargets, takeKills, type StepMobs } from "./killTargets.ts";
import type { Profile } from "./profile.ts";
import { missingPrerequisites, questAccess, type LockReason } from "./questAccess.ts";
import { killXpSettings, simDirectives } from "./simComments.ts";
import { killsToClose, withParty, type GuideSimulation, type SimData, type SimQuest, type SimState } from "./simulate.ts";
import { adjustedKillXp, killXp, questXp, targetXp, totalXp, type KillXpSettings, type LevelTarget, type PartySize } from "./xp.ts";

/**
 * The state a step inserted after step `after` of a simulated guide starts
 * from: that step's state, which a skipped step passes on unchanged. With
 * `after` null, before the first step or in the header, it is the state
 * after the header's `level=` and `done=`. Undefined without a simulation.
 */
export function insertionState(guide: GuideSimulation | undefined, after: number | null): SimState | undefined {
  if (!guide) return undefined;
  return after === null ? guide.afterHeader : (guide.steps[after]?.state ?? guide.end);
}

export type QuestSuggestion =
  | (SuggestionBase & { kind: "turnin" })
  | ObjectiveSuggestion
  | (SuggestionBase & {
      kind: "accept";
      /** Why the character cannot accept it yet, absent when it can. */
      locked?: LockReason[];
    });

export interface ObjectiveSuggestion extends SuggestionBase {
  kind: "objective";
  /**
   * The objective's row in `SimQuest.objectives`, and its `.complete` index,
   * null when the data does not give one.
   */
  objective: { row: number; name: string; index: number | null };
}

interface SuggestionBase {
  questId: number;
  name: string;
  /** Quest level; null when unknown. */
  level: number | null;
  /** The quest's XP at the state's level; null when unknown. */
  xp: number | null;
  /** The nearest giver, ender, or objective spawn; null when the data places none. */
  location: WorldLocation | null;
  /** Yards from the state's position to `location`; null on another continent or without either. */
  distance: number | null;
  /** Whether a prerequisite is not yet turned in, as `questAccess` decides; false when the quest has none. */
  prerequisiteMissing: boolean;
}

export type SuggestionSort =
  /** Nearest first, then those on other continents or with no place. */
  | "distance"
  /** Lowest quest level first. */
  | "level"
  /** Most XP first. */
  | "xp";

export interface SuggestOptions {
  /**
   * The zone whose quests to keep, or null for every zone.
   * Defaults to `stateZone`, or every zone without one.
   */
  zone?: ZoneId | null;
  /** Defaults to `distance`. */
  sort?: SuggestionSort;
}

export function stateZone(data: GameData, state: SimState): Zone | undefined {
  return state.position ? data.zoneAt(state.position) : undefined;
}

/**
 * Quests for the character at `state`: turn-ins for quests in the log with
 * every objective done, the open objectives of the others, and quests it
 * could accept, those it cannot yet marked `locked`, as `questAccess`
 * decides. Quests come from `data`, and their facts from
 * `sim`, as the simulator reads them. Quests `questAccess` excludes for the
 * character's race, class, or faction, quests RXP turns in without an
 * accept, and quests turned in already are left out.
 */
export function suggestQuests(
  state: SimState,
  data: GameData,
  sim: SimData,
  profile: Pick<Profile, "faction" | "race" | "class">,
  options: SuggestOptions = {},
): QuestSuggestion[] {
  const zone = options.zone === undefined ? stateZone(data, state)?.id : (options.zone ?? undefined);
  const record = (id: number) => data.quest(id, profile.faction);
  const locate = (points: Quest["objectivePoints"]) => points.map((p) => p.world);
  const entry = (id: number, quest: SimQuest, points: readonly WorldLocation[]) => ({
    questId: id,
    name: quest.name,
    level: quest.level,
    xp:
      state.level >= data.maxLevel
        ? 0
        : quest.baseXp === null || quest.level === null
          ? null
          : questXp(quest.baseXp, quest.level, state.level),
    ...place(points, state.position),
    prerequisiteMissing:
      missingPrerequisites(
        quest,
        (id) => state.done.has(id),
        (id) => sim.quest(id),
      ) !== undefined,
  });
  const out: QuestSuggestion[] = [];

  for (const [id, progress] of state.log) {
    const quest = sim.quest(id);
    if (!quest || (zone !== undefined && !quest.zoneIds.includes(zone))) continue;
    if (progress.status === "complete") {
      out.push({ kind: "turnin", ...entry(id, quest, quest.enders) });
      continue;
    }
    const rec = record(id);
    const rows = rec ? completeRows(rec) : [];
    const pointsOf = (row: number): Quest["objectivePoints"] => {
      const at = rows[row];
      const objective = at?.kind === "text" ? linkObjective(at.objective) : at?.objective;
      return rec && objective ? objectivePoints(data, rec, objective, profile.faction) : [];
    };
    quest.objectives.forEach((o, row) => {
      if (progress.objectives[row]?.complete) return;
      const objective = { row, name: o.name, index: completeIndex(o, row) };
      out.push({ kind: "objective", ...entry(id, quest, locate(pointsOf(row))), objective });
    });
  }

  for (const rec of data.searchQuests({ faction: profile.faction, ...(zone !== undefined && { zoneId: zone }) })) {
    if (state.log.has(rec.id) || state.done.has(rec.id)) continue;
    const quest = sim.quest(rec.id);
    if (!quest || quest.acceptOnTurnIn) continue;
    const access = questAccess(quest, state, profile, sim);
    if (access.excluded) continue;
    const { locked } = access;
    out.push({ kind: "accept", ...entry(rec.id, quest, quest.givers), ...(locked.length > 0 && { locked }) });
  }

  return out.sort(ORDER[options.sort ?? "distance"]);
}

function place(points: readonly WorldLocation[], from: WorldLocation | null): Pick<QuestSuggestion, "location" | "distance"> {
  const location = nearest(points, from);
  return location && from ? { location, distance: yards(location, from) } : { location: points[0] ?? null, distance: null };
}

/**
 * What an open objective names and still needs. `target` is the one NPC or
 * item that the objective names. `need` is what the simulator counts for a
 * `.complete` line in a new step. For kills, `kills` is the count that
 * earlier lines left. `mobs` are the mobs that the first of those lines
 * chose, or else the objective's mobs. `drops` is set when those mobs drop
 * the objective's item. An item that is `bought` or `gathered` needs no
 * kills. `need` is undefined when the objective needs no kills, or when the
 * data gives no count or no mob, which the simulator warns of.
 */
export interface ObjectiveInfo {
  target?: { kind: "npc" | "item"; id: number };
  need?: { kind: "kills"; kills: number; mobs: number[]; drops: boolean } | { kind: "bought" | "gathered" };
}

const NO_MOBS: StepMobs = { mob: [], target: [], lines: new Map() };

/**
 * What objective suggestion `s` names and still needs at `state`, for the
 * guide's `party`: a duo needs a drop for each member's item.
 */
export function objectiveInfo(state: SimState, sim: SimData, s: ObjectiveSuggestion, party: PartySize): ObjectiveInfo {
  const quest = sim.quest(s.questId);
  const o = s.objective;
  const row = quest?.objectives[o.row];
  if (!row) return {};
  const { npcs, items } = objectiveTargets(row);
  const targets = [...npcs.map((id) => ({ kind: "npc" as const, id })), ...items.map((id) => ({ kind: "item" as const, id }))];
  const target = targets.length === 1 ? targets[0] : undefined;
  const log = state.log.get(s.questId);
  const earlier = log?.objectives[o.row]?.kills;
  const found = objectiveKills(
    sim,
    { questId: s.questId, row: o.row },
    { at: { guide: 0 }, mobs: NO_MOBS, ...(earlier?.total && { total: earlier.total }), ...(earlier?.first && { started: true }) },
  );
  const note = found.notes.find((n) => n.kind === "bought" || n.kind === "gathered");
  const total = found.counts[0];
  const taken = total && takeKills(earlier ?? { counted: 0 }, { to: total.count }, party, sim, { fresh: found.kills[0] });
  const need: ObjectiveInfo["need"] = note
    ? { kind: note.kind }
    : taken && {
        kind: "kills",
        kills: taken.kills.length,
        mobs: taken.mobs.mobs.map((m) => m.npcId),
        drops: taken.mobs.itemId !== undefined,
      };
  return { ...(target && { target }), ...(need && { need }) };
}

type Compare = (a: QuestSuggestion, b: QuestSuggestion) => number;

const ascending =
  (key: (s: QuestSuggestion) => number | null): Compare =>
  (a, b) =>
    (key(a) ?? Infinity) - (key(b) ?? Infinity);

const KIND_ORDER = { turnin: 0, objective: 1, accept: 2 } as const;
const objectiveRow = (s: QuestSuggestion) => (s.kind === "objective" ? s.objective.row : 0);
const ties: Compare = (a, b) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name) || a.questId - b.questId || objectiveRow(a) - objectiveRow(b);

const ORDER: Record<SuggestionSort, Compare> = {
  distance: (a, b) => ascending((s) => s.distance)(a, b) || ties(a, b),
  level: (a, b) => ascending((s) => s.level)(a, b) || ties(a, b),
  xp: (a, b) => ascending((s) => (s.xp === null ? null : -s.xp))(a, b) || ties(a, b),
};

export interface GrindEstimate {
  /** XP from the state to the target; 0 once the state has reached it. */
  xpNeeded: number;
  /** XP per kill at the state's level, at the mob's lowest and highest level; null when its levels are unknown. */
  xpPerKill: { min: number; max: number } | null;
  /**
   * Kills that close `xpNeeded`, counted as the simulator counts them for a
   * checkpoint; null when the mob's levels are unknown or its kills stop
   * giving XP first.
   */
  kills: number | null;
}

export function grindEstimate(
  state: Pick<SimState, "level" | "xp">,
  target: LevelTarget,
  npcId: number,
  sim: SimData,
  settings: KillXpSettings = {},
): GrindEstimate {
  const xpNeeded = Math.max(0, targetXp(sim.rules, target) - totalXp(sim.rules, state.level, state.xp));
  const npc = sim.npc(npcId);
  const elite = npc?.elite ?? false;
  const xpPerKill = npc?.levels
    ? {
        min: adjustedKillXp(killXp(state.level, npc.levels.min, elite), settings),
        max: adjustedKillXp(killXp(state.level, npc.levels.max, elite), settings),
      }
    : null;
  const kills = xpNeeded === 0 ? 0 : (killsToClose(state, xpNeeded, [npcId], sim, settings)?.count ?? null);
  return { xpNeeded, xpPerKill, kills };
}

/**
 * The kill XP settings for a step inserted into `doc`: the `killmult=` and
 * `killxp=` of header lines that apply, for the simulation's party. A step
 * override does not carry over to the new step.
 */
export function insertionKillXp(simulation: GuideSimulation, doc: GuideDocument): KillXpSettings {
  const header = simDirectives(doc, 0).directives.filter(
    (d) => d.at.step === undefined && (simulation.preview.headerLines[d.at.line!] ?? true),
  );
  return withParty(killXpSettings(header), simulation.party);
}

/** The first mob with known levels in the selected step's last grind override, for the Add step default. */
export function grindMobChoice(doc: GuideDocument, step: number | null, sim: SimData): number | undefined {
  const named = simDirectives(doc, 0).directives.findLast((d) => d.key === "grind" && d.at.step === step);
  if (named?.key !== "grind") return undefined;
  for (const name of named.mobs) {
    const found = /^\d+$/.test(name) ? { kind: "npc", id: Number(name) } : sim.entityByName(name);
    if (found?.kind === "npc" && sim.npc(found.id)?.levels) return found.id;
  }
  return undefined;
}
