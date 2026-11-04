import {
  luaNumber,
  parseCondition,
  type BodyLine,
  type Condition,
  type ConditionExpr,
  type GuideDocument,
  type Step,
} from "../guide/index.ts";
import { commandRule } from "./commands.ts";
import { evaluate, holds } from "./condition.ts";
import type { GateState } from "./gates.ts";
import { dungeonTag, xpRate, type Profile } from "./profile.ts";

// Which guides, steps, and lines RXP uses for a profile.
//
// Guides: the loader drops a guide whose last header `<< condition` line is
// false, that names other expansions without `#classic`, or that lacks
// `#name` or `#group` (`addon.ParseGuide` in GuideLoader.lua). A guide that
// loads is offered only when its season, phase, XP rate, and `#maxlevel` tags
// pass and it is not `#internal` (`IsGuideActive` in GuideWindow.lua).
//
// Steps: a false `step << condition` drops the step. Every body line with a
// false condition is dropped. The first applying `#tag` line sets each step
// tag; `.group`, `.solo`, and `.dungeon` set step fields too (`parseLine` in
// GuideLoader.lua, `addon.functions.group`, `solo`, and `dungeon` in
// functions.lua). The step is then shown when every check in
// `addon.stepLogic` passes (RXPGuides.lua).
//
// Routes: `#next` lists guides separated by `;`, each optionally prefixed by
// `group\`. A name not found in its group is looked up in the groups that
// share its condensed display name. RXP takes the first guide found that is
// active, or else looks up the last name listed after swapping `SoM` and
// `Era`. It passes over a guide whose season does not match, or that is
// `#hardcore` while hardcore mode is off, as it always is on Forever (see
// `Profile`), and follows that guide's `#next` instead
// (`addon.functions.next` in functions.lua). It then loads the guide even
// when inactive, unless it is `#internal`, and loading a guide cannot turn
// hardcore mode on outside `CLASSIC` (`addon:LoadGuide` in GuideWindow.lua).

/**
 * Why RXP hides a guide or step. `line` indexes the guide header or the step
 * body; a condition without `line` is on the `step` line.
 */
export type HideReason =
  | { kind: "condition"; condition: Condition; line?: number }
  | { kind: "tag"; name: string; value: string; line: number }
  | { kind: "command"; name: string; args: readonly string[]; line: number }
  /**
   * RXP never reaches the step: the `.xp` or `.maxlevel` line at `line` of
   * step `step` jumps past it or back before it.
   */
  | { kind: "jump"; command: JumpCommand; step: number; line: number }
  /** The header names other expansions but not `#classic`. */
  | { kind: "expansion" }
  /** The header lacks `#name` or `#group`. */
  | { kind: "incomplete" };

export interface TagValue {
  value: string;
  line: number;
}

export interface StepPreview {
  shown: boolean;
  reason?: HideReason;
  /** Whether each body line's own condition holds. */
  lines: boolean[];
  /** Step tags from applying lines; the first line for each tag wins. */
  tags: ReadonlyMap<string, TagValue>;
}

export interface GuidePreview {
  /** Index of the guide in the list given to `previewRoute` or `walkRoute`. */
  source: number;
  doc: GuideDocument;
  /** Header tags from applying lines; the first line for each tag wins, except that the last conditional `#group` wins. */
  tags: ReadonlyMap<string, TagValue>;
  /** Whether each header line's own condition holds. */
  headerLines: boolean[];
  /** Why RXP never runs the guide: the loader drops it, or it is `#internal`. */
  hidden?: HideReason;
  /**
   * Why the guide is inactive: RXP's guide menu leaves it out and `#next`
   * prefers other guides, but RXP still runs it when `#next` falls back to it.
   */
  inactive?: HideReason;
  /** Whether `#defaultfor` holds; undefined without it. */
  isDefault?: boolean;
  steps: StepPreview[];
  shown: number;
}

/**
 * How a route ends. `from` is the guide whose `#next` RXP read last; it is
 * not on the route when RXP passed over it for its season or `#hardcore`.
 */
export type RouteEnd =
  /** The guide has no applying `#next`. */
  | { kind: "last"; from: number }
  /**
   * RXP finds no guide to run for `#next` at header line `line`. `source` is
   * set when RXP selects an `#internal` guide, which it refuses to load.
   */
  | { kind: "missing"; from: number; next: string; line: number; source?: number }
  /** `#next` leads back to the guide at `source`, already on the route or passed over. */
  | { kind: "loop"; from: number; source: number }
  /**
   * The `.xp` or `.maxlevel` line at `line` of step `step` in guide `from`
   * jumps back to that step or an earlier one, and RXP repeats those steps
   * while its condition holds.
   */
  | { kind: "jumpLoop"; from: number; command: JumpCommand; step: number; line: number };

