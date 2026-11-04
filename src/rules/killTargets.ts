import type { ZoneId } from "../data/index.ts";
import { argumentEntities, readAsTerminated, type BodyLine, type Step } from "../guide/index.ts";
import { completeRow, pageOrder } from "./completeRows.ts";
import type {
  KillAssumption,
  MobSource,
  ObjectiveRef,
  SimData,
  SimDirective,
  SimWarning,
  SimNumberedObjective,
  SimObjective,
  SimQuest,
  SimTextObjective,
  StepNote,
  UnitLine,
} from "./simulate.ts";
import { dropChance, ITEM_TOLERANCE, type DropChance } from "./drops.ts";
import type { Location } from "./validate.ts";
import type { PartySize } from "./xp.ts";

/** `unknownSimKey` is for an `extra=` whose `mob=` names no NPC with known levels. */
export type KillWarning = Extract<SimWarning, { kind: "noKillTarget" | "noKillCount" | "unknownSimKey" }>;

export interface StepKills {
  kills: KillAssumption[];
  /** Each `.complete` line's objective count, whatever its `kills=` or mobs. */
  counts: (ObjectiveCount & { at: Location })[];
  notes: StepNote[];
  warnings: KillWarning[];
}

/** An objective's required count, from the data or a `.complete` line's text. */
export interface ObjectiveCount {
  count: number;
  from: "data" | "guideText";
}

export interface StepMobs {
  /** From `.mob` lines, the mobs a text row falls back to. */
  mob: readonly number[];
  /** From `.target` and `.unitscan` lines. */
  target: readonly number[];
  /** The commands whose lines name each NPC. */
  lines: ReadonlyMap<number, readonly UnitLine[]>;
}

const UNIT_LINES = ["mob", "target", "unitscan"] as const satisfies readonly UnitLine[];

export interface KillLine {
  at: Location;
  mobs: StepMobs;
  /** `kills=` on the line. */
  kills?: number;
  /** `mob=` on the line, alone or with `kills=`. */
  mob?: number;
  /** The line's text and comment, which may give the count as `(xN)`, `(N)`, or `N/N`. */
  text?: string;
  /** The count an earlier line gave, for when the data and `text` give none. */
  total?: ObjectiveCount;
  /** An earlier line set the objective's mobs, so a bought or gathered item still counts kills. */
  started?: boolean;
}

type Earlier = (ref: ObjectiveRef) => Pick<KillLine, "total" | "started"> | undefined;

/**
 * The kills one line assumes, or the `step` line for `at.line` undefined:
 * a `.complete` line's objective, then the line's `extra=` directives.
 * `directives` may hold the whole guide's; only those on the line apply.
 * `.complete q,N` names the row that `completeRow` numbers N. Text rows
 * count in page order, because the data keeps them in the quest log's
 * order. `mobs` are the step's, and `earlier` gives the count earlier lines
 * gave an objective and whether they set its mobs.
 */
export function lineKills(
  step: Step,
  at: { guide: number; step: number; line?: number },
  directives: readonly SimDirective[],
  data: SimData,
  mobs: StepMobs,
  earlier?: Earlier,
): StepKills {
  const out: StepKills = { kills: [], counts: [], notes: [], warnings: [] };
  const mine = directives.filter((d) => d.at.step === at.step && d.at.line === at.line);
  const found = at.line === undefined ? undefined : completeKills(step.body[at.line]!, { ...at, line: at.line }, mine, data, mobs, earlier);
  if (found) {
    out.kills.push(...found.kills);
    out.counts.push(...found.counts);
    out.notes.push(...found.notes);
    out.warnings.push(...found.warnings);
  }
  for (const d of mine) {
    if (d.key !== "extra" || d.count === 0) continue;
    const known = knownMobs([d.mob], data);
    if (!known.length) out.warnings.push({ kind: "unknownSimKey", at: d.at, key: "mob", value: String(d.mob), problem: "badValue" });
    else
      out.kills.push({
        at: d.at,
        count: d.count,
        countFrom: "override",
        mobFrom: "override",
        mobs: spreadLevels(known, evenShares(d.count, known.length)),
      });
  }
  return out;
}

