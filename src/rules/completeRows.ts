import type { Quest, QuestObjective, TextObjective } from "../data/index.ts";

type Keyed = { readonly kind: "text" } | { readonly kind: "numbered" | "monster" | "item" | "other"; readonly index: number | null };

export interface NumberedRow {
  kind: "numbered";
  /** The producer's index; null when the data does not establish it. */
  index: number | null;
  objective: QuestObjective;
}

export interface TextRow {
  kind: "text";
  objective: TextObjective;
}

/** The rows `.complete` counts, in its order. Never mixed: a quest's text rows when it has any, else its numbered objectives. */
export type CompleteRows = readonly NumberedRow[] | readonly TextRow[];

export function completeRows(quest: Pick<Quest, "objectives" | "textObjectives">): CompleteRows {
  if (quest.textObjectives?.length)
    return quest.textObjectives.filter((t) => t.need !== "providedItem").map((objective) => ({ kind: "text", objective }));
  return quest.objectives.map((objective) => ({ kind: "numbered", index: objective.index ?? null, objective }));
}

/** True when `.complete` counts `rows` in page order: no row is numbered. An empty list counts as page order. */
export function pageOrder<N extends Keyed, T extends Keyed & { kind: "text" }>(rows: readonly N[] | readonly T[]): rows is readonly T[] {
  return rows.every((r) => r.kind === "text");
}

/** The number `.complete` names the row at `position` by: a numbered row's producer index, else page order from 1. */
export function completeIndex(row: Keyed, position: number): number | null {
  return row.kind === "text" ? position + 1 : row.index;
}

/** The position of the row that `.complete <quest>,<obj>` names; undefined when no row has that number. */
export function completeRow(rows: readonly Keyed[], obj: number): number | undefined {
  const row = rows.findIndex((r, i) => completeIndex(r, i) === obj);
  return row < 0 ? undefined : row;
}

/**
 * The row that `.complete <quest>,<obj>` names; undefined when no row has that number.
 * RXP names the line by the Nth quest-log row of any kind: `addon.UpdateQuestCompletionData`
 * in `functions.lua` reads `objectives[element.obj]`, which `addon.GetQuestObjectives` fills
 * in `GetQuestLogLeaderBoard` order.
 */
export function namedRow(quest: Pick<Quest, "objectives" | "textObjectives">, obj: number): NumberedRow | TextRow | undefined {
  const rows = completeRows(quest);
  const at = completeRow(rows, obj);
  return at === undefined ? undefined : rows[at];
}

export const linkType = (link: NonNullable<TextObjective["link"]>): "monster" | "item" => (link.kind === "npc" ? "monster" : "item");
