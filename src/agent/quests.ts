import { locatedSpawns, RACE_FACTION, yards, type GameData, type Quest, type QuestPoint } from "../data/index.ts";
import { factionData, questAccess, TIMELINE_MODEL, trivialQuest, type Faction, type QuestAccess, type SimState } from "../rules/index.ts";
import { questXp } from "../rules/xp.ts";
import {
  areaPlaces,
  CHARACTER,
  followers,
  MAX_GUIDE,
  npcSpots,
  parsePoint,
  POINT,
  pointPlace,
  profileOf,
  questRef,
  questsFor,
  round1,
  runGuide,
  worldPlace,
  zoneId,
  type CharacterInput,
} from "./data.ts";
import { ToolError, type AgentContext, type Tool } from "./tool.ts";

export const FACTION = { type: "string", enum: ["Alliance", "Horde"], description: "Faction view of the data. A race sets it." } as const;
export const RACE = {
  ...CHARACTER.race,
  description: `${CHARACTER.race.description} Sets the faction and hides quests the race cannot take.`,
};
export const CLASS = { ...CHARACTER.class, description: `${CHARACTER.class.description} Hides quests the class cannot take.` };

export const factionFor = (input: { race?: CharacterInput["race"]; faction?: Faction }) =>
  input.race ? RACE_FACTION[input.race] : input.faction;

const newCharacterState = (level: number): Pick<SimState, "level" | "log" | "done"> => ({ level, log: new Map(), done: new Set() });

function takeablePredicate(ctx: AgentContext, input: { race?: CharacterInput["race"]; class?: CharacterInput["class"] }) {
  if (!input.race || !input.class) return undefined;
  const profile = profileOf({ race: input.race, class: input.class, level: 1 });
  const { sim } = factionData(ctx.game, ctx.entities, RACE_FACTION[input.race]);
  return (id: number) => {
    const quest = sim.quest(id);
    return quest !== undefined && !questAccess(quest, newCharacterState(1), profile, sim).excluded;
  };
}

function accessText(access: QuestAccess): string {
  if (access.excluded) return `not for this ${access.reason}`;
  const locks = access.locked.map((lock) => {
    switch (lock.kind) {
      case "level":
        return `needs level ${lock.requiredLevel}`;
      case "prerequisite":
        return `needs ${[...lock.allOf, ...lock.anyOf].join("/")} turned in first`;
      case "parent":
        return `needs ${lock.quest} in the log`;
      default:
        return lock.kind;
    }
  });
  return locks.length ? locks.join("; ") : "can take";
}

function distinctSources(game: GameData, points: readonly QuestPoint[]) {
  const seen = new Map<string, QuestPoint>();
  for (const point of points) {
    const key = `${point.sourceType}:${point.sourceId ?? point.sourceName}`;
    if (!seen.has(key)) seen.set(key, point);
  }
  return [...seen.values()].map((point) => ({
    name: point.sourceName,
    type: point.sourceType,
    ...(point.sourceId !== undefined && { id: point.sourceId }),
    ...pointPlace(game, point),
  }));
}

const questSearch: Tool<{
  text?: string;
  zone?: string;
  minLevel?: number;
  maxLevel?: number;
  race?: CharacterInput["race"];
  class?: CharacterInput["class"];
  faction?: Faction;
  limit: number;
}> = {
  name: "quest_search",
  description:
    "Find quests by name text or ID, zone, quest level range, and faction or race and class. Returns ID, name, quest level, required level, zones, giver, and base XP, sorted by quest level.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 100, description: "Text in the quest name, or a quest ID." },
      zone: { type: "string", maxLength: 100, description: "Zone name, such as Elwynn Forest." },
      minLevel: { type: "integer", minimum: 1, maximum: 63 },
      maxLevel: { type: "integer", minimum: 1, maximum: 63 },
      race: RACE,
      class: CLASS,
      faction: FACTION,
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
  run(input, ctx) {
    const { game } = ctx;
    const faction = factionFor(input);
    let quests = game.searchQuests({
      ...(input.text !== undefined && { text: input.text }),
      ...(input.zone !== undefined && { zoneId: zoneId(game, input.zone) }),
      ...(input.minLevel !== undefined && { minLevel: input.minLevel }),
      ...(input.maxLevel !== undefined && { maxLevel: input.maxLevel }),
      ...(faction && { faction }),
    });
    const can = takeablePredicate(ctx, input);
    if (can) quests = quests.filter((q) => can(q.id));
    return {
      total: quests.length,
      quests: quests.slice(0, input.limit).map((q) => ({
        id: q.id,
        name: q.name,
        level: q.questLevel,
        requiredLevel: q.requiredLevel,
        zones: q.zoneIds.slice(0, 3).map((id) => game.zone(id)?.name ?? id),
        giver: q.startPoints[0]?.sourceName ?? null,
        baseXp: q.baseXp,
      })),
    };
  },
};

