import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../data/index.ts";
import type { Faction } from "../../rules/profile.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { parseGuide, type Step } from "../../guide/index.ts";
import { questSpots } from "../map/points.ts";
import { zonePoint, ZONES } from "../testing.ts";
import { defaultChoices, draftSteps } from "../../rules/questInsertion.ts";
import { questDraft } from "./draft.ts";

let data: GameData;
beforeAll(async () => {
  data = plannerData();
});

const draft = (id: number) => questDraft(data, data.quest(id)!);
const yards = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("questDraft", () => {
  it("drafts the quest's points as .goto arguments", () => {
    const d = draft(176);
    expect(d.givers.map((p) => p.args)).toEqual([
      ["Elwynn Forest", "24.55", "74.69"],
      ["Elwynn Forest", "24.57", "78.23"],
    ]);
    expect(d.objectives[0]!.point!.args).toEqual(["Elwynn Forest", "25.78", "89.82"]);
    expect(d.enders.map((p) => p.args)).toEqual([["Elwynn Forest", "42.11", "65.93"]]);
  });

  it("drafts a Zephras Isle point", () => {
    expect(draft(92461).givers[0]!.args).toEqual(["Zephras Isle", "42.00", "23.40"]);
  });

  it("offers no .goto for a quest without points, but keeps the accept step", () => {
    const d = draft(93963);
    const quest = data.quest(93963)!;
    expect([quest.startPoints, quest.endPoints]).toEqual([[], []]);
    expect([...d.givers, ...d.enders]).toEqual([]);
    expect(draftSteps(d, { ...defaultChoices(d), giver: -1, ender: -1, complete: false }, "    ").map((s) => s.body)).toEqual([
      [{ kind: "command", indent: "    ", name: "accept", args: ["93963"] }],
      [{ kind: "command", indent: "    ", name: "turnin", args: ["93963"] }],
    ]);
  });

  it("puts each drafted .goto within rounding of the map's marker", () => {
    for (const id of [743, 92461, 176]) {
      const d = draft(id);
      const step = parseGuide(`#name T\nstep\n    .accept ${id}\n    .complete ${id},1\n    .turnin ${id}\n`).steps[0]!;
      const spots = questSpots(data, step, "Alliance");
      for (const point of [...d.givers, ...d.enders, ...d.objectives.flatMap((o) => (o.point ? [o.point] : []))]) {
        const placed = data.locateGoto(point.args);
        if (!placed.ok) throw new Error(placed.message);
        expect(Math.min(...spots.map((s) => yards(s.world, placed.world)))).toBeLessThan(0.5);
      }
    }
  });
});

describe("draftSteps", () => {
  it.each([76156, 77574, 77642, 79095])("enables complete drafting for recovered objective rows on %s", (id) => {
    const d = draft(id);
    expect(defaultChoices(d).complete).toBe(true);
    expect(
      draftSteps(d, defaultChoices(d), "")
        .flatMap((s) => s.body)
        .filter((l) => l.kind === "command" && l.name === "complete"),
    ).toMatchObject([{ args: [String(id), "1"] }]);
  });
  it("keeps changed quest 76160's captured objectives out of complete drafting", () => {
    const d = draft(76160);
    expect(defaultChoices(d).complete).toBe(false);
    expect(
      draftSteps(d, { ...defaultChoices(d), complete: true }, "")
        .flatMap((s) => s.body)
        .filter((l) => l.kind === "command" && l.name === "complete"),
    ).toEqual([]);
  });
  const commands = (steps: Step[]) =>
    steps.map((s) => s.body.map((l) => (l.kind === "command" ? `${l.name} ${l.args.join(",")}` : l.kind)));

  it("completes objectives by the indices the data gives", () => {
    const d = draft(52);
    expect(defaultChoices(d).complete).toBe(true);
    expect(commands(draftSteps(d, defaultChoices(d), ""))[1]!.filter((c) => c.startsWith("complete"))).toEqual([
      "complete 52,1",
      "complete 52,2",
    ]);
  });

  it("places an objective only at points of its type and IDs, except a lone event's triggers, which have no IDs", () => {
    const cleanup = data.quest(7)!;
    const wrong = zonePoint(ZONES.elwynn, 48.83, 35.59, { kind: "mob", sourceType: "npc", sourceId: 257, sourceName: "Kobold Worker" });
    const d = questDraft(data, { ...cleanup, objectivePoints: [wrong] });
    expect(d.objectives.map((o) => o.point)).toEqual([undefined]);
    const fargodeep = data.quest(62)!;
    const trigger = zonePoint(ZONES.elwynn, 40.56, 82.26, {
      kind: "trigger",
      sourceType: "trigger",
      sourceName: "Scout through the Fargodeep Mine",
    });
    expect(questDraft(data, { ...fargodeep, objectivePoints: [trigger] }).objectives[0]!.point).toBeDefined();
  });

  it("drafts each faction's giver for Theldurin the Lost from source B's faction fixes, and without a faction only the ender both share", () => {
    const quest = (faction?: Faction) => data.quest(687, faction)!;
    const givers = (faction?: Faction) => questDraft(data, quest(faction)).givers.map((p) => p.args);
    expect([givers("Alliance"), givers("Horde"), givers()]).toEqual([
      [["Ironforge", "50.83", "5.62"]],
      [["Arathi Highlands", "74.54", "35.64"]],
      [],
    ]);
    expect(data.fieldOrigin(quest("Horde"), "startPoints")).toMatchObject({ source: "source-b" });
    const d = questDraft(data, quest());
    expect(commands(draftSteps(d, defaultChoices(d), ""))).toEqual([["accept 687"], ["goto Badlands,51.39,76.87", "turnin 687"]]);
  });

  it("drafts a source B item objective's points where its source objects are, naming the item", () => {
    const quest = data.quest(3904)!,
      d = draft(3904);
    expect(new Set(quest.objectivePoints.map((p) => `${p.sourceType}:${p.sourceId}`))).toEqual(new Set(["item:11119"]));
    expect(data.fieldOrigin(quest, "objectivePoints")).toMatchObject({ source: "source-b" });
    expect(d.objectives.map((o) => [o.objective.id, o.point?.label])).toEqual([[11119, "Milly's Harvest · Elwynn Forest,53.93,48.78"]]);
  });

  it("drafts no objective step unless every objective has an index, even when asked", () => {
    const quest = data.quest(52)!;
    const [prowler, bear] = quest.objectives.map(({ index: _, ...o }) => o);
    for (const objectives of [
      [prowler!, bear!],
      [quest.objectives[0]!, bear!],
    ]) {
      const d = questDraft(data, { ...quest, objectives });
      expect(defaultChoices(d).complete).toBe(false);
      expect(commands(draftSteps(d, { ...defaultChoices(d), complete: true }, "")).map((s) => s.at(-1))).toEqual([
        "accept 52",
        "turnin 52",
      ]);
    }
  });
});
