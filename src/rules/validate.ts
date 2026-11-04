import {
  argSpecAt,
  COMMANDS,
  luaNumber,
  parseCondition,
  questArgument,
  TAGS,
  type CommandLine,
  type ConditionExpr,
  type GuideDocument,
  type Line,
} from "../guide/index.ts";
import { commandRule, type CommandRule } from "./commands.ts";
import { suspiciousToken } from "./condition.ts";
import { lineQuest } from "./lineQuest.ts";
import { droppedPointArg, type QuestPointNumber } from "./points.ts";
import { missingPrerequisites } from "./questAccess.ts";
import type { GuidePreview, RouteEnd, RoutePreview, StepPreview } from "./preview.ts";
import { dungeonTag } from "./profile.ts";
import type { RouteSimulation, SimState } from "./simulate.ts";

export interface QuestInfo {
  name: string;
  /** Turning in any one of these unlocks the quest; empty when none is needed. */
  preAny: readonly number[];
  /** Every one of these must be turned in first. */
  preAll: readonly number[];
  /** Taking or turning in any of these closes this quest. */
  exclusiveTo: readonly number[];
  /**
   * The player takes and hands in the quest in one visit to the same NPC or
   * object, as with cloth donations, so a guide may list only `.turnin`.
   */
  acceptOnTurnIn?: boolean;
}

/** Finds a quest by ID; undefined for an unknown quest. */
export type QuestLookup = (id: number) => QuestInfo | undefined;

/**
 * A place in a guide. `guide` is the guide's index in the list given to
 * `previewRoute`. `step` indexes `doc.steps` and is absent for header lines.
 * `line` indexes the step body, or the header without `step`; it is absent for
 * the `step` line itself.
 */
export interface Location {
  guide: number;
  step?: number;
  line?: number;
}

export type Warning =
  /** `.complete` or `.turnin` of a quest no earlier line accepts. */
  | { kind: "notAccepted"; at: Location; questId: number; command: "complete" | "turnin" }
  /**
   * `.accept` before the quest's prerequisites are turned in. `allOf` and
   * `anyOf` list the unmet ones; `later` is where the route turns one in.
   */
  | { kind: "prerequisite"; at: Location; questId: number; allOf: number[]; anyOf: number[]; later?: Location }
  /** A step leaves more than `QUEST_LOG_SIZE` quests in the log. */
  | { kind: "questLogFull"; at: Location; count: number }
  /**
   * `#completewith`, `#requires`, or a command names a label that no shown
   * step in the guide has. `hidden` is set when a line this profile skips has it.
   */
  | { kind: "missingLabel"; at: Location; label: string; hidden: boolean }
  | { kind: "unknownQuest"; at: Location; questId: number }
  /**
   * RXP finds no guide to run for `#next`, so the route stops. `at.guide` may
   * be a guide RXP passed over rather than one on the route.
   */
  | { kind: "missingNext"; at: Location; next: string }
  /** `.accept` at a simulated level below the quest's required level. */
  | { kind: "levelTooLow"; at: Location; questId: number; level: number; requiredLevel: number }
  /**
   * A `level=` checkpoint above the simulated state, which jumps up to it.
   * `xp` is the XP skipped; `kills` counts the kills that earn it, as `Checkpoint.kills` does.
   */
  | {
      kind: "checkpointGap";
      at: Location;
      target: { level: number; xp: number };
      xp: number;
      kills: { count: number; mobs: readonly { npcId: number; count: number }[] } | null;
    }
  /** A `level=` checkpoint `xp` below the simulated state, which keeps its value. */
  | { kind: "checkpointBehind"; at: Location; target: { level: number; xp: number }; xp: number }
  /** A `-- @sim` key the planner does not know, a bad value, or a key in the wrong place. */
  | { kind: "unknownSimKey"; at: Location; key: string; value: string; problem: "unknown" | "badValue" | "misplaced" }
  /** A `.turnin` of a quest without XP data, which the simulation counts as 0 XP. */
  | { kind: "noQuestXp"; at: Location; questId: number }
  /** No mob found for an objective's kills: no name match, several, no dropper, or no mob levels. */
  | {
      kind: "noKillTarget";
      at: Location;
      questId: number;
      objective: string;
      reason: "noMatch" | "ambiguous" | "noDropper" | "noLevels";
    }
  /** An objective whose required count is unknown, so its kills are not counted. */
  | { kind: "noKillCount"; at: Location; questId: number; objective: string }
  | { kind: "unknownCommand"; at: Location; command: string }
  /** A command RXP has no handler for; the addon reports an error. */
  | { kind: "noHandler"; at: Location; command: string }
  /** A `.questgoto` or `.questwaypoint` that RXP drops, because `arg` is not a number. */
  | { kind: "droppedPoint"; at: Location; command: string; arg: QuestPointNumber }
  | { kind: "unknownDungeon"; at: Location; dungeon: string }
  | { kind: "unknownTag"; at: Location; tag: string }
  /** A misspelled tag that RXP stores but never reads. */
  | { kind: "misspelledTag"; at: Location; tag: string; correct: string }
  /** A condition token that names nothing RXP checks; `suggestion` may fix it. */
  | { kind: "suspiciousToken"; at: Location; token: string; suggestion?: string }
  /** A group joined to token text, such as `Mage(Human)`, which is never true. */
  | { kind: "invalidCondition"; at: Location; text: string };

