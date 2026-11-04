import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, extractGuides, parseGuide, type CommandLine } from "../guide/index.ts";
import type { GateState } from "./gates.ts";
import {
  describeGuideStatus,
  describeReason,
  previewRoute,
  routeGraph,
  speedrunFaction,
  walkRoute,
  type GuidePreview,
  type RouteEnd,
} from "./preview.ts";
import { createProfile, type Profile } from "./profile.ts";

const humanWarrior = createProfile({ race: "Human", class: "WARRIOR", level: 10 });
const gnomeMage = createProfile({ race: "Gnome", class: "MAGE" });

const guide = (text: string, header = "#name Test\n#group Group") => parseGuide(`${header}\n${text}`);

function preview(text: string, profile: Profile = humanWarrior, header?: string): GuidePreview {
  return previewRoute([guide(text, header)], 0, profile, false).guides[0]!;
}

function stepResult(text: string, profile: Partial<Profile> = {}): string {
  const p = { ...humanWarrior, ...profile };
  const step = preview(`step\n${text}`, p).steps[0]!;
  return step.shown ? "shown" : describeReason(step.reason!, p);
}

describe("step conditions", () => {
  it("names the token that fails", () => {
    expect(stepResult("")).toBe("shown");
    const guidePreview = preview("step << Mage\nstep << !Warrior\nstep << Human !Warrior\nstep << skip\nstep << Dwarf/Gnome\nstep << 20");
    expect(guidePreview.steps.map((s) => describeReason(s.reason!, humanWarrior))).toEqual([
      "Only for Mage",
      "Skipped for Warrior",
      "Skipped for Warrior",
      "Disabled",
      "Only for Dwarf/Gnome",
      "Only for level 20+",
    ]);
    expect(guidePreview.shown).toBe(0);
  });

  it("marks body lines whose condition fails", () => {
    const step = preview("step\n.accept 1 << Mage\n.accept 2 << Warrior\n#xprate >1.49 << Mage\n#xprate <1.5").steps[0]!;
    expect(step.lines).toEqual([false, true, false, true]);
    expect(step.tags.get("xprate")).toEqual({ value: "<1.5", line: 3 });
    expect(step.shown).toBe(true);
  });
});