/** Commands whose third (`.xp`) or second (`.maxlevel`) argument names a label to jump to. */
export type JumpCommand = "xp" | "maxlevel";

/**
 * Groups that RXP's Classic mode treats as speedrun guides: it shows them as
 * "RestedXP Speedrun Guide (A)" or "(H)" and strips their guides' `#next`
 * group prefixes (`addon.GroupOverride` in GuideLoader.lua).
 */
export const SPEEDRUN_GROUP = /^RestedXP (Alliance|Horde)\b/;

export interface RoutePreview {
  guides: GuidePreview[];
  /** How the route ends; undefined when `#next` was not followed. */
  end?: RouteEnd;
}

/**
 * Previews the guide at `start` and, when `follow` is set, the guides its
 * `#next` tags lead to. `guides` holds guides in registration order; the
 * last loaded guide with a given group/name wins, as in RXP's `AddGuide`.
 * The start guide is always on the route, marked `hidden` or `inactive` when
 * RXP would not run or offer it. Later guides are ones RXP runs, so they are
 * never `hidden`.
 */
export function previewRoute(guides: readonly GuideDocument[], start: number, profile: Profile, follow = true): RoutePreview {
  const route: GuidePreview[] = [];
  for (const event of walkRoute(guides, start, profile, () => profile.level, follow)) {
    if (event.kind === "guide") route.push({ ...event.guide, steps: [], shown: 0 });
    else if (event.kind === "step") {
      const guide = route.at(-1)!;
      guide.steps.push(event.preview);
      if (event.preview.shown) guide.shown++;
    } else return { guides: route, end: event.end };
  }
  return { guides: route };
}

/** A guide as `walkRoute` enters it, before its steps. */
export type GuideEntry = Omit<GuidePreview, "steps" | "shown">;

/** What `walkRoute` yields: each guide, then each of its steps, and how the route ends. */
export type RouteEvent =
  | { kind: "guide"; guide: GuideEntry }
  /** `guide` is the entry's `source`; `step` indexes its `doc.steps`. */
  | { kind: "step"; guide: number; step: number; preview: StepPreview }
  | { kind: "end"; end: RouteEnd };

/**
 * Walks the route `previewRoute` previews, reading the player's level from
 * `level` instead of `profile.level`. The walk calls `level` before it gates
 * each step, and at each guide boundary before it reads the guide headers
 * and picks among `#next` alternatives; the entered guide's header is read
 * at that same level.
 *
 * The walk is lazy: it gates a step only when the caller asks for the next
 * event. The simulator applies each step's effects when it receives the
 * step, so `level` returns the level reached before the next step:
 *
 *     for (const event of walkRoute(guides, start, profile, () => state.level)) ...
 *
 * `end` comes last and only when `follow` is set. The walk skips steps whose
 * `#level` or `.maxlevel` gate fails at the level. With `state`, it also
 * skips steps whose quest-state or `.xp` gates fail against the state it
 * returns before each step; without it, those gates pass, as in
 * `previewRoute`. The walk calls `arrive` with each step it reaches, before
 * it calls `level` and `state` to gate the step, so the caller can change
 * the character on arrival. An `.xp` or `.maxlevel` gate with a label jumps
 * to the label's step, and the walk yields the steps it jumps over as
 * hidden, with a `jump` reason, without gating them. The walk yields each
 * step once, so a jump back to the gate's step or an earlier one stops the
 * route: the guide's later steps are hidden with a `jump` reason, and the
 * route ends with `jumpLoop`.
 */
export function walkRoute(
  guides: readonly GuideDocument[],
  start: number,
  profile: Profile,
  level: () => number,
  follow = true,
  state?: () => GateState,
  arrive?: (guide: number, step: number) => void,
): Generator<RouteEvent, void, undefined> {
  return walk(guides, start, profile, level, follow, state, arrive, new Map());
}

export interface EarlierGuide {
  /** Index in the list given to `routeGraph`. */
  source: number;
  /** 1 for the guide whose `#next` names the other guide, 2 for the guide before it, and so on. */
  distance: number;
  /**
   * Whether RXP's guide menu files the guide under the character's own group:
   * the guide has no `#defaultfor`, or its `#defaultfor` holds for the graph's
   * profile. Otherwise RXP files it under `*<group>` (`addon.AddGuide` in
   * GuideLoader.lua).
   */
  isDefault: boolean;
}

