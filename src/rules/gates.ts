import type { UiMapId } from "../data/index.ts";
import { luaNumber, type Step } from "../guide/index.ts";

export interface GateState {
  /** XP into the current level, and the XP to leave it; without it, `.xp` gates pass. */
  xp?: { into: number; toNext: number };
  /** Quests in the log; `complete` means every objective is done. */
  log: ReadonlyMap<number, { status: "incomplete" | "partial" | "complete" }>;
  done: ReadonlySet<number>;
  /**
   * The UI map the character stands on, with how RXP zone names and aliases
   * name maps, so `.zoneskip` cannot get one without the other. Without it,
   * `.zoneskip` gates pass.
   */
  zone?: { uiMapId: UiMapId; uiMapNamed: (token: string) => UiMapId | undefined };
  /** Seconds until the Hearthstone is ready; without it, `.cooldown` gates pass. */
  hearth?: number;
}

/** What a runtime gate reads. Without `state`, every gate but `.maxlevel` passes. */
export interface GateContext {
  level: number;
  state: GateState | undefined;
  /** The step index of each `#label`, as `stepLabels` gives it. */
  labels: ReadonlyMap<string, number>;
}

export type Gate = (args: readonly string[], at: GateContext) => boolean;

// Above the level, with RXP's default XP step skipping on, the step
// completes, or with a second-argument label jumps to the label's step,
// which `walkRoute` follows. RXP reads the first digits and ignores the
// `+X`, `.F`, or `-X` after them. It ignores the line when the guide lacks
// the label, and a line without digits fails to parse
// (`addon.functions.maxlevel` in functions.lua).
export const maxLevelHolds: Gate = (args, { level, labels }) => {
  const max = /\d+/.exec((args[0] ?? "").replaceAll(" ", ""));
  const label = args[1];
  return !max || level <= Number(max[0]) || (label !== undefined && !labels.has(label));
};

// RXP ignores text among the IDs, and a line without an ID fails to parse.
const questIds = (args: readonly string[]) => args.flatMap((arg) => luaNumber(arg) ?? []);

// Any listed quest in the log (`addon.functions.isOnQuest` and
// `isNotOnQuest` in functions.lua).
export const inLogHolds =
  (reverse: boolean): Gate =>
  (args, { state }) => {
    if (!state) return true;
    const ids = questIds(args);
    return ids.length === 0 || ids.some((id) => state.log.has(id)) !== reverse;
  };

// The one quest in the log with its objectives done
// (`addon.functions.isQuestComplete` and `addon.IsQuestComplete` in functions.lua).
export const questCompleteHolds =
  (reverse: boolean): Gate =>
  (args, { state }) => {
    if (!state) return true;
    const first = luaNumber(args[0] ?? "");
    return first === undefined || (state.log.get(first)?.status === "complete") !== reverse;
  };

// Any listed quest turned in, or for `.isQuestAvailable` any not turned in
// (`addon.functions.isQuestTurnedIn` in functions.lua).
export const turnedInHolds =
  (reverse: boolean): Gate =>
  (args, { state }) => {
    if (!state) return true;
    const ids = questIds(args);
    return ids.length === 0 || ids.some((id) => state.done.has(id) !== reverse);
  };

// With a third-argument label, the step skips by jumping to the label's
// step, which `walkRoute` follows. RXP ignores the line when the guide
// lacks the label.
export const xpHolds: Gate = (args, { level, state, labels }) => {
  const xp = state?.xp;
  const gate = readXpGate(args);
  if (!gate || gate.kind !== "skip" || xp === undefined || (gate.label !== undefined && !labels.has(gate.label))) return true;
  return xpReached(gate.level, gate.extra, level, xp) === (gate.comparison === "below");
};

// The step completes on any of the `+` or `/` separated maps, by RXP
// name or ID, or with a reversing flag on none of them
// (`addon.functions.zoneskip` in functions.lua).
export const zoneSkipHolds: Gate = (args, { state }) => {
  const zone = state?.zone;
  if (zone === undefined) return true;
  const maps = (args[0] ?? "").split(/[+/]/).map((name) => zone.uiMapNamed(name) ?? luaNumber(name));
  return maps.includes(zone.uiMapId) === zoneSkipReversed(args[1]);
};