describe("step tags", () => {
  it("checks the season", () => {
    expect(stepResult("#season 0")).toBe("shown");
    expect(stepResult("#season 1")).toBe("Season 1 only");
    expect(stepResult("#season 1,2", { season: 2 })).toBe("shown");
    expect(stepResult("#era", { season: 1 })).toBe("Not in Season of Mastery");
    expect(stepResult("#som")).toBe("Season of Mastery only");
    expect(stepResult("#era/som", { season: 1, phase: 3 })).toBe("Not in Season of Mastery after phase 2");
    expect(stepResult("#era/som", { season: 1, phase: 2 })).toBe("shown");
  });

  it("checks the phase", () => {
    expect(stepResult("#phase 3")).toBe("shown");
    expect(stepResult("#phase 3-4")).toBe("Phase 3-4 only");
    expect(stepResult("#phase soon")).toBe("Phase soon only");
  });

  it("checks the XP rate", () => {
    expect(stepResult("#xprate <1.5")).toBe("shown");
    expect(stepResult("#xprate >1.49")).toBe("XP rate >1.49 only");
    expect(stepResult("#xprate >1.49", { season: 2 })).toBe("XP rate >1.49 only");
    expect(stepResult("#xprate 1.2-1.5", { xpRate: 1.5 })).toBe("shown");
    expect(stepResult("#xprate 1.2-1.5")).toBe("XP rate 1.2-1.5 only");
    expect(stepResult("#xprate 1.5")).toBe("XP rate 1.5 only");
  });

  it("checks hardcore mode, which is off, the realm, and solo self-found", () => {
    expect(stepResult("#hardcore")).toBe("Hardcore only");
    expect(stepResult("#softcore")).toBe("shown");
    expect(stepResult("#hardcoreserver")).toBe("Hardcore realms only");
    expect(stepResult("#softcoreserver", { hardcoreRealm: true })).toBe("Not on hardcore realms");
    expect(stepResult("#ssf")).toBe("Solo self-found only");
    expect(stepResult("#ah", { soloSelfFound: true })).toBe("Not in solo self-found");
  });

  // RXP's `BetaVersionCheck`, with beta features off.
  it("hides #beta steps", () => {
    expect(stepResult("#beta")).toBe("Beta features only");
  });

  it("checks group quests and dungeons", () => {
    expect(stepResult(".group")).toBe("Group quests off");
    expect(stepResult(".group", { groupQuests: true })).toBe("shown");
    expect(stepResult(".solo", { groupQuests: true })).toBe("Solo step; group quests on");
    expect(stepResult(".dungeon WC")).toBe("Dungeon WC off");
    expect(stepResult(".dungeon 718", { dungeons: ["WC"] })).toBe("shown");
    expect(stepResult(".dungeon !WC", { dungeons: ["WC"] })).toBe("Skipped with WC on");
    expect(stepResult(".dungeon !WC")).toBe("shown");
  });

  it("checks the maximum level", () => {
    expect(stepResult("#maxlevel 10")).toBe("shown");
    expect(stepResult("#maxlevel 9")).toBe("Above level 9");
  });

  // `addon.SetStep` in GuideWindow.lua and `addon.functions.maxlevel` in functions.lua.
  it("checks #level and .maxlevel at the step's level", () => {
    expect(stepResult("#level 10")).toBe("shown");
    expect(stepResult("#level 11")).toBe("Below level 11");
    expect(stepResult("#sticky\n#level 11")).toBe("Below level 11");
    expect(stepResult(".maxlevel 10")).toBe("shown");
    expect(stepResult(".maxlevel 9+500")).toBe("Above level 9+500");
    expect(stepResult(".maxlevel 9,Gone")).toBe("shown");
    expect(stepResult(".maxlevel soon")).toBe("shown");
  });
});

describe("guides", () => {
  it("hides a guide by its last header condition", () => {
    expect(preview("step", humanWarrior, "<< Horde\n#name A\n#group G").hidden?.kind).toBe("condition");
    expect(preview("step", humanWarrior, "<< Horde\n#name A\n#group G\n<< Alliance").hidden).toBeUndefined();
  });

  it("hides guides for other games, incomplete guides, and gated guides", () => {
    expect(preview("step", humanWarrior, "#tbc\n#name A\n#group G").hidden).toEqual({ kind: "expansion" });
    expect(preview("step", humanWarrior, "#tbc\n#classic\n#name A\n#group G").hidden).toBeUndefined();
    expect(preview("step", humanWarrior, "#name A").hidden).toEqual({ kind: "incomplete" });
    const inactive = preview("step", humanWarrior, "#name A\n#group G\n#xprate >1.49");
    expect(inactive.hidden).toBeUndefined();
    expect(describeReason(inactive.inactive!, humanWarrior)).toBe("XP rate >1.49 only");
    expect(preview("step", humanWarrior, "#name A\n#group G\n#internal").hidden).toMatchObject({ name: "internal" });
  });

  it("states whether the character's guide never runs, is not offered, or is offered", () => {
    const status = (header: string) => describeGuideStatus(preview("step", humanWarrior, `#name A\n#group G\n${header}`), humanWarrior);
    expect(["<< Horde", "#xprate >1.49", "<< Human"].map(status)).toEqual([
      "Never runs: Only for Horde",
      "Not offered: XP rate >1.49 only",
      undefined,
    ]);
  });

  // RXP leaves a beta guide out of its menu while beta features are off
  // (`IsGuideActive` in GuideWindow.lua).
  it("marks #beta guides inactive", () => {
    expect(describeReason(preview("step", humanWarrior, "#name A\n#group G\n#beta").inactive!, humanWarrior)).toBe("Beta features only");
  });

  describe("#group choice", () => {
    const group = (header: string) => preview("step", humanWarrior, `#name A\n${header}`).tags.get("group");

    it("takes the last applying conditional #group over an earlier unconditional one", () => {
      expect(group("#group Main\n#group A1 << Alliance\n#group A2 << Human\n#group Late")).toEqual({ value: "A2", line: 3 });
    });

    it("takes the first #group when no conditional one applies", () => {
      expect(group("#group Main\n#group H << Horde\n#group Late")).toEqual({ value: "Main", line: 1 });
    });

    it("passes over a conditional #group that does not apply", () => {
      expect(group("#group H << Horde\n#group Main")).toEqual({ value: "Main", line: 2 });
    });

    it("takes a lone conditional #group that applies", () => {
      expect(group("#group A << Alliance")).toEqual({ value: "A", line: 1 });
    });
  });
});

