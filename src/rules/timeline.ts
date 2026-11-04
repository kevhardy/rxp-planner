import {
  FLIGHT_MASTER_REACH,
  nearest,
  npcSpawns,
  within,
  type FlightNodes,
  type GameData,
  type InstanceId,
  type Spawn,
  type SpawnsOf,
  type WorldLocation,
  type WorldMapData,
} from "../data/index.ts";
import { placeName } from "../data/places.ts";
import { guideText, guideTextPlain, isColorRun, isTexture, type GuideDocument, type Step, type TextPart } from "../guide/index.ts";
import { advance, type Act, type ActBody, type Effect, type MobSpawn, type Target } from "./character.ts";
import { ITEM_TOLERANCE } from "./drops.ts";
import type { Faction, Profile } from "./profile.ts";
import type { ClassName } from "../data/races.ts";
import {
  hearthKey,
  simulateRoute,
  type KillAreaSettings,
  type KillAssumption,
  type RouteSimulation,
  type SimData,
  type SimStart,
  type SimState,
} from "./simulate.ts";
import { TIMELINE_MODEL, type MobColor } from "./model.ts";
import { hearthGateHolds } from "./gates.ts";
import type { Location } from "./validate.ts";
import { warningText } from "./warningText.ts";
import { grayLevel, type LevelTarget, type PartySize } from "./xp.ts";

const M = TIMELINE_MODEL;

/** Seconds to travel one leg, and where the estimate came from, such as `straight` or `routing`. */
export interface TravelEstimate {
  seconds: number;
  source: string;
  /** The travel provider's name for the way it took. The timeline copies it to the activity and never reads it. */
  way?: string;
}

/** Where the character stands. `height` is in world yards when known. Absent means unknown, not on the ground. */
export type Standing = WorldLocation & { readonly height?: number };

/**
 * A ground leg. On a `Travel` leg, `mode` is Mount from the mount's level
 * before the step, else Run, and `toward` is a confirmed spawn of an NPC
 * that the step names, within `GOTO_NPC_REACH` of `to`.
 */
export interface TravelLeg {
  readonly from: WorldLocation;
  readonly to: WorldLocation;
  readonly mode: "Run" | "Mount";
  readonly toward?: Spawn;
}

/** A flight between two flight masters. `learned` is the taxi nodes that the character knows before the flight. */
export interface FlightLeg {
  readonly from: WorldLocation;
  readonly to: WorldLocation;
  readonly learned: ReadonlySet<number>;
}

export type Travel = (leg: TravelLeg) => TravelEstimate | Promise<TravelEstimate>;

/** A flight that the character knows; undefined when no flight goes there, so the character walks. */
export type Fly = (leg: FlightLeg) => TravelEstimate | undefined | Promise<TravelEstimate | undefined>;

/**
 * The run between two kills of a kill walk, which stops short of the spawn
 * `toward`. `seconds` undefined keeps the straight line at `runSpeed`. The
 * timeline copies `way` to the kill and never reads it.
 */
export type Walk = (leg: TravelLeg & { readonly mode: "Run"; readonly toward: Spawn }) => { seconds?: number; way?: string };

type TravelTarget = Target | { kind: "bind" };

/**
 * `from` is where the leg starts; the first travel of a route without a start
 * place has `from` equal to `to` and no seconds. `place` names a `goto` target as a player reads it.
 */
type ActivityBody =
  | { kind: "travel"; from: Standing; to: WorldLocation; target: TravelTarget; way?: string; place?: string }
  | { kind: "flight"; from: Standing; to: WorldLocation; name: string; target: Target; way?: string }
  | { kind: "wait" }
  | Exclude<ActBody, { kind: "go" | "kill" | "grind" }>
  | (Extract<ActBody, { kind: "kill" | "grind" }> & { walk?: KillWalk });

/**
 * Where each kill of a kill or grind activity happens, and when, in seconds
 * from the activity's start. Absent when the character has no place yet.
 */
export interface KillWalk {
  /** Where the character stood when the activity started. */
  from: Standing;
  /**
   * One for each kill, in order. When the kill before ends, the character
   * walks to `at`, on `from`'s map, and arrives at `arrive`. It waits there
   * for the mob to respawn, if it must, and the kill ends at `end`. `spawn`
   * is the spawn of the NPC that it kills; none when the NPC has no spawn in
   * the area. `at` has the spawn's height `z`, when it has one. `way` is the
   * walk's name for the run there.
   */
  kills: readonly KillAt[];
  /** Nearby eligible spawns for display, including every selected kill's spawn. */
  spawns: readonly MobSpawn[];
}

interface KillAt {
  at: Standing;
  arrive: number;
  end: number;
  npcId: number;
  spawn?: Spawn;
  way?: string;
}

/**
 * An act, or a part of one, with its time. `start` counts from the start of
 * the route. `source` names a travel estimate. `at` and `effects` are the act's.
 */
export type Activity = ActivityBody & { start: number; seconds: number; source?: string; at: Location; effects: readonly Effect[] };

type Bucket = Exclude<keyof TimelineStep["seconds"], "total">;

const BUCKET = {
  travel: "travel",
  flight: "travel",
  wait: "wait",
  hearth: "interact",
  deathskip: "interact",
  interact: "interact",
  update: "interact",
  kill: "kill",
  grind: "kill",
} as const satisfies Record<Activity["kind"], Bucket>;

export interface TimelineStep {
  /** `GuideSimulation.source`: the index of the step's guide in the guides the route was simulated from. */
  source: number;
  guide: string;
  step: number;
  title: TextPart[];
  zone?: string;
  levelBefore: number;
  levelAfter: number;
  /** `kill` includes checkpoint XP, which the simulator closes with kills. */
  xp: { quest: number; kill: number };
  /** `kill` includes walking between mobs and rest. */
  seconds: { travel: number; kill: number; interact: number; wait: number; total: number };
  /** Cumulative seconds before this step. */
  start: number;
  /** Who plays the step, from its guide's header. */
  party: PartySize;
  /** Seconds after a kill in the step before its spawn has a mob again. */
  respawn: number;
  position?: { map: InstanceId; x: number; y: number };
  /** Where a `@sim state` position puts the character before the step, also when it is on a hidden step since the last shown step. */
  arrive?: WorldLocation;
  notes: string[];
  /** Kills by NPC, including the kills that close checkpoint gaps. */
  kills?: { npcId: number; name: string; count: number }[];
  /** What the character does in the step, in order from `start`. */
  activities: Activity[];
  /** The character before the step. Folding the activities' effects from it gives any moment of the step. */
  before: SimState;
  /** The second the Hearthstone is ready, before the step; 0 when it was never used. */
  hearthReadyAt: number;
}

