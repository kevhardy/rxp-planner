// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { GameData, type EntityIndex } from "../../data/index.ts";
import { plannerContext, plannerData, plannerFile, plannerNames } from "../../data/plannerFixture.ts";
import { EntityIndex as FinishedEntities } from "../../data/entities.ts";
import { insertLine, parseLine, type BodyLine } from "../../guide/index.ts";
import { BUILTIN_PATH, decodeBuiltins, type Builtins } from "../../io/builtin.ts";
import { questAccess, type RouteView, type SimData, type StartLevel } from "../../rules/index.ts";
import { loadLibrary, loadSetting, saveLibrary, saveSetting, type StoredLibrary } from "../../storage/index.ts";
import { renderPlanner, unrelatedEntities } from "../renderPlanner.tsx";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { changeRawDraft, hasRawDraft } from "../drafts.ts";
import { testRules } from "../../rules/testing.ts";
import { guideMeta } from "../../rules/registration.ts";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";
import { DEFAULT_LAYOUT } from "../layout.ts";
import { usePlaybackRoute, useRoute, useSimData } from "./route.ts";
import { DEFAULT_SETTINGS, loadPreviewSettings, readSettings, useFaction, usePreviewSettings } from "./settings.ts";
import { WarningsPanel } from "./WarningsPanel.tsx";

const root = join(import.meta.dirname, "../../..");

// jsdom's Blob has no stream(), which built-in guide decoding needs.
globalThis.Blob = NodeBlob as typeof Blob;

let data: GameData;

beforeAll(async () => {
  data = plannerData();
});

beforeEach(async () => {
  localStorage.clear();
  const { guides } = await loadLibrary();
  await saveLibrary(
    [],
    guides.map((g) => g.id),
    { guideId: null, step: null, line: null },
  );
  await saveSetting("preview", DEFAULT_SETTINGS);
  await saveSetting("layout", DEFAULT_LAYOUT);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(
  texts: string[],
  open: string,
  builtins: Builtins | null = null,
  loaded?: { data: GameData; entities: EntityIndex },
  game = data,
) {
  const guides = texts.map((text, i) => ({ id: `g${i}`, text, order: i }));
  const guideId = builtins ? open : guides.find((g) => guideMeta(g).name === open)!.id;
  await saveLibrary(guides, [], { guideId, step: 0, line: null });
  const { user } = await renderPlanner({
    initial: await loadLibrary(),
    builtins,
    loadGameData: () => Promise.resolve(loaded?.data ?? game),
    loadEntities: () => Promise.resolve(loaded?.entities ?? unrelatedEntities),
  });
  return { user };
}

async function character(user: UserEvent) {
  const button = screen.getByRole("button", { name: /^Preview as / });
  if (button.getAttribute("aria-expanded") !== "true") await user.click(button);
  return screen.getByRole("region", { name: "Character preview" });
}

const routeBar = () => screen.getByRole("region", { name: "Route" });
const startSettings = () => within(routeBar()).getByRole("button", { name: /^Start settings/ });

async function startPanel(user: UserEvent) {
  if (startSettings().getAttribute("aria-expanded") !== "true") await user.click(startSettings());
  return screen.getByRole("region", { name: "Route start" });
}

async function warnings(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: /^Warnings(, \d+)?$/, expanded: false }));
  return screen.getByRole("region", { name: "Warnings" });
}

function stepStatus(index: number): string {
  const row = document.getElementById(`step-${index}`)!;
  return row.querySelector(".step-skip")?.textContent?.replace(/^Skipped · /, "") ?? "shown";
}

const bundledBuiltins = () => decodeBuiltins(new Uint8Array(readFileSync(join(root, "public", BUILTIN_PATH))));

const guideCards = () =>
  within(screen.getByRole("toolbar", { name: "Guides on the route" })).getAllByRole("button", { name: /, guide \d+ of \d+/ });

const routeNames = () => guideCards().map((card) => /^(.*), guide \d+ of/.exec(card.getAttribute("aria-label")!)![1]);

const startCard = () => [guideCards()[0]!.getAttribute("aria-label"), startSettings().getAttribute("aria-label")];

describe("integrated planner", () => {
  it("applies the saved character on the first render", async () => {
    await saveSetting("preview", { ...DEFAULT_SETTINGS, class: "MAGE" });
    const text = "#name A\n#group G\nstep << Warrior\n    >> Warrior only\nstep << Mage\n    >> Mage only\n";
    await renderPlanner({
      initial: { guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: null } },
      loadGameData: () => new Promise<GameData>(() => {}),
    });
    expect(screen.getByRole("button", { name: "Preview as Human Mage · AH" })).toBeTruthy();
    expect(stepStatus(0)).toBe("Only for Warrior");
    expect(stepStatus(1)).toBe("shown");
  });

  it("keeps the map mounted while changing preview, folds, the library, and overlays", async () => {
    const { user } = await mount(
      ["#name Integration\n#group G\nstep\n    .goto Elwynn Forest,48,42\nstep << Mage\n    >> Mage only\n"],
      "Integration",
    );
    screen.getByRole("listbox", { name: "Steps of Integration" });
    const map = screen.getByRole("region", { name: "Map" });
    await within(map).findByRole("button", { name: "Zoom in" });
    await waitFor(() => expect(map.querySelector(".map-stage img")).toBeTruthy());
    const skipped = screen.getByRole("button", { name: "Show skipped steps" });
    await user.click(skipped);
    expect(skipped.getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("step-1")!.classList).not.toContain("collapsed");

    await user.click(within(map).getByRole("button", { name: "Search" }));
    within(map).getByRole("region", { name: "Search" });
    await warnings(user);
    await user.keyboard("{Escape}");

    const library = screen.getByRole("button", { name: "Library" });
    await user.click(library);
    expect(library.getAttribute("aria-expanded")).toBe("true");
    await character(user);
    expect(screen.getByLabelText("Race")).toBe(document.activeElement);
    expect(screen.getByRole("region", { name: "Map" })).toBe(map);
    expect(map.closest(".editor-workspace")).toBeTruthy();
    expect(map.querySelector(".map-stage img")).toBeTruthy();
    expect(document.querySelector("[title]")).toBeNull();
  });
});