describe("speedrunFaction", () => {
  it.each<[string, "Alliance" | "Horde" | undefined]>([
    ["RestedXP Alliance 1-20", "Alliance"],
    ["prefix RestedXP Alliance 1-20", "Alliance"],
    ["RestedXP Alliance!", "Alliance"],
    ["RestedXP Hordi RestedXP Horde", "Horde"],
    ["RestedXP Alli RestedXP Horde", "Horde"],
    ["RestedXP Allia RestedXP Horde", undefined],
    ["RestedXP HordeAlliance", undefined],
    ["Restedxp Alliance", undefined],
    ["RestedXPHorde", undefined],
    ["", undefined],
  ])("reads %j as %s", (group, side) => {
    expect(speedrunFaction(group)).toBe(side);
  });
});

describe("routes", () => {
  it("resolves duplicates to the last loaded guide but preserves the selected start", () => {
    const docs = [
      "#group G\n#name Start\n#next Copy\nstep",
      "#group G\n#name Copy\n#next Old end\nstep\n    >> Old copy",
      "#group G\n#name Copy\n#next New end\nstep\n    >> New copy\nstep",
      "#group G\n#name Old end\nstep",
      "#group G\n#name New end\nstep",
      "#group G\n#name Copy\n<< Horde\nstep",
    ].map(parseGuide);
    const result = previewRoute(docs, 0, humanWarrior);
    expect(result.guides.map((g) => g.source)).toEqual([0, 2, 4]);
    expect(result.guides[1]!.doc).toBe(docs[2]);
    expect(result.guides[1]!.shown).toBe(2);
    expect(previewRoute(docs, 1, humanWarrior).guides.map((g) => g.source)).toEqual([1, 3]);
  });

  const names = (guides: GuidePreview[]) => guides.map((g) => g.tags.get("name")?.value);
  const route = (texts: string[], profile = humanWarrior) =>
    previewRoute(
      texts.map((text) => parseGuide(`${text}\nstep`)),
      0,
      profile,
    );

  it("follows #next across groups and padded level ranges", () => {
    const result = route(["#group G\n#name 1-6 A\n#next H\\6-10 B", "#group H\n#name 06-10 B\n#next 10-12 C", "#group H\n#name 10-12 C"]);
    expect(names(result.guides)).toEqual(["1-6 A", "06-10 B", "10-12 C"]);
    expect(result.end).toEqual({ kind: "last", from: 2 });
  });

  it("takes the first offered guide and skips season mismatches", () => {
    const result = route([
      "#group G\n#name A\n#next B;C",
      "#group G\n#name B\n#xprate >1.49",
      "#group G\n#name C\n#next D",
      "#group G\n#name D\n#season 2\n#next E",
      "#group G\n#name E",
    ]);
    expect(names(result.guides)).toEqual(["A", "C", "E"]);
  });

  it("looks up names in groups that share a speedrun display name", () => {
    const result = route([
      "#group RestedXP Alliance 1-20\n#name A\n#next RestedXP Alliance 20-30\\B",
      "#group RestedXP Alliance 20-30\n#name B",
    ]);
    expect(names(result.guides)).toEqual(["A", "B"]);
    const bare = route(["#group RestedXP Alliance 1-20\n#groupid\n#name A\n#next H\\B", "#group H\n#name B"]);
    expect(names(bare.guides)).toEqual(["A", "B"]);
    const other = route(["#group G\n#name A\n#next H\\B", "#group G2\n#name B"]);
    expect(other.end).toMatchObject({ kind: "missing", next: "H\\B" });
  });

  it("runs the last listed guide when none is active, but not an internal one", () => {
    const result = route(["#group G\n#name A\n#next B;C", "#group G\n#name B\n#phase 7", "#group G\n#name C\n#xprate >1.49"]);
    expect(names(result.guides)).toEqual(["A", "C"]);
    expect(result.guides[1]!.hidden).toBeUndefined();
    expect(result.guides[1]!.inactive).toMatchObject({ name: "xprate" });
    const internal = route(["#group G\n#name A\n#next B", "#group G\n#name B\n#internal"]);
    expect(names(internal.guides)).toEqual(["A"]);
    expect(internal.end).toEqual({ kind: "missing", from: 0, next: "B", line: 2, source: 1 });
  });

  // With beta features off, `IsGuideActive` in GuideWindow.lua rejects the
  // beta guide, so RXP takes the next active entry.
  it("passes over a #beta guide in #next", () => {
    expect(names(route(["#group G\n#name A\n#next B;C", "#group G\n#name B\n#beta", "#group G\n#name C"]).guides)).toEqual(["A", "C"]);
  });

  it("swaps SoM and Era in the last name as RXP's patterns do", () => {
    const targets = ["#group G\n#name B (Era)", "#group G\n#name B (SoM)"];
    expect(names(route(["#group G\n#name A\n#next B SoM", ...targets]).guides)).toEqual(["A", "B (Era)"]);
    const somRoute = route(["#group G\n#name A\n#next B Era", ...targets], { ...humanWarrior, season: 1 });
    expect(names(somRoute.guides)).toEqual(["A", "B (SoM)"]);
    expect(route(["#group G\n#name A\n#next B (SoM)", "#group G\n#name B (Era)"]).end).toMatchObject({ kind: "missing" });
    expect(names(route(["#group G\n#name A\n#next B SoM", "#group G\n#name B SoM", "#group G\n#name B (Era)"]).guides)).toEqual([
      "A",
      "B SoM",
    ]);
  });

  it("reports a missing or looping #next from the guide that has it", () => {
    expect(route(["#group G\n#name A\n#next Z"]).end).toEqual({ kind: "missing", from: 0, next: "Z", line: 2 });
    expect(route(["#group G\n#name A\n#next B", "#group G\n#name B\n#next A"]).end).toEqual({ kind: "loop", from: 1, source: 0 });
    const skipped = route(["#group G\n#name A\n#next B", "#group G\n#name B\n#season 2\n#next Missing"]);
    expect(names(skipped.guides)).toEqual(["A"]);
    expect(skipped.end).toEqual({ kind: "missing", from: 1, next: "Missing", line: 3 });
    const back = route(["#group G\n#name A\n#next B", "#group G\n#name B\n#season 2\n#next A"]);
    expect(back.end).toEqual({ kind: "loop", from: 1, source: 0 });
  });

  it("keeps hardcore mode off after a #hardcore guide and passes over #hardcore guides", () => {
    const result = route([
      "#group G\n#name A\n#hardcore\n#next B\nstep\n#hardcore",
      "#group G\n#name B\n#next C",
      "#group G\n#name C\n#softcore\n#next D",
      "#group G\n#name D\n#hardcore\n#next E",
      "#group G\n#name E",
    ]);
    expect(names(result.guides)).toEqual(["A", "B", "C", "E"]);
    expect(result.guides[0]!.steps[0]!.shown).toBe(false);
  });
});

