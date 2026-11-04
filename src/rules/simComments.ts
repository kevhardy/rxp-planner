import {
  bodyIndent,
  deleteLine,
  getLines,
  insertLine,
  luaNumber,
  readAsTerminated,
  replaceLine,
  setComment,
  simStart,
  updateLine,
  updateStepLine,
  type CommentLine,
  type GuideDocument,
  type Line,
  type LinePos,
} from "../guide/index.ts";
import { MAX_LEVEL } from "../data/gameRules.ts";
import { MIN_DROP_CHANCE } from "./drops.ts";
import type { SimDirective, SimWarning } from "./simulate.ts";
import { parseStatePatch } from "./stateOverride.ts";
import type { Location } from "./validate.ts";
import type { KillXpSettings, LevelTarget } from "./xp.ts";

export type SimKeyWarning = Extract<SimWarning, { kind: "unknownSimKey" }>;

type Scope = SimDirective["scope"];

export type SimKey = SimDirective["key"];

export type KillXpKey = "killmult" | "killxp";

/** Zero is an explicit override. */
export function parseKillXpValue(key: KillXpKey, text: string): number | undefined {
  const n = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER && (key === "killmult" || Number.isSafeInteger(n)) ? n : undefined;
}

/** Last setting in each scope wins; a step multiplier replaces the guide default. */
export function killXpSettings(directives: readonly SimDirective[], step?: number): KillXpSettings {
  const settings: KillXpSettings = {};
  for (const scope of step === undefined ? [undefined] : [undefined, step]) {
    for (const d of directives) {
      if (d.at.step !== scope) continue;
      if (d.key === "killmult") settings.multiplier = d.value;
      if (d.key === "killxp") settings.exact = d.value;
    }
  }
  return settings;
}

type KillAreaKey = "respawn" | "area" | "near" | "pass";

/** The kill-area and `pass=` directives that win for a step: the last in each scope, and a step one over the guide's. */
export function killAreaSettings(
  directives: readonly SimDirective[],
  step: number,
): Partial<{ [K in KillAreaKey]: Extract<SimDirective, { key: K }> }> {
  const settings: ReturnType<typeof killAreaSettings> = {};
  for (const scope of [undefined, step])
    for (const d of directives) {
      if (d.at.step !== scope) continue;
      if (d.key === "respawn") settings.respawn = d;
      else if (d.key === "area") settings.area = d;
      else if (d.key === "near") settings.near = d;
      else if (d.key === "pass") settings.pass = d;
    }
  return settings;
}

/** A kill-area directive's value as a guide writes it, such as `47.3,48.7`. */
export function killAreaValue(d: Extract<SimDirective, { key: KillAreaKey }>): string {
  return d.key === "respawn" ? String(d.seconds) : d.key === "near" ? `${d.x},${d.y}` : String(d.yards);
}

/** Edits only this setting's tokens, leaving other directives and ordinary comments intact. */
export function setKillXpSetting(doc: GuideDocument, step: number | null, key: KillXpKey, value: number | undefined): GuideDocument {
  if (step === null && key === "killxp") throw new Error("Exact kill XP belongs in a step");
  if (value !== undefined && parseKillXpValue(key, String(value)) === undefined) throw new Error("Invalid kill XP value");
  const positions: SimLinePos[] = getLines(doc, step).map((_, index) => ({ step, index }));
  if (step !== null) positions.unshift({ step });
  const holders = positions.filter((at) => {
    const line = lineAt(doc, at);
    return (line.kind === "comment" || line.kind === "step") && simPairs(line.comment)?.some(([k]) => k === key);
  });
  holders.reverse().forEach((at, i) => (doc = setSimValue(doc, at, key, i === 0 ? value : undefined)));
  if (value !== undefined && holders.length === 0) {
    doc = insertLine(
      doc,
      { step, index: getLines(doc, step).length },
      {
        kind: "comment",
        indent: step === null ? "" : bodyIndent(doc),
        comment: ` @sim ${key}=${value}`,
      },
    );
  }
  return doc;
}

/** A body line, or with no `index`, a step's `step` line. */
export type SimLinePos = LinePos | { step: number; index?: undefined };

/**
 * Sets one `@sim` key in a line's comment, or clears it when `value` is
 * undefined, leaving the rest of the comment as it is. A comment without
 * `@sim` gains ` @sim key=value` at its end. Clearing the last key removes
 * `@sim`, then the comment if nothing is left, and a comment line with it.
 * A blank line becomes a comment line.
 */