describe("step filter", () => {
  it("keeps the character across reloads", async () => {
    const guide = "#name One\n#group G\nstep\n.accept 1\n";
    const { user } = await mount([guide], "One");
    const bar = await character(user);
    await user.selectOptions(within(bar).getByLabelText("Class"), "ROGUE");
    await user.selectOptions(within(routeBar()).getByLabelText("Start level"), "20");
    cleanup();
    const again = await character((await mount([guide], "One")).user);
    await expect.poll(() => within(again).getByLabelText<HTMLSelectElement>("Class").value).toBe("ROGUE");
    expect(within(routeBar()).getByLabelText<HTMLSelectElement>("Start level").value).toBe("20");
  });
});

describe("Preview as", () => {
  const guide = "#name A\n#group G\nstep\n    .accept 7\n";

  it("reads a saved level 1 with 0 XP as Auto and keeps other saved levels fixed", async () => {
    for (const [saved, startLevel] of [
      [{ level: 1, xp: 0 }, "auto"],
      [
        { level: 5, xp: 0 },
        { level: 5, xp: 0 },
      ],
      [
        { level: 1, xp: 200 },
        { level: 1, xp: 200 },
      ],
      [{ level: 5 }, { level: 5, xp: 0 }],
      [
        { level: 5, xp: 1.5 },
        { level: 5, xp: 0 },
      ],
      [{}, "auto"],
      [
        { startLevel: { level: 1, xp: 0 }, level: 7 },
        { level: 1, xp: 0 },
      ],
      [{ startLevel: "auto", level: 7, xp: 9 }, "auto"],
      [{ startLevel: { level: 61, xp: 0 } }, "auto"],
      [{ startLevel: { level: 5, xp: -1 } }, { level: 5, xp: 0 }],
    ] as const) {
      expect(readSettings(saved).startLevel, JSON.stringify(saved)).toEqual(startLevel);
    }
    createStores().preview.update({ startLevel: { level: 1, xp: 0 } });
    await vi.waitFor(async () => expect(await loadSetting("preview")).toMatchObject({ startLevel: { level: 1, xp: 0 } }));
    expect((await loadPreviewSettings()).startLevel).toEqual({ level: 1, xp: 0 });
  });

  it("copies a built-in into the group its own range gives under Auto", () => {
    const text = "#name 12-14 Ranged\n#group Low\n#group High << 12\nstep\n    .accept 7\n";
    const groupOfCopy = (startLevel: StartLevel) => {
      const builtins = { version: "v1", guides: [{ id: "rxp:t#1", text, order: 0, fileName: "t.lua" }] };
      const stores = createStores({ guides: [], session: { guideId: "rxp:t#1", step: 0, line: null } }, builtins, {
        ...DEFAULT_SAVED_SETTINGS,
        preview: { ...DEFAULT_SETTINGS, startLevel },
      });
      stores.editor.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine("    >> Note") as BodyLine));
      return guideMeta(stores.editor.getState().current!.record).group;
    };
    expect(groupOfCopy("auto")).toBe("High (custom)");
    expect(groupOfCopy({ level: 1, xp: 0 })).toBe("Low (custom)");
  });

  it("keeps a fixed start XP within the level", () => {
    for (const [level, xp, read] of [
      [5, 2799, 2799],
      [5, 2800, 0],
      [60, 1, 0],
    ] as const) {
      const store = createStores().preview;
      store.update({ startLevel: { level, xp } });
      store.setGame({ raceClasses: undefined, rules: testRules });
      expect(store.getState().startLevel).toEqual({ level, xp: read });
    }
    const store = createStores().preview;
    store.setGame({ raceClasses: undefined, rules: testRules });
    store.update({ startLevel: { level: 5, xp: 2000 } });
    store.update({ startLevel: { level: 1, xp: 2000 } });
    expect(store.getState().startLevel).toEqual({ level: 1, xp: 399 });
  });

  it("shows each Skyborne race's side of the steps, and keeps the race and class across reloads", async () => {
    const text = "#name Sky\n#group G\nstep << Skyborne Alliance\nstep << Skyborne Horde\nstep << Human\n";
    const { user } = await mount([text], "Sky");
    const popover = await character(user);
    const race = within(popover).getByLabelText("Race") as HTMLSelectElement;
    const steps = async () => {
      for (let fold; (fold = document.querySelector(".fold-toggle[aria-expanded=false]"));) await user.click(fold);
      return [0, 1, 2].map(stepStatus);
    };

    await user.selectOptions(within(popover).getByLabelText("Class"), "PALADIN");
    await user.selectOptions(race, "HighOrder");
    expect(await steps()).toEqual(["shown", "Only for Horde", "Only for Human"]);

    await character(user);
    await user.selectOptions(within(popover).getByLabelText("Class"), "MAGE");
    await user.selectOptions(race, "Windshaper");
    expect(await steps()).toEqual(["Only for Alliance", "shown", "Only for Human"]);

    await character(user);
    await user.selectOptions(within(popover).getByLabelText("Class"), "SHAMAN");
    cleanup();
    const again = await character((await mount([text], "Sky")).user);
    await expect.poll(() => within(again).getByLabelText<HTMLSelectElement>("Race").value).toBe("Windshaper");
    expect(within(again).getByLabelText<HTMLSelectElement>("Class").value).toBe("SHAMAN");
  });

  it("loads a saved pair the dataset allows unchanged, and a class the race cannot be as Warrior", async () => {
    const loaded = async (classes: string[]) => {
      const cls = within(await character(userEvent.setup())).getByLabelText("Class") as HTMLSelectElement;
      await expect.poll(() => [...cls.options].map((o) => o.value)).toEqual(classes);
      return screen.getByRole("button", { name: /^Preview as / }).textContent;
    };
    await saveSetting("preview", { ...DEFAULT_SETTINGS, race: "Dwarf", class: "SHAMAN", startLevel: { level: 12, xp: 0 } });
    await mount([guide], "A");
    expect(await loaded(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN"])).toBe("Preview as Dwarf Shaman · AH");
    cleanup();
    await saveSetting("preview", { ...DEFAULT_SETTINGS, race: "Tauren", class: "MAGE", startLevel: { level: 12, xp: 0 } });
    await mount([guide], "A");
    expect(await loaded(["WARRIOR", "HUNTER", "SHAMAN", "DRUID"])).toBe("Preview as Tauren Warrior · AH");
    expect(readSettings({ race: "Skyborne", class: "MAGE" })).toMatchObject({ race: "Human", class: "MAGE" });
    const store = createStores().preview;
    store.setGame(data);
    store.update({ class: "SHAMAN", race: "Orc" });
    store.update({ race: "HighOrder" });
    expect(store.getState()).toMatchObject({ race: "HighOrder", class: "WARRIOR" });
  });

  it("checks the saved class against each dataset that loads", async () => {
    const file = plannerFile();
    const tauren = "6";
    const mage = 8;
    const raceClasses = { ...file.raceClasses, [tauren]: [...file.raceClasses![tauren]!, mage].sort((a, b) => a - b) };
    const mageTauren = new GameData({ ...file, raceClasses }, plannerContext);
    const games = [mageTauren, data];
    await saveSetting("preview", { ...DEFAULT_SETTINGS, race: "Tauren", class: "MAGE" });
    const { stores } = await renderPlanner({ initial: { guides: [] }, loadGameData: async () => games.shift()! });
    const cls = within(await character(userEvent.setup())).getByLabelText("Class") as HTMLSelectElement;
    await expect.poll(() => [...cls.options].map((o) => o.value)).toEqual(["WARRIOR", "HUNTER", "SHAMAN", "MAGE", "DRUID"]);
    const previewAs = () => screen.getByRole("button", { name: /^Preview as / }).textContent;
    expect(previewAs()).toBe("Preview as Tauren Mage · AH");
    act(() => stores.dataset.select({ manifest: "/other/manifest.json", base: "/other/" }));
    await expect.poll(previewAs).toBe("Preview as Tauren Warrior · AH");
  });

  it("gives the faction view, the route character, and quest access the Skyborne race's faction", () => {
    const text = "#name Sky\n#group G\nstep\n    .accept 93963\n";
    const stores = createStores({ guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: null } });
    function Probe() {
      const sim = useSimData(usePreviewSettings());
      const profile = useRoute(true)?.profile;
      const state = { level: 10, log: new Map(), done: new Set<number>() };
      const open = (id: number) => (sim && profile ? !questAccess(sim.quest(id)!, state, profile, sim).excluded : null);
      return <output>{[useFaction(), profile?.faction, open(93963), open(94013)].join(" ")}</output>;
    }
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={data}>
          <EntityContext.Provider value={unrelatedEntities}>
            <Probe />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    const probe = screen.getByRole("status");
    act(() => stores.preview.update({ race: "HighOrder", class: "HUNTER" }));
    expect(probe.textContent).toBe("Alliance Alliance true true");
    act(() => stores.preview.update({ race: "Windshaper" }));
    expect(probe.textContent).toBe("Horde Horde false true");
    act(() => stores.preview.update({ race: "Orc" }));
    expect(probe.textContent).toBe("Horde Horde false false");
  });

  it("keeps the simulator's data and the route while their inputs stay, and builds both again for new names or another faction", () => {
    const text = "#name Sim\n#group G\nstep\n    .accept 830\n";
    const stores = createStores({ guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: null } });
    const seen: { sim: SimData | undefined; route: RouteView | null }[] = [];
    function Probe() {
      seen.push({ sim: useSimData(usePreviewSettings()), route: useRoute() });
      return null;
    }
    const app = (entities: EntityIndex) => (
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={data}>
          <EntityContext.Provider value={entities}>
            <Probe />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>
    );
    const { rerender } = render(app(unrelatedEntities));
    const first = seen.at(-1)!;
    rerender(app(unrelatedEntities));
    expect(seen.at(-1)!.sim).toBe(first.sim);
    expect(seen.at(-1)!.route).toBe(first.route);
    const names = new FinishedEntities(plannerNames);
    rerender(app(names));
    const renamed = seen.at(-1)!;
    expect([renamed.sim === first.sim, renamed.route === first.route]).toEqual([false, false]);
    expect([first.sim!.entityByName("Hogger"), renamed.sim!.entityByName("Hogger")]).toEqual([undefined, { kind: "npc", id: 448 }]);
    act(() => stores.preview.update({ race: "Orc" }));
    expect([seen.at(-1)!.sim === renamed.sim, seen.at(-1)!.route?.profile.faction]).toEqual([false, "Horde"]);
  });

  it("plays the route again solo self-found with the Playback choices, the same object while both stay, and plays the preview route when it needs neither", () => {
    const text = "#name Sim\n#group G\nstep\n    .accept 830\n";
    const stores = createStores({ guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: null } });
    let shown: { route: RouteView | null; played: RouteView | null } = { route: null, played: null };
    function Probe() {
      shown = { route: useRoute(), played: usePlaybackRoute() };
      return null;
    }
    const app = () => (
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={data}>
          <EntityContext.Provider value={unrelatedEntities}>
            <Probe />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>
    );
    const { rerender } = render(app());
    const first = shown;
    expect([first.played === first.route, first.route!.profile.soloSelfFound, first.played!.profile.soloSelfFound]).toEqual([
      false,
      false,
      true,
    ]);
    rerender(app());
    expect(shown.played).toBe(first.played);
    act(() => stores.playbackSettings.update({ respawn: 30 }));
    expect([shown.route === first.route, shown.played === first.played]).toEqual([true, false]);
    act(() => {
      stores.preview.update({ soloSelfFound: true });
      stores.playbackSettings.reset();
    });
    expect(shown.played).toBe(shown.route);
  });

  it("writes the unsaved copy of a change at its key, and loads its valid fields over the saved settings", async () => {
    createStores().preview.update({ class: "PRIEST" });
    expect(JSON.parse(localStorage.getItem("restedxp-planner:unsaved-preview")!)).toMatchObject({ class: "PRIEST" });
    await vi.waitFor(() => expect(localStorage.getItem("restedxp-planner:unsaved-preview")).toBeNull());

    await saveSetting("preview", { ...DEFAULT_SETTINGS, class: "MAGE", startLevel: { level: 5, xp: 0 } });
    localStorage.setItem("restedxp-planner:unsaved-preview", '{"class":"PIRATE","level":10}');
    const settings = await loadPreviewSettings();
    expect([settings.class, settings.startLevel]).toEqual(["WARRIOR", { level: 10, xp: 0 }]);
  });

  it("previews settings saved in hardcore mode as softcore", async () => {
    await saveSetting("preview", { ...DEFAULT_SETTINGS, hardcore: true });
    expect(await loadPreviewSettings()).toEqual(DEFAULT_SETTINGS);
    await mount(["#name A\n#group G\nstep\n    #hardcore\nstep\n    #softcore\n"], "A");
    await vi.waitFor(() => expect([0, 1].map(stepStatus)).toEqual(["Hardcore only", "shown"]));
  });
});

