import { MAX_LEVEL } from "../data/gameRules.ts";
import { parseGuide, type BodyLine, type GuideDocument, type GuideRecord } from "../guide/index.ts";
import { PLAYBACK_SETTING_ENTRIES, resolvePlaybackSettings, type PlaybackChoices } from "./playbackSettings.ts";
import { previewRoute, routeGraph, type EarlierGuide, type GuidePreview, type RouteGraph, type RoutePreview } from "./preview.ts";
import type { Profile } from "./profile.ts";
import { guideMeta, resolvedGroup, type LevelRange } from "./registration.ts";
import { simulateRoute, type RouteSimulation, type SimData } from "./simulate.ts";

const docs = new WeakMap<GuideRecord, GuideDocument>();

/**
 * The document RXP reads for a guide. A `RegisterGuide` group argument wins
 * over `#group`, so it replaces every `#group` value, or is added at the end
 * of the header; header line indexes stay the same.
 */
export function previewDoc(record: GuideRecord, parsed?: GuideDocument): GuideDocument {
  let doc = docs.get(record);
  if (doc) return doc;
  doc = parsed ?? parseGuide(record.text);
  const group = record.registerArgs?.group;
  if (group !== undefined) {
    let found = false;
    const tag: BodyLine = { kind: "tag", indent: "", name: "group", value: group, assign: false };
    const header = doc.header.map((line) => {
      if (line.kind !== "tag" || line.name !== "group") return line;
      found = true;
      return tag;
    });
    if (!found) header.push(tag);
    doc = { ...doc, header };
  }
  docs.set(record, doc);
  return doc;
}

/**
 * Stored guides in the order RXP registers them, with the documents it reads
 * and their names. A route's guide positions are indexes in these lists, and
 * refer to these versions of the guides.
 */
export interface GuideChain {
  records: GuideRecord[];
  /** The documents RXP reads; see `previewDoc`. */
  docs: GuideDocument[];
  /** Each guide's first `#name`, or `(no #name)`. */
  names: string[];
}

export function guideChain(records: GuideRecord[]): GuideChain {
  return { records, docs: records.map((r) => previewDoc(r)), names: records.map(guideName) };
}

const guideName = (record: GuideRecord) => guideMeta(record).name || "(no #name)";

/**
 * "auto" starts at the low end of the start guide's `#name` range, capped at
 * `MAX_LEVEL`, with 0 XP, or at level 1 without a range. A fixed level has
 * its own XP, below `xpToNextLevel(level)`.
 */
export type StartLevel = "auto" | { level: number; xp: number };

/** The level and XP a route starts at; `auto` when Auto gave them. */
export interface ResolvedStart {
  level: number;
  xp: number;
  auto: boolean;
}

export function resolveStartLevel(startLevel: StartLevel, range: LevelRange | undefined): ResolvedStart {
  return startLevel === "auto" ? { level: Math.min(range?.min ?? 1, MAX_LEVEL), xp: 0, auto: true } : { ...startLevel, auto: false };
}

export interface RouteView extends GuideChain {
  /** The guides as the simulation reads them and its step previews. */
  preview: RoutePreview;
  /** The character at the route's start, at `startLevel.level`. */
  profile: Profile;
  /** The level and XP the route starts at, with Auto read from the start guide's range. */
  startLevel: ResolvedStart;
  /** Index in `records` of the open guide, which the route always holds. */
  open: number;
  /** The guides that lead to the open guide, nearest first; the route can start at one of them. */
  earlier: readonly EarlierGuide[];
  /** The `#next` graph over `records`, read at the open guide's start level. */
  graph: RouteGraph;
  /** The simulated route, from `startLevel`. Undefined when the route was only previewed. */
  simulation?: RouteSimulation;
  /**
   * Index in `records` of the start that was asked for, when the route from
   * it does not reach the open guide. The route then starts at the open guide.
   */
  unreached?: number;
}

type RouteBase = Pick<RouteView, "records" | "names" | "docs" | "open" | "earlier" | "graph">;

/**
 * How many of a guide's steps the character sees: none when RXP never runs
 * the guide. The route and the step list both count with this.
 */
export function shownSteps(guide: GuidePreview): number {
  return guide.hidden ? 0 : guide.shown;
}

function startAt(character: Profile, startLevel: StartLevel, record: GuideRecord): { profile: Profile; startLevel: ResolvedStart } {
  const resolved = resolveStartLevel(startLevel, guideMeta(record).range);
  return { profile: { ...character, level: resolved.level }, startLevel: resolved };
}