describe("route graph", () => {
  const graph = (headers: string[], profile = humanWarrior) =>
    routeGraph(
      headers.map((h) => parseGuide(`#group G\n${h}\nstep`)),
      profile,
    );

  it("lists the guides that lead to a guide, nearest first", () => {
    const g = graph(["#name A\n#next B", "#name B\n#next C", "#name C", "#name D\n#next C", "#name E", "#name F\n#next A"]);
    expect(g.leadingTo(2)).toEqual([
      { source: 1, distance: 1, isDefault: true },
      { source: 3, distance: 1, isDefault: true },
      { source: 0, distance: 2, isDefault: true },
      { source: 5, distance: 3, isDefault: true },
    ]);
  });

  it("marks each guide by whether its #defaultfor holds for the character", () => {
    const g = graph([
      "#name A\n#defaultfor Gnome/Dwarf\n#next E",
      "#name B\n#defaultfor Human\n#next E",
      "#name C\n#next E",
      "#name D\n#defaultfor !Warrior\n#next E",
      "#name E",
    ]);
    expect(g.leadingTo(4)).toEqual([
      { source: 0, distance: 1, isDefault: false },
      { source: 1, distance: 1, isDefault: true },
      { source: 2, distance: 1, isDefault: true },
      { source: 3, distance: 1, isDefault: false },
    ]);
  });

  it("follows the #next line that applies", () => {
    const g = graph(["#name X\n#next B << Hunter\n#next C << !Hunter", "#name B", "#name C"]);
    expect(g.next).toEqual([2, undefined, undefined]);
  });

  it("leads nowhere from a guide the loader drops", () => {
    expect(graph(["#name A\n<< Horde\n#next B", "#name B"]).leadingTo(1)).toEqual([]);
  });

  it("leads nowhere from a guide that a later one with its group and name replaces", () => {
    const g = graph(["#name A\n#next C", "#name A\n#next B", "#name B\n#next C", "#name C"]);
    expect(g.leadingTo(3)).toEqual([
      { source: 2, distance: 1, isDefault: true },
      { source: 1, distance: 2, isDefault: true },
    ]);
  });

  it("ignores a loop that does not reach the target", () => {
    const g = graph(["#name A\n#next B", "#name B\n#next A", "#name C"]);
    expect(g.leadingTo(2)).toEqual([]);
    expect(g.leadingTo(0)).toEqual([{ source: 1, distance: 1, isDefault: true }]);
  });
});