const levelText = ({ min, max }: { min: number; max: number }) => (min === max ? `${min}` : `${min}-${max}`);

export function mobsIn(ctx: AgentContext, points: readonly QuestPoint[], faction?: Faction) {
  const counts = new Map<number, { name: string; spawns: number }>();
  for (const p of points)
    if (p.sourceType === "npc" && p.sourceId !== undefined) {
      const entry = counts.get(p.sourceId) ?? { name: p.sourceName, spawns: 0 };
      entry.spawns++;
      counts.set(p.sourceId, entry);
    }
  return [...counts].map(([id, { name, spawns }]) => {
    const levels = ctx.game.npc(id, faction)?.levels;
    return { id, name, spawns, ...(levels && { levels: levelText(levels) }) };
  });
}

const questDetails: Tool<{
  id: number;
  race?: CharacterInput["race"];
  class?: CharacterInput["class"];
  faction?: Faction;
  level?: number;
  near?: string;
}> = {
  name: "quest_details",
  description:
    "Everything a guide needs about one quest: givers and enders with `.goto` points, objectives with spawn areas (spawn count, radius in yards, nearest-first when `near` is given), the mobs or droppers, prerequisites and next quests, XP at a level, and a guess at whether party members can share it.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1, maximum: 10_000_000 },
      race: RACE,
      class: CLASS,
      faction: FACTION,
      level: { type: "integer", minimum: 1, maximum: 60, description: "Player level for the XP and access check." },
      near: { ...POINT, description: `Sort spawn areas by distance from this point. ${POINT.description}` },
    },
    required: ["id"],
    additionalProperties: false,
  },
  run(input, ctx) {
    const { game } = ctx;
    const faction = factionFor(input);
    const quest = game.quest(input.id, faction);
    if (!quest) throw new ToolError(`No quest ${input.id} in the data. Use quest_search to find IDs.`);
    const near = input.near === undefined ? undefined : parsePoint(game, input.near);
    const objectives = quest.objectives.map((o) => {
      const points = [...locatedSpawns(game, quest, o, faction).keys()];
      return {
        ...(o.index !== undefined && { index: o.index }),
        type: o.type,
        name: o.name,
        count: o.count ?? null,
        ids: o.ids.slice(0, 5),
        mobs: mobsIn(ctx, points, faction).slice(0, 5),
        spawns: points.length,
        areas: areaPlaces(
          game,
          points.map((p) => p.world),
          near,
        ),
      };
    });
    const textObjectives = (quest.textObjectives ?? []).map((t) => ({
      name: t.name,
      count: t.count ?? null,
      need: t.need,
      ...(t.link && { link: t.link }),
    }));
    const pre = { allOf: quest.preQuestGroup, anyOf: quest.preQuestSingle };
    const providedItem = textObjectives.some((t) => t.need === "providedItem");
    const hasPre = pre.allOf === null || pre.anyOf === null || pre.allOf.length > 0 || pre.anyOf.length > 0;
    const can = takeablePredicate(ctx, input);
    const next = [...new Set([...(quest.nextQuestInChain ? [quest.nextQuestInChain] : []), ...followers(game, quest.id)])].filter(
      (id) => can?.(id) ?? true,
    );
    const level = input.level;
    let access: string | undefined;
    if (input.race && input.class) {
      const { sim } = factionData(ctx.game, ctx.entities, RACE_FACTION[input.race]);
      const simQuest = sim.quest(quest.id);
      if (simQuest)
        access = accessText(
          questAccess(simQuest, newCharacterState(level ?? 1), profileOf({ race: input.race, class: input.class, level: level ?? 1 }), sim),
        );
    }
    return {
      id: quest.id,
      name: quest.name,
      level: quest.questLevel,
      requiredLevel: quest.requiredLevel,
      for: `${quest.raceRequirement}, ${quest.classRequirement}`,
      ...(access && { access: `${access} (for a new character)` }),
      types: quest.types,
      givers: distinctSources(game, quest.startPoints),
      enders: distinctSources(game, quest.endPoints),
      objectives,
      ...(textObjectives.length && { textObjectives }),
      prerequisites:
        pre.allOf === null || pre.anyOf === null
          ? "unknown"
          : { allOf: pre.allOf.map((id) => questRef(game, id)), anyOf: pre.anyOf.map((id) => questRef(game, id)) },
      next: next.slice(0, 8).map((id) => questRef(game, id)),
      ...(quest.exclusiveTo?.length && { exclusiveTo: quest.exclusiveTo.map((id) => questRef(game, id)) }),
      baseXp: quest.baseXp,
      ...(level !== undefined &&
        quest.baseXp !== null &&
        quest.questLevel !== null && {
          xp: { level, xp: questXp(quest.baseXp, quest.questLevel, level), gray: trivialQuest(quest.questLevel, level) },
        }),
      ...(quest.rewardMoney !== undefined && { rewardCopper: quest.rewardMoney }),
      shareable: {
        guess: !hasPre && !providedItem,
        why: hasPre
          ? "has or may have prerequisites"
          : providedItem
            ? "the giver hands over an item"
            : "no prerequisite and no provided item",
      },
    };
  },
};