function routeThrough(
  base: RouteBase,
  chosen: number,
  character: Profile,
  startLevel: StartLevel,
  data: SimData | undefined,
  choices?: PlaybackChoices,
): RouteView {
  const from = (start: number) => {
    const at = startAt(character, startLevel, base.records[start]!);
    const built = data
      ? simulateRoute(base.docs, start, at.profile, data, at.startLevel.xp, { log: new Map(), done: new Set() }, choices)
      : previewRoute(base.docs, start, at.profile);
    return { ...at, built };
  };
  let route = from(chosen);
  const reached = chosen === base.open || route.built.guides.some((g) => g.source === base.open);
  if (!reached) route = from(base.open);
  const { profile, built } = route;
  const view = { ...base, profile, startLevel: route.startLevel, ...(!reached && { unreached: chosen }) };
  if (!("warnings" in built)) return { ...view, preview: built };
  const preview = { guides: built.guides.map((g) => g.preview), ...(built.end && { end: built.end }) };
  return { ...view, preview, simulation: built };
}

interface GuideLibrary {
  guides: ReadonlyMap<string, GuideRecord>;
  builtins: ReadonlyMap<string, GuideRecord>;
}

/**
 * The route through guide `open.id` of the library, in registration order,
 * with built-ins first so user guides override them, as an addon's guides do
 * in RXP. It starts at the guide with ID `settings.start` when that guide
 * leads to the open guide, and at the open guide otherwise. With `data`, it
 * is simulated, else previewed. Null when the library does not hold the open
 * guide.
 *
 * An open copy of built-in `open.copyOf` registers under the built-in's
 * group, so it takes the built-in's place: `#next` items that name the
 * built-in lead to the copy.
 */
export function openRoute(
  library: GuideLibrary,
  open: { id: string; copyOf?: string },
  character: Profile,
  settings: { start: string | null; startLevel: StartLevel },
  data: SimData | undefined,
): RouteView | null {
  const records = registrationOrder(library);
  const at = records.findIndex((g) => g.id === open.id);
  if (at < 0) return null;
  const chain = guideChain(records);
  const builtin = open.copyOf === undefined ? undefined : library.builtins.get(open.copyOf);
  if (builtin) {
    const copy = records[at]!;
    chain.docs[at] = previewDoc({ ...copy, registerArgs: { ...copy.registerArgs, group: resolvedGroup(builtin, character) } });
  }
  const { startLevel } = settings;
  const graph = routeGraph(chain.docs, startAt(character, startLevel, records[at]!).profile);
  const earlier = graph.leadingTo(at);
  const chosen = earlier.find((e) => records[e.source]!.id === settings.start)?.source ?? at;
  return routeThrough({ ...chain, open: at, earlier, graph }, chosen, character, startLevel, data);
}

function registrationOrder(library: GuideLibrary): GuideRecord[] {
  const byOrder = (records: ReadonlyMap<string, GuideRecord>) => [...records.values()].sort((a, b) => a.order - b.order);
  return [...byOrder(library.builtins), ...byOrder(library.guides)];
}

/**
 * The route that Playback plays: simulated route `route` again solo
 * self-found, because Forever has no auction house, with the Playback
 * `choices`. It starts where `route` was asked to start, by the same rule.
 */
export function playbackRoute(route: RouteView, data: SimData, choices: PlaybackChoices, startLevel: StartLevel): RouteView {
  if (simulatedAsPlayback(route, choices)) return route;
  const { records, names, docs, open, earlier, graph } = route;
  const character = { ...route.profile, soloSelfFound: true };
  return routeThrough(
    { records, names, docs, open, earlier, graph },
    route.unreached ?? startOf(route),
    character,
    startLevel,
    data,
    choices,
  );
}

function simulatedAsPlayback(route: RouteView, choices: PlaybackChoices): boolean {
  const ran = route.simulation?.settings;
  const wanted = resolvePlaybackSettings(choices);
  return ran !== undefined && route.profile.soloSelfFound && PLAYBACK_SETTING_ENTRIES.every(([key]) => ran[key] === wanted[key]);
}

/** Index in `route.records` of the route's start guide. */
export function startOf(route: RouteView): number {
  return route.preview.guides[0]!.source;
}

export interface StartLevelWarning {
  level: number;
  /** Index in `RouteView.records` of the start guide. */
  start: number;
  range: LevelRange;
  /** Index in `RouteView.records` of a guide that leads to the start guide, to start from instead. */
  earlier?: number;
}

export function startLevelWarning(route: RouteView): StartLevelWarning | null {
  const start = startOf(route);
  const range = guideMeta(route.records[start]!).range;
  const { level } = route.startLevel;
  if (!range || level >= range.min) return null;
  const leading = route.graph.leadingTo(start);
  const before = [...leading.filter((e) => e.isDefault), ...leading.filter((e) => !e.isDefault)];
  const fits = before.find(({ source }) => {
    const min = guideMeta(route.records[source]!).range?.min;
    return min !== undefined && min <= level;
  });
  const earlier = (fits ?? before[0])?.source;
  return { level, start, range, ...(earlier !== undefined && { earlier }) };
}