export type WarningKind = Warning["kind"];

/** Quests the quest log holds in WoW Forever. */
export const QUEST_LOG_SIZE = 40;

const ROUTE_UNKNOWN: ReadonlySet<CommandRule["live"]> = new Set(["log", "bags"]);
const SIM_UNKNOWN: ReadonlySet<CommandRule["live"]> = new Set(["bags"]);
// Whether RXP loads the step, and so resolves its labels: it is shown, or
// only `#level`, a runtime gate, or a label jump skips it at runtime.
function loaded(preview: StepPreview): boolean {
  const { shown, reason } = preview;
  return (
    shown ||
    (reason?.kind === "tag" && reason.name === "level") ||
    (reason?.kind === "command" && commandRule(reason.name)?.gate !== undefined) ||
    reason?.kind === "jump"
  );
}

/**
 * Checks a previewed route. Guide text checks cover every line of each guide
 * on the route. Route checks walk the shown steps and applying lines in order,
 * across `#next`, and skip a `hidden` start guide. Labels and quest IDs are
 * checked on steps that `#level` or `.maxlevel` skips too, since RXP resolves
 * labels when it loads a guide.
 *
 * Quest order is checked conservatively, since guides may assume earlier
 * progress and RXP skips some steps by live quest state:
 *
 * - A step with an applying `.isOnQuest`, `.isNotOnQuest`, `.isQuestComplete`,
 *   `.isQuestTurnedIn`, `.isQuestAvailable`, or `.itemcount` line runs only in
 *   some quest log or bag states, as do a `.complete` or `.turnin` line with
 *   a negative ID and an `.accept` with flag 0x2 and a `requiredTurnIn`
 *   quest. Such lines raise no order warnings. Their accepts count
 *   as accepted but do not fill the log; their turn-ins count as turned in
 *   and leave the log.
 * - A `.turnin` needs no accept when the lookup marks the quest
 *   `acceptOnTurnIn`.
 * - Lines within a step count as done together, so a step may list a turn-in
 *   after the accept it unlocks, and the log counts quests after the step.
 * - A quest counts as accepted from its first accept on, so a second turn-in
 *   raises no warning.
 * - An accept of a quest already turned in leaves the log unchanged, as RXP
 *   completes the line (`addon.functions.accept` in functions.lua).
 */
export function validateRoute(route: RoutePreview, lookup: QuestLookup): Warning[] {
  const warnings: Warning[] = [];
  for (const guide of route.guides) lintGuide(guide.doc, guide.source, warnings);
  walkRoute(route, lookup, warnings);
  return sortWarnings(
    warnings,
    route.guides.map((guide) => guide.source),
  );
}

