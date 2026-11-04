import { parseLine, type ConditionExpr, type GuideRecord, type Line, type TagLine } from "../guide/index.ts";
import { evaluate } from "./condition.ts";
import { pickGroup, SPEEDRUN_GROUP } from "./preview.ts";
import { raceToken, type Profile } from "./profile.ts";
import { PLAYABLE_RACES, RACE_FACTION } from "../data/races.ts";

export interface GuideMeta {
  /** First `#name` value. */
  name: string;
  /**
   * The `RegisterGuide` group argument, else the first `#group` value. RXP
   * keeps an explicit group argument and ignores `#group` then.
   */
  group: string;
  /** Guides that `#next` lines point to, in order. */
  next: NextTarget[];
  /**
   * The levels a leading `N-M` in `#name` names, such as 12 to 14 for
   * `12-14 Loch Modan`. This is the planner's reading of the name, not an
   * RXP rule: RXP reads levels only from conditions and `#maxlevel`.
   */
  range: LevelRange | undefined;
}

/** A guide's level range; `min <= max`, both at least 1. */
export interface LevelRange {
  min: number;
  max: number;
}

const NO_GROUP = "(no group)";

const metaCache = new WeakMap<GuideRecord, GuideMeta>();

/** Reads the header of a guide's text. Cached per record object. */
export function guideMeta(guide: GuideRecord): GuideMeta {
  let meta = metaCache.get(guide);
  if (meta) return meta;
  const tags = headerLines(guide.text).filter((l): l is TagLine => l.kind === "tag");
  const first = (name: string) => tags.find((t) => t.name === name)?.value.trim() ?? "";
  const group = guide.registerArgs?.group.trim() || first("group") || NO_GROUP;
  const next = tags
    .filter((t) => t.name === "next")
    .flatMap((t) => nextItems(t.value, group).map((item) => item.target))
    .filter((t) => t.name);
  const name = first("name");
  meta = { name, group, next, range: nameRange(name) };
  metaCache.set(guide, meta);
  return meta;
}

function nameRange(name: string): LevelRange | undefined {
  const match = /^(\d+)-(\d+)(?!\d)/.exec(name);
  if (!match) return undefined;
  const [min, max] = [Number(match[1]), Number(match[2])];
  return min >= 1 && min <= max ? { min, max } : undefined;
}

function headerLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = parseLine(raw);
    if (line.kind === "step") break;
    lines.push(line);
  }
  return lines;
}

export interface NextTarget {
  group: string;
  name: string;
}

/**
 * Reads the `;`-separated items of a `#next` value. An item is a name, or
 * `Group\Name`. RXP reads an unqualified name in the group of the last
 * `Group\` prefix before it in the same value, else in the guide's own group
 * (`addon.functions.next` in RXP's functions.lua).
 */
export function nextItems(value: string, group: string): { part: string; item: string; qualified: boolean; target: NextTarget }[] {
  let readIn = group;
  return value.split(";").map((part) => {
    const item = part.trim();
    const at = item.lastIndexOf("\\");
    const qualified = at >= 0;
    if (qualified) readIn = item.slice(0, at).trim();
    return { part, item, qualified, target: { group: readIn, name: qualified ? item.slice(at + 1).trim() : item } };
  });
}

/**
 * The group that the user's copies of a built-in guide in `group` go in:
 * `<group> (custom)`, where a speedrun group goes by the name Classic mode
 * shows it under, such as `RestedXP Speedrun Guide (A) (custom)`.
 */
export function customGroup(group: string): string {
  const side = SPEEDRUN_GROUP.exec(group)?.[1];
  return `${side ? `RestedXP Speedrun Guide (${side[0]})` : group} (custom)`;
}

export function guideKey(target: NextTarget): string {
  return `${target.group}\n${target.name}`;
}

/**
 * The group RXP files a guide under for `profile`: a `RegisterGuide` group
 * argument, else the group `pickGroup` gives. Without a profile, the group
 * `guideMeta` reads.
 */
export function resolvedGroup(guide: GuideRecord, profile: Profile | null): string {
  if (!profile) return guideMeta(guide).group;
  return pickGroup(registration(guide).groups, (when) => evaluate(when, profile))?.value || guideMeta(guide).group;
}

