import type { GameData } from "../../data/index.ts";
import { parseGuide } from "../../guide/index.ts";
import type { Faction, SimData } from "../../rules/index.ts";
import { questSpots } from "./points.ts";

export function writtenMarkers(game: GameData, sim: SimData, faction: Faction, text: string): Map<number, string | undefined> {
  const step = parseGuide(`#group T\n#name T\n${text}\n`).steps[0]!;
  const completes = step.body.filter((l) => l.kind === "command" && l.name === "complete");
  return new Map(
    completes.map((line) => {
      const alone = { ...step, body: step.body.filter((l) => !completes.includes(l) || l === line) };
      const [spot] = questSpots(game, alone, faction, sim).filter((s) => s.kind === "objective");
      return [Number(line.kind === "command" && line.args[1]), spot && game.formatLocation(spot).join(",")];
    }),
  );
}
