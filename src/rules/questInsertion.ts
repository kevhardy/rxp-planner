import type { GameData, MapLocation, Quest, QuestObjective, QuestPoint, WorldLocation } from "../data/index.ts";
import { bodyIndent, insertLine, insertStep, newStep, type BodyLine, type GuideDocument, type Step } from "../guide/index.ts";
import { lineQuest } from "./lineQuest.ts";
import type { Faction } from "./profile.ts";
import { checkpointLine } from "./simComments.ts";
import type { LevelTarget } from "./xp.ts";

export interface DraftPoint {
  label: string;
  args: string[];
}

export interface QuestDraft {
  quest: Quest;
  givers: DraftPoint[];
  enders: DraftPoint[];
  objectives: { objective: QuestObjective; point?: DraftPoint }[];
}

export interface DraftChoices {
  accept: boolean;
  complete: boolean;
  turnin: boolean;
  giver: number;
  ender: number;
}

/**
 * The `.complete` indices, or undefined unless the data gives every objective
 * one. A step that completes some objectives would let RXP move on too soon.
 */
export function objectiveIndices(draft: QuestDraft): number[] | undefined {
  const indices = draft.objectives.map((o) => o.objective.index);
  return indices.length > 0 && indices.every((i) => i !== undefined) ? indices : undefined;
}

export function defaultChoices(draft: QuestDraft): DraftChoices {
  return {
    accept: true,
    complete: objectiveIndices(draft) !== undefined,
    turnin: true,
    giver: draft.givers.length > 0 ? 0 : -1,
    ender: draft.enders.length > 0 ? 0 : -1,
  };
}

const DRAFT_PARTS = ["accept", "complete", "turnin"] as const;
export type DraftPart = (typeof DRAFT_PARTS)[number];

export function draftSteps(draft: QuestDraft, choices: DraftChoices, indent: string): Step[] {
  return DRAFT_PARTS.flatMap((part) => (choices[part] ? (draftStep(draft, choices, part, indent) ?? []) : []));
}

/** The step for one part, whether or not `choices` includes it. */
export function draftStep(draft: QuestDraft, choices: DraftChoices, part: DraftPart, indent: string): Step | undefined {
  const id = String(draft.quest.id);
  const line = (name: string, args: string[]): BodyLine => ({ kind: "command", indent, name, args });
  const step = (body: BodyLine[]): Step => ({ ...newStep(), body });
  switch (part) {
    case "accept": {
      const giver = draft.givers[choices.giver];
      return step([...(giver ? [line("goto", giver.args)] : []), line("accept", [id])]);
    }
    case "complete": {
      const indices = objectiveIndices(draft);
      if (!indices) return undefined;
      const gotos = new Map(draft.objectives.flatMap((o) => (o.point ? [[o.point.args.join(","), o.point.args] as const] : [])));
      return step([
        ...[...gotos.values()].map((args) => line("goto", args)),
        ...indices.map((index) => line("complete", [id, String(index)])),
      ]);
    }
    case "turnin": {
      const ender = draft.enders[choices.ender];
      return step([...(ender ? [line("goto", ender.args)] : []), line("turnin", [id])]);
    }
  }
}

export type SuggestedQuest =
  | { kind: "accept" | "turnin"; questId: number; location: WorldLocation | null }
  | { kind: "objective"; questId: number; location: WorldLocation | null; objective: { index: number | null } };

export type QuestRequest =
  | { kind: "draft"; draft: QuestDraft; choices: DraftChoices }
  | { kind: "suggestion"; suggestion: SuggestedQuest; skipped: boolean }
  | { kind: "marker"; command: "accept" | "turnin"; id: number; marker: MapLocation; skipped: boolean };

export interface InsertTarget {
  data: GameData;
  faction: Faction;
  doc: GuideDocument;
  after: number | null;
}

/**
 * An insertion for the editor to apply. `edit` changes the document it is
 * given, which on a built-in's first edit is the built-in's new copy.
 */
export interface QuestInsertion {
  edit: (doc: GuideDocument) => GuideDocument;
  select: number;
}

/**
 * Inserts the steps for `request`. A draft goes in as new steps. A
 * suggestion or a marker adds one command, which joins step `after` when
 * both meet the same NPC, such as accepting a quest from the NPC the step
 * turns in to: the command, without its `.goto`, since the step already goes
 * there, follows the step's last non-blank line. It stays a new step when the
 * character skips step `after`, whose lines never run. Undefined when a
 * suggestion's quest is not in the data or its objective has no index.
 */