function completeKills(
  line: BodyLine,
  at: Location,
  mine: readonly SimDirective[],
  data: SimData,
  mobs: StepMobs,
  earlier: Earlier | undefined,
): StepKills | undefined {
  const view = readAsTerminated(line);
  if (view.kind !== "command" || view.name !== "complete") return undefined;
  const questId = argumentEntities("complete", view.args, 0)[0]?.id;
  const index = /^\d+$/.test(view.args[1]?.trim() ?? "") ? Number(view.args[1]) : 0;
  if (questId === undefined || index < 1) return undefined;
  const quest = data.quest(questId);
  if (!quest) return undefined;
  const row = completeRow(quest.objectives, index);
  if (row === undefined) {
    if (!pageOrder(quest.objectives)) return undefined;
    const warning: KillWarning = { kind: "noKillTarget", at, questId, objective: `Objective ${index}`, reason: "noMatch" };
    return { kills: [], counts: [], notes: [], warnings: [warning] };
  }
  const set = mine.find((d): d is LineSetting => d.key === "kills" || d.key === "mob");
  const said = [view.text, view.comment].filter(Boolean).join(" ");
  const ref = { questId, row };
  return objectiveKills(data, ref, {
    at,
    mobs,
    ...(set?.key === "kills" && { kills: set.count }),
    ...(set?.mob !== undefined && { mob: set.mob }),
    ...(said && { text: said }),
    ...earlier?.(ref),
  });
}

/**
 * The NPCs on a step's `.mob`, `.target`, and `.unitscan` lines, each once.
 * An argument is an ID, `Name::id`, or a name, which counts when it names
 * exactly one NPC. A name several NPCs share counts as the one of them that
 * the step's `.complete` and `.turnin` quests name, as `npcNamed` says.
 */
export function stepMobs(step: Step, data: SimData): StepMobs {
  let quests: SimQuest[] | undefined;
  const stepQuests = () => (quests ??= questsOf(step, data));
  const mob = new Set<number>();
  const target = new Set<number>();
  const lines = new Map<number, UnitLine[]>();
  for (const line of step.body) {
    if (line.kind !== "command" || (line.name !== "mob" && line.name !== "target" && line.name !== "unitscan")) continue;
    const name = line.name;
    line.args.forEach((arg, i) => {
      const id = argumentEntities(name, line.args, i)[0]?.id ?? npcNamed(data, arg.trim().replace(/^\+/, ""), stepQuests);
      if (id === undefined) return;
      (name === "mob" ? mob : target).add(id);
      const named = lines.get(id) ?? lines.set(id, []).get(id)!;
      if (!named.includes(name)) named.push(name);
    });
  }
  return { mob: [...mob], target: [...target], lines };
}

/**
 * One objective's kills at `line`: its whole count, the mobs, and where each
 * came from. Objectives that need no kills give nothing. Unless the line has
 * `kills=` or `mob=`, or an earlier line set the mobs, an item an NPC sells
 * gives a `bought` note, and one that only objects give, a `gathered` note.
 */