/** A guide that RXP runs on the priced route, in route order. */
export interface TimelineGuide {
  /** `GuideSimulation.source`. */
  source: number;
  /** The same text as `TimelineStep.guide`. */
  name: string;
  /** The simulated level at the guide's start and end. */
  levels: { start: number; end: number };
  /** The `maxGuides` that prices through this guide. */
  through: number;
  /** The guide's steps in `TimelineResult.steps`, and their time. Undefined past `maxGuides`. */
  priced?: { first: number; count: number; start: number; seconds: number };
}

/**
 * Timeline seconds as a clock, "1:02:03" or "2:03", rounded to the nearest
 * second so a clock agrees with a rounded seconds count beside it.
 */
export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/**
 * Rounds each part's ends, not its length, so the parts add up to the total and the start plus the total is the next
 * start.
 */
export function shownSeconds(step: Pick<TimelineStep, "start" | "seconds">): TimelineStep["seconds"] {
  const shown = { travel: 0, kill: 0, interact: 0, wait: 0, total: 0 };
  let end = 0;
  for (const key of ["travel", "kill", "interact", "wait"] as const) {
    const from = Math.round(step.start + end);
    end += step.seconds[key];
    shown[key] = Math.round(step.start + end) - from;
  }
  shown.total = Math.round(step.start + end) - Math.round(step.start);
  return shown;
}

export interface TimelineResult {
  steps: TimelineStep[];
  /** Each guide that RXP runs on the route, in the simulation that was priced last, also the guides past `maxGuides`. */
  guides: TimelineGuide[];
  totals: {
    seconds: number;
    xp: number;
    xpPerHour: number;
    levelStart: number;
    levelEnd: number;
    kills: number;
    questsTurnedIn: number;
    travelSeconds: number;
    killSeconds: number;
  };
  /** Seconds when each level is reached, at the end of the step that reaches it. */
  byLevel: { level: number; reachedAt: number }[];
  /** `source` and `guide` are the step's, as in `TimelineStep`. */
  warnings: { source: number; guide: string; step: number; message: string }[];
  /** Names of the quests, NPCs, and flight masters that activities name. */
  names: Names;
}

export interface Names {
  quests: Record<number, string>;
  npcs: Record<number, string>;
  flights: Record<number, string>;
}

export interface PriceOptions {
  /** Defaults to `straightTravel`. */
  travel?: Travel;
  /** Defaults to `flightLeg`. */
  fly?: Fly;
  /** The runs between kills; straight lines by default. */
  walk?: Walk;
  /** Where an NPC spawns for a quest's objective, or for a grind; none by default. */
  spawns?: SpawnsOf;
  /** An NPC's name for `TimelineStep.kills`; `NPC <id>` by default. */
  npcName?: (npcId: number) => string | undefined;
  /** A name for a `.goto` place, given the quests that the step accepts and turns in there; the line's arguments by default. */
  placeName?: (at: WorldLocation, quests: readonly QuestNpc[]) => string | undefined;
  /** Stop after this many guides of the route, hidden guides included. */
  maxGuides?: number;
  /**
   * Awaited before each step and before each rerun of the route, so that a
   * caller can give the event loop a turn, or stop the price by throwing.
   */
  pause?: () => Promise<void> | undefined;
}

export interface TimelineOptions extends PriceOptions {
  /** Start XP and seed, as `simulateRoute` takes them. */
  xp?: number;
  seed?: SimStart;
}

/** A quest whose giver or turn-in NPC a step talks to. */
export type QuestNpc = Extract<Target, { kind: "quest" }>;

/** The timeline's NPC spawns and names, and its place names, with the landmarks of `map` when there is one. */
export function timelineNpcs(
  game: GameData,
  faction: Faction,
  map?: WorldMapData,
): Pick<TimelineOptions, "spawns" | "npcName" | "placeName"> {
  return {
    spawns: npcSpawns(game, faction),
    npcName: (npcId) => game.npcName(npcId),
    placeName: (at, quests) =>
      placeName(
        game,
        map,
        at,
        quests.flatMap(({ questId, role }) => {
          const quest = game.quest(questId, faction);
          return (role === "accept" ? quest?.startPoints : quest?.endPoints) ?? [];
        }),
      ),
  };
}

/**
 * Simulates the route from `guides[start]`, then prices each shown step's
 * acts in order as activities. The simulator decides what happens; this
 * function decides only how long it takes.
 */
export function buildTimeline(
  guides: readonly GuideDocument[],
  start: number,
  profile: Profile,
  data: SimData,
  options: TimelineOptions = {},
): Promise<TimelineResult> {
  return priceRoute(simulateRoute(guides, start, profile, data, options.xp ?? 0, options.seed), guides, profile, data, options);
}

/**
 * Prices a simulated route. Playback prices one simulation many times, once
 * for each better set of travel estimates. `guides` and `profile` must be
 * the ones that `simulation` was built from. The walk starts at the place of
 * the route's start, which `simulateRoute` leaves unset, so it starts at its
 * first place.
 *
 * Only the clock knows when the Hearthstone is ready, so the clock decides
 * each `.cooldown` gate. When a gate goes the other way than the simulation
 * assumed, the route is simulated again with the clock's cooldown there and
 * priced from the start. Each gated step is simulated again at most once.
 */