export interface RouteGraph {
  /** The guide each guide leads to by `#next`, by source; undefined when it leads nowhere. */
  readonly next: readonly (number | undefined)[];
  /** The guides that lead to `target`, nearest first, then in registration order. */
  leadingTo(target: number): EarlierGuide[];
}

/**
 * Where each guide leads at `profile.level`, as `walkRoute` from that guide
 * would follow it. A guide that the loader drops leads nowhere, as do a
 * guide that a later one with its group and name replaces and a guide whose
 * route ends after it.
 */
export function routeGraph(guides: readonly GuideDocument[], profile: Profile): RouteGraph {
  const routing = readRouting(guides, profile);
  const routings = new Map([[profile.level, routing]]);
  const next = guides.map((_, start) => {
    const key = routing.headers[start]!.key;
    if (key === undefined || routing.byName.get(key) !== start) return undefined;
    for (const event of walk(guides, start, profile, () => profile.level, true, undefined, undefined, routings)) {
      if (event.kind !== "guide") continue;
      if (event.guide.source !== start) return event.guide.source;
      if (event.guide.hidden) return undefined;
    }
    return undefined;
  });
  const into = guides.map((): number[] => []);
  next.forEach((to, from) => to !== undefined && into[to]!.push(from));
  return {
    next,
    leadingTo(target) {
      const found: EarlierGuide[] = [];
      let frontier = [target];
      for (let distance = 1; frontier.length > 0; distance++) {
        frontier = frontier
          .flatMap((t) => into[t]!)
          .filter((source) => source !== target)
          .sort((a, b) => a - b);
        found.push(
          ...frontier.map((source) => ({ source, distance, isDefault: defaultForHolds(routing.headers[source]!, profile) !== false })),
        );
      }
      return found;
    },
  };
}

function* walk(
  guides: readonly GuideDocument[],
  start: number,
  profile: Profile,
  level: () => number,
  follow: boolean,
  state: (() => GateState) | undefined,
  arrive: ((guide: number, step: number) => void) | undefined,
  routings: Map<number, Routing>,
): Generator<RouteEvent, void, undefined> {
  const atLevel = (level: number): Profile => (level === profile.level ? profile : { ...profile, level });
  // RXP evaluates header and step `<<` conditions, numeric ones included,
  // once when it parses a guide (`addon.ParseGuide` in GuideLoader.lua). The
  // walk evaluates them at the supplied level instead: headers at each guide
  // boundary, steps before each step, as if the player reloads while
  // leveling. The `#next` choice and `#maxlevel` match RXP, which checks them
  // against the current level at runtime (`addon.functions.next` in
  // functions.lua, `IsGuideActive` in GuideWindow.lua, and `LevelCheck` in
  // RXPGuides.lua).
  const routingAt = (level: number) => {
    let routing = routings.get(level);
    if (!routing) routings.set(level, (routing = readRouting(guides, atLevel(level))));
    return routing;
  };
  const onRoute = new Set<number>();
  let current = start;
  let routing = routingAt(level());
  for (;;) {
    const header = routing.headers[current]!;
    onRoute.add(current);
    yield { kind: "guide", guide: guideEntry(guides[current]!, current, header, routing.profile) };
    const dungeons = dungeonsOn(routing, header);
    const steps = guides[current]!.steps;
    const labels = stepLabels(steps, routing.profile);
    let jump: { to: number; back: boolean; reason: Extract<HideReason, { kind: "jump" }> } | undefined;
    for (const [i, step] of steps.entries()) {
      if (jump && (jump.back || i < jump.to)) {
        const preview = previewStep(step, atLevel(level()), dungeons);
        yield {
          kind: "step",
          guide: current,
          step: i,
          preview: preview.shown ? { ...preview, shown: false, reason: jump.reason } : preview,
        };
        continue;
      }
      arrive?.(current, i);
      const preview = previewStep(step, atLevel(level()), dungeons, state?.(), labels);
      yield { kind: "step", guide: current, step: i, preview };
      const { reason } = preview;
      if (reason?.kind === "command" && (reason.name === "xp" || reason.name === "maxlevel")) {
        const label = reason.args[reason.name === "xp" ? 2 : 1];
        const to = label === undefined ? undefined : labels.get(label);
        if (to !== undefined) jump = { to, back: to <= i, reason: { kind: "jump", command: reason.name, step: i, line: reason.line } };
      }
    }
    if (!follow) return;
    if (jump?.back) {
      const { command, step, line } = jump.reason;
      yield { kind: "end", end: { kind: "jumpLoop", from: current, command, step, line } };
      return;
    }

    routing = routingAt(level());
    const next = resolveNext(routing, current, new Set());
    if (typeof next !== "number") {
      yield { kind: "end", end: next };
      return;
    }
    current = next;
  }

  function resolveNext(routing: Routing, from: number, skipped: Set<number>): number | RouteEnd {
    const { headers, byName, condensed, profile } = routing;
    const header = headers[from]!;
    const next = header.tags.get("next");
    if (!next) return { kind: "last", from };
    let group = header.tags.get("group")?.value ?? "";
    let name = "";
    let found: number | undefined;
    let last: number | undefined;
    for (const entry of nextEntries(header, next.value)) {
      name = entry;
      const prefix = /^\s*(.+)\\\s*/.exec(entry);
      if (prefix) {
        group = prefix[1]!;
        name = entry.slice(prefix[0].length);
      }
      last = byName.get(loadedKey(group, name));
      const parent = condensed.get(group);
      if (last === undefined && parent !== undefined) {
        // RXP walks the groups in `pairs` order; this takes the first registered.
        for (const [other, display] of condensed) {
          const index = display === parent ? byName.get(loadedKey(other, name)) : undefined;
          if (index !== undefined) {
            [last, group] = [index, other];
            break;
          }
        }
      }
      // Take the first entry whose guide is active and not `#internal`
      // (`IsGuideActive` in GuideWindow.lua).
      if (last !== undefined && !activeGate(headers[last]!.fields, profile) && !truthy(headers[last]!.fields.get("internal"))) {
        found = last;
        break;
      }
    }
    // RXP passes these names to `gsub` as patterns, where the parentheses
    // are a capture: `SoM` becomes `(Era)`, so `B SoM` finds `B (Era)` but
    // `B (SoM)` looks for `B ((Era))`.
    const swapped = profile.season === 1 ? name.replaceAll("Era", "(SoM)") : name.replaceAll("SoM", "(Era)");
    const target = found ?? byName.get(loadedKey(group, swapped));
    const missing: RouteEnd = { kind: "missing", from, next: next.value, line: next.line };
    // Without a target, RXP follows the last guide it found from that guide's `#next`.
    const passOver = target ?? last;
    if (passOver === undefined) return missing;
    if (target !== undefined) {
      const candidate = headers[target]!;
      if (!seasonGate(candidate.fields, profile) && !candidate.fields.has("hardcore")) {
        if (truthy(candidate.fields.get("internal"))) return { ...missing, source: target };
        return onRoute.has(target) ? { kind: "loop", from, source: target } : target;
      }
    }
    if (skipped.has(passOver)) return { kind: "loop", from, source: passOver };
    skipped.add(passOver);
    return resolveNext(routing, passOver, skipped);
  }
}