export function objectiveKills(data: SimData, ref: ObjectiveRef, line: KillLine): StepKills {
  const out: StepKills = { kills: [], counts: [], notes: [], warnings: [] };
  const quest = data.quest(ref.questId);
  const row = quest?.objectives[ref.row];
  if (!quest || !row) return out;
  const need = row.kind === "text" ? textNeed(data, row) : numberedNeed(row);
  if (!need) return out;
  const warn = (warning: { kind: "noKillCount" } | { kind: "noKillTarget"; reason: TargetReason }) =>
    out.warnings.push({ ...warning, at: line.at, questId: ref.questId, objective: row.name });

  const guideCount = textCount(line.text);
  const total: ObjectiveCount | undefined =
    row.count !== null
      ? { count: row.count, from: "data" }
      : guideCount !== undefined
        ? { count: guideCount, from: "guideText" }
        : line.total;
  if (total) out.counts.push({ at: line.at, ...total });

  const itemId = need.kind === "item" ? need.id : row.kind === "item" ? null : undefined;
  const item = itemId != null && line.kills === undefined && line.mob === undefined && !line.started ? data.item(itemId) : undefined;
  if (itemId != null && (item?.sold || item?.objectsOnly)) {
    out.notes.push({ kind: item.sold ? "bought" : "gathered", at: line.at, objective: ref, itemId, count: row.count });
    return out;
  }

  const { count, from: countFrom } = line.kills !== undefined ? { count: line.kills, from: "override" as const } : (total ?? {});
  if (count === undefined || countFrom === undefined) {
    warn({ kind: "noKillCount" });
    return out;
  }
  if (count === 0) return out;
  if (line.started && line.mob === undefined) return out;

  const chosen: Choice | TargetReason =
    line.mob !== undefined
      ? { ids: [line.mob], from: "override" }
      : need.kind === "monster"
        ? monsterMobs(need, line.mobs)
        : need.kind === "item"
          ? itemMobs(data, need.id, quest.zoneIds, line.mobs)
          : need.kind === "stepMob" && line.mobs.mob.length
            ? { ids: line.mobs.mob, from: "stepMob", lines: ["mob"] }
            : need.reason;
  if (typeof chosen === "string") {
    warn({ kind: "noKillTarget", reason: chosen });
    return out;
  }
  const known = knownMobs(chosen.ids, data);
  if (!known.length) {
    warn({ kind: "noKillTarget", reason: "noLevels" });
    return out;
  }
  const droppers = itemId == null ? undefined : data.item(itemId)?.droppers;
  const drops =
    itemId === undefined ? undefined : known.map(({ npcId }) => ({ npcId, chance: dropChance(droppers?.find((d) => d.id === npcId)) }));
  const kills = drops
    ? itemLineKills(drops, undefined, countFrom === "override" ? { kills: count } : { to: count }).per
    : evenShares(count, known.length);
  out.kills.push({
    at: line.at,
    objective: ref,
    eligibleNpcIds: known.map(({ npcId }) => npcId),
    count: kills.reduce((a, b) => a + b, 0),
    countFrom,
    mobFrom: chosen.from,
    ...(chosen.lines && { mobLines: chosen.lines }),
    ...(itemId !== undefined && { itemId }),
    ...(drops && { drops }),
    mobs: spreadLevels(known, kills),
  });
  return out;
}

export interface ItemProgress {
  items: number;
  unroundedKills: number;
  kills: number[];
}

/** What lines have counted of one objective's kills, as `ObjectiveProgress.kills` holds it. */
export interface KillProgress {
  /**
   * The first line to count kills, or a deferring line's `mob=`: its mobs
   * and drop chances, whose kill order later lines continue.
   */
  first?: KillAssumption;
  /** The count from the last line that found one. */
  total?: ObjectiveCount;
  /** Kills of a monster objective, or the items each member holds of an item objective. */
  counted: number;
  /** For an item objective, the party's expected drops and kills, once a line counts kills. */
  items?: ItemProgress;
}

/**
 * The kills that take an objective's `progress` to `to`, or `kills` kills
 * for `kills=`, in the order they count, with the progress after them.
 * They continue the mobs of `progress.first`, else start `fresh`'s, and
 * there are none without either. A kill objective continues the first
 * line's kill order, which repeats past its count. An item objective
 * continues its expected drops in the party's items, where each member
 * needs the items. `drop` sets every dropper's chance for these kills only.
 * Item progress can advance with no kills.
 */
export function takeKills(
  progress: KillProgress,
  goal: { to: number } | { kills: number },
  party: PartySize,
  data: SimData,
  line: { fresh?: KillAssumption | undefined; drop?: number | undefined } = {},
): { kills: Kill[]; mobs: KillAssumption; progress: KillProgress } | undefined {
  const first = progress.first ?? line.fresh;
  if (!first) return undefined;
  const { drop } = line;
  if (!first.drops) {
    const n = "to" in goal ? Math.floor(goal.to) - progress.counted : Math.floor(goal.kills);
    const order = killSequence(first.mobs);
    const kills = Array.from({ length: Math.max(0, n) }, (_, k) => order[(progress.counted + k) % order.length]!);
    return { kills, mobs: first, progress: kills.length ? { ...progress, first, counted: progress.counted + kills.length } : progress };
  }
  const drops =
    drop === undefined
      ? first.drops
      : first.drops.map(({ npcId }) => ({ npcId, chance: { value: drop, source: { kind: "override" as const } } }));
  const whole = "to" in goal ? { to: Math.floor(goal.to * party) } : { kills: Math.floor(goal.kills) };
  const prior = progress.items ?? itemLineKills(first.drops, undefined, { to: progress.counted * party }).progress;
  const next = itemLineKills(drops, prior, whole);
  return {
    kills: itemKillSlice(drops, next.progress, next.per, data),
    mobs: { ...first, drops },
    progress: next.progress === prior ? progress : { ...progress, first, items: next.progress, counted: next.progress.items / party },
  };
}

