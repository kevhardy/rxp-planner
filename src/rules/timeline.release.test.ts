import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { releaseData, releaseEntities } from "../data/releaseInputs.ts";
import { guideMeta } from "./registration.ts";
import { decodeBuiltins } from "../io/builtin.ts";
import { createProfile } from "./profile.ts";
import { RACE_FACTION, type PlayableRace, type Race } from "../data/races.ts";
import { previewDoc } from "./chain.ts";
import { simData } from "./simData.ts";
import { buildTimeline, timelineNpcs } from "./timeline.ts";

describe("starting flight paths", () => {
  const timeline = async (race: PlayableRace, start: string, maxGuides: number) => {
    const { guides } = await decodeBuiltins(
      new Uint8Array(await readFile(new URL("../../public/data/rxp-forever.json.gz", import.meta.url))),
    );
    const at = guides.findIndex((r) => {
      const meta = guideMeta(r);
      return meta.group === "RestedXP Forever Guide (A)" && meta.name === start;
    });
    const game = releaseData();
    const faction = RACE_FACTION[race];
    return buildTimeline(
      guides.map((r) => previewDoc(r)),
      at,
      createProfile({ race, class: "WARRIOR", level: 1, soloSelfFound: true }),
      simData(game, releaseEntities(), faction),
      { ...timelineNpcs(game, faction), maxGuides },
    );
  };

  it.each([
    { race: "NightElf", start: "1-6 Shadowglen", fly: ".fly Darkshore", guide: "6-11 Teldrassil", step: 288 },
    { race: "Human", start: "1-6 Northshire", fly: ".fly Stormwind", guide: "6-11 Elwynn Forest", step: 262 },
  ] as const satisfies readonly { race: Race; start: string; fly: string; guide: string; step: number }[])(
    "flies the $race guide's $fly with no .fp before it",
    async ({ race, start, fly, guide, step }) => {
      const result = await timeline(race, start, 2);
      const flies = result.steps.flatMap((s) =>
        s.activities.flatMap((a) =>
          (a.kind === "travel" || a.kind === "flight") && a.target.kind === "flight" ? [[s.guide, s.step, a.kind]] : [],
        ),
      );
      expect(flies).toEqual([[guide, step, "flight"]]);
      expect(result.warnings.filter((w) => w.message.startsWith(`${fly} `))).toEqual([]);
    },
  );

  it("flies the Windshaper guide's .fly Orgrimmar with no .fp before it", async () => {
    const result = await timeline("Windshaper", "9-13 Zephras Isle", 1);
    const step = result.steps.find((s) => s.step === 350);
    expect(step?.activities.map((a) => a.kind)).toEqual(["travel", "interact", "flight", "update"]);
    expect(result.warnings.filter((w) => w.message.startsWith(".fly Orgrimmar "))).toEqual([]);
    expect(
      result.steps
        .find((s) => s.step === 347)!
        .activities.filter((a) => (a.kind === "travel" || a.kind === "flight") && a.target.kind === "flight"),
    ).toEqual([]);
  });
});