describe("Forever simulation", () => {
  let forever: { data: GameData; entities: EntityIndex };
  beforeAll(async () => {
    forever = {
      data: plannerData(),
      entities: new FinishedEntities(plannerNames),
    };
  });
  const route = [
    "#name A\n#group G\n#next B\nstep\n    .accept 783\n    .accept 62\nstep\n    .turnin 783\n    .accept 33\n    .accept 830\n" +
      "step\n    .complete 33,1\n    -- @sim kils=3\n",
    "#name B\n#group G\n-- @sim level=5\nstep\n    .accept 18\n",
  ];

  it("lists the simulator's warnings, each selecting its line", async () => {
    const { user } = await mount(route, "A", null, forever);
    const cases = [
      ["Step 1, line 2 Accepts The Fargodeep Mine (62) at level 1; it requires level 4", "A", 0, 1],
      ["Step 3, line 2 Unknown @sim key kils", "A", 2, 1],
      ["Header line 3 Checkpoint level 5 is 3,821 xp ahead of the simulation", "B", null, 2],
    ] as const;
    for (const [name, guide, step, line] of cases) {
      await user.click(await within(await warnings(user)).findByRole("button", { name }));
      expect(screen.getByRole("listbox", { name: `Steps of ${guide}` })).toBeTruthy();
      expect(document.querySelector(".outline [aria-current]")!.closest("li")!.getAttribute("data-line")).toBe(String(line));
      if (step !== null) expect(document.getElementById(`step-${step}`)!.getAttribute("aria-selected")).toBe("true");
    }
  });

  it("opens a closed editor on Lines from a warning and scrolls the warning's line into view", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    onTestFinished(() => void delete (Element.prototype as Partial<Element>).scrollIntoView);
    const { user } = await mount(route, "A", null, forever);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    await user.click(await within(await warnings(user)).findByRole("button", { name: /^Step 3, line 2 Unknown @sim key/ }));

    expect(screen.getByRole("tab", { name: "Lines" }).getAttribute("aria-selected")).toBe("true");
    const row = document.querySelector('#step-detail .outline [data-line="1"]')!;
    expect(row.querySelector("[aria-current]")).toBeTruthy();
    expect(scrolled.filter((el) => el.matches("[data-line]"))).toEqual([row]);
  });

  it("focuses the selected line's first field when Enter is pressed in the step list", async () => {
    const { user } = await mount(route, "A", null, forever);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    await user.click(document.getElementById("step-2")!);
    await user.keyboard("{Enter}");

    const focused = document.activeElement!;
    expect(focused.closest("#step-detail [data-line]")?.getAttribute("data-line")).toBe("0");
    expect(focused.getAttribute("role")).not.toBe("tab");
    expect(focused.matches("input, select, textarea, [contenteditable]")).toBe(true);
    expect(screen.getByRole("tab", { name: "Lines" }).getAttribute("aria-selected")).toBe("true");
  });

  describe("prerequisite quick fix", () => {
    const a = "#name A\n#group G\n#next B\nstep\n    .accept 1079\n";
    const b = "#name B\n#group G\n-- @sim level=17\nstep\n    .accept 990\n    .accept 737\nstep\n    .turnin 735\n";

    function renderPanel(library: StoredLibrary, builtins: Builtins | null = null) {
      const stores = createStores(library, builtins);
      render(
        <StoresContext.Provider value={stores}>
          <GameDataContext.Provider value={forever.data}>
            <EntityContext.Provider value={forever.entities}>
              <WarningsPanel />
            </EntityContext.Provider>
          </GameDataContext.Provider>
        </StoresContext.Provider>,
      );
      return { store: stores.editor, user: userEvent.setup() };
    }

    const warningRow = (text: RegExp) => screen.getByRole("button", { name: text }).closest("li")!;

    it("marks every allOf quest done in the header as one undo step, then focuses the next warning", async () => {
      const { store, user } = renderPanel({
        guides: [
          { id: "a", text: a, order: 0 },
          { id: "b", text: b, order: 1 },
        ],
        session: { guideId: "a", step: 0, line: null },
      });
      await warnings(user);
      const fix = await screen.findByRole("button", { name: /^Mark .* \(1074\) and .* \(1077\) done in header$/ });
      await user.click(fix);
      expect(store.getState().guides.get("a")!.text).toBe(a.replace("step", "-- @sim done=1074,1077\nstep"));
      await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Accepts Covert Ops - Alpha .* before turning in/ })).toBeNull());
      await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector(".warnings .warn-item")));

      act(() => store.undo());
      expect(store.getState().guides.get("a")!.text).toBe(a);
      expect(store.getState().canUndo).toBe(false);
    });

    it("offers each anyOf candidate, edits the warning's guide rather than the open one, and hides with a later turn-in", async () => {
      const { store, user } = renderPanel({
        guides: [
          { id: "a", text: a, order: 0 },
          { id: "b", text: b, order: 1 },
        ],
        session: { guideId: "a", step: 0, line: null },
      });
      await warnings(user);
      const trek = within(warningRow(/Accepts Trek to Ashenvale .* before turning in/));
      const fixes = await trek.findAllByRole("button", { name: /^Mark / });
      expect(fixes.map((f) => /\((\d+)\)/.exec(f.textContent)![1])).toEqual(["994", "995"]);
      expect(within(warningRow(/Accepts Forbidden Knowledge .* before turning in/)).queryByRole("button", { name: /^Mark / })).toBeNull();

      await user.click(fixes[1]!);
      expect(store.getState().guides.get("b")!.text).toBe(b.replace("step", "-- @sim done=995\nstep"));
      expect(store.getState().guides.get("a")!.text).toBe(a);
      expect(store.getState().current!.id).toBe("a");
      await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Accepts Trek to Ashenvale .* before turning in/ })).toBeNull());
    });

    it("keeps the header's unapplied Raw draft when Mark done adds a @sim done= line", async () => {
      const { store, user } = renderPanel({
        guides: [
          { id: "a", text: a, order: 0 },
          { id: "b", text: b, order: 1 },
        ],
        session: { guideId: "a", step: 0, line: null },
      });
      act(() => changeRawDraft(store, null, "#name A\n#group G\n#next B\n-- mine\n"));
      await warnings(user);
      await user.click(await screen.findByRole("button", { name: /^Mark .* \(1074\) and .* \(1077\) done in header$/ }));
      expect(store.getState().guides.get("a")!.text).toBe(a.replace("step", "-- @sim done=1074,1077\nstep"));
      expect(hasRawDraft(store.getState().current!, null)).toBe(true);
    });

    it("keeps the header's unapplied Raw draft of a guide on the route that is not open", async () => {
      const { store, user } = renderPanel({
        guides: [
          { id: "a", text: a, order: 0 },
          { id: "b", text: b, order: 1 },
        ],
        session: { guideId: "b", step: 0, line: null },
      });
      act(() => changeRawDraft(store, null, "#name B\n#group G\n-- mine\n"));
      act(() => store.open("a"));
      await warnings(user);
      const trek = within(warningRow(/Accepts Trek to Ashenvale .* before turning in/));
      await user.click((await trek.findAllByRole("button", { name: /^Mark / }))[0]!);
      expect(store.getState().guides.get("b")!.text).toBe(b.replace("step", "-- @sim done=994\nstep"));
      act(() => store.open("b"));
      expect(hasRawDraft(store.getState().current!, null)).toBe(true);
    });

    it("copies a built-in guide to fix it", async () => {
      const builtin = { id: "rxp:A.lua#1", text: a.replace("#next B\n", ""), order: 0 };
      const { store, user } = renderPanel(
        { guides: [], session: { guideId: builtin.id, step: 0, line: null } },
        {
          version: "v1",
          guides: [builtin],
        },
      );
      await warnings(user);
      await user.click(await screen.findByRole("button", { name: /^Mark .* done in header$/ }));
      const [copy] = store.getState().guides.values();
      expect(guideMeta(copy!).group).toBe("G (custom)");
      expect(copy!.text).toContain("\n-- @sim done=1074,1077\nstep\n");
      expect(store.getState().current!.id).toBe(copy!.id);
      expect(store.getState().builtins.get(builtin.id)!.text).toBe(builtin.text);
      await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Accepts Covert Ops - Alpha .* before turning in/ })).toBeNull());
    });

    it("opens a built-in's existing copy instead, as any edit of it does", async () => {
      const builtin = { id: "rxp:A.lua#1", text: a.replace("#next B\n", ""), order: 0 };
      const copy = { id: "c", text: builtin.text, order: 0, registerArgs: { group: "G (custom)" } };
      const { store, user } = renderPanel(
        { guides: [copy], session: { guideId: builtin.id, step: 0, line: null } },
        {
          version: "v1",
          guides: [builtin],
        },
      );
      await warnings(user);
      await user.click(await screen.findByRole("button", { name: /^Mark .* done in header$/ }));
      const state = store.getState();
      expect(state.current!.id).toBe("c");
      expect(state.notice).toBe("Opened your copy in “G (custom)”. Make the change there.");
      expect(state.builtins.get(builtin.id)!.text).toBe(builtin.text);
      expect(state.guides.get("c")!.text).toBe(copy.text);
      expect(state.canUndo).toBe(false);
    });
  });

  it("keeps the route and its start when an edit of a built-in opens its copy, and after a reload", () => {
    const builtins = {
      version: "v1",
      guides: [
        { id: "rxp:t#1", text: "#name A\n#group G\n#next B\nstep\n", order: 0, fileName: "t.lua" },
        { id: "rxp:t#2", text: "#name B\n#group G\nstep\n", order: 1, fileName: "t.lua" },
      ],
    };
    const settings = { ...DEFAULT_SAVED_SETTINGS, preview: { ...DEFAULT_SETTINGS, start: "rxp:t#1" } };
    let route: RouteView | null = null;
    function Probe() {
      route = useRoute(true);
      return null;
    }
    const shown = () => ({
      route: route!.preview.guides.map((g) => route!.records[g.source]!.id),
      earlier: route!.earlier.map((e) => route!.records[e.source]!.id),
    });
    const stores = createStores({ guides: [], session: { guideId: "rxp:t#2", step: 0, line: null } }, builtins, settings);
    render(
      <StoresContext.Provider value={stores}>
        <Probe />
      </StoresContext.Provider>,
    );
    expect(shown()).toEqual({ route: ["rxp:t#1", "rxp:t#2"], earlier: ["rxp:t#1"] });
    act(() => void stores.editor.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine("    >> Note") as BodyLine)));
    const copy = stores.editor.getState().current!.record;
    expect(guideMeta(copy).group).toBe("G (custom)");
    expect(shown()).toEqual({ route: ["rxp:t#1", copy.id], earlier: ["rxp:t#1"] });

    cleanup();
    const reloaded = createStores({ guides: [copy], session: { guideId: copy.id, step: 0, line: null } }, builtins, settings);
    render(
      <StoresContext.Provider value={reloaded}>
        <Probe />
      </StoresContext.Provider>,
    );
    expect(shown()).toEqual({ route: ["rxp:t#1", copy.id], earlier: ["rxp:t#1"] });
  });

  it("gives snapshots of the edited document at once, while the settled route waits", () => {
    vi.useFakeTimers();
    const text = "#name Sim\n#group G\nstep\n    .accept 830\nstep\n    .goto Elwynn Forest,48,42\n";
    const stores = createStores({ guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: null } });
    const level = (route: RouteView | null) => route?.simulation?.guides[0]!.steps[1]!.state.level;
    const settled = new Set<RouteView | null>();
    function Probe() {
      const live = useRoute(true);
      const route = useRoute();
      settled.add(route);
      return <output>{`live ${level(live)}, settled ${level(route)}`}</output>;
    }
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={forever.data}>
          <EntityContext.Provider value={forever.entities}>
            <Probe />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    const probe = screen.getByRole("status");
    expect(probe.textContent).toBe("live 1, settled 1");
    act(() => void stores.editor.edit((d) => insertLine(d, { step: 1, index: 0 }, parseLine("    .turnin 830") as BodyLine)));
    expect(probe.textContent).toBe("live 2, settled 1");
    act(() => void stores.editor.edit((d) => insertLine(d, { step: 1, index: 0 }, parseLine("    >> Hand it in") as BodyLine)));
    expect(probe.textContent).toBe("live 2, settled 1");
    expect(settled.size).toBe(1);
    act(() => void vi.advanceTimersByTime(300));
    expect(probe.textContent).toBe("live 2, settled 2");
  });
});