/**
 * An item objective's `progress` after kills that its lines did not count
 * drop `expected` items for the party, up to `count` items for each member. The drops advance its
 * expected kills too, as seeded items do, so later lines round the running
 * total once.
 */
export function creditDrops(progress: KillProgress, count: number, expected: number, party: PartySize): KillProgress {
  const drops = Math.min(expected, (count - progress.counted) * party);
  if (drops <= 0) return progress;
  const sum = progress.counted * party + drops;
  const items = Math.abs(sum - Math.round(sum)) <= ITEM_TOLERANCE ? Math.round(sum) : sum;
  const before = progress.items;
  return {
    ...progress,
    counted: items / party,
    ...(before && { items: { ...itemLineKills(progress.first!.drops!, before, { to: items }).progress, kills: before.kills } }),
  };
}

/**
 * An objective count as the party's work: kills of a monster objective, or
 * drops of an item objective, where each drop credits one member.
 */
export function partyCount(kills: Pick<KillAssumption, "itemId">, n: number, party: PartySize): number {
  return kills.itemId === undefined ? n : n * party;
}

function itemLineKills(
  drops: readonly { npcId: number; chance: DropChance }[],
  progress: ItemProgress = { items: 0, unroundedKills: 0, kills: drops.map(() => 0) },
  goal: { to: number } | { kills: number },
): { progress: ItemProgress; per: number[] } {
  const per = drops.map(() => 0);
  const segment = "to" in goal ? goal.to - progress.items : goal.kills;
  if (segment <= ITEM_TOLERANCE || drops.length === 0) return { progress, per };
  const ordered = drops.map((drop, i) => ({ ...drop, i, weight: 1 / drop.chance.value })).sort((a, b) => a.npcId - b.npcId);
  const weight = ordered.reduce((sum, d) => sum + d.weight, 0);
  const expected = progress.unroundedKills + ("to" in goal ? (segment / drops.length) * weight : goal.kills);
  // Rounding the running total, not each share, makes partial lines and the turn-in total the kills of one whole line.
  const count = "kills" in goal ? goal.kills : Math.round(expected) - Math.round(progress.unroundedKills);
  const quotas = ordered.map((d) => {
    const quota = (count * d.weight) / weight;
    per[d.i] = Math.floor(quota);
    return { ...d, remainder: quota - Math.floor(quota) };
  });
  const left = count - per.reduce((sum, n) => sum + n, 0);
  quotas.sort((a, b) => b.remainder - a.remainder || a.npcId - b.npcId);
  for (const d of quotas.slice(0, left)) per[d.i]! += 1;
  const items = "to" in goal ? goal.to : progress.items + ordered.reduce((sum, d) => sum + per[d.i]! * d.chance.value, 0);
  return { progress: { items, unroundedKills: expected, kills: progress.kills.map((n, i) => n + per[i]!) }, per };
}

function itemKillSlice(
  drops: readonly { npcId: number; chance: DropChance }[],
  progress: ItemProgress,
  per: readonly number[],
  data: SimData,
): Kill[] {
  const ordered = drops
    .map((d, i) => ({ npcId: d.npcId, left: per[i]!, cursor: progress.kills[i]! - per[i]! }))
    .sort((a, b) => a.npcId - b.npcId);
  const slice: Kill[] = [];
  while (ordered.some((d) => d.left > 0)) {
    for (const d of ordered) {
      if (d.left === 0) continue;
      slice.push({ npcId: d.npcId, level: levelOf(data.npc(d.npcId)!.levels!, d.cursor++) });
      d.left -= 1;
    }
  }
  return slice;
}