export async function priceRoute(
  simulation: RouteSimulation,
  guides: readonly GuideDocument[],
  profile: Profile,
  data: SimData,
  options: PriceOptions = {},
): Promise<TimelineResult> {
  const names: Names = { quests: {}, npcs: {}, flights: {} };
  const npcName = (npcId: number) => (names.npcs[npcId] ??= options.npcName?.(npcId) ?? `NPC ${npcId}`);
  const clock: Clock = {
    profile,
    data,
    party: 1,
    travel: options.travel ?? straightTravel,
    fly: options.fly ?? flightLeg,
    walk: options.walk,
    spawns: cachedSpawns(options.spawns),
    npcs: [],
    killedFor: new Map(),
    respawns: new Map(),
    npcName,
    areaSettings: { respawn: simulation.settings.respawn, radius: simulation.settings.area },
    area: undefined,
    seconds: 0,
    at: simulation.start.position,
    hearthReadyAt: 0,
  };
  const steps: TimelineStep[] = [];
  const listed: TimelineGuide[] = [];
  const byLevel: TimelineResult["byLevel"] = [];
  const warnings: TimelineResult["warnings"] = [];
  const tooLow = simulation.warnings.filter((w) => w.kind === "levelTooLow");
  let state = simulation.start;
  let kills = 0;
  let questsTurnedIn = 0;
  let arrive: WorldLocation | undefined;

  for (const [i, sim] of simulation.guides.entries()) {
    const name = sim.preview.tags.get("name")?.value ?? `guide ${sim.source}`;
    const guide: TimelineGuide = { source: sim.source, name, levels: { start: sim.start.level, end: sim.end.level }, through: i + 1 };
    if (!sim.hidden) listed.push(guide);
    if (i >= (options.maxGuides ?? Infinity)) continue;
    const [first, began] = [steps.length, clock.seconds];
    clock.party = sim.party;
    for (const snapshot of sim.steps) {
      await options.pause?.();
      const keyframe = snapshot.before;
      const { override } = snapshot;
      if (override?.hearth !== undefined) clock.hearthReadyAt = clock.seconds + override.hearth;
      if (override?.position) clock.at = arrive = override.position;
      if (snapshot.hearth !== undefined) {
        const key = hearthKey(snapshot.guide, snapshot.step);
        const cooldown = Math.max(0, clock.hearthReadyAt - clock.seconds);
        const gate = (seconds: number) => hearthGateHolds(guides[snapshot.guide]!.steps[snapshot.step]!, snapshot.preview.lines, seconds);
        if (!simulation.hearth.has(key) && gate(cooldown) !== gate(snapshot.hearth)) {
          await options.pause?.();
          const again = simulation.rerun(new Map(simulation.hearth).set(key, cooldown));
          return priceRoute(again, guides, profile, data, options);
        }
      }
      if (sim.hidden || !snapshot.preview.shown) continue;
      const step = guides[snapshot.guide]!.steps[snapshot.step]!;
      const start = clock.seconds;
      const { hearthReadyAt } = clock;
      clock.areaSettings = { respawn: simulation.settings.respawn, radius: simulation.settings.area, ...snapshot.killArea };
      clock.npcs = confirmedSpawns(clock.spawns, snapshot.npcs);
      clock.area = undefined;
      const warn = (message: string) => warnings.push({ source: sim.source, guide: name, step: snapshot.step, message });
      for (const w of tooLow)
        if (w.at.guide === snapshot.guide && w.at.step === snapshot.step) warn(warningText(w, (id) => data.quest(id), String));
      const activities: Activity[] = [];
      let fold = keyframe;
      for (const act of snapshot.acts) {
        for (const activity of await price(act, keyframe, fold, clock, warn)) {
          activities.push(activity);
          clock.seconds += activity.seconds;
          fold = activity.effects.reduce(advance, fold);
        }
      }
      if (options.placeName) namePlaces(activities, options.placeName);
      state = snapshot.state;

      const seconds = { travel: 0, kill: 0, interact: 0, wait: 0 };
      for (const a of activities) seconds[BUCKET[a.kind]] += a.seconds;
      const total = seconds.travel + seconds.kill + seconds.interact + seconds.wait;
      const killed = killTally(activities, keyframe.level, clock);
      kills += killed.count;
      for (const a of activities) {
        questsTurnedIn += a.effects.filter((e) => e.kind === "turnin").length;
        for (const questId of questsOf(a)) names.quests[questId] ??= data.quest(questId)?.name ?? `Quest ${questId}`;
        if ((a.kind === "travel" || a.kind === "flight") && a.target.kind === "flight")
          names.flights[a.target.to] ??= data.flights.node(a.target.to).name;
      }
      for (const up of snapshot.levelUps) byLevel.push({ level: up.level, reachedAt: clock.seconds });
      const zone = activities
        .flatMap((a) => ((a.kind === "travel" || a.kind === "flight") && a.target.kind === "goto" && a.target.zone) || [])
        .at(-1);
      const { at } = clock;
      steps.push({
        source: sim.source,
        guide: name,
        step: snapshot.step,
        title: stepTitleParts(step),
        ...(zone && { zone }),
        levelBefore: keyframe.level,
        levelAfter: state.level,
        xp: { quest: snapshot.xp.quest, kill: snapshot.xp.kills + snapshot.xp.checkpoint },
        seconds: { ...seconds, total },
        start,
        party: sim.party,
        respawn: clock.areaSettings.respawn,
        ...(at && { position: { map: at.instance, x: at.x, y: at.y } }),
        ...(arrive && { arrive }),
        notes: stepNotes(activities, killed),
        kills: [...killed.byNpc].map(([npcId, count]) => ({ npcId, name: npcName(npcId), count })),
        activities,
        before: keyframe,
        hearthReadyAt,
      });
      arrive = undefined;
    }
    guide.priced = { first, count: steps.length - first, start: began, seconds: clock.seconds - began };
  }

  const levelStart = simulation.start.level;
  const xp = steps.reduce((sum, s) => sum + s.xp.quest + s.xp.kill, 0);
  const sum = (key: "travel" | "kill") => steps.reduce((total, s) => total + s.seconds[key], 0);
  return {
    steps,
    guides: listed,
    totals: {
      seconds: clock.seconds,
      xp,
      xpPerHour: clock.seconds > 0 ? Math.round((xp * 3600) / clock.seconds) : 0,
      levelStart,
      levelEnd: state.level,
      kills,
      questsTurnedIn,
      travelSeconds: sum("travel"),
      killSeconds: sum("kill"),
    },
    byLevel,
    warnings,
    names,
  };
}

type NpcSpawn = Spawn & { readonly z: number };

const GOTO_NPC_REACH = 3;