interface Routing {
  profile: Profile;
  headers: Header[];
  /** Loaded guides by `group||name`; the last registered wins. */
  byName: Map<string, number>;
  /** `addon.condenseGroups`: group to display name, for groups that have one. */
  condensed: Map<string, string>;
  /** What `.enabledungeon` lines set, by guide group: each dungeon tag, on or off. */
  dungeonOverrides: Map<string, Map<string, boolean>>;
}

function readRouting(guides: readonly GuideDocument[], profile: Profile): Routing {
  const headers = guides.map((doc) => readHeader(doc, profile));
  const byName = new Map<string, number>();
  const condensed = new Map<string, string>();
  const dungeonOverrides = new Map<string, Map<string, boolean>>();
  headers.forEach((header, i) => {
    const key = header.key;
    if (key === undefined || header.skip) return;
    byName.set(key, i);
    const display = displayGroup(header, profile);
    if (display) condensed.set(display.group, display.name);
    const group = header.tags.get("group")!.value;
    for (const step of guides[i]!.steps) {
      if (!holds(step.line.condition, profile)) continue;
      for (const line of step.body) {
        if (line.kind !== "command" || line.name !== "enabledungeon" || !holds(line.condition, profile)) continue;
        const arg = dungeonArg(line.args[0]);
        if (!arg) continue;
        let overrides = dungeonOverrides.get(group);
        if (!overrides) dungeonOverrides.set(group, (overrides = new Map<string, boolean>()));
        overrides.set(arg.tag, !arg.negated);
      }
    }
  });
  return { profile, headers, byName, condensed, dungeonOverrides };
}

