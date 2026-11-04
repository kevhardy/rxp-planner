import { luaNumber, questArgument, type BodyLine } from "../guide/index.ts";

export interface LineQuest {
  questId: number;
  /** A negative `.turnin` or `.complete` ID: RXP skips the line while the quest is not in the log. */
  skipIfMissing: boolean;
}

/**
 * The quest of a `.accept`, `.turnin`, or `.complete` line, read from its
 * first argument as `questArgument` reads it. Undefined for another line, or
 * for an ID that names no quest.
 */
export function lineQuest(line: BodyLine): LineQuest | undefined {
  if (line.kind !== "command" || (line.name !== "accept" && line.name !== "turnin" && line.name !== "complete")) return undefined;
  const questId = questArgument(line.name, line.args, 0);
  if (questId === undefined || questId < 0) return undefined;
  return { questId, skipIfMissing: (luaNumber(line.args[0] ?? "") ?? 0) < 0 };
}