describe("walking with a changing level", () => {
  function walk(texts: string[]) {
    let level = 1;
    const guides: number[] = [];
    const shown: boolean[] = [];
    let end: RouteEnd | undefined;
    for (const event of walkRoute(texts.map(parseGuide), 0, humanWarrior, () => level)) {
      if (event.kind === "guide") guides.push(event.guide.source);
      else if (event.kind === "step") {
        shown.push(event.preview.shown);
        level++;
      } else end = event.end;
    }
    return { guides, shown, end };
  }

  it("gates each step at the level reached before it", () => {
    const steps = ["step << 5", "step\n#maxlevel 2", "step\n#maxlevel 2", "step << 5", "step << 5"];
    expect(walk([`#group G\n#name A\n${steps.join("\n")}`]).shown).toEqual([false, true, false, false, true]);
  });

  it("picks the #next alternative that fits the level reached at the guide's end", () => {
    const alternatives = ["#group G\n#name B\n#maxlevel 3\nstep", "#group G\n#name C\nstep"];
    expect(walk(["#group G\n#name A\n#next B;C\nstep\nstep", ...alternatives]).guides).toEqual([0, 1]);
    expect(walk(["#group G\n#name A\n#next B;C\nstep\nstep\nstep", ...alternatives]).guides).toEqual([0, 2]);
  });

  it("enters a guide whose header condition passes at the level reached", () => {
    const docs = ["#group G\n#name A\n#next B\nstep\nstep\nstep\nstep", "<< 5\n#group G\n#name B\nstep"];
    const atStart = createProfile({ race: "Human", class: "WARRIOR" });
    expect(previewRoute(docs.map(parseGuide), 0, atStart).end).toMatchObject({ kind: "missing" });
    expect(walk(docs)).toMatchObject({ guides: [0, 1], end: { kind: "last", from: 1 } });
  });

  it("previewRoute shows steps behind quest-state and .xp gates", () => {
    const gates = [
      ".isOnQuest 1",
      ".isNotOnQuest 1",
      ".isQuestComplete 1",
      ".isQuestNotComplete 1",
      ".isQuestTurnedIn 1",
      ".isQuestAvailable 1",
    ];
    const steps = preview([...gates, ".xp 5,1", ".xp <20,1"].map((g) => `step\n${g}`).join("\n")).steps;
    expect(steps.map((s) => s.shown)).toEqual(Array(8).fill(true));
  });
});