// RXP's `DungeonCheck` decides whether a dungeon is on for the guide it loads.
// An `.enabledungeon` line in a guide of the same group decides first, then
// `#disabledungeons` turns every dungeon off, and then RXP's settings decide.
// `.enabledungeon` acts when RXP parses its guide (`addon.functions.enabledungeon`
// in functions.lua), so a line or step whose condition fails does nothing,
// and the last guide parsed wins.
function dungeonsOn(routing: Routing, header: Header): ReadonlySet<string> {
  const on = new Set(truthy(header.fields.get("disabledungeons")) ? [] : routing.profile.dungeons);
  for (const [tag, enabled] of routing.dungeonOverrides.get(header.tags.get("group")?.value ?? "") ?? []) {
    if (enabled) on.add(tag);
    else on.delete(tag);
  }
  return on;
}

/** A value RXP stores on a guide or step table, and the line that set it. */
interface Field {
  value: string | boolean;
  line: number;
}

type Fields = ReadonlyMap<string, Field>;

export interface Header {
  tags: Map<string, TagValue>;
  fields: Fields;
  lines: boolean[];
  skip?: HideReason;
  /** `group||name` as RXP indexes loaded guides. */
  key?: string;
}

/** Reads a guide's header for `profile`: the tags and lines that apply, and why the loader drops it. */
export function readHeader(doc: GuideDocument, profile: Profile): Header {
  const lines = doc.header.map((line) => holds(line.condition, profile));
  const tags = new Map<string, TagValue>();
  let gate: HideReason | undefined;
  doc.header.forEach((line, i) => {
    if (line.kind === "condition") {
      gate = lines[i] ? undefined : { kind: "condition", condition: line.condition, line: i };
    } else if (line.kind === "tag" && lines[i] && !tags.has(line.name)) {
      tags.set(line.name, { value: line.value, line: i });
    }
  });
  const groups = doc.header.flatMap((line, i) =>
    line.kind === "tag" && line.name === "group" ? [{ value: line.value, line: i, when: line.condition?.expr }] : [],
  );
  const groupLine = pickGroup(groups, (when) => evaluate(when, profile));
  if (groupLine) tags.set("group", { value: groupLine.value, line: groupLine.line });

  const has = (name: string) => tags.has(name);
  const otherGame = ["tbc", "wotlk", "df", "retail", "cata"].some(has);
  const name = tags.get("name")?.value;
  const group = tags.get("group")?.value;
  let skip = gate;
  if (!has("classic") && otherGame) skip = { kind: "expansion" };
  else if (name === undefined || group === undefined) skip = { kind: "incomplete" };

  return {
    tags,
    fields: tags,
    lines,
    ...(skip && { skip }),
    ...(name !== undefined && group !== undefined && { key: loadedKey(group, name) }),
  };
}

/**
 * The `#group` line RXP takes, from `#group` lines in header order: the last
 * one with a condition that applies, else the first one that applies
 * (`addon.ParseGuide` in GuideLoader.lua).
 */
export function pickGroup<T extends { when?: ConditionExpr | undefined }>(
  groups: readonly T[],
  applies: (when: ConditionExpr) => boolean,
): T | undefined {
  const applying = groups.filter((g) => !g.when || applies(g.when));
  return applying.findLast((g) => g.when) ?? applying[0];
}

/** The key RXP indexes a loaded guide under and looks `#next` names up by. */
export function loadedKey(group: string, name: string): string {
  return `${group}||${affix(name)}`;
}

// `addon.affix`: RXP pads a leading `1-9` level range to two digits.
function affix(name: string): string {
  return name.replace(/^(\d)-(\d\d?)/, (_, min: string, max: string) => `0${min}-${max.padStart(2, "0")}`);
}

// RXP reads a five-letter start that loosely fits either faction, plus any
// ASCII letters or digits after it. Only the first such name counts, so a
// near miss like "Allia" hides a later exact name.
const SPEEDRUN_NAME = /RestedXP ([AH][lo][lr][id][ae][A-Za-z0-9]*)/;

export function speedrunFaction(group: string): "Alliance" | "Horde" | undefined {
  const name = SPEEDRUN_NAME.exec(group)?.[1];
  return name === "Alliance" || name === "Horde" ? name : undefined;
}

function speedrunSide(header: Header): "A" | "H" | undefined {
  // RXP tests `not groupId`, and an empty Lua string is true, so a bare
  // `#groupid` still turns off the faction-name check.
  const groupId = header.tags.get("groupid")?.value;
  const faction = groupId !== undefined ? undefined : speedrunFaction(header.tags.get("group")?.value ?? "");
  if (faction === "Alliance" || groupId === "RXP-SRGCE-A1") return "A";
  if (faction === "Horde" || groupId === "RXP-SRGCE-H1") return "H";
  return undefined;
}

function defaultForHolds(header: Header, profile: Profile): boolean | undefined {
  const defaultFor = header.tags.get("defaultfor");
  return defaultFor ? holds(parseCondition(defaultFor.value), profile) : undefined;
}