/** Every group that a guide's `RegisterGuide` group argument or `#group` lines can give, conditional or not. */
export function guideGroups(guide: GuideRecord): string[] {
  const reg = registration(guide);
  const groups = reg.fallbackGroup ? [reg.fallbackGroup] : reg.groups.map((g) => g.value).filter(Boolean);
  return groups.length > 0 ? [...new Set(groups)] : [NO_GROUP];
}

/** Every group and `#name` pair that a guide's lines can give, conditional or not. */
export function guideTargets(guide: GuideRecord): NextTarget[] {
  const names = new Set(
    registration(guide)
      .names.map((n) => n.value)
      .filter(Boolean),
  );
  return guideGroups(guide).flatMap((group) => [...names].map((name) => ({ group, name })));
}

/**
 * The groups that the user's one copy of built-in `builtin` can be in:
 * `customGroup` of each group in `guideGroups`. The first is where a new
 * copy goes: the custom group of the group that applies for `profile`.
 */
export function copyGroups(builtin: GuideRecord, profile: Profile | null): string[] {
  const first = customGroup(resolvedGroup(builtin, profile));
  return [...new Set([first, ...guideGroups(builtin).map(customGroup)])];
}

export interface BuiltinIndex {
  /** The built-in RXP keeps under each group and name: the last one registered. */
  kept: ReadonlyMap<string, GuideRecord>;
  /** The built-in that a user's copy with each group and name belongs to: its name in one of its `copyGroups`. */
  copied: ReadonlyMap<string, GuideRecord>;
}

/** Indexes `builtins`, which are in load order. */
export function builtinIndex(builtins: Iterable<GuideRecord>): BuiltinIndex {
  const kept = new Map<string, GuideRecord>();
  const copied = new Map<string, GuideRecord>();
  for (const builtin of builtins) {
    const { group, name } = guideMeta(builtin);
    kept.set(guideKey({ group, name }), builtin);
    for (const copyGroup of copyGroups(builtin, null)) copied.set(guideKey({ group: copyGroup, name }), builtin);
  }
  return { kept, copied };
}

/** The last registered user copy under each group and name, by `guideKey`. */
export function guidesByKey(guides: Iterable<GuideRecord>): Map<string, GuideRecord> {
  const byKey = new Map<string, GuideRecord>();
  for (const guide of guides) {
    const key = guideKey(guideMeta(guide));
    const previous = byKey.get(key);
    if (!previous || guide.order >= previous.order) byKey.set(key, guide);
  }
  return byKey;
}

/**
 * Selects a name from records in load order. Names in different groups are
 * separate guides in the library, so the first matching group wins. Within
 * that group, keep the last registration, as the library does.
 */
export function guideNamed(guides: readonly GuideRecord[], name: string): number {
  const match = [...guidesByKey(guides).values()].find((guide) => guideMeta(guide).name === name);
  return match ? guides.indexOf(match) : -1;
}

/**
 * The user's copy of built-in `builtin`: the guide in `byKey` (see
 * `guidesByKey`) with its name in one of its `copyGroups`, looked up in
 * that order. A built-in has a copy whatever the character, so changing it
 * never leads to a second copy.
 */
export function copyOf(byKey: ReadonlyMap<string, GuideRecord>, builtin: GuideRecord, profile: Profile | null): GuideRecord | undefined {
  const { name } = guideMeta(builtin);
  for (const group of copyGroups(builtin, profile)) {
    const copy = byKey.get(guideKey({ group, name }));
    if (copy) return copy;
  }
  return undefined;
}

// Registration clashes. RXP keys loaded guides by group and name
// (`group||name`, `addon.AddGuide` in RXP's GuideLoader.lua), and reports a guide it
// already loaded under that key (`LoadGuide` there). A guide loads only for
// characters that its first header `<< condition` line applies to, and
// `#group` and `#name` lines with a failing `<< condition` do not count
// (`LoadGuide`). Two guides clash when some character loads both
// under the same key.

const RACES = PLAYABLE_RACES.map((race) => [raceToken(race), RACE_FACTION[race]] as const);
const RACE_TOKENS = new Set(RACES.map(([token]) => token));
const CLASSES = ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"];
const MAX_FREE_TOKENS = 10;

interface Registration {
  /** First header condition line, which decides whether the guide loads. */
  enabledFor?: ConditionExpr;
  groups: { value: string; when?: ConditionExpr }[];
  names: { value: string; when?: ConditionExpr }[];
  fallbackGroup: string;
}

