import { objectiveRef, withStatus } from "./character.ts";
import type { Faction } from "./profile.ts";
import type { ObjectiveProgress, SimData, SimPosition, SimState } from "./simulate.ts";
import { xpToNextLevel } from "./xp.ts";

export interface Arrival {
  state: SimState;
  /** Seconds after arrival when the Hearthstone is ready. */
  hearth?: number;
  /** Where the character stands, with no travel there. */
  position?: SimPosition;
}

export interface Known {
  data: SimData;
  /** The character's faction, whose flight masters `flightPaths` names as `.fp` does. */
  faction: Faction;
}

interface Field<T> {
  parse(value: unknown): T | undefined;
  apply(to: Arrival, value: T, known: Known): string[];
}

const field = <T>(f: Field<T>): Field<T> => f;

const isWhole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (key: string) => /^[1-9]\d*$/.test(key);

function record<T>(v: unknown, parse: (v: unknown) => T | undefined, key: (k: string) => boolean = () => true) {
  if (!isRecord(v)) return undefined;
  const out: Record<string, T> = {};
  for (const [k, value] of Object.entries(v)) {
    const parsed = parse(value);
    if (parsed === undefined || !key(k)) return undefined;
    out[k] = parsed;
  }
  return out;
}

const flag = (v: unknown) => (typeof v === "boolean" ? v : undefined);

const placeText = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function locate(text: string, known: Known): SimPosition | undefined {
  return known.data.locateGoto(text.split(",").map((arg) => arg.trim()));
}

type LogEntry = false | "complete" | Readonly<Record<string, number>>;

const STATE_FIELDS = {
  level: field<number>({
    parse: (v) => (isWhole(v) && v >= 1 && v <= 60 ? v : undefined),
    apply: (to, level, { data }) => {
      to.state = { ...to.state, level, xp: to.state.xp < xpToNextLevel(data.rules, level) ? to.state.xp : 0 };
      return [];
    },
  }),
  xp: field<number>({
    parse: (v) => (isWhole(v) ? v : undefined),
    apply: (to, xp, { data }) => {
      if (xp > 0 && xp >= xpToNextLevel(data.rules, to.state.level)) return [String(xp)];
      to.state = { ...to.state, xp };
      return [];
    },
  }),
  hearth: field<number>({
    parse: (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined),
    apply: (to, seconds) => {
      to.hearth = seconds;
      return [];
    },
  }),
  bind: field<string>({
    parse: placeText,
    apply: (to, text, known) => {
      const at = locate(text, known);
      if (!at) return [text];
      to.state = { ...to.state, bind: at };
      return [];
    },
  }),
  position: field<string>({
    parse: placeText,
    apply: (to, text, known) => {
      const at = locate(text, known);
      if (!at) return [text];
      to.state = { ...to.state, position: at };
      to.position = at;
      return [];
    },
  }),
  flightPaths: field<Record<string, boolean>>({
    parse: (v) => record(v, flag),
    apply: (to, names, known) => {
      const flightPaths = new Set(to.state.flightPaths);
      const unknown: string[] = [];
      for (const [name, learned] of Object.entries(names)) {
        const node = known.data.flights.named(name, known.faction).node;
        if (!node) unknown.push(name);
        else if (learned) flightPaths.add(node.id);
        else flightPaths.delete(node.id);
      }
      to.state = { ...to.state, flightPaths };
      return unknown;
    },
  }),
  done: field<Record<string, boolean>>({
    parse: (v) => record(v, flag, isId),
    apply: (to, quests, known) => {
      const done = new Set(to.state.done);
      const unknown: string[] = [];
      for (const [key, turnedIn] of Object.entries(quests)) {
        if (!known.data.quest(Number(key))) unknown.push(key);
        else if (turnedIn) done.add(Number(key));
        else done.delete(Number(key));
      }
      to.state = { ...to.state, done };
      return unknown;
    },
  }),
  log: field<Record<string, LogEntry>>({
    parse: (v) =>
      record<LogEntry>(
        v,
        (entry) => (entry === false || entry === "complete" ? entry : record(entry, (n) => (isWhole(n) ? n : undefined), isId)),
        isId,
      ),
    apply: (to, entries, known) => {
      const log = new Map(to.state.log);
      const unknown: string[] = [];
      for (const [key, entry] of Object.entries(entries)) {
        const questId = Number(key);
        const quest = known.data.quest(questId);
        if (!quest) {
          unknown.push(key);
          continue;
        }
        if (entry === false) {
          log.delete(questId);
          continue;
        }
        const current = log.get(questId);
        const objectives = quest.objectives.map((o, row): ObjectiveProgress =>
          entry === "complete" ? { count: o.count ?? 0, complete: true } : (current?.objectives[row] ?? { count: 0, complete: false }),
        );
        if (entry !== "complete")
          for (const [index, count] of Object.entries(entry)) {
            const ref = objectiveRef(quest, questId, Number(index));
            if (!ref) {
              unknown.push(`${key}.${index}`);
              continue;
            }
            const need = quest.objectives[ref.row]!.count;
            objectives[ref.row] = { count, complete: need !== null && count >= need };
          }
        log.set(questId, withStatus(objectives));
      }
      to.state = { ...to.state, log };
      return unknown;
    },
  }),
};

type StateKey = keyof typeof STATE_FIELDS;

export type StatePatch = { [K in StateKey]?: (typeof STATE_FIELDS)[K] extends Field<infer T> ? T : never };

/** A field that `state=` names wrongly, as a `@sim` warning names it: `state.<field>`. */
export interface StateProblem {
  key: string;
  value: string;
  problem: "unknown" | "badValue";
}

/** Reads a `state=` value. Bad fields give a problem each and are left out; bad JSON gives no patch. */
export function parseStatePatch(text: string): { patch?: StatePatch; problems: StateProblem[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problems: [{ key: "state", value: text, problem: "badValue" }] };
  }
  if (!isRecord(json)) return { problems: [{ key: "state", value: text, problem: "badValue" }] };
  const patch: Record<string, unknown> = {};
  const problems: StateProblem[] = [];
  for (const [key, value] of Object.entries(json)) {
    const f = Object.hasOwn(STATE_FIELDS, key) ? (STATE_FIELDS[key as StateKey] as Field<unknown>) : undefined;
    const parsed = f?.parse(value);
    if (parsed === undefined) problems.push({ key: `state.${key}`, value: JSON.stringify(value), problem: f ? "badValue" : "unknown" });
    else patch[key] = parsed;
  }
  return { patch, problems };
}

/** Applies a patch to the arriving character, field by field in `STATE_FIELDS` order. */
export function applyStatePatch(to: Arrival, patch: StatePatch, known: Known): StateProblem[] {
  const problems: StateProblem[] = [];
  for (const key of Object.keys(STATE_FIELDS) as StateKey[]) {
    if (patch[key] === undefined) continue;
    const unknown = (STATE_FIELDS[key] as Field<unknown>).apply(to, patch[key], known);
    problems.push(...unknown.map((value) => ({ key: `state.${key}`, value, problem: "badValue" as const })));
  }
  return problems;
}