// The group RXP files the guide under and its display name, when they differ
// (`addon.AddGuide` in GuideLoader.lua). A `#defaultfor` guide that does not
// apply files under `*group`. Speedrun guides share one display name per faction.
function displayGroup(header: Header, profile: Profile): { group: string; name: string } | undefined {
  const star = defaultForHolds(header, profile) === false ? "*" : "";
  const group = star + (header.tags.get("group")?.value ?? "");
  const side = speedrunSide(header);
  const display = side ? `RestedXP Speedrun Guide (${side})` : header.tags.get("groupdisplayname")?.value;
  if (display === undefined || star + display === group) return undefined;
  return { group, name: star + display };
}

// Splits `#next` at semicolons as RXP does. RXP cuts leading whitespace from
// a name, keeps trailing whitespace, and keeps an entry of only whitespace.
// Speedrun guides drop `group\` prefixes.
function nextEntries(header: Header, next: string): string[] {
  if (speedrunSide(header)) next = next.replace(/[^;]*?\\/g, "");
  return next
    .split(";")
    .filter((entry) => entry !== "")
    .map((entry) => entry.trimStart() || entry);
}

/** Why RXP never runs a guide, or leaves it out of its menu; see `GuidePreview`. */
export function guideStatus(header: Header, profile: Profile): Pick<GuidePreview, "hidden" | "inactive"> {
  const internal = header.fields.get("internal");
  const hidden = header.skip ?? (truthy(internal) ? tagReason("internal", internal) : undefined),
    inactive = activeGate(header.fields, profile);
  return { ...(hidden && { hidden }), ...(inactive && { inactive }) };
}

function guideEntry(doc: GuideDocument, source: number, header: Header, profile: Profile): GuideEntry {
  const isDefault = defaultForHolds(header, profile);
  return {
    source,
    doc,
    tags: header.tags,
    headerLines: header.lines,
    ...guideStatus(header, profile),
    ...(isDefault !== undefined && { isDefault }),
  };
}

/**
 * The step each `#label` names, as RXP indexes the guide's loaded steps: the
 * first applying `#label` line of a step, and the last step with a label wins
 * (`addon:LoadGuide` in GuideWindow.lua, `parseLine` in GuideLoader.lua).
 */
export function stepLabels(steps: readonly Step[], profile: Profile): Map<string, number> {
  const labels = new Map<string, number>();
  steps.forEach((step, i) => {
    if (!holds(step.line.condition, profile)) return;
    const label = step.body.find((line) => line.kind === "tag" && line.name === "label" && holds(line.condition, profile));
    if (label?.kind === "tag") labels.set(label.value, i);
  });
  return labels;
}

function previewStep(
  step: Step,
  profile: Profile,
  dungeons: ReadonlySet<string>,
  state?: GateState,
  labels: ReadonlyMap<string, number> = new Map(),
): StepPreview {
  const lines = step.body.map((line) => holds(line.condition, profile));
  const tags = new Map<string, TagValue>();
  const fields = new Map<string, Field>();
  step.body.forEach((line, i) => {
    if (!lines[i]) return;
    if (line.kind === "tag") {
      if (!tags.has(line.name)) tags.set(line.name, { value: line.value, line: i });
      if (!truthy(fields.get(line.name))) fields.set(line.name, { value: line.value, line: i });
    } else if (line.kind === "command") {
      setCommandFields(line, i, fields);
    }
  });

  const reason: HideReason | undefined = !holds(step.line.condition, profile)
    ? { kind: "condition", condition: step.line.condition! }
    : (stepGate(fields, profile, dungeons, (name, field) => fieldReason(name, field, step.body)) ??
      lineGate(step.body, lines, profile.level, state, labels));
  return reason ? { shown: false, reason, lines, tags } : { shown: true, lines, tags };
}

function setCommandFields(line: Extract<BodyLine, { kind: "command" }>, i: number, fields: Map<string, Field>) {
  switch (line.name) {
    case "group":
      fields.set("group", { value: true, line: i });
      fields.set("solo", { value: false, line: i });
      break;
    case "solo":
      fields.set("group", { value: false, line: i });
      fields.set("solo", { value: true, line: i });
      break;
    case "dungeon": {
      const arg = dungeonArg(line.args[0]);
      if (arg) fields.set(arg.negated ? "dungeonskip" : "dungeon", { value: arg.tag, line: i });
      break;
    }
  }
}