const registrationCache = new WeakMap<GuideRecord, Registration>();

function registration(guide: GuideRecord): Registration {
  let reg = registrationCache.get(guide);
  if (reg) return reg;
  reg = { groups: [], names: [], fallbackGroup: guide.registerArgs?.group.trim() ?? "" };
  for (const line of headerLines(guide.text)) {
    if (line.kind === "condition") reg.enabledFor ??= line.condition.expr;
    // An explicit `RegisterGuide` group wins over `#group` (`addon.ParseGuide` in GuideLoader.lua).
    if (line.kind === "tag" && line.name === "group" && guide.registerArgs) continue;
    if (line.kind === "tag" && (line.name === "group" || line.name === "name")) {
      const entry: Registration["groups"][number] = { value: line.value.trim() };
      if (line.condition) entry.when = line.condition.expr;
      (line.name === "group" ? reg.groups : reg.names).push(entry);
    }
  }
  registrationCache.set(guide, reg);
  return reg;
}

type Character = (token: string) => boolean;

function holds(expr: ConditionExpr, character: Character): boolean {
  switch (expr.type) {
    case "or":
      return expr.items.some((e) => holds(e, character));
    case "and":
      return expr.items.every((e) => holds(e, character));
    case "not":
      return !holds(expr.item, character);
    case "token":
      return character(expr.value);
    case "invalid":
      return false;
  }
}

function freeTokens(expr: ConditionExpr, out: Set<string>): void {
  if (expr.type === "or" || expr.type === "and") expr.items.forEach((e) => freeTokens(e, out));
  else if (expr.type === "not") freeTokens(expr.item, out);
  else if (expr.type === "token") {
    const token = expr.value === "Undead" ? "Scourge" : expr.value;
    if (!CLASSES.includes(token.toUpperCase()) && !RACE_TOKENS.has(token) && token !== "Alliance" && token !== "Horde") out.add(token);
  }
}

function key(reg: Registration, character: Character): string | undefined {
  if (reg.enabledFor && !holds(reg.enabledFor, character)) return undefined;
  const name = reg.names.find((n) => !n.when || holds(n.when, character))?.value;
  const group = pickGroup(reg.groups, (when) => holds(when, character))?.value || reg.fallbackGroup;
  return name ? `${group}\n${name}` : undefined;
}

/** Whether some character would load both guides under the same group and name. Above `MAX_FREE_TOKENS` free tokens, true without a check. */
export function guidesClash(a: GuideRecord, b: GuideRecord): boolean {
  const regs = [registration(a), registration(b)];
  const free = new Set<string>();
  for (const reg of regs) {
    for (const expr of [reg.enabledFor, ...[...reg.groups, ...reg.names].map((e) => e.when)]) {
      if (expr) freeTokens(expr, free);
    }
  }
  if (free.size > MAX_FREE_TOKENS) return true;
  const tokens = [...free];
  for (const [race, faction] of RACES) {
    for (const cls of CLASSES) {
      for (let bits = 0; bits < 1 << tokens.length; bits++) {
        const character: Character = (token) => {
          const t = token === "Undead" ? "Scourge" : token;
          if (t.toUpperCase() === cls || t === race || t === faction) return true;
          const i = tokens.indexOf(t);
          return i >= 0 && (bits & (1 << i)) !== 0;
        };
        const [ka, kb] = regs.map((r) => key(r, character));
        if (ka !== undefined && ka === kb) return true;
      }
    }
  }
  return false;
}

/** Pairs of guides for which `guidesClash` is true. */
export function registrationClashes(guides: readonly GuideRecord[]): [GuideRecord, GuideRecord][] {
  const buckets = new Map<string, GuideRecord[]>();
  for (const guide of guides) {
    const reg = registration(guide);
    const groups = [...reg.groups.map((g) => g.value || reg.fallbackGroup), reg.fallbackGroup];
    for (const k of new Set(reg.names.flatMap((n) => groups.map((g) => `${g}\n${n.value}`)))) {
      buckets.set(k, [...(buckets.get(k) ?? []), guide]);
    }
  }
  const pairs: [GuideRecord, GuideRecord][] = [];
  const seen = new Set<string>();
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [a, b] = [bucket[i]!, bucket[j]!];
        const id = `${a.id}\n${b.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (guidesClash(a, b)) pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