describe("route", () => {
  const chain = [
    "#name A\n#group G\n#next B\nstep\n",
    "#name B\n#group G\n#next C\nstep\n",
    "#name C\n#group G\nstep\n",
    "#name D\n#group G\nstep\n",
  ];
  const startFrom = async (user: UserEvent) => within(await startPanel(user)).getByLabelText<HTMLSelectElement>("Start from");

  it("shows the same route strip in Playback", async () => {
    const { user } = await mount(chain, "C");
    await user.selectOptions(await startFrom(user), "B (1 guide earlier)");
    await user.click(screen.getByRole("button", { name: "Playback" }));
    expect(screen.getByRole("region", { name: "Steps" }).closest(".playback")).toBeTruthy();
    expect(guideCards().map((card) => card.getAttribute("aria-label"))).toEqual(["B, guide 1 of 2", "C, guide 2 of 2, open guide"]);
    expect((await startFrom(user)).selectedOptions[0]!.textContent).toBe("B (1 guide earlier)");
  });

  it("plays from the open guide when the solo self-found route from the start does not reach it, and says so", async () => {
    await saveSetting("preview", { ...DEFAULT_SETTINGS, soloSelfFound: false, start: "g0" });
    const { user } = await mount(
      [
        "#name A\n#group G\n#next D << 20\n#next C\nstep -- @sim level=20\n    #ssf\n    >> Grind\n",
        "#name C\n#group G\nstep\n",
        "#name D\n#group G\nstep\n",
      ],
      "C",
    );
    const shown = async () => [
      startCard(),
      routeNames(),
      (await startFrom(user)).selectedOptions[0]!.textContent,
      within(await startPanel(user)).queryByText(/does not reach/)?.textContent,
    ];
    await vi.waitFor(async () =>
      expect(await shown()).toEqual([["A, guide 1 of 2", "Start settings"], ["A", "C"], "A (1 guide earlier)", undefined]),
    );
    await user.click(screen.getByRole("button", { name: "Playback" }));
    await vi.waitFor(async () =>
      expect(await shown()).toEqual([
        ["C, guide 1 of 1, open guide", "Start settings, with a warning"],
        ["C"],
        "This guide (C)",
        "Solo self-found, the route from A does not reach C, so Playback starts at C.",
      ]),
    );
  });

  const ranged = (first = "1-6 A") => [
    `#name ${first}\n#group G\n#next 6-11 B\nstep\n`,
    "#name 6-11 B\n#group G\n#next 12-14 C\nstep\n",
    "#name 12-14 C\n#group G\nstep\n",
  ];
  const warning = async (user: UserEvent) => {
    const text = within(await startPanel(user)).queryByText(/is below/);
    return (
      text && [
        text.textContent,
        within(text.parentElement!)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ]
    );
  };

  it("shows the level warning on the Start card in Playback too", async () => {
    await saveSetting("preview", { ...DEFAULT_SETTINGS, startLevel: { level: 1, xp: 0 } });
    const { user } = await mount(ranged(), "12-14 C");
    await user.click(screen.getByRole("button", { name: "Playback" }));
    expect(startCard()).toEqual(["12-14 C, guide 1 of 1, open guide", "Start settings, with a warning"]);
    expect(await warning(user)).toEqual(["Level 1 is below this guide's range, 12 to 14.", ["Use Auto (level 12)", "Start from 1-6 A"]]);
  });

  it("follows #next across guides", async () => {
    await mount(
      [
        "#group Test Group\n#name 1-10 Example Start\n#next 10-20 Example Middle\nstep\n",
        "#group Test Group\n#name 10-20 Example Middle\n#next 20-21 Example End\nstep\n",
        "#group Test Group\n#name 20-21 Example End\n#next Test Group\\21-23 Example Zone\nstep\n",
      ],
      "1-10 Example Start",
    );
    expect(routeNames()).toEqual(["1-10 Example Start", "10-20 Example Middle", "20-21 Example End"]);
  });

  it("keeps a saved open guide and route start that RXP moved to its dungeon guides", async () => {
    const preview = { ...DEFAULT_SETTINGS, start: "rxp:RestedXP-Skyborne.lua#4" };
    await saveSetting("preview", preview);
    const { user } = await mount([], "rxp:RestedXP-Skyborne.lua#4", await bundledBuiltins());
    expect(within(routeBar()).getByText("RestedXP Forever Dungeon Guide (A)")).toBeTruthy();
    expect(within(routeBar()).getByRole("button", { current: "page" }).getAttribute("aria-label")).toMatch(
      /^Random Stuff, guide 1 of \d+, open guide$/,
    );
    expect((await startFrom(user)).selectedOptions[0]!.textContent).toBe("This guide (Random Stuff)");
    const stores = createStores({ guides: [] }, await bundledBuiltins(), { ...DEFAULT_SAVED_SETTINGS, preview });
    expect(stores.preview.getState().start).toBe("rxp:dungeon/RestedXP-Skyborne.lua#5");
  });
});