/**
 * Checks a simulated route as `validateRoute` checks a previewed one, and
 * returns the simulation's own warnings with the others. `guides` is the
 * list given to `simulateRoute`.
 *
 * Quest order reads the simulated state before each step that ran, so it
 * knows the progress a guide assumes from `done=` and earlier guides:
 *
 * - An `.accept` needs its prerequisites in `done` or turned in by a line
 *   of the step, since lines within a step count as done together.
 * - A `.complete` or `.turnin` needs the quest in the log or accepted by a
 *   line of the step. Either needs neither when the quest is in `done`, as
 *   RXP completes the line for a quest turned in (`addon.functions.turnin`
 *   and `addon.functions.complete` in functions.lua). A `.turnin` needs
 *   neither when the lookup marks the quest `acceptOnTurnIn`.
 * - A step warns when the simulated log after it holds more than
 *   `QUEST_LOG_SIZE` quests.
 * - A step that a quest-state, `.xp`, or `.maxlevel` gate skips, or that
 *   their label jump passes over, raises no order warnings.
 *   Lines whose state the simulation does not know raise none either: a step
 *   with `.itemcount`, which reads bags; `.acceptmultiple`, `.daily`, and
 *   `.dailyturnin`, which it does not run; a negative ID, which runs only
 *   with the quest in the log; and an `.accept` with flag 0x2 and a
 *   `requiredTurnIn` quest, which it accepts either way.
 *
 * Labels and quest IDs are checked on steps that `#level`, a gate, or a jump
 * skips too, since RXP resolves labels when it loads a guide.
 */
export function validateSimulation(guides: readonly GuideDocument[], sim: RouteSimulation, lookup: QuestLookup): Warning[] {
  const warnings: Warning[] = [...sim.warnings];
  for (const { source } of sim.guides) lintGuide(guides[source]!, source, warnings);

  const steps: { lines: QuestLine[]; before: SimState; after: SimState }[] = [];
  for (const guide of sim.guides) {
    if (guide.hidden) continue;
    const doc = guides[guide.source]!;
    const previews = guide.steps.map((step) => step.preview);
    const lines = routeSteps({ doc, source: guide.source, steps: previews }, lookup, SIM_UNKNOWN, warnings);
    guide.steps.forEach((step, s) => {
      if (step.preview.shown) steps.push({ lines: lines[s]!, before: step.before, after: step.state });
    });
  }

  const turnedInAt = firstTurnIns(steps.map((step) => step.lines));
  for (const { lines, before, after } of steps) {
    const accepted = new Set(lines.filter((l) => l.command.startsWith("accept")).flatMap((l) => l.ids));
    const turnedIn = new Set(lines.filter((l) => l.command.endsWith("turnin")).flatMap((l) => l.ids));
    let lastAccept: Location | undefined;
    for (const { command, ids, conditional, at } of lines) {
      const id = ids[0]!;
      if (command === "accept" && !conditional) {
        checkPrerequisites(id, at, (pre) => before.done.has(pre) || turnedIn.has(pre), lookup, turnedInAt, warnings);
        lastAccept = at;
      }
      if ((command === "complete" || command === "turnin") && !conditional) {
        const passes = before.done.has(id) || (command === "turnin" && lookup(id)?.acceptOnTurnIn);
        if (!before.log.has(id) && !accepted.has(id) && !passes) warnings.push({ kind: "notAccepted", at, questId: id, command });
      }
    }
    if (lastAccept && after.log.size > QUEST_LOG_SIZE) warnings.push({ kind: "questLogFull", at: lastAccept, count: after.log.size });
  }
  checkEnd(sim.end, warnings);

  return sortWarnings(
    warnings,
    sim.guides.map((guide) => guide.source),
  );
}

function sortWarnings(warnings: Warning[], route: readonly number[]): Warning[] {
  const order = new Map(route.map((source, i) => [source, i]));
  const rank = (at: Location) => [order.get(at.guide) ?? route.length, at.step ?? -1, at.line ?? -1];
  return warnings.sort((a, b) => {
    const [x, y] = [rank(a.at), rank(b.at)];
    return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  });
}

function lintGuide(doc: GuideDocument, guide: number, out: Warning[]) {
  doc.header.forEach((line, i) => lintLine(line, { guide, line: i }, out));
  doc.steps.forEach((step, s) => {
    lintLine(step.line, { guide, step: s }, out);
    step.body.forEach((line, i) => lintLine(line, { guide, step: s, line: i }, out));
  });
}

