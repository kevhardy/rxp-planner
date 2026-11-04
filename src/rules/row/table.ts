import type { TagName, TextPart } from "../../guide/index.ts";
import type { MarkKind } from "./marks.ts";
import type { RowNames } from "./index.ts";

/** The arguments of one command line, with readers that never throw. */
export interface Args {
  readonly raw: readonly string[];
  /** The i-th argument as a positive integer ID, without a leading `+` or `-`. */
  id(i: number): number | undefined;
  str(i: number): string | undefined;
  ids(from?: number): number[];
}

export function readArgs(raw: readonly string[]): Args {
  const str = (i: number) => raw[i]?.trim() || undefined;
  const id = (i: number) => {
    const n = Number(str(i)?.replace(/^[+-]/, ""));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return { raw, id, str, ids: (from = 0) => raw.slice(from).flatMap((_, i) => id(from + i) ?? []) };
}

/** Names with the row's fallbacks, such as "Item #6948", the form the simulation notes use. */
export interface Say {
  quest(id: number | undefined): string;
  /** With `fallback`, the fallback names an item that the data does not name. */
  item(id: number | undefined, fallback?: string): string;
  npc(id: number | undefined): string;
  spell(id: number | undefined): string;
  /** An AreaTable ID. The dataset has no area names. */
  area(id: string | undefined): string;
  map(token: string | undefined): string;
  items(ids: readonly number[]): string;
  objective(questId: number | undefined, index: number | undefined): { label: string; type?: string };
  faction(id: number | undefined): string;
  /** "the next step" or "step N", with N as the planner numbers its steps. */
  step(label: string): string;
}

export function say(names: RowNames, labels: ReadonlyMap<string, number>): Say {
  const named = (type: "quest" | "item" | "npc" | "spell", word: string) => (id: number | undefined, fallback?: string) =>
    (id !== undefined && names.name(type, id)) || fallback || `${word} #${id ?? "?"}`;
  const item = named("item", "Item");
  return {
    quest: named("quest", "Quest"),
    item,
    npc: named("npc", "NPC"),
    spell: named("spell", "Spell"),
    area: (id) => `Area #${id ?? "?"}`,
    map: (token) => (token === undefined ? "?" : (names.map(token) ?? token)),
    items: (ids) => (ids.length === 0 ? item(undefined) : ids.map((id) => item(id)).join(", ")),
    objective(questId, index) {
      const found = questId !== undefined && index !== undefined ? names.objective(questId, index) : undefined;
      if (!found) return { label: `Objective ${index ?? "?"}` };
      return {
        label: found.count === undefined ? found.name : `${found.name} ×${found.count}`,
        ...(found.type !== undefined && { type: found.type }),
      };
    },
    faction: (id) => (id !== undefined && names.faction(id)) || `Faction #${id ?? "?"}`,
    step: (label) => (label === "next" ? "the next step" : `step ${labels.has(label) ? labels.get(label)! + 1 : label}`),
  };
}

type Phrase = (a: Args, say: Say) => string;

interface DoRow {
  role: "do";
  mark: MarkKind | ((a: Args, say: Say) => MarkKind);
  /** Shown when the line has no `>>` text. */
  label: Phrase;
  /** Without `>>` text, RXP reads the line as a step check with this meaning. */
  bare?: Phrase;
}

/** A step check, as a plain phrase. The row does not evaluate it. */
interface CheckRow {
  role: "check";
  phrase: Phrase;
}

interface SettingRow {
  role: "setting";
  phrase: Phrase;
  /** RXP's meaning, for the tooltip. */
  hint?: string;
}

export interface WhereRow {
  role: "where";
  where: "goto" | "waypoint" | "target" | "mob" | "map";
  /**
   * How RXP shows the line's text: with the goto icon, as a line the player acts on (`do`); with no icon, as a note
   * (`note`), both in `CurrentStepFrame.UpdateText` in GuideWindow.lua; or as the arrow's title, outside the guide
   * window (`arrow`), in `addon.DrawArrow` in map.lua.
   */
  textAs: "do" | "note" | "arrow";
}

/** A command whose arguments, or whether it has `>>` text, decide its role. */
interface EitherRow {
  role: "either";
  pick: (a: Args, hasText: boolean) => "do" | "check";
  do: DoRow;
  check: CheckRow;
}

export type CommandRow = DoRow | CheckRow | SettingRow | WhereRow | EitherRow;

/** How a step tag shows in the footer; `null` for tags that never show in a row. */
export type TagRow = { kind: "tag" | "setting"; phrase: (value: string, s: Say) => string | TextPart[]; hint?: string } | null;

export const TAG_ROWS: { readonly [T in TagName]: TagRow } = {
  name: null,
  group: null,
  subgroup: null,
  displayname: null,
  next: null,
  defaultfor: null,
  version: null,
  forever: null,
  classic: null,
  tbc: null,
  internal: null,
  somname: null,
  disabledungeons: null,
  season: { kind: "tag", phrase: (v) => `Season ${v} only` },
  xprate: { kind: "tag", phrase: (v) => `XP rate ${v} only` },
  "era/som": { kind: "tag", phrase: () => "Not in Season of Mastery after phase 2" },
  maxlevel: { kind: "tag", phrase: (v) => `Up to level ${v}` },
  beta: { kind: "tag", phrase: () => "Beta features only" },
  label: { kind: "setting", phrase: (v) => ["Label ", { mono: v }] },
  completewith: {
    kind: "tag",
    phrase: (v, s) => `Until ${s.step(v)} is done`,
    hint: "Stays on screen until its lines or that step are done",
  },
  requires: { kind: "tag", phrase: (v, s) => `After ${s.step(v)}`, hint: "Waits until that step is done" },
  optional: { kind: "tag", phrase: () => "Optional", hint: "Hidden in the step list" },
  sticky: { kind: "tag", phrase: () => "Sticky", hint: "Stays on screen until done" },
  loop: { kind: "tag", phrase: () => "Loop waypoints" },
  hidewindow: { kind: "tag", phrase: () => "Hidden in the guide window" },
  ignorecorpse: { kind: "setting", phrase: () => "Ignore corpse", hint: "The arrow ignores the corpse" },
  level: { kind: "tag", phrase: (v) => `From level ${v}` },
  phase: { kind: "tag", phrase: (v) => `Phase ${v} only` },
  era: { kind: "tag", phrase: () => "Not in Season of Mastery" },
  som: { kind: "tag", phrase: () => "Season of Mastery only" },
  hardcore: { kind: "tag", phrase: () => "Hardcore only" },
  softcore: { kind: "tag", phrase: () => "Softcore only" },
  hardcoreserver: { kind: "tag", phrase: () => "Hardcore realms only" },
  softcoreserver: { kind: "tag", phrase: () => "Not on hardcore realms" },
  ssf: { kind: "tag", phrase: () => "Solo self-found only" },
  ah: { kind: "tag", phrase: () => "Not in solo self-found" },
  map: null,
  icon: null,
  title: null,
  arrowtext: null,
  stop: null,
  qremove: null,
  completwith: { kind: "setting", phrase: () => "Misspelled #completewith", hint: "RXP ignores it" },
  sofcore: { kind: "setting", phrase: () => "Misspelled #softcore", hint: "RXP ignores it" },
};