function dungeonArg(arg: string | undefined): { tag: string; negated: boolean } | undefined {
  if (arg === undefined) return undefined;
  const negated = arg.startsWith("!");
  const tag = dungeonTag(negated ? arg.slice(1) : arg);
  return tag === undefined ? undefined : { tag, negated };
}

const truthy = (field: Field | undefined): field is Field => field !== undefined && field.value !== false;

type Reason = (name: string, field: Field) => HideReason;

function tagReason(name: string, field: Field): HideReason {
  return { kind: "tag", name, value: String(field.value), line: field.line };
}

function fieldReason(name: string, field: Field, body: readonly BodyLine[]): HideReason {
  const line = body[field.line]!;
  return line.kind === "command" ? { kind: "command", name: line.name, args: line.args, line: field.line } : tagReason(name, field);
}

// `addon.stepLogic.SeasonCheck` in RXPGuides.lua.
function seasonGate(fields: Fields, profile: Profile, reason: Reason = tagReason): HideReason | undefined {
  const som = profile.season === 1;
  const flag = (name: string) => (truthy(fields.get(name)) ? fields.get(name) : undefined);
  const era = flag("era");
  if (som && era) return reason("era", era);
  const somOnly = flag("som");
  if (somOnly && !som) return reason("som", somOnly);
  const eraSom = flag("era/som");
  if (som && profile.phase > 2 && eraSom) return reason("era/som", eraSom);
  const season = flag("season");
  if (season) {
    const seasons = String(season.value)
      .split(/[,;\s]+/)
      .filter(Boolean);
    if (!seasons.some((s) => luaNumber(s) === profile.season)) return reason("season", season);
  }
  return undefined;
}

// The checks RXP applies to both guides and steps: season, phase, XP rate,
// `#maxlevel`, and `#beta`.
function activeGate(fields: Fields, profile: Profile, reason: Reason = tagReason): HideReason | undefined {
  const seasonReason = seasonGate(fields, profile, reason);
  if (seasonReason) return seasonReason;
  // `BetaVersionCheck` in RXPGuides.lua, with RXP's beta features setting at
  // its default, off.
  const beta = fields.get("beta");
  if (truthy(beta)) return reason("beta", beta);
  const phase = fields.get("phase");
  if (truthy(phase) && !phaseHolds(String(phase.value), profile.phase)) return reason("phase", phase);
  const rate = fields.get("xprate");
  if (truthy(rate) && !xpRateHolds(String(rate.value), xpRate(profile))) return reason("xprate", rate);
  // `LevelCheck` with RXP's default "skip steps by level" setting on.
  const maxLevel = fields.get("maxlevel");
  if (truthy(maxLevel) && profile.level > (luaNumber(String(maxLevel.value)) ?? 1000)) return reason("maxlevel", maxLevel);
  return undefined;
}

function stepGate(fields: Fields, profile: Profile, dungeons: ReadonlySet<string>, reason: Reason): HideReason | undefined {
  const active = activeGate(fields, profile, reason);
  if (active) return active;
  const flags: [name: string, hides: boolean][] = [
    // `HardcoreCheck` in RXPGuides.lua, with hardcore mode off.
    ["softcoreserver", profile.hardcoreRealm],
    ["hardcoreserver", !profile.hardcoreRealm],
    ["hardcore", true],
    // `AHCheck` in RXPGuides.lua.
    ["ssf", !profile.soloSelfFound],
    ["ah", profile.soloSelfFound],
    // `GroupCheck` in RXPGuides.lua.
    ["group", !profile.groupQuests],
    ["solo", profile.groupQuests],
  ];
  for (const [name, hides] of flags) {
    const field = fields.get(name);
    if (hides && truthy(field)) return reason(name, field);
  }

  // `DungeonCheck` in RXPGuides.lua.
  const dungeon = fields.get("dungeon");
  const skip = fields.get("dungeonskip");
  const on = (field: Field) => dungeons.has(String(field.value));
  if (truthy(skip) && on(skip)) return reason("dungeonskip", skip);
  if (truthy(dungeon) && (dungeon.value === skip?.value || !on(dungeon))) return reason("dungeon", dungeon);

  // `addon.SetStep` in GuideWindow.lua activates a step only from its
  // `#level`. With no other step active, RXP moves past the step. While a
  // sticky step is active, RXP waits instead, and activates a passed sticky
  // step at a later step once the level is reached. The walk yields each step
  // once, so it skips the step either way.
  const minLevel = fields.get("level");
  if (truthy(minLevel) && profile.level < (luaNumber(String(minLevel.value)) ?? 0)) return reason("level", minLevel);
  return undefined;
}