/** The level of a mob's kill after `kills` kills, in the order `spreadLevels` gives leftover kills. */
export function levelOf(range: { min: number; max: number }, kills: number): number {
  const span = range.max - range.min + 1;
  const j = kills % span;
  return range.min + (j % 2 === 0 ? j / 2 : span - 1 - (j - 1) / 2);
}

function evenShares(count: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, i) => Math.floor(count / parts) + (i < count % parts ? 1 : 0));
}

function knownMobs(npcIds: readonly number[], data: SimData): { npcId: number; range: { min: number; max: number } }[] {
  return [...new Set(npcIds)].flatMap((npcId) => {
    const range = data.npc(npcId)?.levels;
    return range ? [{ npcId, range }] : [];
  });
}

function spreadLevels(known: ReturnType<typeof knownMobs>, kills: readonly number[]): KillAssumption["mobs"] {
  const mobs: { npcId: number; levels: { level: number; kills: number }[] }[] = [];
  for (const [i, { npcId, range }] of known.entries()) {
    const total = kills[i]!;
    if (total === 0) continue;
    const span = range.max - range.min + 1;
    const perLevel = Array.from({ length: span }, () => Math.floor(total / span));
    for (let j = 0; j < total % span; j++) perLevel[j % 2 === 0 ? j / 2 : span - 1 - (j - 1) / 2]! += 1;
    const levels = perLevel.map((n, o) => ({ level: range.min + o, kills: n })).filter((l) => l.kills > 0);
    mobs.push({ npcId, levels });
  }
  return mobs;
}

export interface Kill {
  npcId: number;
  level: number;
}

/**
 * A `KillAssumption`'s kills in the order they are counted: one from each
 * mob and level in turn, so any slice mixes them evenly. Consecutive slices,
 * such as a partial `.complete` line's and then the turn-in's, together
 * give all its kills.
 */
export function killSequence(mobs: KillAssumption["mobs"]): Kill[] {
  const left = mobs.flatMap((m) => m.levels.map((l) => ({ npcId: m.npcId, level: l.level, kills: l.kills })));
  const kills: Kill[] = [];
  while (left.some((b) => b.kills > 0)) {
    for (const b of left) {
      if (b.kills === 0) continue;
      b.kills -= 1;
      kills.push({ npcId: b.npcId, level: b.level });
    }
  }
  return kills;
}

/** Kills grouped by mob and level, as `KillAssumption.mobs` holds them: mobs in first-seen order, levels ascending. */
export function tallyKills(kills: readonly Kill[]): KillAssumption["mobs"] {
  const mobs = new Map<number, Map<number, number>>();
  for (const { npcId, level } of kills) {
    const levels = mobs.get(npcId) ?? new Map<number, number>();
    mobs.set(npcId, levels.set(level, (levels.get(level) ?? 0) + 1));
  }
  return [...mobs].map(([npcId, levels]) => ({
    npcId,
    levels: [...levels].map(([level, n]) => ({ level, kills: n })).sort((a, b) => a.level - b.level),
  }));
}

function npcNamed(data: SimData, name: string, quests: () => readonly SimQuest[]): number | undefined {
  const match = data.entityByName(name);
  if (match?.kind === "npc") return match.id;
  if (match?.kind !== "ambiguous") return undefined;
  const named = questNpcs(data, quests());
  const zoneIds = quests().flatMap((q) => q.zoneIds);
  for (const keep of [(id: number) => named.has(id), (id: number) => !!data.npc(id)?.zoneIds.some((z) => zoneIds.includes(z))]) {
    const found = match.npcIds.filter(keep);
    if (found.length) return found.length === 1 ? found[0] : undefined;
  }
  return undefined;
}