export function insertQuest(target: InsertTarget, request: Exclude<QuestRequest, { kind: "suggestion" }>): QuestInsertion;
export function insertQuest(target: InsertTarget, request: QuestRequest): QuestInsertion | undefined;
export function insertQuest(target: InsertTarget, request: QuestRequest): QuestInsertion | undefined {
  const { data, faction, doc, after } = target;
  const at = after === null ? 0 : after + 1;
  const indent = bodyIndent(doc);
  if (request.kind === "draft") {
    const steps = draftSteps(request.draft, request.choices, indent);
    return { edit: (d) => steps.reduce((next, step, i) => insertStep(next, at + i, step), d), select: at };
  }
  const planned = questCommand(data, faction, request);
  if (!planned) return undefined;
  const command: BodyLine = { kind: "command", indent, ...planned.command };
  const quest = (id: number) => data.quest(id, faction);
  if (after !== null && !request.skipped) {
    const body = doc.steps[after]!.body;
    const npcs = sharedNpcs(body, quest);
    if (!worksOnObjectives(body) && [...sharedNpcs([command], quest)].some((id) => npcs.has(id))) {
      const index = body.findLastIndex((l) => l.kind !== "blank") + 1;
      return { edit: (d) => insertLine(d, { step: after, index }, command), select: after };
    }
  }
  const goto: BodyLine[] = planned.goto ? [{ kind: "command", indent, name: "goto", args: data.formatLocation(planned.goto) }] : [];
  const step: Step = { ...newStep(), body: [...goto, command] };
  return { edit: (d) => insertStep(d, at, step), select: at };
}

/**
 * A checkpoint insertion for the editor to apply. `edit` changes the document
 * it is given, as in `QuestInsertion`. `select.step` is null for the header,
 * and `select.line` is null when no line is selected.
 */
export interface CheckpointInsertion {
  edit: (doc: GuideDocument) => GuideDocument;
  select: { step: number | null; line: number | null };
}

/**
 * Inserts a `-- @sim level=` line after step `after`, or in the header when
 * `after` is null. The line follows the last non-blank line there, in the
 * header with no indent. It goes in a new step when the character skips step
 * `after`, whose lines never run.
 */
export function insertCheckpoint(doc: GuideDocument, after: number | null, skipped: boolean, target: LevelTarget): CheckpointInsertion {
  const indent = bodyIndent(doc);
  if (after !== null && skipped) {
    const step: Step = { ...newStep(), body: [checkpointLine(target, indent)] };
    return { edit: (d) => insertStep(d, after + 1, step), select: { step: after + 1, line: 0 } };
  }
  const lines = after === null ? doc.header : doc.steps[after]!.body;
  const pos = { step: after, index: lines.findLastIndex((l) => l.kind !== "blank") + 1 };
  const line = checkpointLine(target, after === null ? "" : indent);
  return { edit: (d) => insertLine(d, pos, line), select: { step: after, line: after === null ? null : pos.index } };
}

export function questPointAt(points: readonly QuestPoint[], at: WorldLocation | null): QuestPoint | undefined {
  return at ? points.find((p) => p.world.instance === at.instance && p.world.x === at.x && p.world.y === at.y) : undefined;
}

function questCommand(
  data: GameData,
  faction: Faction,
  request: Exclude<QuestRequest, { kind: "draft" }>,
): { command: { name: string; args: string[] }; goto: MapLocation | undefined } | undefined {
  if (request.kind === "marker") return { command: { name: request.command, args: [String(request.id)] }, goto: request.marker };
  const s = request.suggestion;
  const quest = data.quest(s.questId, faction);
  if (!quest) return undefined;
  const id = String(s.questId);
  if (s.kind === "objective" && s.objective.index === null) return undefined;
  const [points, command] =
    s.kind === "objective"
      ? [quest.objectivePoints, { name: "complete", args: [id, String(s.objective.index)] }]
      : s.kind === "accept"
        ? [quest.startPoints, { name: "accept", args: [id] }]
        : [quest.endPoints, { name: "turnin", args: [id] }];
  const point = questPointAt(points, s.location);
  return { command, goto: point && data.locateQuestPoint(point) };
}

const worksOnObjectives = (body: readonly BodyLine[]) => body.some((l) => l.kind === "command" && l.name === "complete");

function sharedNpcs(body: readonly BodyLine[], quest: (id: number) => Quest | undefined): Set<number> {
  let shared: Set<number> | undefined;
  for (const line of body) {
    if (line.kind !== "command" || (line.name !== "accept" && line.name !== "turnin")) continue;
    const questId = lineQuest(line)?.questId;
    const q = questId === undefined ? undefined : quest(questId);
    const points = (line.name === "accept" ? q?.startPoints : q?.endPoints) ?? [];
    const npcs = points.flatMap((p) => (p.sourceType === "npc" && p.sourceId !== undefined ? [p.sourceId] : []));
    shared = new Set(shared ? npcs.filter((id) => shared!.has(id)) : npcs);
  }
  return shared ?? new Set();
}