function confirmedSpawns(spawns: SpawnsOf, npcIds: readonly number[]): NpcSpawn[] {
  return npcIds.flatMap((id) => spawns(id, undefined)).filter((spawn): spawn is NpcSpawn => spawn.z !== undefined);
}

function npcAt(npcs: readonly NpcSpawn[], to: WorldLocation): NpcSpawn | undefined {
  return nearest(npcs.filter((spawn) => within(spawn, to, GOTO_NPC_REACH)).reverse(), to);
}

interface Clock {
  profile: Profile;
  data: SimData;
  party: PartySize;
  travel: Travel;
  fly: Fly;
  walk: Walk | undefined;
  spawns: SpawnsOf;
  npcs: readonly NpcSpawn[];
  killedFor: Map<number, number>;
  respawns: Map<string, number>;
  npcName: (npcId: number) => string;
  areaSettings: KillAreaSettings & { respawn: number; radius: number };
  area: KillArea | undefined;
  seconds: number;
  at: Standing | null;
  hearthReadyAt: number;
}

async function price(act: Act, keyframe: SimState, fold: SimState, clock: Clock, warn: (message: string) => void): Promise<Activity[]> {
  const { at, effects } = act;
  let now = clock.seconds;
  const timed = (body: ActivityBody, seconds: number, source?: string): Activity => {
    const activity = { ...body, start: now, seconds, ...(source !== undefined && { source }), at, effects: [] };
    now += seconds;
    return activity;
  };
  const travel = async (from: Standing, to: WorldLocation, target: TravelTarget) => {
    const toward = npcAt(clock.npcs, to);
    const estimate = await clock.travel({ from, to, mode: travelMode(keyframe), ...(toward && { toward }) });
    clock.at = to;
    const way = estimate.way !== undefined && { way: estimate.way };
    return timed({ kind: "travel", from, to, target, ...way }, estimate.seconds, estimate.source);
  };
  const withEffects = (activity: Activity): Activity => ({ ...activity, effects });
  const walked = (body: Extract<Act, { kind: "kill" | "grind" }>, fights: readonly Fight[]) => {
    const area = killArea(clock);
    const result = clock.at && area ? killWalk(fights, clock.at, now, clock, area) : undefined;
    for (const [npcId, kills] of result?.away ?? []) {
      const name = clock.npcName(npcId);
      warn(
        `no ${name} spawn is in the ${Math.round(area!.radius)} yd kill area, so the fight time of ${kills} ${kills === 1 ? "kill" : "kills"} is added without a walk to the mob; add a step that goes to ${name}`,
      );
    }
    const walk = result?.walk;
    const last = walk?.kills.at(-1);
    if (last) clock.at = last.at;
    const seconds = walk ? (last?.end ?? 0) : fights.reduce((sum, f) => sum + f.seconds + M.noSpawnWalk.value / M.runSpeed.value, 0);
    return withEffects(timed({ ...body, ...(walk && last && { walk }) }, seconds));
  };
  switch (act.kind) {
    case "go": {
      const { to, target } = act;
      const from = clock.at;
      if (!from) {
        clock.at = to;
        return [withEffects(timed({ kind: "travel", from: to, to, target }, 0))];
      }
      if (target.kind !== "flight") return [withEffects(await travel(from, to, target))];
      const node = clock.data.flights.node(target.to);
      const known = target.from !== undefined && fold.flightPaths.has(target.to);
      const flight = known ? await clock.fly({ from, to, learned: fold.flightPaths }) : undefined;
      if (!flight) {
        const why =
          target.from === undefined
            ? `with no ${clock.profile.faction} flight master within ${FLIGHT_MASTER_REACH} yd`
            : known
              ? `with no known flight to ${node.name}`
              : `before .fp ${node.name}`;
        warn(`.fly ${target.name} ${why}; walked`);
        return [withEffects(await travel(from, to, target))];
      }
      clock.at = to;
      const body = { kind: "flight" as const, from, to, name: node.name, target, ...(flight.way !== undefined && { way: flight.way }) };
      return [withEffects(timed(body, flight.seconds, flight.source))];
    }
    case "deathskip": {
      if (!act.to) warn(".deathskip with no known Spirit Healer on this world map; position unchanged");
      else clock.at = act.to;
      return [withEffects(timed(act, M.deathskip.value))];
    }
    case "hearth": {
      const bind = act.to;
      if (!bind) {
        warn(".hs with no Hearthstone bind");
        return [withEffects(timed(act, 0))];
      }
      const wait = clock.hearthReadyAt - now;
      const from = clock.at;
      if (wait > 0 && from) {
        const walk = await clock.travel({ from, to: bind, mode: travelMode(keyframe) });
        if (walk.seconds < wait) {
          warn(`.hs ${Math.round(wait)} s before the Hearthstone is ready; walked instead`);
          clock.at = bind;
          const body = {
            kind: "travel" as const,
            from,
            to: bind,
            target: { kind: "bind" as const },
            ...(walk.way !== undefined && { way: walk.way }),
          };
          return [withEffects(timed(body, walk.seconds, walk.source))];
        }
      }
      const parts: Activity[] = [];
      if (wait > 0) {
        warn(`.hs ${Math.round(wait)} s before the Hearthstone is ready; waited`);
        parts.push(timed({ kind: "wait" }, wait));
      }
      parts.push(withEffects(timed(act, M.hearthCast.value)));
      clock.hearthReadyAt = now + M.hearthCooldown.value;
      clock.at = bind;
      return parts;
    }
    case "interact":
      if ((act.action === "fp" || act.action === "fly") && act.node === undefined)
        warn(unknownFlightMaster(act, clock.profile.faction, clock.data.flights));
      return [withEffects(timed(act, (M.interact.value[act.action] ?? 0) * (act.count ?? 1)))];
    case "kill": {
      if (act.unproven) {
        warn(unprovenWarning(act.kills, clock));
        return [withEffects(timed(act, 0))];
      }
      const fights = killFights(act.kills, keyframe.level, clock);
      if (act.passBy && clock.at) {
        const walk = passWalk(act.passBy, clock.at, now, clock, keyframe.level, act.progress?.questId);
        const last = walk.kills.at(-1);
        if (last) clock.at = last.at;
        return [withEffects(timed({ ...act, walk }, last?.end ?? 0))];
      }
      return [walked(act, fights)];
    }
    case "grind": {
      const fights = (act.checkpoint.kills?.mobs ?? []).flatMap(({ npcId, count }) => {
        const npc = clock.data.npc(npcId);
        if (!npc?.levels) return [];
        const level = Math.round((npc.levels.min + npc.levels.max) / 2);
        const fight = {
          npcId,
          questId: clock.killedFor.get(npcId),
          seconds: fightSeconds(level, npc.elite ?? false, keyframe.level, clock),
        };
        return Array.from({ length: count }, () => fight);
      });
      if (!fights.length) warn(`${act.checkpoint.gap} checkpoint XP with no kill estimate takes no time`);
      return [walked(act, fights)];
    }
    case "update":
      return [withEffects(timed(act, 0))];
  }
}