describe("runtime gates", () => {
  const state: GateState = {
    xp: { into: 0, toNext: 7600 },
    log: new Map([
      [7, { status: "incomplete" }],
      [783, { status: "complete" }],
    ]),
    done: new Set([33]),
    zone: { uiMapId: 1429, uiMapNamed: (token) => ({ "Elwynn Forest": 1429, Westfall: 1436 })[token] },
    hearth: 0,
  };
  function visibility(line: string) {
    for (const event of walkRoute(
      [guide(`step\n${line}`)],
      0,
      humanWarrior,
      () => 10,
      false,
      () => state,
    )) {
      if (event.kind === "step") return { shown: event.preview.shown, reason: event.preview.reason };
    }
    throw new Error(`no step for ${line}`);
  }

  it.each([
    [".maxlevel 9", ".maxlevel 10"],
    [".isOnQuest 456", ".isOnQuest 7"],
    [".isNotOnQuest 7", ".isNotOnQuest 456"],
    [".isQuestComplete 7", ".isQuestComplete 783"],
    [".isQuestNotComplete 783", ".isQuestNotComplete 7"],
    [".isQuestTurnedIn 456", ".isQuestTurnedIn 33"],
    [".isQuestAvailable 33", ".isQuestAvailable 456"],
    [".xp 10,1", ".xp 11,1"],
    [".zoneskip Elwynn Forest", ".zoneskip Westfall"],
    [".cooldown item,6948,<5m", ".cooldown item,6948,5m"],
  ])("hides a step with %s and runs one with %s", (failing, passing) => {
    const line = parseGuide(`#name T\n#group T\nstep\n${failing}`).steps[0]!.body[0] as CommandLine;
    expect(visibility(failing)).toEqual({ shown: false, reason: { kind: "command", name: line.name, args: line.args, line: 0 } });
    expect(visibility(passing)).toEqual({ shown: true, reason: undefined });
  });

  const GATES = [
    "maxlevel",
    "isOnQuest",
    "isNotOnQuest",
    "isQuestComplete",
    "isQuestNotComplete",
    "isQuestTurnedIn",
    "isQuestAvailable",
    "xp",
    "zoneskip",
    "cooldown",
  ];
  const PROFILE = ["group", "solo", "dungeon"];

  it.each([...COMMANDS.keys()].filter((name) => !GATES.includes(name) && !PROFILE.includes(name)))(
    "runs a step with a .%s line",
    (name) => {
      expect(visibility(`.${name}`)).toEqual({ shown: true, reason: undefined });
    },
  );
});

