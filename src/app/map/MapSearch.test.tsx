// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameData, type GameDataFile, type QuestPoint, type ZoneRecord } from "../../data/index.ts";
import { plannerContext } from "../../data/plannerFixture.ts";
import { terrainFixture } from "../../data/terrainFixture.ts";
import { StoresContext } from "../context.ts";
import { EditorNotices } from "../EditorDock.tsx";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { DraftView } from "../quests/QuestDraft.tsx";
import { saveSetting } from "../../storage/index.ts";
import { createStores } from "../stores.ts";
import { zoneData, datasetContext, questRow, withHyjalQuest, ZONES, zonePoint } from "../testing.ts";
import { renderMap, type MapOptions } from "./renderMap.tsx";

const elwynn = (x: number, y: number, from: Pick<QuestPoint, "kind" | "sourceType" | "sourceId" | "sourceName">) =>
  zonePoint(ZONES.elwynn, x, y, from);
const poster = (x: number, y: number, sourceId: number) =>
  elwynn(x, y, { kind: "start", sourceType: "object", sourceId, sourceName: "Wanted Poster" });

const hogger = questRow(176, 'Wanted: "Hogger"', {
  questLevel: 11,
  zoneIds: [ZONES.elwynn.id],
  startPoints: [poster(24.55, 74.69, 68), poster(24.57, 78.23, 156561)],
  endPoints: [elwynn(42.11, 65.93, { kind: "turn-in", sourceType: "npc", sourceId: 240, sourceName: "Marshal Dughan" })],
  objectives: [{ index: 1, type: "item", id: 1931, ids: [1931], name: "Huge Gnoll Claw" }],
  objectivePoints: [elwynn(25.78, 89.82, { kind: "item", sourceType: "item", sourceId: 1931, sourceName: "Huge Gnoll Claw" })],
});

const data = zoneData([
  hogger,
  questRow(11, "Riverpaw Gnoll Bounty", { questLevel: 10, zoneIds: [ZONES.elwynn.id] }),
  questRow(2998, "Tome of Divinity", { questLevel: 12, zoneIds: [ZONES.elwynn.id] }),
  questRow(1680, "Tormus Deepforge", { questLevel: 11, zoneIds: [ZONES.ironforge.id] }),
]);

const CAPTURE_EVIDENCE = "capture-a.json.gz#quest:4104 sha256:447762 page quest=4104";

const FOREVER_ZONES = {
  stormwind: { id: 1519, uiMapId: 1453, name: "Stormwind City", category: "city", instance: 0 },
  zephras: { id: 16593, uiMapId: 2521, name: "Zephras Isle", category: "zone", instance: 2991 },
  felwood: { id: 361, uiMapId: 1448, name: "Felwood", category: "zone", instance: 1 },
} as const satisfies Record<string, ZoneRecord>;