export function setSimValue(doc: GuideDocument, at: SimLinePos, key: SimKey, value: number | undefined): GuideDocument {
  const line = lineAt(doc, at);
  const comment = withSimValue(line.comment, key, value);
  if (comment === line.comment) return doc;
  if (at.index === undefined) return updateStepLine(doc, at.step, (step) => setComment(readAsTerminated(step), comment));
  if (line.kind === "comment" && comment === undefined) return deleteLine(doc, at);
  return updateLine(doc, at, (body) => setComment(readAsTerminated(body), comment));
}

/** A `-- @sim extra=` comment line that adds `kills` kills of NPC `mob` to its step. */
export function extraKillsLine(kills: number, mob: number, indent: string): CommentLine {
  return { kind: "comment", indent, comment: ` @sim extra=${kills} mob=${mob}` };
}

function withSimValue(comment: string | undefined, key: SimKey, value: number | undefined): string | undefined {
  const start = simStart(comment);
  if (start === undefined) return value === undefined ? comment : `${(comment ?? "").trimEnd()} @sim ${key}=${value}`;
  let written = false;
  const sim = comment!.slice(start).replace(new RegExp(`(\\s)${key}(?:=\\S*)?(?=\\s|$)`, "g"), (_token, space: string) => {
    if (value === undefined || written) return "";
    written = true;
    return `${space}${key}=${value}`;
  });
  const head = comment!.slice(0, start);
  if (value !== undefined && !written) return head + sim.replace(/\s*$/, (end) => ` ${key}=${value}${end}`);
  if (/^@sim\s*$/.test(sim)) return head.trim() === "" ? undefined : head.trimEnd();
  return head + sim;
}

function lineAt(doc: GuideDocument, at: SimLinePos): Line {
  const line = at.index === undefined ? doc.steps[at.step]?.line : getLines(doc, at.step)[at.index];
  if (!line) throw new RangeError(`No line at ${JSON.stringify(at)}`);
  return readAsTerminated(line);
}

/** The `@sim` directives in a guide, in text order, and warnings for keys it cannot use. */
export function simDirectives(doc: GuideDocument, guide: number): { directives: SimDirective[]; warnings: SimKeyWarning[] } {
  const directives: SimDirective[] = [];
  const warnings: SimKeyWarning[] = [];
  const read = (line: Line, at: Location, inStep: boolean, grind = false) => {
    const view = readAsTerminated(line);
    const pairs = simPairs(view.comment, grind && !(view.kind === "command" && view.name === "complete"));
    if (!pairs) return;
    const scope: Scope = view.kind === "step" ? "step" : view.kind !== "comment" ? "line" : inStep ? "step" : "guide";
    const onComplete = view.kind === "command" && view.name === "complete";
    const onGrind = grind && (scope === "step" || isGrindTarget(view) || pairs.some(([key]) => key === "level"));
    readPairs(pairs, at, scope, !inStep, onComplete, onGrind, directives, warnings);
  };
  doc.header.forEach((line, i) => read(line, { guide, line: i }, false));
  doc.steps.forEach((step, s) => {
    const grind = [step.line, ...step.body].some((line) => {
      const view = readAsTerminated(line);
      return isGrindTarget(view) || simPairs(view.comment)?.some(([key, value]) => key === "level" && parseLevelTarget(value));
    });
    read(step.line, { guide, step: s }, true, grind);
    step.body.forEach((line, i) => read(line, { guide, step: s, line: i }, true, grind));
  });
  return { directives, warnings };
}

function isGrindTarget(line: Line): boolean {
  return (
    line.kind === "command" &&
    line.name === "xp" &&
    luaNumber(line.args[1] ?? "") === undefined &&
    parseLevelTarget(line.args[0] ?? "") !== undefined
  );
}

/**
 * Marks quests turned in for the simulation with `-- @sim done=` in the
 * header. Adds the IDs to the first header `done=` list that `simDirectives`
 * reads for the whole guide with no warning, else adds a `-- @sim done=` line
 * after the last non-blank header line and leaves other lists as they are.
 * IDs already in such a list are skipped; when none are left, returns `doc`.
 */
