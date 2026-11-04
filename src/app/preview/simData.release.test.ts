import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { releaseData, releaseEntities } from "../../data/releaseInputs.ts";
import { extractGuides, parseGuide } from "../../guide/index.ts";
import { createProfile, questLookup, simData, simulateRoute, validateSimulation } from "../../rules/index.ts";

describe("simData", () => {
  it("feeds real Forever quest and kill data through a bundled route and validation", async () => {
    const data = releaseData();
    const entities = releaseEntities();
    const alliance = simData(data, entities, "Alliance");
    const source = await readFile(new URL("../../../guides/rxp-forever/Alliance-1-13_Human.lua", import.meta.url), "utf8");
    const docs = extractGuides(source).map((g) => parseGuide(g.text));
    expect(docs).toHaveLength(3);
    const start = docs.findIndex((doc) =>
      doc.header.some((line) => line.kind === "tag" && line.name === "name" && line.value === "6-11 Elwynn Forest"),
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const result = simulateRoute(docs, start, createProfile({ race: "Human", class: "WARRIOR", level: 6 }), alliance);
    const warnings = validateSimulation(docs, result, questLookup(data, "Alliance"));
    const steps = result.guides.flatMap((guide) => guide.steps);
    const end = result.guides.at(-1)!.end;
    expect(end.level).toBeGreaterThanOrEqual(13);
    expect(end.level).toBeLessThan(16);
    expect(steps.reduce((sum, step) => sum + step.xp.quest, 0)).toBeGreaterThan(0);
    expect(steps.reduce((sum, step) => sum + step.xp.kills, 0)).toBeGreaterThan(0);
    expect(steps.every(({ state }) => Number.isFinite(state.xp) && state.xp >= 0)).toBe(true);
    expect(warnings.filter((w) => w.kind === "noKillCount" || w.kind === "noKillTarget")).toEqual([
      { kind: "noKillCount", at: { guide: 1, step: 321, line: 2 }, questId: 1640, objective: "Bartleby" },
    ]);
  });
});