function lintLine(line: Line, at: Location, out: Warning[]) {
  if (line.condition) lintCondition(line.condition.expr, at, out);
  if (line.kind === "tag") {
    const tag = TAGS.get(line.name);
    if (!tag) out.push({ kind: "unknownTag", at, tag: line.name });
    else if (tag.misspellingOf) out.push({ kind: "misspelledTag", at, tag: line.name, correct: tag.misspellingOf });
    if (line.name === "defaultfor") lintCondition(parseCondition(line.value).expr, at, out);
  } else if (line.kind === "command") {
    const command = COMMANDS.get(line.name);
    if (!command) out.push({ kind: "unknownCommand", at, command: line.name });
    else if (command.noHandler) out.push({ kind: "noHandler", at, command: line.name });
    const arg = droppedPointArg(line);
    if (arg) out.push({ kind: "droppedPoint", at, command: line.name, arg });
    const dungeon = line.name === "dungeon" || line.name === "enabledungeon" ? line.args[0]?.replace(/^!/, "") : undefined;
    if (dungeon !== undefined && !dungeonTag(dungeon)) out.push({ kind: "unknownDungeon", at, dungeon });
  }
}

function lintCondition(expr: ConditionExpr, at: Location, out: Warning[]) {
  const seen = new Set<string>();
  visit(expr);

  function visit(node: ConditionExpr) {
    switch (node.type) {
      case "or":
      case "and":
        node.items.forEach(visit);
        break;
      case "not":
        visit(node.item);
        break;
      case "invalid":
        out.push({ kind: "invalidCondition", at, text: node.text });
        break;
      case "token": {
        if (seen.has(node.value)) break;
        seen.add(node.value);
        const suggestion = suspiciousToken(node.value);
        if (suggestion === "") out.push({ kind: "suspiciousToken", at, token: node.value });
        else if (suggestion !== undefined) out.push({ kind: "suspiciousToken", at, token: node.value, suggestion });
      }
    }
  }
}

interface QuestLine {
  command: "accept" | "acceptmultiple" | "complete" | "turnin" | "dailyturnin" | "abandon";
  ids: number[];
  conditional: boolean;
  at: Location;
}

function walkRoute(route: RoutePreview, lookup: QuestLookup, out: Warning[]) {
  const shownGuides = route.guides.filter((guide) => !guide.hidden);
  const steps = shownGuides.flatMap((guide) => routeSteps(guide, lookup, ROUTE_UNKNOWN, out));
  const turnedInAt = firstTurnIns(steps);

  const log = new Set<number>();
  const accepted = new Set<number>();
  const turnedIn = new Set<number>();
  for (const step of steps) {
    const stepAccepts = new Set(step.filter((l) => l.command.startsWith("accept")).flatMap((l) => l.ids));
    const stepTurnIns = new Set(step.filter((l) => l.command.endsWith("turnin")).flatMap((l) => l.ids));
    const added: number[] = [];
    const removed: number[] = [];
    let lastAccept: Location | undefined;
    for (const line of step) {
      const { command, ids, conditional, at } = line;
      if (command === "accept" && !conditional) {
        const done = (pre: number) => turnedIn.has(pre) || stepTurnIns.has(pre);
        checkPrerequisites(ids[0]!, at, done, lookup, turnedInAt, out);
        if (!turnedIn.has(ids[0]!)) added.push(ids[0]!);
        lastAccept = at;
      }
      if (command.startsWith("accept")) ids.forEach((id) => accepted.add(id));
      if ((command === "complete" || command === "turnin") && !conditional) {
        const id = ids[0]!;
        if (!accepted.has(id) && !stepAccepts.has(id) && !(command === "turnin" && lookup(id)?.acceptOnTurnIn))
          out.push({ kind: "notAccepted", at, questId: id, command });
      }
      if (command.endsWith("turnin")) ids.forEach((id) => turnedIn.add(id));
      if (command.endsWith("turnin") || command === "abandon") removed.push(...ids);
    }
    added.forEach((id) => log.add(id));
    removed.forEach((id) => log.delete(id));
    if (lastAccept && log.size > QUEST_LOG_SIZE) out.push({ kind: "questLogFull", at: lastAccept, count: log.size });
  }
  checkEnd(route.end, out);
}

function firstTurnIns(steps: readonly QuestLine[][]): Map<number, Location> {
  const turnedInAt = new Map<number, Location>();
  for (const step of steps) {
    for (const line of step) {
      if (line.command !== "turnin" && line.command !== "dailyturnin") continue;
      for (const id of line.ids) if (!turnedInAt.has(id)) turnedInAt.set(id, line.at);
    }
  }
  return turnedInAt;
}