const foreverFile = ((): GameDataFile => {
  const felwood = (x: number, y: number, from: Pick<QuestPoint, "kind" | "sourceType" | "sourceId" | "sourceName">) =>
    zonePoint(FOREVER_ZONES.felwood, x, y, from);
  const rorian = zonePoint(FOREVER_ZONES.zephras, 42, 23.4, {
    kind: "start",
    sourceType: "npc",
    sourceId: 251361,
    sourceName: "Rorian the Dayseeker",
  });
  const giver = felwood(54.15, 86.83, { kind: "start", sourceType: "npc", sourceId: 9528, sourceName: "Arathandris Silversky" });
  const vitriol = (x: number, y: number) =>
    felwood(x, y, { kind: "item", sourceType: "item", sourceId: 11513, sourceName: "Tainted Vitriol" });
  const sourceA = { source: "source-a" } as const;
  return {
    source: { name: "test", version: "0", pack: "forever" },
    maxLevel: 60,
    zones: Object.values(FOREVER_ZONES),
    continents: [
      {
        instance: 1,
        uiMapId: 1414,
        name: "Kalimdor",
        crop: { left: 24.3513, top: 0, width: 50, height: 100 },
        hitGrid: { width: 1, height: 1, alphabet: "0", zoneIds: [0], rows: ["0"] },
      },
    ],
    npcNames: {},
    sources: [
      {
        source: "source-a",
        pins: { "capture-a.json.gz": "sha256:aaa" },
        derivedFrom: [{ source: "source-c", edition: "forever", pins: { "QuestV2.csv": "sha256:bbb" } }],
      },
      { source: "source-b", pins: { revision: "ccc" } },
      { source: "recorder:forever", pins: { session: "test" } },
    ],
    quests: [
      questRow(92461, "Harmony in Balance", {
        startPoints: [rorian],
        provenance: { fields: { name: sourceA } },
      }),
      questRow(93963, "Exploring the Alliance"),
      questRow(4104, "Salve via Mining", {
        startPoints: [giver],
        objectives: [{ index: 1, type: "item", id: 11513, ids: [11513], name: "Tainted Vitriol" }],
        objectivePoints: [vitriol(34.69, 61.76), vitriol(47.84, 14.2), vitriol(44.74, 12.34)],
        capturedObjectives: [{ text: "4Tainted Vitriol (4)", quantity: 4, links: [{ type: "item", id: 11513 }] }],
        provenance: {
          fields: {
            name: sourceA,
            questLevel: sourceA,
            baseXp: sourceA,
            capturedObjectives: sourceA,
            startPoints: { source: "source-b" },
            objectives: { source: "source-b", reason: "Seen in game" },
            objectivePoints: { source: "source-b" },
          },
          evidence: { "source-a": [CAPTURE_EVIDENCE] },
        },
      }),
      questRow(76160, "Stalk With The Earthmother", {
        changes: { status: "updated", labels: ["level_changed", "objectives_changed"], lines: ["Objectives: adds Windfury Cone x8"] },
        capturedObjectives: [
          { text: "Pine Salve (1)", quantity: 1, links: [{ type: "item", id: 206175 }] },
          { text: "8Windfury Cone (8)", quantity: 8, links: [{ type: "item", id: 206170 }] },
          { text: "Mortar and Pestle (1)", quantity: 1, links: [{ type: "item", id: 206176 }] },
        ],
        capturedObjectiveText: { text: "Gather 8", limitation: "text-nodes-before-first-element" },
        provenance: { fields: { name: sourceA, changes: sourceA, capturedObjectives: sourceA, capturedObjectiveText: sourceA } },
      }),
      questRow(2, "Sharptalon's Claw", {
        questLevel: 30,
        provenance: {
          fields: {
            name: { source: "recorder:forever" },
            questLevel: { source: "recorder:forever" },
            objectives: { source: "recorder:forever" },
          },
          evidence: { "recorder:forever": ["session 1"] },
        },
      }),
    ],
  };
})();
const SOURCE_NAMES = { "source-a": { name: "Source A" }, "source-b": { name: "Source B" }, "source-c": { name: "Source C" } };
const forever = new GameData(foreverFile, { ...plannerContext, sources: SOURCE_NAMES });

beforeEach(async () => {
  localStorage.clear();
  await saveSetting("layout", {});
  await saveSetting("preview", DEFAULT_SETTINGS);
});

afterEach(() => cleanup());

const GUIDE = "#group T\n#name One\nstep\n    .xp 10\n";

async function mount(text?: string, game = data, options: Partial<MapOptions> = {}) {
  const mounted = await renderMap({ data: game, texts: text === undefined ? [] : [text], ...options });
  await openSearch(mounted.user);
  return mounted;
}

function mountDraft(game: GameData, id: number, text?: string) {
  const stores = createStores(
    text === undefined ? undefined : { guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: null } },
  );
  const view = render(
    <StoresContext.Provider value={stores}>
      <DraftView data={game} quest={game.quest(id, "Alliance")!} />
    </StoresContext.Provider>,
  );
  return { user: userEvent.setup(), ...view };
}

const panel = () => screen.getByRole("region", { name: "Search" });
const field = () => screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" });
const HINT = "Search by name or ID, or choose a zone or levels under Filters.";

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Search" }));
  await within(panel()).findByText(HINT);
}

async function choose(user: ReturnType<typeof userEvent.setup>, query: string, name: RegExp) {
  await user.type(field(), query);
  await user.click(await within(panel()).findByRole("button", { name }));
}