function unknownFlightMaster(act: Extract<Act, { kind: "interact" }>, faction: Faction, flights: FlightNodes): string {
  const { nodes } = flights.named(act.name!, faction);
  const line = `.${act.action} ${act.name}`;
  return nodes.length > 1
    ? `${line} names more than one ${faction} flight master: ${nodes.map((n) => n.name).join("; ")}`
    : `${line} names no ${faction} flight master`;
}

function unprovenWarning(kills: readonly KillAssumption[], clock: Clock): string {
  const questId = kills[0]!.objective!.questId;
  const quest = clock.data.quest(questId);
  const parts = kills.map(({ objective, count, itemId }) => {
    const row = objective && quest?.objectives[objective.row];
    const name = row?.name ?? "the objective";
    if (itemId !== undefined) return `${count} ${count === 1 ? "kill" : "kills"} for ${name}`;
    return `${count}${row?.count == null ? "" : ` of ${row.count}`} ${name} kills`;
  });
  return `${quest?.name ?? `Quest ${questId}`}: ${parts.join(" and ")} are not counted by any earlier step, so the planner cannot tell if the quest was complete at this turn-in. Their XP is still counted; set -- @sim state= on this step if that is wrong`;
}

interface Fight {
  npcId: number;
  questId: number | undefined;
  seconds: number;
}

function fightSeconds(mobLevel: number, elite: boolean, level: number, clock: Clock): number {
  return combatSeconds(mobColor(level, mobLevel), elite, clock.profile.class, clock.party) * (1 + M.rest.value[clock.profile.class]);
}

function killFights(kills: readonly KillAssumption[], level: number, clock: Clock): Fight[] {
  const fights: Fight[] = [];
  for (const a of kills) {
    const questId = a.objective?.questId;
    for (const mob of a.mobs) {
      if (questId !== undefined) clock.killedFor.set(mob.npcId, questId);
      for (const l of mob.levels) {
        const fight = { npcId: mob.npcId, questId, seconds: fightSeconds(l.level, mob.elite ?? false, level, clock) };
        for (let i = 0; i < l.kills; i++) fights.push(fight);
      }
    }
  }
  return fights;
}

interface KillArea {
  anchor: WorldLocation;
  radius: number;
  respawn: number;
}

function killArea(clock: Clock): KillArea | undefined {
  const { near, respawn, radius } = clock.areaSettings;
  const anchor = near ?? clock.at;
  if (!clock.area && anchor) clock.area = { anchor, radius, respawn };
  return clock.area;
}

const inArea =
  ({ anchor, radius }: KillArea) =>
  (p: WorldLocation) =>
    within(p, anchor, radius);

function killWalk(
  fights: readonly Fight[],
  from: Standing,
  start: number,
  clock: Clock,
  area: KillArea,
): { walk: KillWalk; away: Map<number, number> } {
  const run = M.runSpeed.value;
  const groups = new Map<string, { npcId: number; spawns: readonly Spawn[]; fights: Fight[] }>();
  const ready = new Map<string, number>();
  const readyAt = (p: Spawn) => ready.get(p.id) ?? (clock.respawns.get(p.id) ?? 0) - start;
  const away = new Map<number, number>();
  for (const fight of fights) {
    const key = `${fight.npcId} ${fight.questId}`;
    let group = groups.get(key);
    if (!group) {
      const onMap = clock.spawns(fight.npcId, fight.questId).filter((p) => p.instance === from.instance);
      const spawns = onMap.filter(inArea(area));
      if (onMap.length && !spawns.length) away.set(fight.npcId, 0);
      groups.set(key, (group = { npcId: fight.npcId, spawns, fights: [] }));
    }
    group.fights.push(fight);
    const far = away.get(fight.npcId);
    if (far !== undefined) away.set(fight.npcId, far + 1);
  }
  const kills: KillAt[] = [];
  let at: Standing = from;
  let now = 0;
  while (kills.length < fights.length) {
    let best = { key: "", spawn: -1, yards: 0, begin: Infinity };
    for (const [key, group] of groups) {
      if (!group.fights.length) continue;
      if (!group.spawns.length) {
        const begin = now + M.noSpawnWalk.value / run;
        if (begin < best.begin) best = { key, spawn: -1, yards: 0, begin };
        continue;
      }
      for (const [i, p] of group.spawns.entries()) {
        const yards = Math.max(0, Math.hypot(p.x - at.x, p.y - at.y) - M.pullReach.value);
        const begin = Math.max(now + yards / run, readyAt(p));
        if (begin < best.begin) best = { key, spawn: i, yards, begin };
      }
    }
    const { key, spawn, yards } = best;
    const group = groups.get(key)!;
    const fight = group.fights.shift()!;
    let { begin } = best;
    let arrive = begin;
    let way: string | undefined;
    const p = group.spawns[spawn];
    if (p) {
      const to = stopShort(at, p, yards);
      const routed = clock.walk?.({ from: at, to, mode: "Run", toward: p });
      arrive = now + (routed?.seconds ?? yards / run);
      begin = Math.max(arrive, readyAt(p));
      way = routed?.way;
      at = to;
    }
    now = begin + fight.seconds;
    if (p) {
      ready.set(p.id, now + area.respawn);
      clock.respawns.set(p.id, start + now + area.respawn);
    }
    kills.push({ at, arrive, end: now, npcId: fight.npcId, ...(p && { spawn: p }), ...(way !== undefined && { way }) });
  }
  const spawns = [...groups.values()].flatMap(({ npcId, spawns }) => spawns.map((at) => ({ npcId, at })));
  return { walk: { from, kills, spawns }, away };
}