describe("dungeons that a guide group turns on or off", () => {
  const steps = "step\n.dungeon RFC\nstep\n.dungeon !RFC\nstep\n.dungeon BH";

  function results(texts: string[], dungeons: string[] = []): string[] {
    const profile = { ...humanWarrior, dungeons };
    const docs = texts.map((text) => parseGuide(text));
    const route = previewRoute(docs, 0, profile, false);
    return route.guides[0]!.steps.map((step) => (step.shown ? "shown" : describeReason(step.reason!, profile)));
  }

  it("turns every dungeon off in a #disabledungeons guide, even one the profile chose", () => {
    expect(results([`#name A\n#group G\n#disabledungeons\n${steps}`], ["RFC", "BH"])).toEqual([
      "Dungeon RFC off",
      "shown",
      "Dungeon BH off",
    ]);
  });

  it("turns a dungeon on from an .enabledungeon line in another guide of the group", () => {
    const other = "#name B\n#group G\nstep\n.enabledungeon RFC\n.enabledungeon BMH";
    expect(results([`#name A\n#group G\n#disabledungeons\n${steps}`, other])).toEqual(["shown", "Skipped with RFC on", "shown"]);
    expect(results([`#name A\n#group H\n#disabledungeons\n${steps}`, other])).toEqual(["Dungeon RFC off", "shown", "Dungeon BH off"]);
  });

  it("turns a dungeon off with .enabledungeon !, even one the profile chose", () => {
    expect(results([`#name A\n#group G\n${steps}`, "#name B\n#group G\nstep\n.enabledungeon !RFC"], ["RFC", "BH"])).toEqual([
      "Dungeon RFC off",
      "shown",
      "shown",
    ]);
  });

  it("reads only .enabledungeon lines that RXP parses for the character, and the last one wins", () => {
    const off = `#name A\n#group G\n#disabledungeons\n${steps}`;
    expect(results([off, "#name B\n#group G\nstep\n.enabledungeon RFC << Mage\nstep << Mage\n.enabledungeon BH"])).toEqual([
      "Dungeon RFC off",
      "shown",
      "Dungeon BH off",
    ]);
    expect(results([off, "<< Horde\n#name B\n#group G\nstep\n.enabledungeon RFC"])).toEqual(["Dungeon RFC off", "shown", "Dungeon BH off"]);
    expect(results([off, "#name B\n#group G\nstep\n.enabledungeon RFC", "#name C\n#group G\nstep\n.enabledungeon !RFC"])).toEqual([
      "Dungeon RFC off",
      "shown",
      "Dungeon BH off",
    ]);
  });
});

describe("bundled Westfall guide", () => {
  const source = readFileSync(join(import.meta.dirname, "../../guides/rxp-forever/Alliance-11-20.lua"), "utf8");
  const docs = extractGuides(source).map((g) => parseGuide(g.text));

  function tally(profile: Profile) {
    const westfall = previewRoute(docs, 0, profile, false).guides[0]!;
    const reasons: Record<string, number> = {};
    for (const step of westfall.steps) {
      if (step.shown) continue;
      const reason = describeReason(step.reason!, profile);
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    return { name: westfall.tags.get("name")?.value, steps: westfall.steps.length, shown: westfall.shown, reasons };
  }

  it("shows a Human Warrior the Human steps", () => {
    const result = tally(humanWarrior);
    expect(result).toMatchObject({ name: "13-15 Westfall", steps: 102, shown: 70 });
    expect(result.reasons).toMatchObject({ "Skipped for Human": 2, "Only for Rogue": 3 });
    expect(result.reasons["Only for Human"]).toBeUndefined();
  });

  it("hides the Human and Warrior steps from a Gnome Mage", () => {
    const result = tally(gnomeMage);
    expect(result).toMatchObject({ steps: 102, shown: 70 });
    expect(result.reasons).toMatchObject({ "Only for Human": 7 });
    expect(result.reasons["Skipped for Human"]).toBeUndefined();
  });
});