const questNames = () =>
  within(within(panel()).getByRole("list", { name: "Quests" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".search-name")!.textContent);

const fieldSources = () =>
  within(screen.getByRole("list", { name: "Field sources" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("summary")!.textContent.trim());

describe("map search", () => {
  it.each([
    ["community:era", undefined],
    ["offline-catalog", "Local catalog"],
    ["toString:era", undefined],
    ["constructor", "Constructor catalog"],
    ["toString", "String catalog"],
    ["__proto__", "Prototype catalog"],
    ["questie:era", "Local Era catalog"],
  ] as const)("displays independent source %s offline with its provenance intact", async (source, name) => {
    const context = datasetContext(terrainFixture);
    context.sources = { ...(name && { [source]: { name } }), community: { name: "Community archive" } };
    const label = name ?? source;
    const game = zoneData(
      [
        {
          ...hogger,
          objectives: [],
          provenance: { fields: { name: { source }, objectives: { source } }, evidence: { [source]: ["local capture"] } },
        },
      ],
      {
        sources: [{ source, pins: { revision: "abc" }, derivedFrom: [{ source: "community", edition: "era", pins: { revision: "old" } }] }],
      },
      context,
    );
    const { user } = mountDraft(game, 176);
    await user.click(screen.getByText(`Sources: ${label}`));
    const groups = screen.getByRole("list", { name: "Field sources" });
    expect(groups.querySelector("summary")!.textContent.trim()).toBe(`${label}: name, objectives`);
    expect([...groups.querySelectorAll("dt, dd")].map((e) => e.textContent)).toEqual([
      "Source",
      source,
      "Evidence",
      "local capture",
      "Pins",
      "revision abc",
      "Derived from Community archive",
      "revision old",
    ]);
    expect(screen.getByText(`${label} gives no numbered objectives for this quest, so no .complete lines can be drafted.`)).toBeTruthy();
  });

  it("drafts only the commands for a quest without points", async () => {
    const { user, stores } = await mount(GUIDE, forever);
    await choose(user, "93963", /Exploring the Alliance/);
    expect(within(panel()).getByText("This data bundle does not record where each field came from.")).toBeTruthy();
    expect(within(panel()).getByLabelText("Accept at").textContent).toBe("No mapped location in the data");
    await user.click(within(panel()).getByRole("button", { name: "Insert 2 steps after step 1" }));
    expect(stores.editor.getState().current!.record.text).toBe(`${GUIDE}step\n    .accept 93963\nstep\n    .turnin 93963\n`);
  });

  it("names a point's own map, not its zone's", () => {
    mountDraft(withHyjalQuest(forever), 4005);
    expect(screen.getByLabelText("Accept step text").textContent).toBe("step\n.goto 2482,11.17,99.17\n.accept 4005");
  });

  it("drafts accept, objective, and turn-in steps in the open guide's indent", () => {
    mountDraft(data, 176, GUIDE);
    expect(screen.getByLabelText("Accept step text").textContent).toBe("step\n    .goto Elwynn Forest,24.55,74.69\n    .accept 176");
    expect(screen.getByLabelText("Objectives step text").textContent).toBe(
      "step\n    .goto Elwynn Forest,25.78,89.82\n    .complete 176,1",
    );
    expect(screen.getByLabelText("Turn in step text").textContent).toBe("step\n    .goto Elwynn Forest,42.11,65.93\n    .turnin 176");
  });

  it("inserts the chosen steps after the selected step and selects the first", async () => {
    const { user, stores } = await mount(`${GUIDE}step\n    .xp 11\n`);
    await choose(user, "176", /Wanted: "Hogger"/);
    await user.selectOptions(within(panel()).getByLabelText("Accept at"), "1");
    await user.click(within(panel()).getByRole("checkbox", { name: "Objectives" }));
    await user.click(within(panel()).getByRole("button", { name: "Insert 2 steps after step 1" }));
    expect(within(panel()).getByRole("status").textContent).toBe("Inserted 2 steps after step 1.");

    const { current, selection } = stores.editor.getState();
    expect(current!.record.text).toBe(
      GUIDE +
        "step\n    .goto Elwynn Forest,24.57,78.23\n    .accept 176\n" +
        "step\n    .goto Elwynn Forest,42.11,65.93\n    .turnin 176\n" +
        "step\n    .xp 11\n",
    );
    expect(selection).toEqual({ step: 1, line: null });
  });

  it("opens a built-in's existing copy on Insert, changes nothing, and leaves the notice to the editor notices", async () => {
    const copy = "#group T (custom)\n#name One\nstep\n    .xp 10\n";
    const { user, stores } = await mount(copy, data, {
      builtins: { version: "v9.9.9", guides: [{ id: "rxp:t.lua#1", text: GUIDE, order: 0, fileName: "t.lua" }] },
    });
    render(
      <StoresContext.Provider value={stores}>
        <EditorNotices />
      </StoresContext.Provider>,
    );
    await choose(user, "176", /Wanted: "Hogger"/);
    await user.click(within(panel()).getByRole("button", { name: "Insert 3 steps after step 1" }));
    expect(within(panel()).queryByRole("status")).toBeNull();
    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(screen.getByText("Opened your copy in “T (custom)”. Make the change there.")).toBeTruthy();
    const { current } = stores.editor.getState();
    expect([current!.id, current!.record.text]).toEqual(["g0", copy]);
  });

  it("lists a zone's quests without a query, and narrows them by level", async () => {
    const { user } = await mount(GUIDE);
    await user.click(within(panel()).getByText("Filters"));
    await user.selectOptions(within(panel()).getByLabelText("Zone"), "12");
    expect(questNames()).toEqual(["Riverpaw Gnoll Bounty", 'Wanted: "Hogger"', "Tome of Divinity"]);
    await user.type(within(panel()).getByLabelText("Minimum quest level"), "11");
    await user.type(within(panel()).getByLabelText("Maximum quest level"), "11");
    expect(questNames()).toEqual(['Wanted: "Hogger"']);
    expect(within(panel()).getByText("Levels apply to quests only, so only quests show.")).toBeTruthy();
    expect(within(panel()).getByText("Filters").textContent.trim()).toBe("Filters · Elwynn Forest · levels 11–11");
  });

  it("names each field's source and edition", async () => {
    const { user, container } = mountDraft(forever, 4104);
    await user.click(screen.getByText("Sources: Source A, Source B"));
    expect(fieldSources()).toEqual([
      "Source A: name, level, captured objective rows, experience",
      "Source B: starts, objectives (Seen in game), objective locations",
    ]);
    const groups = screen.getByRole("list", { name: "Field sources" });
    const first = within(groups).getAllByRole("listitem")[0]!;
    expect([...first.querySelectorAll("dt, dd")].map((e) => e.textContent)).toEqual([
      "Source",
      "source-a",
      "Evidence",
      CAPTURE_EVIDENCE,
      "Pins",
      "capture-a.json.gz sha256:aaa",
      "Derived from Source C",
      "QuestV2.csv sha256:bbb",
    ]);
    expect(screen.getByLabelText("Objectives step text").textContent).toMatch(/\.complete 4104,1$/);
    expect(container.textContent).not.toMatch(/fallback|verified/i);
  });

  it("explains why a normalized quest has no objective step", () => {
    mountDraft(forever, 76160);
    expect(
      screen.getByRole("checkbox", {
        name: "Objectives",
        description:
          "No source gives this quest's numbered objectives, so no .complete lines can be drafted. " +
          "Source A says the objectives changed, so the old layout is left out.",
      }),
    ).toHaveProperty("disabled", true);
    const rows = screen.getByRole("list", { name: "Captured objective rows" });
    expect(
      within(rows)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Pine Salve (1)", "8Windfury Cone (8)", "Mortar and Pestle (1)"]);
    expect(screen.getByText(/^Objective text from Source A, .* may be partial:/).textContent).toMatch(/Gather 8$/);
    cleanup();

    mountDraft(forever, 2);
    expect(
      screen.getByRole("checkbox", {
        name: "Objectives",
        description: "Recorder Forever gives no numbered objectives for this quest, so no .complete lines can be drafted.",
      }),
    ).toHaveProperty("disabled", true);
    expect(screen.queryByRole("list", { name: "Captured objective rows" })).toBeNull();
  });

  it("offers no objective step when the data does not number the objectives", () => {
    const game = zoneData([{ ...hogger, objectives: hogger.objectives.map(({ index: _, ...o }) => o) }]);
    mountDraft(game, 176, GUIDE);
    const objectives = screen.getByRole("checkbox", {
      name: "Objectives",
      description: "The data does not number every objective; add .complete lines by hand.",
    });
    expect([objectives.hasAttribute("disabled"), (objectives as HTMLInputElement).checked]).toEqual([true, false]);
    expect(screen.queryByLabelText("Objectives step text")).toBeNull();
    expect(screen.getByRole("button", { name: "Insert 2 steps after step 1" })).toBeTruthy();
  });

  it("keeps the search and the draft through a close and a guide opening", async () => {
    const { user, stores } = await mount();
    await choose(user, "176", /Wanted: "Hogger"/);
    await user.click(within(panel()).getByRole("checkbox", { name: "Objectives" }));

    await user.click(screen.getByRole("heading", { name: "Map" }));
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull();
    act(() => void stores.editor.createGuide("T", "New guide"));
    expect(screen.getByRole("combobox", { name: "Map shown" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(within(panel()).getByRole("checkbox", { name: "Objectives" })).toHaveProperty("checked", false);
    await user.click(within(panel()).getByRole("button", { name: "Back to results" }));
    expect(document.activeElement).toBe(field());
    expect(field()).toHaveProperty("value", "176");
  });

  it("moves focus through the panel, closes on Escape to its button, and closes when focus leaves", async () => {
    const { user } = await mount(GUIDE);
    expect(document.activeElement).toBe(field());
    await user.type(field(), "176");
    await user.tab();
    expect(document.activeElement).toBe(within(panel()).getByText("Filters"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search" }));

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(field()).toHaveProperty("value", "176");
    await user.tab({ shift: true });
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull();
  });

  it("counts each group, shows its first rows, and shows more on request", async () => {
    const many = zoneData(ELWYNN_QUESTS.map(([id, name, questLevel]) => questRow(id, name, { questLevel, zoneIds: [ZONES.elwynn.id] })));
    const { user } = await mount(GUIDE, many);
    await user.click(within(panel()).getByText("Filters"));
    await user.selectOptions(within(panel()).getByLabelText("Zone"), "12");
    expect(within(panel()).getByRole("heading", { name: "Quests 101" })).toBeTruthy();
    expect(within(panel()).getByRole("status").textContent).toBe("101 Quests");
    expect(questNames()).toHaveLength(8);
    await user.click(within(panel()).getByRole("button", { name: "Show 100 of 101" }));
    expect(questNames()).toHaveLength(100);
    expect(within(panel()).getByText("Showing 100 of 101. Narrow the search to see the rest.")).toBeTruthy();
  });

  it("links each result and the chosen quest to Wowhead without choosing it", async () => {
    const { user } = await mount(GUIDE);
    await user.type(field(), "176");
    const link = within(panel()).getByRole("link", { name: /Hogger" on Wowhead$/ });
    expect(link.getAttribute("href")).toBe("https://www.wowhead.com/forever/quest=176");
    expect(link.closest("button")).toBeNull();
    link.addEventListener("click", (e) => e.preventDefault());
    await user.click(link);
    expect(within(panel()).queryByRole("button", { name: "Back to results" })).toBeNull();

    await user.click(within(panel()).getByRole("button", { name: /Wanted: "Hogger"/ }));
    expect(
      within(panel())
        .getByRole("link", { name: /Hogger"$/ })
        .getAttribute("href"),
    ).toBe("https://www.wowhead.com/forever/quest=176");
  });
});

const ELWYNN_QUESTS: [number, string, number][] = [
  [6, "Bounty on Garrick Padfoot", 5],
  [7, "Kobold Camp Cleanup", 2],
  [11, "Riverpaw Gnoll Bounty", 10],
  [15, "Investigate Echo Ridge", 3],
  [16, "Give Gerard a Drink", 1],
  [18, "Brotherhood of Thieves", 4],
  [21, "Skirmish at Echo Ridge", 5],
  [33, "Wolves Across the Border", 2],
  [35, "Further Concerns", 10],
  [37, "Find the Lost Guards", 10],
  [39, "Deliver Thomas' Report", 10],
  [40, "A Fishy Peril", 10],
  [45, "Discover Rolf's Fate", 10],
  [46, "Bounty on Murlocs", 10],
  [47, "Gold Dust Exchange", 7],
  [52, "Protect the Frontier", 10],
  [54, "Report to Goldshire", 5],
  [59, "Cloth and Leather Armor", 10],
  [60, "Kobold Candles", 7],
  [61, "Shipment to Stormwind", 7],
  [62, "The Fargodeep Mine", 7],
  [71, "Report to Thomas", 10],
  [76, "The Jasperlode Mine", 10],
  [83, "Red Linen Goods", 9],
  [84, "Back to Billy", 6],
  [85, "Lost Necklace", 6],
  [86, "Pie for Billy", 6],
  [87, "Goldtooth", 8],
  [88, "Princess Must Die!", 9],
  [106, "Young Lovers", 6],
  [107, "Note to William", 6],
  [109, "Report to Gryan Stoutmantle", 10],
  [111, "Speak with Gramma", 6],
  [112, "Collecting Kelp", 7],
  [114, "The Escape", 7],
  [123, "The Collector", 10],
  [147, "Manhunt", 10],
  [176, 'WANTED: "Hogger"', 11],
  [239, "Westbrook Garrison Needs Help!", 10],
  [783, "A Threat Within", 1],
  [1598, "The Stolen Tome", 4],
  [1667, "Dead-tooth Jack", 10],
  [2158, "Rest and Relaxation", 5],
  [3100, "Simple Letter", 1],
  [3101, "Consecrated Letter", 1],
  [3102, "Encrypted Letter", 1],
  [3103, "Hallowed Letter", 1],
  [3104, "Glyphic Letter", 1],
  [3105, "Tainted Letter", 1],
  [3903, "Milly Osworth", 4],
  [3904, "Milly's Harvest", 4],
  [3905, "Grape Manifest", 4],
  [5261, "Eagan Peltskinner", 2],
  [5545, "A Bundle of Trouble", 9],
  [5623, "In Favor of the Light", 4],
  [5624, "Garments of the Light", 4],
  [7937, "Your Fortune Awaits You...", 60],
  [8649, "Stormbrow the Elder", 60],
  [77620, "Spell Research", 2],
  [91723, "Delicate Instruments", 10],
  [91724, "Delicate Instruments", 10],
  [91725, "Stolen Enchanting Supplies", 10],
  [91732, "Good Steel", 10],
  [91733, "Downstream", 10],
  [91736, "Applejack Still", 0],
  [91738, "An Apple Treat", 10],
  [91740, "Croaky's Head", 10],
  [91741, "Nibbled-On Book", 2],
  [91743, "Rascally Rodents", 2],
  [91745, "Mining Consultant", 3],
  [91746, "Elmpaw's Head", 10],
  [91751, "Rough Wolf Pelts", 7],
  [91752, "The Big Picture", 3],
  [91753, "An Enchanting Lesson", 7],
  [91758, "Follow That Kobold!", 4],
  [91772, "Shhh! We're Hunting Kobolds", 4],
  [91775, "Book Return", 6],
  [91777, "Rare Books", 7],
  [92124, "Book Inventory", 2],
  [92479, "A Scribbled Letter", 1],
  [94792, "Taming the Beast", 10],
  [94793, "Training the Beast", 10],
  [94863, "Taming the Beast", 10],
  [94864, "Taming the Beast", 10],
  [95998, "The Great Outdoors", 6],
  [96626, "Camping 101: Cooking", 6],
  [96627, "The Adventurer", 6],
  [97915, "Camping 101: Alchemy", 6],
  [97916, "Camping 101: Blacksmithing", 6],
  [97919, "Camping 101: First Aid", 6],
  [97920, "Camping 101: Fishing", 6],
  [97921, "Camping 101: Herbalism", 6],
  [97922, "Camping 101: Leatherworking", 6],
  [97924, "Camping 101: Skinning", 6],
  [97925, "Camping 101: Tailoring", 6],
  [99127, "A Net Disaster", 7],
  [99128, "Slimy Menace", 7],
  [99129, "A Man About a Murloc", 7],
  [99130, "An Enticing Offer", 7],
  [99131, "Baited for Success", 7],
  [99143, "Bottles and Baubles", 7],
];