function stopShort(at: WorldLocation, p: Spawn, yards: number): Standing {
  const f = yards / (yards + M.pullReach.value);
  return { instance: at.instance, x: at.x + (p.x - at.x) * f, y: at.y + (p.y - at.y) * f, ...(p.z !== undefined && { height: p.z }) };
}

function passWalk(
  pass: NonNullable<Extract<ActBody, { kind: "kill" }>["passBy"]>,
  from: Standing,
  start: number,
  clock: Clock,
  level: number,
  questId?: number,
): KillWalk {
  const kills: KillAt[] = [];
  let at: Standing = from;
  let now = 0;
  for (const kill of pass.kills) {
    const p = kill.at;
    const yards = Math.max(0, Math.hypot(p.x - at.x, p.y - at.y) - M.pullReach.value);
    const to = stopShort(at, p, yards);
    const routed = clock.walk?.({ from: at, to, mode: "Run", toward: p });
    const arrive = now + (routed?.seconds ?? yards / M.runSpeed.value);
    now = arrive + fightSeconds(kill.level, clock.data.npc(kill.npcId)?.elite ?? false, level, clock);
    kills.push({ at: to, arrive, end: now, npcId: kill.npcId, spawn: p, ...(routed?.way !== undefined && { way: routed.way }) });
    clock.respawns.set(p.id, start + now + (clock.areaSettings.respawn ?? M.respawn.value));
    at = to;
  }
  const { respawn, radius } = clock.areaSettings;
  const areas = [from, ...kills.map((kill) => kill.at)].map((anchor) => inArea({ anchor, radius, respawn }));
  const spawns = new Map(pass.kills.map(({ npcId, at }) => [at.id, { npcId, at }]));
  for (const npcId of pass.eligibleNpcIds)
    for (const at of clock.spawns(npcId, questId))
      if (!spawns.has(at.id) && areas.some((contains) => contains(at))) spawns.set(at.id, { npcId, at });
  return { from, kills, spawns: [...spawns.values()] };
}

interface KillTally {
  count: number;
  colors: Map<MobColor, number>;
  byNpc: Map<number, number>;
}

function killTally(activities: readonly Activity[], level: number, clock: Clock): KillTally {
  const tally: KillTally = { count: 0, colors: new Map(), byNpc: new Map() };
  const add = (npcId: number, mobLevel: number, n: number) => {
    const color = mobColor(level, mobLevel);
    tally.count += n;
    tally.colors.set(color, (tally.colors.get(color) ?? 0) + n);
    tally.byNpc.set(npcId, (tally.byNpc.get(npcId) ?? 0) + n);
  };
  for (const a of activities)
    if (a.kind === "kill") for (const k of a.kills) for (const mob of k.mobs) for (const l of mob.levels) add(mob.npcId, l.level, l.kills);
  for (const a of activities) {
    if (a.kind !== "grind") continue;
    for (const { npcId, count } of a.checkpoint.kills?.mobs ?? []) {
      const npc = clock.data.npc(npcId);
      if (npc?.levels) add(npcId, Math.round((npc.levels.min + npc.levels.max) / 2), count);
    }
  }
  return tally;
}

function stepNotes(activities: readonly Activity[], killed: KillTally): string[] {
  const sources = new Map<string, number>();
  for (const a of activities) if (a.source !== undefined) sources.set(a.source, (sources.get(a.source) ?? 0) + 1);
  return [
    ...(sources.size ? [`travel ${[...sources].map(([s, n]) => `${s}×${n}`).join(", ")}`] : []),
    ...activities.flatMap((a) => (a.kind === "flight" ? [`flew to ${a.name}`] : a.kind === "hearth" && a.to ? ["hearthed"] : [])),
    ...(killed.count ? [`${killed.count} kills (${[...killed.colors].map(([c, n]) => `${n} ${c}`).join(", ")})`] : []),
  ];
}

function namePlaces(activities: Activity[], name: NonNullable<PriceOptions["placeName"]>): void {
  activities.forEach((a, i) => {
    if (a.kind !== "travel" || a.target.kind !== "goto") return;
    const quests: QuestNpc[] = [];
    for (const next of activities.slice(i + 1)) {
      if (next.kind === "travel" || next.kind === "flight" || next.kind === "deathskip") break;
      if (next.kind === "interact" && next.questId !== undefined && (next.action === "accept" || next.action === "turnin"))
        quests.push({ kind: "quest", questId: next.questId, role: next.action });
    }
    const place = name(a.to, quests);
    if (place !== undefined) activities[i] = { ...a, place };
  });
}

function questsOf(a: Activity): number[] {
  const ids = a.effects.flatMap((e) => (e.kind === "accept" || e.kind === "turnin" ? [e.questId] : []));
  if ((a.kind === "travel" || a.kind === "flight") && a.target.kind === "quest") ids.push(a.target.questId);
  if (a.kind === "interact" && a.questId !== undefined) ids.push(a.questId);
  if (a.kind === "kill" && a.progress) ids.push(a.progress.questId);
  return ids;
}

export interface Moment {
  /** Index into `TimelineResult.steps`. */
  step: number;
  /** The activity at the moment; none after the last. An activity of no seconds is never current. */
  activity?: Activity;
  /** What the character is doing, with the target and the kills done; empty after the last activity. */
  doing: string;
  /**
   * The character at the moment. Kill `i` of `n` ends at its walk's `end`,
   * or at `start + i/n` of its activity's seconds with no walk, and then
   * counts its XP and its share of the activity's objective counts and drops.
   */
  character: SimState;
  /** The second the Hearthstone is ready at the moment; 0 when it was never used. */
  hearthReadyAt: number;
}