describe("warnings", () => {
  it("does not jump to a line that an edit has moved", async () => {
    const stores = createStores({
      guides: [{ id: "a", text: "#name A\n#group G\nstep\n    .turnin 7\n", order: 0 }],
      session: { guideId: "a", step: null, line: null },
    });
    const store = stores.editor;
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={data}>
          <WarningsPanel />
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    const user = userEvent.setup();
    await warnings(user);
    const warning = await screen.findByRole("button", { name: /^Step 1, line 1 Turns in .* before accepting it$/ });

    act(() => void store.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine("    Talk to him") as BodyLine)));
    await user.click(warning);
    expect(warning.getAttribute("aria-disabled")).toBe("true");
    expect(store.getState().selection).toEqual({ step: null, line: null });

    await user.click(await screen.findByRole("button", { name: /^Step 1, line 2 Turns in/ }));
    expect(store.getState().selection).toEqual({ step: 0, line: 1 });
  });

  const routeOfThree = [
    "#name A\n#group G\n#next B\nstep\n    .turnin 7\n",
    "#name B\n#group G\nstep\n    .complete 33,1\nstep\n    .turnin 33\n",
  ];

  /** Opens the panel on one warning, in a body 200 high that holds 500 of rows. */
  async function overflowingPanel() {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    onTestFinished(() => void vi.unstubAllGlobals());
    const user = userEvent.setup();
    const view = { scrollTop: 0 };
    const inBody = (el: HTMLElement, value: number) => (el.classList.contains("warnings-body") ? value : 0);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return inBody(this, 500);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return inBody(this, 200);
    });
    vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return inBody(this as HTMLElement, view.scrollTop);
    });
    const stores = createStores({
      guides: [{ id: "a", text: "#name A\n#group G\nstep\n    .turnin 7\n", order: 0 }],
      session: { guideId: "a", step: null, line: null },
    });
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={data}>
          <WarningsPanel />
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    await user.click(await screen.findByRole("button", { name: "Warnings, 1" }));
    return { body: screen.getByRole("region", { name: "Warnings" }).querySelector<HTMLElement>(".warnings-body")!, view };
  }

  it("marks the list clipped only while rows sit below its scrolled view", async () => {
    const { body, view } = await overflowingPanel();
    const clipped = (top: number) => {
      view.scrollTop = top;
      fireEvent.scroll(body);
      return body.hasAttribute("data-clipped");
    };

    expect([body.hasAttribute("data-clipped"), clipped(300), clipped(280)]).toEqual([true, false, true]);
  });

  it("ends a clipped list its bottom border below its last whole row", async () => {
    const style = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) =>
      el.classList.contains("warnings-body") ? ({ borderBottomWidth: "6px" } as CSSStyleDeclaration) : style(el),
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const rows = [...document.querySelectorAll(".warn-guide > summary, .warn-kind > summary, .warn-kind li")];
      const i = rows.indexOf(this);
      return DOMRect.fromRect({ y: i < 0 ? 40 : 44 + 80 * i, width: 600, height: i < 0 ? 200 : 80 });
    });
    const { body } = await overflowingPanel();

    // The rows end 84, 164, and 244 below the body's top, and only 164 leaves room for the border in 200.
    expect([body.style.maxHeight, body.hasAttribute("data-clipped")]).toEqual(["170px", true]);
  });

  it("shows the count on a top bar button that opens the panel, and closes on Escape, on focus leaving, and on a press outside", async () => {
    const { user } = await mount(routeOfThree, "A");
    const button = await within(screen.getByRole("banner")).findByRole("button", { name: "Warnings, 3" });
    expect(button.textContent).toBe("3");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();

    await user.click(button);
    const panel = screen.getByRole("region", { name: "Warnings" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.querySelector(".panel-head")!.textContent).toBe("Warnings3");
    expect([...panel.querySelectorAll(".warn-guide > summary")].map((s) => s.textContent)).toEqual(["A 1", "B 2"]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await user.tab();
    expect(document.activeElement!.closest(".warnings")).toBe(panel);
    act(() => screen.getByRole("button", { name: "More guide actions" }).focus());
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();

    await user.click(button);
    fireEvent.pointerDown(screen.getByRole("region", { name: "Warnings" }).querySelector(".panel-head")!);
    expect(screen.queryByRole("region", { name: "Warnings" })).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("region", { name: "Steps" }));
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();
  });

  it("opens a warning's line and closes, and marks the warning when it opens again", async () => {
    const { user } = await mount(routeOfThree, "A");
    await user.click(
      await within(await warnings(user)).findByRole("button", { name: /^Step 1, line 1 Completes .* before accepting it$/ }),
    );
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "Steps of B" })).toBeTruthy();
    expect(document.getElementById("step-0")!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Warnings/ }));

    const panel = await warnings(user);
    expect(
      within(panel)
        .getAllByRole("button", { name: /^Step / })
        .map((b) => [b.textContent, b.getAttribute("aria-current")]),
    ).toEqual([
      ["Step 1, line 1 Turns in Kobold Camp Cleanup (7) before accepting it", null],
      ["Step 1, line 1 Completes Wolves Across the Border (33) before accepting it", "location"],
      ["Step 2, line 1 Turns in Wolves Across the Border (33) before accepting it", null],
    ]);
  });

  it("shows 0 with no warnings", async () => {
    await mount(["#name A\n#group G\nstep\n    >> Talk\n"], "A");
    await screen.findByRole("button", { name: "Warnings, 0" });
    expect(within(await warnings(userEvent.setup())).getByText("No warnings on this route")).toBeTruthy();
  });

  it("lists ten warnings of a kind, then the rest on request", async () => {
    const { user } = await mount([`#name A\n#group G\nstep\n${"    .turnin 7\n".repeat(12)}`], "A");
    const panel = await warnings(user);
    await within(panel).findAllByRole("button", { name: /before accepting it$/ });
    expect(panel.querySelectorAll(".warn-item")).toHaveLength(10);

    await user.click(within(panel).getByRole("button", { name: "2 more" }));
    expect(panel.querySelectorAll(".warn-item")).toHaveLength(12);
    expect(within(panel).queryByRole("button", { name: /more$/ })).toBeNull();
    expect(document.activeElement).toBe(panel.querySelectorAll(".warn-item")[10]);

    await user.keyboard("{Escape}");
    expect((await warnings(user)).querySelectorAll(".warn-item")).toHaveLength(12);
  });
});