const questsAvailable: Tool<
  CharacterInput & { guide?: string; afterStep?: number; near?: string; zone?: string; radius?: number; limit: number }
> = {
  name: "quests_available",
  description:
    "Quests the character can accept now: simulates `guide` (optional) for the character, takes the state after `afterStep` (default: the end), and lists quests it can take that it has not taken, nearest first from `near` or the simulated position. Needs a place: `near`, `zone`, or a guide with .goto lines. Also returns the level, XP, and quest log at that point.",
  inputSchema: {
    type: "object",
    properties: {
      ...CHARACTER,
      guide: { type: "string", maxLength: MAX_GUIDE, description: "Guide text so far. Omit for a new character." },
      afterStep: { type: "integer", minimum: 1, maximum: 10_000, description: "1-based step number; default the last step." },
      near: { ...POINT, description: `Measure distance from here instead of the simulated position. ${POINT.description}` },
      zone: { type: "string", maxLength: 100, description: "Only quests in this zone." },
      radius: { type: "integer", minimum: 1, maximum: 20_000, description: "Only givers within this many yards." },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 15 },
    },
    required: ["race", "class"],
    additionalProperties: false,
  },
  run(input, ctx) {
    const { game } = ctx;
    const profile = profileOf(input);
    let state: SimState = {
      level: input.level,
      xp: 0,
      position: null,
      log: new Map(),
      done: new Set(),
      bind: null,
      flightPaths: new Set(),
    };
    if (input.guide !== undefined) {
      const run = runGuide(ctx, input.guide, input);
      const steps = run.simulation.guides[0]?.steps ?? [];
      if (input.afterStep !== undefined && input.afterStep > steps.length) throw new ToolError(`The guide has ${steps.length} steps.`);
      state = input.afterStep === undefined ? (run.simulation.guides[0]?.end ?? run.simulation.start) : steps[input.afterStep - 1]!.state;
    }
    const origin = input.near === undefined ? (state.position ?? undefined) : parsePoint(game, input.near);
    const zone = input.zone === undefined ? undefined : zoneId(game, input.zone);
    if (!origin && zone === undefined)
      throw new ToolError(
        "Give a place: `near` as a .goto point (npc_find and quest_details give them), `zone`, or a `guide` with .goto lines. Without one, the list mixes every starting zone.",
      );
    const { sim } = factionData(ctx.game, ctx.entities, profile.faction);
    const open = questsFor(game, profile.faction).flatMap((quest) => {
      if (state.done.has(quest.id) || state.log.has(quest.id) || (zone !== undefined && !quest.zoneIds.includes(zone))) return [];
      const simQuest = sim.quest(quest.id);
      if (!simQuest || simQuest.acceptOnTurnIn) return [];
      const access = questAccess(simQuest, state, profile, sim);
      if (access.excluded || access.locked.length) return [];
      const giver = origin
        ? quest.startPoints.reduce<QuestPoint | undefined>(
            (best, p) => (!best || yards(p.world, origin) < yards(best.world, origin) ? p : best),
            undefined,
          )
        : quest.startPoints[0];
      const distance = giver && origin ? yards(giver.world, origin) : Infinity;
      if (input.radius !== undefined && !(distance <= input.radius)) return [];
      return [{ quest, giver, distance }];
    });
    const noXp = (q: Quest) => (q.baseXp ? 0 : 1);
    open.sort(
      (a, b) => a.distance - b.distance || noXp(a.quest) - noXp(b.quest) || (a.quest.questLevel ?? 99) - (b.quest.questLevel ?? 99),
    );
    const xpAt = (q: Quest) => (q.baseXp === null || q.questLevel === null ? null : questXp(q.baseXp, q.questLevel, state.level));
    return {
      level: state.level,
      xp: state.xp,
      ...(origin && { from: worldPlace(game, origin) }),
      log: [...state.log].map(([id, progress]) => ({ id, name: game.quest(id)?.name ?? null, status: progress.status })),
      turnedIn: state.done.size,
      total: open.length,
      quests: open.slice(0, input.limit).map(({ quest, giver, distance }) => ({
        id: quest.id,
        name: quest.name,
        level: quest.questLevel,
        xp: xpAt(quest),
        ...(quest.questLevel !== null && trivialQuest(quest.questLevel, state.level) && { gray: true }),
        giver: giver ? { name: giver.sourceName, ...pointPlace(game, giver) } : null,
        yards: Number.isFinite(distance) ? Math.round(distance) : null,
      })),
    };
  },
};