/** What the character is doing at second `t` of the timeline, and its state then. Undefined for a timeline of no steps. */
export function momentAt(timeline: TimelineResult, t: number): Moment | undefined {
  const { steps } = timeline;
  if (!steps.length) return undefined;
  let lo = 0;
  let hi = steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (steps[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  let character = steps[lo]!.before;
  let { hearthReadyAt } = steps[lo]!;
  for (const activity of steps[lo]!.activities) {
    if (activity.start + activity.seconds <= Math.max(t, 0)) {
      character = activity.effects.reduce(advance, character);
      if (activity.kind === "hearth" && activity.to) hearthReadyAt = activity.start + activity.seconds + M.hearthCooldown.value;
      continue;
    }
    const of = workCount(activity);
    const done = workDone(activity, t - activity.start, of);
    if (activity.kind === "kill") character = killsDone(activity.effects, done, of, character);
    return { step: lo, activity, doing: describe(activity, done, timeline.names), character, hearthReadyAt };
  }
  return { step: lo, doing: "", character, hearthReadyAt };
}

function killsDone(effects: readonly Effect[], done: number, of: number, before: SimState): SimState {
  let state = before;
  let kills = 0;
  for (const e of effects) {
    if (e.kind === "xp") {
      if (kills++ < done) state = advance(state, e);
    } else if (e.kind === "objective") {
      const quest = state.log.get(e.ref.questId);
      const from = quest?.objectives[e.ref.row];
      if (!from) continue;
      const count = from.count + Math.floor((done * (e.progress.count - from.count)) / of);
      state = advance(state, { ...e, progress: { ...from, count } });
    }
  }
  return state;
}

function workDone(a: Activity, seconds: number, of: number): number {
  const walk = (a.kind === "kill" || a.kind === "grind") && a.walk;
  if (walk) return walk.kills.filter((k) => k.end <= seconds).length;
  return Math.max(0, Math.floor((seconds / a.seconds) * of));
}

/**
 * A mob at its spawn. A dead mob has `dead`: the second of its kill, and the
 * second its spawn has a mob again, from the route's start.
 */
export type MobView = MobSpawn & { dead?: { since: number; until: number } };

const deathsOf = new WeakMap<TimelineResult, (MobSpawn & { since: number; until: number })[]>();

function deaths(timeline: TimelineResult) {
  let found = deathsOf.get(timeline);
  if (found) return found;
  found = timeline.steps.flatMap(({ activities, respawn }) =>
    activities.flatMap((a) =>
      a.kind === "grind" || a.kind === "kill"
        ? (a.walk?.kills ?? []).flatMap(({ npcId, spawn, end }) =>
            spawn ? [{ npcId, at: spawn, since: a.start + end, until: a.start + end + respawn }] : [],
          )
        : [],
    ),
  );
  deathsOf.set(timeline, found);
  return found;
}

/**
 * The mobs at second `t` of the timeline: the activity's displayed spawns,
 * including eligible mobs it does not kill, and each spawn whose mob is
 * dead at `t`, until its respawn.
 */
export function mobsAt(timeline: TimelineResult, t: number, activity: Activity | undefined): MobView[] {
  const shown = new Map<string, MobView>();
  const key = ({ at }: MobSpawn) => at.id;
  const targets = activity?.kind === "grind" || activity?.kind === "kill" ? activity.walk?.spawns : undefined;
  for (const spawn of targets ?? []) shown.set(key(spawn), spawn);
  for (const { since, until, ...spawn } of deaths(timeline))
    if (since <= t && t < until) shown.set(key(spawn), { ...spawn, dead: { since, until } });
  return [...shown.values()];
}

function workCount(a: Activity): number {
  if (a.kind === "kill") return a.kills.reduce((n, k) => n + k.count, 0);
  if (a.kind === "grind") return a.checkpoint.kills?.count ?? 0;
  return 0;
}

function describe(a: Activity, done: number, names: Names): string {
  const quest = (questId: number) => names.quests[questId] ?? `Quest ${questId}`;
  const npc = (npcId: number) => names.npcs[npcId] ?? `NPC ${npcId}`;
  switch (a.kind) {
    case "travel":
    case "flight": {
      const { target } = a;
      const to =
        target.kind === "goto"
          ? (a.kind === "travel" && a.place) || target.label
          : target.kind === "quest"
            ? `${target.role === "accept" ? "accept" : "turn in"} ${quest(target.questId)}`
            : target.kind === "bind"
              ? "the Hearthstone bind"
              : target.kind === "flight"
                ? names.flights[target.to]
                : "the guide's last place";
      return a.kind === "flight" ? `On flight path to ${a.name}` : `Traveling to ${to}`;
    }
    case "wait":
      return "Waiting for the Hearthstone";
    case "hearth":
      return "Hearthing";
    case "deathskip":
      return "Dying and resurrecting at the Spirit Healer";
    case "interact": {
      const q = a.questId === undefined ? "" : quest(a.questId);
      return {
        accept: `Accepting ${q}`,
        turnin: `Turning in ${q}`,
        train: "Training",
        vendor: "At a vendor",
        home: "Setting the Hearthstone",
        fp: `Learning the flight path ${a.name}`,
        fly: `Taking the flight path ${a.name}`,
        gather: `Gathering ${a.count} for ${q}`,
      }[a.action];
    }
    case "kill": {
      const mobs = killList(a, names);
      const p = a.progress;
      return p
        ? `Killing ${mobs} for ${quest(p.questId)} (${Math.floor(p.counted + (done * p.gained) / workCount(a) + ITEM_TOLERANCE)}/${p.of ?? "?"})`
        : `Killing ${mobs} (${done}/${workCount(a)})`;
    }
    case "grind": {
      const { kills, target } = a.checkpoint;
      return `Grinding${kills ? ` ${kills.mobs.map((m) => npc(m.npcId)).join(", ")} (${done}/${kills.count})` : ""} to ${levelText(target)}`;
    }
    case "update":
      return "";
  }
}

function killList(a: Extract<Activity, { kind: "kill" }>, names: Names): string {
  const byNpc = new Map<number, number>();
  for (const k of a.kills)
    for (const mob of k.mobs) byNpc.set(mob.npcId, (byNpc.get(mob.npcId) ?? 0) + mob.levels.reduce((n, l) => n + l.kills, 0));
  return [...byNpc].map(([id, n]) => `${names.npcs[id] ?? `NPC ${id}`} x${n}`).join(", ");
}

/**
 * What a step does, as its quest log, trainer, and map would show it: `label`
 * names the quest, the mobs, the level, the flight path, or the place. `kill`
 * is kills that count toward no quest; `grind` closes an XP gap.
 */
export interface StepAction {
  kind: "accept" | "turnin" | "complete" | "kill" | "grind" | "train" | "vendor" | "home" | "fp" | "fly" | "hearth" | "deathskip" | "goto";
  label: string;
}

/**
 * The step's actions in the order of its activities, each once. Travel and
 * waits are not actions, except that a step with no other action goes to the
 * place of its last `goto`.
 */
export function stepActions(step: TimelineStep, names: Names): StepAction[] {
  const quest = (questId: number) => names.quests[questId] ?? `Quest ${questId}`;
  const action = (a: Activity): StepAction | undefined => {
    switch (a.kind) {
      case "interact":
        if (a.action === "accept" || a.action === "turnin") return { kind: a.action, label: quest(a.questId!) };
        if (a.action === "gather") return { kind: "complete", label: quest(a.questId!) };
        if (a.action === "fp" || a.action === "fly") return { kind: a.action, label: a.name ?? "" };
        return { kind: a.action, label: "" };
      case "flight":
        return { kind: "fly", label: a.name };
      case "deathskip":
        return a.to ? { kind: "deathskip", label: "Spirit Healer" } : undefined;
      case "hearth":
        return a.to ? { kind: "hearth", label: "" } : undefined;
      case "kill": {
        const questId = a.progress?.questId;
        return questId === undefined ? { kind: "kill", label: killList(a, names) } : { kind: "complete", label: quest(questId) };
      }
      case "grind":
        return { kind: "grind", label: levelText(a.checkpoint.target) };
      default:
        return undefined;
    }
  };
  const actions: StepAction[] = [];
  for (const a of step.activities) {
    const next = action(a);
    if (next && !actions.some((b) => b.kind === next.kind && b.label === next.label)) actions.push(next);
  }
  const goto = step.activities.findLast((a) => a.kind === "travel" && a.target.kind === "goto");
  if (!actions.length && goto?.kind === "travel" && goto.target.kind === "goto")
    actions.push({ kind: "goto", label: goto.place ?? goto.target.label });
  return actions;
}

function levelText(target: LevelTarget): string {
  switch (target.kind) {
    case "level":
      return `level ${target.level}`;
    case "plus":
      return `${target.xp} XP into level ${target.level}`;
    case "fraction":
      return `level ${target.level + target.fraction}`;
    case "minus":
      return `${target.xp} XP before level ${target.level}`;
  }
}

/** Classic con colors: red 5 or more levels above, orange 3 to 4, yellow within 2, gray at or below `grayLevel`, green between. */
export function mobColor(playerLevel: number, mobLevel: number): MobColor {
  const above = mobLevel - playerLevel;
  if (above >= 5) return "red";
  if (above >= 3) return "orange";
  if (above >= -2) return "yellow";
  return mobLevel > grayLevel(playerLevel) ? "green" : "gray";
}

function combatSeconds(color: MobColor, elite: boolean, cls: ClassName, party: PartySize): number {
  return (M.killSeconds.value[color] * M.classSpeed.value[cls] * (elite ? M.eliteFactor.value : 1)) / M.partyDamage.value[party];
}

function travelMode(state: Pick<SimState, "level">): TravelLeg["mode"] {
  const mount = M.mount.value;
  return mount && state.level >= mount.level ? "Mount" : "Run";
}

/**
 * The default travel: a straight line times `detour` at run speed, or
 * mounted in the Mount mode when that is faster. A leg between maps costs
 * `crossMap`.
 */
export function straightTravel({ from, to, mode }: TravelLeg): TravelEstimate {
  if (from.instance !== to.instance) return { seconds: M.crossMap.value, source: "crossing" };
  const yards = Math.hypot(to.x - from.x, to.y - from.y) * M.detour.value;
  const run = yards / M.runSpeed.value;
  const mount = M.mount.value;
  const ride = mount && mode === "Mount" ? mount.cast + yards / (M.runSpeed.value * mount.speed) : Infinity;
  return { seconds: Math.min(run, ride), source: "straight" };
}

/** The default flight: a straight line times `flightDetour` at flight speed, after `flightOverhead`. */
export function flightLeg({ from, to }: Pick<FlightLeg, "from" | "to">): TravelEstimate {
  if (from.instance !== to.instance) return { seconds: M.crossMap.value, source: "crossing" };
  const yards = Math.hypot(to.x - from.x, to.y - from.y) * M.flightDetour.value;
  return { seconds: M.flightOverhead.value + yards / M.flightSpeed.value, source: "flight" };
}

function cachedSpawns(spawns: PriceOptions["spawns"]): SpawnsOf {
  const cache = new Map<string, readonly Spawn[]>();
  return (npcId, questId) => {
    const key = `${npcId} ${questId}`;
    let points = cache.get(key);
    if (!points) cache.set(key, (points = spawns?.(npcId, questId) ?? []));
    return points;
  };
}

export function stepTitle(step: Step): string {
  return reportTitle(stepTitleParts(step));
}

/** In UTF-16 code units. */
const TITLE_LENGTH = 60;

export function reportTitle(title: readonly TextPart[]): string {
  const text = guideTextPlain(title);
  if (text.length <= TITLE_LENGTH) return text;
  const high = text.charCodeAt(TITLE_LENGTH - 1);
  return text.slice(0, high >= 0xd800 && high <= 0xdbff ? TITLE_LENGTH - 1 : TITLE_LENGTH);
}

export function stepTitleParts(step: Step): TextPart[] {
  const commands = step.body.filter((l) => l.kind === "command");
  const text = step.body.find((l) => l.kind === "text")?.text ?? commands.find((c) => c.text)?.text;
  const command = commands[0];
  const parts = guideText(text ?? (command ? `.${command.name} ${command.args.join(",")}` : ""), undefined, { colors: true });
  const trim = (from: number, step: 1 | -1, pattern: RegExp) => {
    for (let i = from; i >= 0 && i < parts.length; i += step) {
      const part = parts[i]!;
      if (typeof part === "string") parts[i] = part.replace(pattern, "");
      else if (isColorRun(part)) parts[i] = { ...part, text: part.text.replace(pattern, "") };
      else continue;
      if (guideTextPlain([parts[i]!])) return;
    }
  };
  trim(0, 1, /^[\s>]+/);
  trim(parts.length - 1, -1, /\s+$/);
  return parts.filter((part) => isTexture(part) || guideTextPlain([part]) !== "");
}