function checkPrerequisites(
  id: number,
  at: Location,
  done: (pre: number) => boolean,
  lookup: QuestLookup,
  turnedInAt: ReadonlyMap<number, Location>,
  out: Warning[],
) {
  const quest = lookup(id);
  const missing = quest && missingPrerequisites(quest, done, lookup);
  if (!missing) return;
  const later = [...missing.allOf, ...missing.anyOf].map((pre) => turnedInAt.get(pre)).find((loc) => loc !== undefined);
  out.push({ kind: "prerequisite", at, questId: id, ...missing, ...(later && { later }) });
}

function checkEnd(end: RouteEnd | undefined, out: Warning[]) {
  if (end?.kind === "missing") out.push({ kind: "missingNext", at: { guide: end.from, line: end.line }, next: end.next });
}

function routeSteps(
  guide: Pick<GuidePreview, "doc" | "source" | "steps">,
  lookup: QuestLookup,
  unknown: ReadonlySet<CommandRule["live"]>,
  out: Warning[],
): QuestLine[][] {
  const { doc, source } = guide;
  const labels = new Set<string>();
  const allLabels = new Set<string>();
  doc.steps.forEach((step, s) => {
    const label = guide.steps[s]!.tags.get("label");
    if (loaded(guide.steps[s]!) && label) labels.add(label.value);
    for (const line of step.body) if (line.kind === "tag" && line.name === "label") allLabels.add(line.value);
  });
  const checkLabel = (label: string, at: Location) => {
    if (!labels.has(label)) out.push({ kind: "missingLabel", at, label, hidden: allLabels.has(label) });
  };

  return doc.steps.map((step, s) => {
    const preview = guide.steps[s]!;
    if (!loaded(preview)) return [];
    for (const name of ["completewith", "requires"]) {
      const tag = preview.tags.get(name);
      if (tag && !(name === "completewith" && tag.value === "next")) {
        checkLabel(tag.value, { guide: source, step: s, line: tag.line });
      }
    }

    const commands: { line: CommandLine; at: Location }[] = [];
    step.body.forEach((line, i) => {
      if (line.kind === "command" && preview.lines[i]) commands.push({ line, at: { guide: source, step: s, line: i } });
    });
    const conditional = commands.some(({ line }) => unknown.has(commandRule(line.name)?.live));
    const quests: QuestLine[] = [];
    for (const { line, at } of commands) {
      const spec = COMMANDS.get(line.name);
      if (!spec) continue;
      const ids: number[] = [];
      line.args.forEach((arg, i) => {
        const argSpec = argSpecAt(spec, i);
        if (argSpec?.name === "ref") checkLabel(arg, at);
        const id = argSpec?.kind === "questId" ? questArgument(line.name, line.args, i) : undefined;
        if (id === undefined) return;
        if (!lookup(id)) out.push({ kind: "unknownQuest", at, questId: id });
        if (id > 0) ids.push(id);
      });
      if (line.name === "accept" || line.name === "complete" || line.name === "turnin") {
        const quest = lineQuest(line);
        if (!quest) continue;
        // `.accept id,flags,requiredTurnIn`: flag 0x2 completes the step
        // without accepting while `requiredTurnIn` is not turned in
        // (`addon.functions.accept` in functions.lua).
        const [, flags = "", required = ""] = line.args;
        const needsTurnIn = line.name === "accept" && ((luaNumber(flags) ?? 0) & 2) !== 0 && luaNumber(required) !== undefined;
        quests.push({ command: line.name, ids: [quest.questId], conditional: conditional || quest.skipIfMissing || needsTurnIn, at });
      } else if (line.name === "acceptmultiple" || line.name === "dailyturnin" || line.name === "abandon") {
        quests.push({ command: line.name, ids, conditional: true, at });
      } else if (line.name === "daily") {
        // RXP runs `.daily` as `.acceptmultiple` (`addon.functions.daily` in functions.lua).
        quests.push({ command: "acceptmultiple", ids, conditional: true, at });
      }
    }
    return preview.shown ? quests : [];
  });
}