const npcFind: Tool<{ query: string; faction?: Faction; race?: CharacterInput["race"]; near?: string; limit: number }> = {
  name: "npc_find",
  description:
    "Find NPCs by name or ID: level range, elite, zones, quests they start and end, and where they stand. Places come from quest data, so NPCs no quest names have no places.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 100, description: "NPC name, part of a name, or ID." },
      faction: FACTION,
      race: RACE,
      near: { ...POINT, description: `Sort spawn areas by distance from this point. ${POINT.description}` },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  run(input, ctx) {
    const { game } = ctx;
    const faction = factionFor(input);
    const near = input.near === undefined ? undefined : parsePoint(game, input.near);
    const spots = npcSpots(game, faction);
    const found = ctx.entities.search("npc", input.query, input.limit);
    return {
      npcs: found.map((npc) => {
        const facts = game.npc(npc.id, faction);
        const at = spots.get(npc.id);
        const points = at?.points ?? [];
        const zones = facts?.zoneIds?.length
          ? facts.zoneIds.map((id) => game.zone(id)?.name ?? `${id}`)
          : points.map((p) => pointPlace(game, p).zone);
        return {
          id: npc.id,
          name: npc.name,
          ...(facts?.levels && { levels: levelText(facts.levels) }),
          ...(facts?.elite && { elite: true }),
          zones: [...new Set(zones)].slice(0, 5),
          ...(at?.starts.length && { starts: at.starts.slice(0, 10).map((id) => questRef(game, id)) }),
          ...(at?.ends.length && { ends: at.ends.slice(0, 10).map((id) => questRef(game, id)) }),
          spawns: points.length,
          places:
            points.length <= 3
              ? points.map((p) => pointPlace(game, p))
              : areaPlaces(
                  game,
                  points.map((p) => p.world),
                  near,
                ),
        };
      }),
    };
  },
};

const STRAIGHT_LINE_DETOUR = TIMELINE_MODEL.detour.value;
const RUN_SPEED = TIMELINE_MODEL.runSpeed.value;

const travelTime: Tool<{ from: string; to: string }> = {
  name: "travel_time",
  description: `Seconds and yards to run between two points. Uses a ground route on real terrain when the host has the routing artifact for the map, else a straight line times ${STRAIGHT_LINE_DETOUR} at ${RUN_SPEED} yd/s. \`method\` says which.`,
  inputSchema: {
    type: "object",
    properties: { from: POINT, to: POINT },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const from = parsePoint(ctx.game, input.from),
      to = parsePoint(ctx.game, input.to);
    if (from.instance !== to.instance) throw new ToolError(`The points are on different maps (${from.instance} and ${to.instance}).`);
    const straight = yards(from, to);
    const route = await ctx.travel?.(from, to);
    const measured = route
      ? { method: "terrain", seconds: round1(route.seconds), yards: Math.round(route.yards) }
      : {
          method: "straight-line estimate",
          seconds: round1((straight * STRAIGHT_LINE_DETOUR) / RUN_SPEED),
          yards: Math.round(straight * STRAIGHT_LINE_DETOUR),
        };
    return { ...measured, straightYards: Math.round(straight), from: worldPlace(ctx.game, from), to: worldPlace(ctx.game, to) };
  },
};

export const QUEST_TOOLS = [questSearch, questDetails, questsAvailable, npcFind, travelTime];
