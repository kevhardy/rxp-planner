import { describe, expect, it } from "vitest";
import type { GameData } from "../../data/index.ts";
import { isMono, parseGuide } from "../../guide/index.ts";
import {
  markDoneParts,
  placeParts,
  prerequisiteFixes,
  previewRoute,
  routeGraph,
  warningParts,
  warningText,
  type RouteView,
  type Warning,
} from "../../rules/index.ts";
import { DEFAULT_SETTINGS, profileOf } from "./settings.ts";
import { routeWarnings, stepWarnings } from "./warnings.ts";

const questData = (names: Record<number, string>) =>
  ({
    quest: (id: number) => (names[id] ? { name: names[id], preQuestSingle: [], preQuestGroup: [], types: [] } : undefined),
  }) as unknown as GameData;

describe("routeWarnings", () => {
  it("distinguishes partial quest data from a missing quest", () => {
    const warning = { kind: "unknownQuest", questId: 5, at: { guide: 0 } } as const;
    expect(
      warningText(
        warning,
        () => ({ name: "Jitters' Growling Gut" }),
        () => "A",
      ),
    ).toBe("Jitters' Growling Gut (5) has unverified prerequisite data");
    expect(
      warningText(
        warning,
        () => undefined,
        () => "A",
      ),
    ).toBe("Quest 5 is not in the quest data");
  });
  it("describes the simulator's warnings", () => {
    const at = { guide: 0, step: 1, line: 0 };
    const text = (warning: Warning) =>
      warningText(
        warning,
        (id) => (id === 579 ? { name: "Stormwind Library" } : undefined),
        () => "A",
      );
    const cases: [Warning, string][] = [
      [
        { kind: "checkpointGap", at, target: { level: 8, xp: 1200 }, xp: 3543, kills: null },
        "Checkpoint level 8 + 1,200 xp is 3,543 xp ahead of the simulation",
      ],
      [{ kind: "checkpointBehind", at, target: { level: 8, xp: 0 }, xp: 500 }, "Checkpoint level 8 is 500 xp behind the simulation"],
      [{ kind: "unknownSimKey", at, key: "kills", value: "x", problem: "badValue" }, "@sim kills=x has a value the simulator cannot use"],
      [
        { kind: "unknownSimKey", at, key: "done", value: "7", problem: "misplaced" },
        "@sim done= does not apply here; it belongs in the header",
      ],
      [
        { kind: "unknownSimKey", at, key: "mob", value: "6", problem: "misplaced" },
        "@sim mob= does not apply here; it belongs on a .complete line",
      ],
      [
        { kind: "unknownSimKey", at, key: "kills", value: "3", problem: "misplaced" },
        "@sim kills= does not apply here; it belongs on a .complete line",
      ],
      [
        { kind: "unknownSimKey", at: { guide: 0, line: 2 }, key: "extra", value: "2", problem: "misplaced" },
        "@sim extra= does not apply here; it belongs in a step, with mob=",
      ],
      [{ kind: "noQuestXp", at, questId: 5 }, "No XP data for quest 5, so its turn-in counts 0 xp"],
      [
        { kind: "noKillTarget", at, questId: 579, objective: "Library Scrip", reason: "noDropper" },
        "No kills counted for Library Scrip in Stormwind Library (579): no mob drops its item",
      ],
    ];
    expect(cases.map(([warning]) => text(warning))).toEqual(cases.map(([, expected]) => expected));
  });
  it("sets each quest ID, place number, and piece of guide syntax in Mono, apart from the words", () => {
    const at = { guide: 0, step: 1, line: 0 };
    const mono = (warning: Warning) =>
      warningParts(
        warning,
        (id) => (id === 579 ? { name: "Stormwind Library" } : undefined),
        () => "A",
      ).flatMap((part) => (isMono(part) ? [part.mono] : []));
    expect(mono({ kind: "noKillCount", at, questId: 579, objective: "Library Scrip" })).toEqual(["579"]);
    expect(mono({ kind: "misspelledTag", at, tag: "softcor", correct: "softcore" })).toEqual(["#softcor", "#softcore"]);
    expect(mono({ kind: "unknownSimKey", at, key: "kills", value: "x", problem: "badValue" })).toEqual(["@sim kills=x"]);
    expect(placeParts(at)).toEqual([
      ["Step ", { mono: "2" }],
      [", line ", { mono: "1" }],
    ]);
  });
  it("gives a prerequisite's quick fixes each quest it needs, with one anyOf candidate each", () => {
    const at = { guide: 0, step: 1, line: 0 };
    const warning: Extract<Warning, { kind: "prerequisite" }> = { kind: "prerequisite", at, questId: 9, allOf: [1, 2], anyOf: [3, 4] };
    expect(prerequisiteFixes(warning)).toEqual([
      [1, 2, 3],
      [1, 2, 4],
    ]);
    expect(prerequisiteFixes({ ...warning, anyOf: [] })).toEqual([[1, 2]]);
    expect(prerequisiteFixes({ ...warning, later: at })).toEqual([]);
    expect(markDoneParts([33, 2], (id) => (id === 33 ? { name: "Wolves Across the Border" } : undefined))).toEqual([
      "Mark ",
      "Wolves Across the Border",
      " (",
      { mono: "33" },
      ")",
      " and ",
      "quest ",
      { mono: "2" },
      " done in header",
    ]);
  });
  it("checks the same route again for other game data", () => {
    const profile = profileOf(DEFAULT_SETTINGS, undefined);
    const doc = parseGuide("#name A\n#group G\nstep\n    .accept 33\n");
    const route: RouteView = {
      preview: previewRoute([doc], 0, profile),
      profile,
      startLevel: { level: 1, xp: 0, auto: true },
      records: [],
      names: ["A"],
      docs: [doc],
      open: 0,
      earlier: [],
      graph: routeGraph([doc], profile),
    };
    const data = questData({ 33: "Wolves Across the Border" });
    expect(routeWarnings(route, questData({})).map((w) => w.kind)).toEqual(["unknownQuest"]);
    expect(routeWarnings(route, data)).toEqual([]);
  });
});

describe("stepWarnings", () => {
  it("gives the open guide's warnings by step, with the line number of a warning on a line", () => {
    const profile = profileOf(DEFAULT_SETTINGS, undefined);
    const docs = [
      parseGuide("#name A\n#group G\n#next B\nstep\n    .accept 33\n"),
      parseGuide("#name B\n#group G\nstep\n    .goto Elwynn Forest,1,1\nstep << Mgae\n    .frobnicate 1\n    .accept 34\n"),
    ];
    const route: RouteView = {
      preview: previewRoute(docs, 0, profile),
      profile,
      startLevel: { level: 1, xp: 0, auto: true },
      records: [],
      names: ["A", "B"],
      docs,
      open: 1,
      earlier: [],
      graph: routeGraph(docs, profile),
    };
    const data = questData({});
    expect(stepWarnings(route, data, 1)).toEqual(
      new Map([[1, ["Mgae matches nothing RXP checks", "Line 1: .frobnicate is not an RXP command"]]]),
    );
    expect(stepWarnings(route, data, 0)).toEqual(new Map([[0, ["Line 1: Quest 33 is not in the quest data"]]]));
  });
});
