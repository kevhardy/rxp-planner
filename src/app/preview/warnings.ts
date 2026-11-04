import type { GameData } from "../../data/index.ts";
import type { RouteView, Warning, WarningKind } from "../../rules/index.ts";
import { questLookup, validateRoute, validateSimulation, warningText } from "../../rules/index.ts";

export const KIND_LABELS: Record<WarningKind, string> = {
  notAccepted: "Completed before accepted",
  prerequisite: "Prerequisite not turned in",
  questLogFull: "Quest log full",
  missingLabel: "Missing label",
  unknownQuest: "Unknown quest data",
  missingNext: "Missing #next guide",
  levelTooLow: "Level too low",
  checkpointGap: "Checkpoint gap",
  checkpointBehind: "Checkpoint behind",
  unknownSimKey: "@sim comment problem",
  noQuestXp: "No quest XP",
  noKillTarget: "No kill target",
  noKillCount: "No kill count",
  unknownCommand: "Unknown command",
  noHandler: "Command RXP cannot run",
  droppedPoint: "Point RXP drops",
  unknownDungeon: "Unknown dungeon",
  unknownTag: "Unknown tag",
  misspelledTag: "Misspelled tag",
  suspiciousToken: "Suspicious condition token",
  invalidCondition: "Invalid condition",
};

export const KIND_ORDER = Object.keys(KIND_LABELS) as WarningKind[];

const checked = new WeakMap<RouteView, { data: GameData; warnings: Warning[] }>();

export function routeWarnings(route: RouteView, data: GameData): Warning[] {
  let entry = checked.get(route);
  if (entry?.data !== data) {
    const lookup = questLookup(data, route.profile.faction);
    const warnings = route.simulation ? validateSimulation(route.docs, route.simulation, lookup) : validateRoute(route.preview, lookup);
    checked.set(route, (entry = { data, warnings }));
  }
  return entry.warnings;
}

export function stepWarnings(route: RouteView, data: GameData, source: number): Map<number, string[]> {
  const byStep = new Map<number, string[]>();
  for (const w of routeWarnings(route, data)) {
    const step = w.at.step;
    if (w.at.guide !== source || step === undefined) continue;
    const text = warningText(
      w,
      (id) => data.quest(id),
      (g) => route.names[g]!,
    );
    const list = byStep.get(step) ?? [];
    list.push(w.at.line === undefined ? text : `Line ${w.at.line + 1}: ${text}`);
    byStep.set(step, list);
  }
  return byStep;
}