// RXP checks the text-only commands with a `gate` in commands.ts once when
// the step becomes active, and skips the whole step when one fails.
function lineGate(
  body: readonly BodyLine[],
  lines: boolean[],
  level: number,
  state: GateState | undefined,
  labels: ReadonlyMap<string, number>,
): HideReason | undefined {
  for (const [i, line] of body.entries()) {
    if (!lines[i] || line.kind !== "command") continue;
    const gate = commandRule(line.name)?.gate;
    if (gate && !gate(line.args, { level, state, labels })) return { kind: "command", name: line.name, args: line.args, line: i };
  }
  return undefined;
}

// `PhaseCheck`: `N` means phase N or later; `N-M` an inclusive range.
function phaseHolds(phase: string, current: number): boolean {
  const range = /(\d+)-(\d+)/.exec(phase);
  const min = range ? Number(range[1]) : luaNumber(phase);
  const max = range ? Number(range[2]) : 0xffff;
  return min !== undefined && current >= min && current <= max;
}

// `XpRateCheck`: `<N` and `>N` are strict, `N` means N or more, and `N-M` is
// inclusive. Text that does not match allows rates from 1.
function xpRateHolds(spec: string, rate: number): boolean {
  let min = 1;
  let max = 0xfff;
  const match = /^([<>]?)\s*(\d+\.?\d*)-?(\d*\.?\d*)/.exec(spec);
  if (match) {
    const value = Number(match[2]);
    if (match[1] === "<") [min, max] = [0, value - 1e-4];
    else if (match[1] === ">") [min, max] = [value + 1e-4, 0xfff];
    else [min, max] = [value, luaNumber(match[3]!) ?? 0xfff];
  }
  return rate >= min && rate <= max;
}

const TAG_TEXT: Record<string, (value: string) => string> = {
  era: () => "Not in Season of Mastery",
  som: () => "Season of Mastery only",
  "era/som": () => "Not in Season of Mastery after phase 2",
  season: (v) => `Season ${v} only`,
  phase: (v) => `Phase ${v} only`,
  xprate: (v) => `XP rate ${v} only`,
  maxlevel: (v) => `Above level ${v}`,
  level: (v) => `Below level ${v}`,
  internal: () => "Internal guide",
  beta: () => "Beta features only",
  softcoreserver: () => "Not on hardcore realms",
  hardcoreserver: () => "Hardcore realms only",
  hardcore: () => "Hardcore only",
  ssf: () => "Solo self-found only",
  ah: () => "Not in solo self-found",
  group: () => "Group quests off",
  solo: () => "Solo step; group quests on",
};

/**
 * A short label for a hide reason, such as "Skipped for Mage". A runtime gate
 * reads as its command name, such as ".zoneskip"; `stepSkipText` in `row/`
 * names it in words.
 */
export function describeReason(reason: HideReason, profile: Profile): string {
  switch (reason.kind) {
    case "condition":
      return describeCondition(reason.condition, profile);
    case "tag":
      return TAG_TEXT[reason.name]?.(reason.value) ?? `#${reason.name} ${reason.value}`.trim();
    case "command": {
      const arg = reason.args[0] ?? "";
      if (reason.name !== "dungeon") return TAG_TEXT[reason.name]?.(arg.trim()) ?? `.${reason.name}`;
      return arg.startsWith("!") ? `Skipped with ${arg.slice(1)} on` : `Dungeon ${arg} off`;
    }
    case "jump":
      return `Not reached: .${reason.command} jump in step ${reason.step + 1}`;
    case "expansion":
      return "Not a Classic guide";
    case "incomplete":
      return "Missing #name or #group";
  }
}

/** A guide's status for the character, such as "Never runs: Only for Horde"; undefined when the guide is offered. */
export function describeGuideStatus(guide: Pick<GuidePreview, "hidden" | "inactive">, profile: Profile): string | undefined {
  if (guide.hidden) return `Never runs: ${describeReason(guide.hidden, profile)}`;
  if (guide.inactive) return `Not offered: ${describeReason(guide.inactive, profile)}`;
  return undefined;
}

function describeCondition(condition: Condition, profile: Profile): string {
  const { expr } = condition;
  const items = expr.type === "and" ? expr.items : [expr];
  const failed = items.find((item) => !evaluate(item, profile));
  // A number token means that level or higher.
  const name = (token: string) => (luaNumber(token) === undefined ? token : `level ${token}+`);
  if (failed?.type === "token") return failed.value.toLowerCase() === "skip" ? "Disabled" : `Only for ${name(failed.value)}`;
  if (failed?.type === "not" && failed.item.type === "token") return `Skipped for ${name(failed.item.value)}`;
  return `Only for ${condition.text}`;
}