export function addSimDone(doc: GuideDocument, questIds: readonly number[]): GuideDocument {
  const { directives, warnings } = simDirectives(doc, 0);
  const header = (at: Location) => at.step === undefined;
  const rejected = new Set(warnings.filter((w) => header(w.at) && w.key === "done").map((w) => w.at.line));
  const lists = directives.filter(
    (d): d is Extract<SimDirective, { key: "done" }> => d.key === "done" && d.scope === "guide" && !rejected.has(d.at.line),
  );
  const listed = new Set(lists.flatMap((d) => d.questIds));
  const added = [...new Set(questIds)].filter((id) => !listed.has(id));
  if (added.length === 0) return doc;

  const first = lists[0];
  if (!first) {
    const at = doc.header.findLastIndex((l) => l.kind !== "blank") + 1;
    const line: CommentLine = { kind: "comment", indent: "", comment: ` @sim done=${added.join(",")}` };
    return insertLine(doc, { step: null, index: at }, line);
  }
  const index = first.at.line!;
  const line = doc.header[index]!;
  const view = readAsTerminated(line);
  const start = simStart(view.comment)!;
  const sim = view.comment!.slice(start);
  const [match, key = "", value = ""] = sim.match(/^(@sim(?:\s+\S+)*?\s+done=)(\S*)/)!;
  const comment = `${view.comment!.slice(0, start)}${key}${[value, ...added].join(",")}${sim.slice(match.length)}`;
  return replaceLine(doc, { step: null, index }, setComment(view, comment));
}

function simPairs(comment: string | undefined, mobNames = false): [key: string, value: string][] | undefined {
  const start = simStart(comment);
  if (start === undefined) return undefined;
  const text = comment!.slice(start + "@sim".length);
  const tokens =
    text.match(
      mobNames && !/\bextra=/.test(text)
        ? /\S+=\{(?:[\s\S]*\}|[\s\S]*$)|mob=[\s\S]*?(?=\s+\S+=|$)|\S+/g
        : /\S+=\{(?:[\s\S]*\}|[\s\S]*$)|\S+/g,
    ) ?? [];
  return tokens.map((token) => {
    const eq = token.indexOf("=");
    return eq < 0 ? [token, ""] : [token.slice(0, eq), token.slice(eq + 1).trim()];
  });
}

/** The keys that a line's `@sim` directive sets, such as `kills` and `mob`. */
export function simKeys(line: Line): string[] {
  return simPairs(readAsTerminated(line).comment)?.map(([key]) => key) ?? [];
}

function readPairs(
  pairs: [string, string][],
  at: Location,
  scope: Scope,
  header: boolean,
  onComplete: boolean,
  onGrind: boolean,
  directives: SimDirective[],
  warnings: SimKeyWarning[],
) {
  const warn = (key: string, value: string, problem: SimKeyWarning["problem"]) =>
    warnings.push({ kind: "unknownSimKey", at, key, value, problem });
  const kill: Partial<Record<"kills" | "mob" | "extra", { n: number; value: string }>> = {};
  const seen = new Set<string>();
  for (const [key, value] of pairs) {
    if (
      key !== "kills" &&
      key !== "mob" &&
      key !== "extra" &&
      key !== "drop" &&
      key !== "level" &&
      key !== "done" &&
      key !== "party" &&
      key !== "killmult" &&
      key !== "killxp" &&
      key !== "respawn" &&
      key !== "area" &&
      key !== "near" &&
      key !== "pass" &&
      key !== "state"
    ) {
      warn(key, value, "unknown");
      continue;
    }
    if (seen.has(key)) {
      warn(key, value, "badValue");
      continue;
    }
    seen.add(key);
    if (key === "mob" && onGrind && !onComplete && !pairs.some(([k]) => k === "extra")) {
      const mobs = value.split(",").map((name) => name.trim());
      if (!mobs.every(Boolean)) warn(key, value, "badValue");
      else directives.push({ at, scope, key: "grind", mobs });
    } else if (key === "killmult" || key === "killxp") {
      const n = parseKillXpValue(key, value);
      if (n === undefined) warn(key, value, "badValue");
      else if ((key === "killxp" && header) || scope === "line") warn(key, value, "misplaced");
      else directives.push({ at, scope, key, value: n });
    } else if (key === "level") {
      const target = parseLevelTarget(value);
      if (!target) warn(key, value, "badValue");
      else directives.push({ at, scope, key, target });
    } else if (key === "drop") {
      const chance = parseChance(value);
      if (chance === undefined) warn(key, value, "badValue");
      else if (!onComplete) warn(key, value, "misplaced");
      else directives.push({ at, scope, key, chance });
    } else if (key === "done") {
      const questIds = value.split(",").map(parseId);
      if (!questIds.every((id) => id !== undefined)) warn(key, value, "badValue");
      else if (!header) warn(key, value, "misplaced");
      else directives.push({ at, scope, key, questIds });
    } else if (key === "respawn" || key === "area") {
      const n = parsePositive(value);
      if (n === undefined) warn(key, value, "badValue");
      else if (scope === "line") warn(key, value, "misplaced");
      else directives.push(key === "respawn" ? { at, scope, key, seconds: n } : { at, scope, key, yards: n });
    } else if (key === "pass") {
      const n = parsePositive(value, true);
      if (n === undefined) warn(key, value, "badValue");
      else if (scope === "line") warn(key, value, "misplaced");
      else directives.push({ at, scope, key, yards: n });
    } else if (key === "near") {
      const point = parseMapPoint(value);
      if (!point) warn(key, value, "badValue");
      else if (scope !== "step") warn(key, value, "misplaced");
      else directives.push({ at, scope, key, ...point });
    } else if (key === "state") {
      if (scope !== "step") warn(key, value, "misplaced");
      else {
        const { patch, problems } = parseStatePatch(value);
        for (const p of problems) warn(p.key, p.value, p.problem);
        if (patch) directives.push({ at, scope, key, patch });
      }
    } else if (key === "party") {
      if (value !== "1" && value !== "2") warn(key, value, "badValue");
      else if (!header) warn(key, value, "misplaced");
      else directives.push({ at, scope, key, size: value === "2" ? 2 : 1 });
    } else {
      const n = key === "mob" ? parseId(value) : parseCount(value);
      if (n === undefined) warn(key, value, "badValue");
      else if (header) warn(key, value, "misplaced");
      else kill[key] = { n, value };
    }
  }
  const { kills, mob, extra } = kill;
  if (kills) {
    if (!onComplete) warn("kills", kills.value, "misplaced");
    else directives.push({ at, scope, key: "kills", count: kills.n, ...(mob && { mob: mob.n }) });
  }
  if (extra) {
    if (!mob) warn("extra", extra.value, "badValue");
    else directives.push({ at, scope, key: "extra", count: extra.n, mob: mob.n });
  }
  if (mob && !extra && !(kills && onComplete)) {
    if (!onComplete) warn("mob", mob.value, "misplaced");
    else directives.push({ at, scope, key: "mob", mob: mob.n });
  }
}

