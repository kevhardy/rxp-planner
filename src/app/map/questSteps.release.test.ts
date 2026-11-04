import { describe, expect, it } from "vitest";
import { parsePoint } from "../../agent/data.ts";
import { callTool, TOOLS } from "../../agent/index.ts";
import { yards } from "../../data/index.ts";
import { releaseData, releaseEntities } from "../../data/releaseInputs.ts";
import { simData } from "../../rules/index.ts";
import { questDraft } from "../quests/draft.ts";
import { writtenMarkers } from "./testing.ts";

describe("quest_steps", () => {
  it("puts the .goto at the first objective's drafted spawn, and no marker farther from it than the objective's drafted spawn", async () => {
    const game = releaseData();
    const entities = releaseEntities();
    const failures: string[] = [];
    let steps = 0;
    for (const faction of ["Alliance", "Horde"] as const) {
      const sim = simData(game, entities, faction);
      for (const { id } of game.quests) {
        const quest = game.quest(id, faction);
        if (!quest) continue;
        const result = await callTool(TOOLS, "quest_steps", { id, faction }, { game, entities, guides: [] });
        if (!result.ok) throw new Error(result.error);
        const picks = new Map(questDraft(game, quest, faction).objectives.map((o) => [o.objective.index, o.point?.args.join(",")]));
        for (const step of (result.value as { steps: { kind: string; text: string; at?: string }[] }).steps) {
          if (step.kind !== "objective") continue;
          steps++;
          const markers = writtenMarkers(game, sim, faction, step.text);
          const fromGoto = (at: string | undefined) => (at && step.at ? yards(parsePoint(game, at), parsePoint(game, step.at)) : Infinity);
          const farther = [...markers].filter(([index, at]) => fromGoto(at) > fromGoto(picks.get(index)));
          const first = [...markers.keys()].map((index) => picks.get(index)).find((at) => at !== undefined);
          if (farther.length || step.at !== first)
            failures.push(
              `${faction} ${id} .goto ${step.at}: ${[...markers].map(([i, at]) => `${i} at ${at}, drafted ${picks.get(i)}`).join("; ")}`,
            );
        }
      }
    }
    expect(steps).toBeGreaterThan(3000);
    expect(failures, failures.slice(0, 20).join("\n")).toEqual([]);
  }, 600_000);
});
