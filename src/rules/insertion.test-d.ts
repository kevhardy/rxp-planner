// pnpm typecheck checks this file; Vitest does not run it.
import type { QuestSuggestion } from "./insertion.ts";

const base = { questId: 52, name: "Protect the Frontier", level: 10, xp: 10, location: null, distance: null, prerequisiteMissing: false };

export const objective: QuestSuggestion = { ...base, kind: "objective", objective: { row: 0, name: "Prowler", index: 1 } };
export const locked: QuestSuggestion = { ...base, kind: "accept", locked: [{ kind: "level", requiredLevel: 5 }] };

// @ts-expect-error An objective suggestion names its objective.
export const noObjective: QuestSuggestion = { ...base, kind: "objective" };
// @ts-expect-error Only a quest to accept can be locked.
export const lockedTurnin: QuestSuggestion = { ...base, kind: "turnin", locked: [{ kind: "level", requiredLevel: 5 }] };