export const cooldownHolds: Gate = (args, { state }) => {
  const hearth = state?.hearth;
  return hearth === undefined || (hearthCooldownHolds(args, hearth) ?? true);
};

/**
 * Whether a `.zoneskip` or `.subzoneskip` flag argument makes the step
 * complete outside the listed maps instead of in them. RXP reads bit 0 of
 * the flag as Lua's `tonumber` parses it (`addon.functions.zoneskip` and
 * `addon.functions.subzoneskip` in functions.lua).
 */
export function zoneSkipReversed(flag: string | undefined): boolean {
  return ((luaNumber(flag ?? "") ?? 0) & 1) === 1;
}

const HEARTHSTONE = 6948;

/**
 * Whether the step's `.cooldown item,6948` lines let it run with `remaining`
 * seconds left on the Hearthstone; undefined when no applying line names it.
 */
export function hearthGateHolds(step: Step, lines: readonly boolean[], remaining: number): boolean | undefined {
  let gated: boolean | undefined;
  step.body.forEach((line, i) => {
    if (!lines[i] || line.kind !== "command" || line.name !== "cooldown") return;
    const holds = hearthCooldownHolds(line.args, remaining);
    if (holds !== undefined) gated = (gated ?? true) && holds;
  });
  return gated;
}

// A Hearthstone `.cooldown` completes the step while more than `N` seconds
// remain, or with `<N` fewer, and `Nm` is minutes; `N` under 2 is 2
// (`addon.functions.cooldown` in functions.lua). The walk checks it once,
// when the step starts. Spell and other item cooldowns are not modeled.
function hearthCooldownHolds(args: readonly string[], remaining: number): boolean | undefined {
  if (args[0]?.trim() !== "item" || luaNumber(args[1] ?? "") !== HEARTHSTONE) return undefined;
  const match = /([<>]?)\s*(\d+[^\w\s]?\d*)\s*([ms]?)/.exec(args[2] ?? "");
  const seconds = (Number(match?.[2]) || 0) * (match?.[3] === "m" ? 60 : 1);
  const threshold = Math.max(seconds, 2);
  return match?.[1] === "<" ? remaining >= threshold : remaining <= threshold;
}

export type XpGate = {
  readonly level: number;
  readonly extra: number;
  readonly comparison: "below" | "atOrAbove";
} & ({ readonly kind: "complete" } | { readonly kind: "skip"; readonly label: string | undefined });

// RXP ignores text around the first level and offset, including `>`
// (`addon.functions.xp` in functions.lua).
export function readXpGate(args: readonly string[]): XpGate | undefined {
  const match = /(<?)\s*(\d+)([+.-]?\d*)/.exec((args[0] ?? "").replaceAll(" ", ""));
  if (!match) return undefined;
  const skipStep = luaNumber(args[1] ?? "");
  const target = {
    level: Number(match[2]),
    extra: luaNumber(match[3]!) ?? 0,
    comparison: match[1] === "<" || (skipStep !== undefined && skipStep < 0) ? "below" : "atOrAbove",
  } satisfies Pick<XpGate, "level" | "extra" | "comparison">;
  return skipStep === undefined ? { ...target, kind: "complete" } : { ...target, kind: "skip", label: args[2] };
}

// Whether the character has reached `.xp` level `n` with `extra` XP: `extra`
// XP into it from 1, a fraction of it below 1, or `-extra` short of it
// below 0 (`addon.functions.xp` in functions.lua).
function xpReached(n: number, extra: number, level: number, { into, toNext }: NonNullable<GateState["xp"]>): boolean {
  if (extra < 0) return level >= n || (level === n - 1 && into >= toNext + extra);
  return level > n || (level === n && into >= (extra >= 1 ? extra : toNext * extra));
}