function questsOf(step: Step, data: SimData): SimQuest[] {
  const quests: SimQuest[] = [];
  for (const line of step.body) {
    const view = readAsTerminated(line);
    if (view.kind !== "command" || (view.name !== "complete" && view.name !== "turnin")) continue;
    const id = argumentEntities(view.name, view.args, 0)[0]?.id;
    const quest = id === undefined ? undefined : data.quest(id);
    if (quest) quests.push(quest);
  }
  return quests;
}

function questNpcs(data: SimData, quests: readonly SimQuest[]): Set<number> {
  const npcs = new Set<number>();
  for (const quest of quests)
    for (const o of quest.objectives) {
      if ((o.need ?? "kills") !== "kills") continue;
      const targets = objectiveTargets(o);
      for (const id of targets.npcs) npcs.add(id);
      for (const id of targets.items) for (const dropper of data.item(id)?.droppers ?? []) npcs.add(dropper.id);
    }
  return npcs;
}

type LineSetting = Extract<SimDirective, { key: "kills" | "mob" }>;

type Choice = { ids: readonly number[]; from: MobSource; lines?: readonly UnitLine[] };

type TargetReason = Extract<KillWarning, { kind: "noKillTarget" }>["reason"];

type Need =
  | { kind: "monster"; ids: readonly number[]; from: MobSource }
  | { kind: "item"; id: number }
  | { kind: "stepMob" | "unresolved"; reason: TargetReason };

function numberedNeed(objective: SimNumberedObjective): Need | undefined {
  if (objective.kind === "other" || (objective.need ?? "kills") !== "kills") return undefined;
  const [first] = objective.ids;
  if (first === undefined) return { kind: "unresolved", reason: objective.kind === "item" ? "noDropper" : "noMatch" };
  return objective.kind === "item" ? { kind: "item", id: first } : { kind: "monster", ids: objective.ids, from: "objective" };
}

/** The NPCs and items a row names: a numbered row's IDs by its kind, or a text row's one link. */
export function objectiveTargets(row: SimObjective): { npcs: readonly number[]; items: readonly number[] } {
  if (row.kind !== "text") return { npcs: row.kind === "monster" ? row.ids : [], items: row.kind === "item" ? row.ids : [] };
  const { link } = row;
  return { npcs: link?.kind === "npc" ? [link.id] : [], items: link?.kind === "item" ? [link.id] : [] };
}

function textNeed(data: SimData, row: SimTextObjective): Need | undefined {
  if (row.need !== "kills") return undefined;
  if (row.link?.kind === "npc") return { kind: "monster", ids: [row.link.id], from: "objective" };
  if (row.link?.kind === "item") return { kind: "item", id: row.link.id };
  const match = data.entityByName(row.name);
  if (match?.kind === "npc") return { kind: "monster", ids: [match.id], from: "nameMatch" };
  if (match?.kind === "item") return { kind: "item", id: match.id };
  return { kind: "stepMob", reason: match ? "ambiguous" : "noMatch" };
}

function namedMobs(ids: readonly number[], mobs: StepMobs): Choice | undefined {
  const named = [...mobs.mob, ...mobs.target].filter((id) => ids.includes(id));
  if (!named.length) return undefined;
  return { ids: named, from: "stepMob", lines: UNIT_LINES.filter((name) => named.some((id) => mobs.lines.get(id)?.includes(name))) };
}

function monsterMobs(need: { ids: readonly number[]; from: MobSource }, mobs: StepMobs): Choice {
  return (need.ids.length > 1 && namedMobs(need.ids, mobs)) || need;
}

function itemMobs(data: SimData, itemId: number, zoneIds: readonly ZoneId[], mobs: StepMobs): Choice | "noDropper" {
  const droppers = data.item(itemId)?.droppers.map((d) => d.id) ?? [];
  const named = namedMobs(droppers, mobs);
  if (named) return named;
  const local = droppers.filter((id) => data.npc(id)?.zoneIds.some((z) => zoneIds.includes(z)));
  if (local.length) return { ids: local, from: "zoneDroppers" };
  return droppers.length ? { ids: [droppers[0]!], from: "firstDropper" } : "noDropper";
}

function textCount(text: string | undefined): number | undefined {
  const match = text?.match(/\(x?(\d+)\)|\d+\/(\d+)/);
  return match ? Number(match[1] ?? match[2]) : undefined;
}