/**
 * `.xp`'s level forms: `8`, `8+1200`, `8.5`, or `8-300`. Levels run 1 to 60;
 * a fraction is the digits after the point, so `8.25` is a quarter.
 */
export function parseLevelTarget(text: string): LevelTarget | undefined {
  const match = text.match(/^(\d+)(?:([+.-])(\d+))?$/);
  if (!match) return undefined;
  const level = Number(match[1]);
  if (level < 1 || level > 60) return undefined;
  const [, , sign, digits] = match;
  if (!sign || !digits) return { kind: "level", level };
  if (sign === ".") return { kind: "fraction", level, fraction: Number(`0.${digits}`) };
  const xp = parseCount(digits);
  if (xp === undefined) return undefined;
  return sign === "+" ? { kind: "plus", level, xp } : { kind: "minus", level, xp };
}

/** A `-- @sim level=` comment line that sets the simulated level to `target`. */
export function checkpointLine(target: LevelTarget, indent: string): CommentLine {
  return { kind: "comment", indent, comment: ` @sim level=${formatLevelTarget(target)}` };
}

/** A target as `.xp` writes it and `parseLevelTarget` reads it. */
export function formatLevelTarget(target: LevelTarget): string {
  switch (target.kind) {
    case "level":
      return String(target.level);
    case "plus":
      return `${target.level}+${target.xp}`;
    case "minus":
      return `${target.level}-${target.xp}`;
    case "fraction": {
      const { level, fraction } = target;
      if (fraction === 0) return String(level);
      if (fraction >= 1) return String(Math.min(level + 1, MAX_LEVEL));
      // In decimal, never exponent notation: 1e-7 is `.0000001`.
      const [mantissa, exponent] = fraction.toExponential().split("e");
      return `${level}.${"0".repeat(-Number(exponent) - 1)}${mantissa!.replace(".", "")}`;
    }
  }
}

function parseChance(text: string): number | undefined {
  const n = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) ? Number(text) : NaN;
  return n >= MIN_DROP_CHANCE && n <= 1 ? n : undefined;
}

function parsePositive(text: string, zero = false): number | undefined {
  const n = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) ? Number(text) : NaN;
  return (n > 0 || (zero && n === 0)) && Number.isFinite(n) ? n : undefined;
}

function parseMapPoint(text: string): { x: number; y: number } | undefined {
  const match = text.match(/^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
  const [x, y] = [Number(match?.[1]), Number(match?.[2])];
  return match && x <= 100 && y <= 100 ? { x, y } : undefined;
}

function parseCount(text: string): number | undefined {
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(n) ? n : undefined;
}

function parseId(text: string): number | undefined {
  const n = parseCount(text);
  return n !== undefined && n > 0 ? n : undefined;
}
