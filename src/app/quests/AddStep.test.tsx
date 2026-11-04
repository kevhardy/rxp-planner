// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EntityIndex, GameData } from "../../data/index.ts";
import { northshireData, northshireFile, northshireNames } from "../../data/northshireFixture.ts";
import { plannerContext } from "../../data/plannerFixture.ts";
import { questRow } from "../testing.ts";
import { insertLine, insertStep } from "../../guide/index.ts";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { changeRawDraft, hasRawDraft } from "../drafts.ts";
import { DEFAULT_SETTINGS, type PreviewSettings } from "../preview/settings.ts";
import { WarningsPanel } from "../preview/WarningsPanel.tsx";
import { StepList } from "../StepList.tsx";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";

afterEach(() => cleanup());

let northshire: { data: GameData; entities: EntityIndex };
beforeAll(async () => {
  northshire = { data: northshireData(), entities: new EntityIndex(northshireNames) };
});

const guide = `#group G
#name Sim
step
    .accept 783
    .accept 5261
step
    .accept 33
step
    >> Later
`;

const BUILTIN_ID = "rxp:test.lua#1";
const builtinText = guide.replace("#group G", "#group Built-ins");

const ringNotes = () => document.querySelectorAll("#step-2 .step-side > .sr-only")[1]?.textContent.replace(/ · $/, "").split("\n");

function mount(
  options: {
    settings?: Partial<PreviewSettings>;
    names?: boolean;
    other?: string;
    text?: string;
    step?: number | null;
    builtin?: boolean;
    data?: GameData;
  } = {},
) {
  const text0 = options.text ?? guide;
  const guides = options.builtin
    ? []
    : [{ id: "g", text: text0, order: 0 }, ...(options.other ? [{ id: "o", text: options.other, order: 1 }] : [])];
  const builtins = options.builtin
    ? { version: "v9.9.9", guides: [{ id: BUILTIN_ID, text: builtinText, order: 0, fileName: "test.lua" }] }
    : null;
  const session = { guideId: options.builtin ? BUILTIN_ID : "g", step: options.step === undefined ? 1 : options.step, line: null };
  const stores = createStores({ guides, session }, builtins, {
    ...DEFAULT_SAVED_SETTINGS,
    preview: { ...DEFAULT_SETTINGS, startLevel: { level: 2, xp: 0 }, ...options.settings },
  });
  render(
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={options.data ?? northshire.data}>
        <EntityContext.Provider value={options.names === false ? null : northshire.entities}>
          <StepList />
          <WarningsPanel />
        </EntityContext.Provider>
      </GameDataContext.Provider>
    </StoresContext.Provider>,
  );
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "Add step" });
  const open = async () => {
    await user.click(button);
    return screen.getByRole("dialog");
  };
  const text = () => stores.editor.getState().current!.record.text;
  return { user, stores, button, open, text };
}

const warningsButton = () => screen.getByRole("button", { name: /^Warnings/, expanded: false });
const head = (dialog: HTMLElement) => dialog.querySelector(".add-head")!.textContent;
const groups = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll(".add-group")].map((g) => [
    g.querySelector("h3")!.textContent,
    [...g.querySelectorAll(".add-row")].map((r) =>
      [...r.children].flatMap((c) => (c.tagName === "BUTTON" ? [] : [c.textContent.replace(/ xp$/, "")])).join(" | "),
    ),
  ]);
const row = (dialog: HTMLElement, name: string) => [...dialog.querySelectorAll(".add-row")].find((r) => r.textContent.startsWith(name))!;

describe("Add step popover", () => {
  it("opens at the state after the selected step with quests to turn in, work on, and accept", async () => {
    const { open, button } = mount();
    const dialog = await open();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(head(dialog)).toBe("Add after step 2 · Level 2 (0/900) · Elwynn Forest · log 3/40");
    const [turnin, objective, accept] = groups(dialog);
    expect(turnin).toEqual([
      "Ready to turn in",
      [
        " | Eagan Peltskinner → Eagan Peltskinner | after A Threat Within | 0 yd | +85",
        " | A Threat Within → Marshal McBride |  | 28 yd | +40",
      ],
    ]);
    expect(objective).toEqual([
      "Open objectives",
      [" | Wolves Across the Border: Tough Wolf Meat |  | 16 yd | +170 | 16 kills · Young Wolf (Lv 1), Timber Wolf (Lv 2) drop it"],
    ]);
    expect(accept![0]).toBe("Can accept");
    expect((accept![1] as string[]).find((r) => r.includes("Nibbled-On Book"))).toMatch(
      /^ \| Nibbled-On Book · Nibbled-On Book \| {2}\| \d+ yd \| 85 \|/,
    );
  });

  it("sets the state's numbers, each distance, and each XP in Mono, apart from the words", async () => {
    const dialog = await mount().open();
    const mono = (el: Element) => [...el.querySelectorAll(".ui-mono")].map((e) => e.textContent);
    expect(mono(dialog.querySelector(".add-head")!)).toEqual(["2", "0/900", "3/40"]);
    expect(mono(row(dialog, "A Threat Within"))).toEqual(["28", "+40"]);
  });

  it("lists quests the character cannot accept yet after those it can, with Add disabled and why", async () => {
    const { open } = mount();
    const dialog = await open();
    const accepts = [...within(dialog).getByRole("region", { name: "Can accept" }).querySelectorAll(".add-row")];
    const locked = accepts.map((r) => r.classList.contains("locked"));
    expect(locked.indexOf(true)).toBeGreaterThan(0);
    expect(locked.slice(locked.indexOf(true)).every(Boolean)).toBe(true);
    const add = (r: Element) => within(r as HTMLElement).getByRole<HTMLButtonElement>("button", { name: /^Add / });
    expect(accepts.map((r) => add(r).disabled)).toEqual(locked);
    const prerequisite = row(dialog, "Brotherhood of Thieves");
    expect(prerequisite.querySelector(".add-chip")!.textContent).toBe("after A Threat Within");
    expect(within(prerequisite.querySelector<HTMLElement>(".add-chip")!).getByRole("link").getAttribute("href")).toBe(
      "https://www.wowhead.com/forever/quest=783",
    );
    expect(prerequisite.querySelector(".add-sub")).toBeNull();
    expect(row(dialog, "Kobold Candles").querySelector(".add-sub")!.textContent).toBe("level 3");
    expect(row(dialog, "Kobold Candles").querySelector(".add-chip")).toBeNull();
  });

  it("draws each section with its kind's step list mark, dimmed in a locked row", async () => {
    const { open } = mount();
    const dialog = await open();
    const kind = (r: Element) => [...(r.querySelector(":scope > .mk")?.classList ?? [])].find((name) => name.startsWith("mk-"));
    const marks = [...dialog.querySelectorAll(".add-group")].map((g) => [
      g.querySelector("h3")!.textContent,
      [...new Set([...g.querySelectorAll(".add-row")].map(kind))],
    ]);
    expect(marks).toEqual([
      ["Ready to turn in", ["mk-turnin"]],
      ["Open objectives", ["mk-complete"]],
      ["Can accept", ["mk-accept"]],
    ]);
    // jsdom applies no CSS, so match each mark against the rules that dim.
    const dimming = postcss
      .parse(readFileSync(join(import.meta.dirname, "addStep.css"), "utf8"))
      .nodes.flatMap((node) =>
        node.type === "rule" && node.nodes.some((decl) => decl.type === "decl" && decl.prop === "opacity" && parseFloat(decl.value) < 1)
          ? [node.selector]
          : [],
      );
    const accepts = [...within(dialog).getByRole("region", { name: "Can accept" }).querySelectorAll(".add-row")];
    expect(accepts.map((r) => dimming.some((selector) => r.querySelector(".mk")!.matches(selector)))).toEqual(
      accepts.map((r) => r.classList.contains("locked")),
    );
  });

  it("locks war-effort and invasion quests as world events, and leaves out those accepted on turn-in", async () => {
    const file = northshireFile();
    const event = (id: number, name: string, types: string[], zoneIds: number[]) => questRow(id, name, { zoneIds, types });
    const warEffort = [17, 40, 130, 331, 1537];
    const data = new GameData(
      {
        ...file,
        quests: [
          ...file.quests.filter((q) => [783, 5261, 33].includes(q.id)),
          event(8492, "The Alliance Needs Copper Bars!", ["war-effort"], warEffort),
          event(9260, "Investigate the Scourge of Stormwind", ["invasion"], [1, 12, 14, 85, 141, 215, 1519]),
          event(8493, "The Alliance Needs More Copper Bars!", ["repeatable", "war-effort"], warEffort),
        ],
      },
      plannerContext,
    );
    const { open, user } = mount({ data });
    const dialog = await open();
    await user.selectOptions(within(dialog).getByLabelText("Zone"), "all");
    const [, , accept] = groups(dialog);
    expect(accept).toEqual([
      "Can accept",
      [" | Investigate the Scourge of Stormwind |  | — | — | world event", " | The Alliance Needs Copper Bars! |  | — | — | world event"],
    ]);
  });

  it("filters to the current zone or all zones, and sorts by distance, level, or XP", async () => {
    const file = northshireFile();
    const named = [18, 33, 60, 783, 5261, 91741];
    const real = (zoneId: number, quests: [number, string, number, number, number][]) =>
      quests.map(([id, name, requiredLevel, questLevel, baseXp]) =>
        questRow(id, name, { zoneIds: [zoneId], requiredLevel, questLevel, baseXp }),
      );
    const elwynn = real(12, [
      [7, "Kobold Camp Cleanup", 1, 2, 170],
      [15, "Investigate Echo Ridge", 1, 3, 250],
      [21, "Skirmish at Echo Ridge", 1, 5, 450],
      [54, "Report to Goldshire", 1, 5, 225],
      [2158, "Rest and Relaxation", 1, 5, 110],
      [6, "Bounty on Garrick Padfoot", 2, 5, 335],
      [3904, "Milly's Harvest", 2, 4, 180],
      [3905, "Grape Manifest", 2, 4, 355],
      [61, "Shipment to Stormwind", 3, 7, 790],
      [47, "Gold Dust Exchange", 4, 7, 630],
      [62, "The Fargodeep Mine", 4, 7, 475],
      [76, "The Jasperlode Mine", 4, 10, 840],
      [83, "Red Linen Goods", 4, 9, 780],
      [84, "Back to Billy", 5, 6, 135],
      [85, "Lost Necklace", 5, 6, 135],
      [86, "Pie for Billy", 5, 6, 405],
      [87, "Goldtooth", 5, 8, 880],
      [106, "Young Lovers", 5, 6, 135],
      [107, "Note to William", 5, 6, 135],
      [111, "Speak with Gramma", 5, 6, 135],
      [112, "Collecting Kelp", 5, 7, 315],
      [114, "The Escape", 5, 7, 790],
      [5545, "A Bundle of Trouble", 5, 9, 780],
      [11, "Riverpaw Gnoll Bounty", 6, 10, 840],
      [88, "Princess Must Die!", 6, 9, 780],
      [35, "Further Concerns", 7, 10, 420],
      [37, "Find the Lost Guards", 7, 10, 210],
      [39, "Deliver Thomas' Report", 7, 10, 1050],
      [40, "A Fishy Peril", 7, 10, 85],
      [45, "Discover Rolf's Fate", 7, 10, 420],
      [46, "Bounty on Murlocs", 7, 10, 840],
      [52, "Protect the Frontier", 7, 10, 630],
      [59, "Cloth and Leather Armor", 7, 10, 210],
      [71, "Report to Thomas", 7, 10, 210],
      [123, "The Collector", 7, 10, 210],
      [147, "Manhunt", 7, 10, 840],
      [91738, "An Apple Treat", 7, 10, 630],
      [91740, "Croaky's Head", 7, 10, 840],
      [91746, "Elmpaw's Head", 7, 10, 840],
      [109, "Report to Gryan Stoutmantle", 9, 10, 630],
    ]);
    const westfall = real(40, [
      [9, "The Killing Fields", 8, 15, 1050],
      [102, "Patrolling Westfall", 8, 14, 980],
      [184, "Furlbrow's Deed", 8, 9, 590],
      [12, "The People's Militia", 9, 12, 910],
      [22, "Goretusk Liver Pie", 9, 12, 910],
      [36, "Westfall Stew", 9, 10, 420],
      [64, "The Forgotten Heirloom", 9, 12, 910],
      [151, "Poor Old Blanchy", 9, 14, 1250],
    ]);
    const data = new GameData(
      { ...file, quests: [...file.quests.filter((q) => named.includes(q.id)), ...elwynn, ...westfall] },
      plannerContext,
    );
    const { open, user } = mount({ data });
    const dialog = await open();
    const group = (name: string) => within(dialog).getByRole("region", { name });
    const note = (name: string) => group(name).querySelector(".add-note")?.textContent;
    const zone = within(dialog).getByLabelText("Zone");
    expect((zone as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Elwynn Forest");
    const accepts = () => [...dialog.querySelectorAll(".add-accept .add-name")].map((n) => n.textContent);
    expect(note("Can accept")).toBeUndefined();
    expect(accepts()).toHaveLength(43);
    expect(accepts()).not.toContain("Westfall Stew");

    const sort = within(dialog).getByLabelText("Sort");
    await user.selectOptions(sort, "xp");
    expect(accepts().slice(0, 3)).toEqual(["Skirmish at Echo Ridge", "Grape Manifest", "Bounty on Garrick Padfoot"]);
    await user.selectOptions(sort, "level");
    expect(accepts().slice(0, 3)).toEqual(["Kobold Camp Cleanup", "Nibbled-On Book · Nibbled-On Book", "Investigate Echo Ridge"]);

    await user.selectOptions(zone, "all");
    expect(note("Can accept")).toBe("Showing 50 of 51. Choose a zone or sort to see others.");
    expect(accepts()).toHaveLength(50);
  });

  it("joins the selected step when it meets the same NPC, as one undo step, and returns focus to +", async () => {
    const { open, user, stores, text, button } = mount();
    const dialog = await open();
    await user.click(within(dialog).getByRole("button", { name: "Add Eagan Peltskinner → Eagan Peltskinner" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(text()).toBe(guide.replace("    .accept 33\n", "    .accept 33\n    .turnin 5261\n"));
    expect(stores.editor.getState().selection).toEqual({ step: 1, line: null });

    act(() => stores.editor.undo());
    expect(text()).toBe(guide);
    expect(stores.editor.getState().canUndo).toBe(false);
  });

  it.each([
    ["joins the step", (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Add Eagan Peltskinner → Eagan Peltskinner" })],
    [
      "adds a checkpoint to it",
      async (dialog: HTMLElement, user: UserEvent) => {
        await user.click(within(dialog).getByRole("tab", { name: "Checkpoint" }));
        return within(dialog).getByRole("button", { name: "Add" });
      },
    ],
  ])("keeps the selected step's unapplied Raw draft when Add %s", async (_, addButton) => {
    const { open, user, stores, text } = mount();
    act(() => changeRawDraft(stores.editor, 1, "step\n    .accept 33\n    >> mine\n"));
    await user.click(await addButton(await open(), user));
    expect(text()).not.toBe(guide);
    expect(hasRawDraft(stores.editor.getState().current!, 1)).toBe(true);
  });

  it("adds a new step for another NPC or an objective", async () => {
    const { open, user, stores, text } = mount();
    await user.click(within(await open()).getByRole("button", { name: "Add A Threat Within → Marshal McBride" }));
    expect(text()).toMatch(/^step\n {4}\.goto Elwynn Forest,[\d.]+,[\d.]+\n {4}\.turnin 783\nstep\n {4}>> Later/m);
    expect(stores.editor.getState().selection).toEqual({ step: 2, line: null });

    await user.click(within(await open()).getByRole("button", { name: "Add Wolves Across the Border: Tough Wolf Meat" }));
    expect(text()).toMatch(/\.turnin 783\nstep\n {4}\.goto Elwynn Forest,[\d.]+,[\d.]+\n {4}\.complete 33,1\nstep\n {4}>> Later/);
    expect(stores.editor.getState().selection).toEqual({ step: 3, line: null });
  });

  it("uses the document as edited, with no wait", async () => {
    const { open, stores } = mount();
    act(() => {
      stores.editor.edit((d) => insertLine(d, { step: 1, index: 1 }, { kind: "command", indent: "    ", name: "turnin", args: ["783"] }));
    });
    const dialog = await open();
    expect(head(dialog)).toContain("log 2/40");
    expect(row(dialog, "A Threat Within")).toBeUndefined();
    const unlocked = row(dialog, "Brotherhood of Thieves") as HTMLElement;
    expect(within(unlocked).getByRole<HTMLButtonElement>("button", { name: /^Add/ }).disabled).toBe(false);
    expect(unlocked.querySelector(".add-chip.done")!.textContent).toBe("after A Threat Within, done");
  });

  it("simulates a guide off the route on its own, as the step list does", async () => {
    const { open } = mount({
      settings: { start: "o", startLevel: { level: 5, xp: 0 } },
      other: "#group G\n#name Other\nstep\n    .accept 7\n",
    });
    expect(document.querySelector("#step-1 .sim-level")!.textContent).toBe("5");
    const dialog = await open();
    expect(head(dialog)).toBe("Add after step 2 · Level 5 (0/2,800) · Elwynn Forest · log 3/40");
    expect(within(dialog).getByRole("tab", { name: "Quests" })).toBeTruthy();
  });

  it("grinds with the guide multiplier, matching the inserted step rather than inheriting the previous step override", async () => {
    const { open, user, text } = mount({
      text: "-- @sim killmult=0.5\n" + guide.replace("    .accept 33", "    .accept 33\n    -- @sim killxp=999"),
    });
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Grind" }));
    expect(within(dialog).getByLabelText<HTMLInputElement>("Target .xp").value).toBe("3");
    await user.type(within(dialog).getByRole("combobox", { name: "Mob" }), "Kobold Vermin");
    await user.click(within(dialog).getByRole("option", { name: /^Kobold Vermin #6/ }));
    const estimate = within(dialog).getByRole("status").textContent;
    expect(estimate).toMatch(/^Kobold Vermin \(Lv 1–2\): 900 xp · about \d+ kills$/);
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toContain("    .accept 33\n    -- @sim killxp=999\nstep\n    .xp 3\n    .mob Kobold Vermin::6\nstep\n");
    expect(estimate).toContain("about 36 kills");
    const kills = estimate.match(/about (\d+) kills/)![1];
    expect(ringNotes()).toEqual(["Checkpoint: +900 xp", `Stands for: about ${kills} Kobold Vermin kills`]);
  });

  it("grinds for a party of two, matching the kills the simulator counts for the inserted step", async () => {
    const { open, user } = mount({ text: "-- @sim party=2\n" + guide });
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Grind" }));
    await user.type(within(dialog).getByRole("combobox", { name: "Mob" }), "Kobold Vermin");
    await user.click(within(dialog).getByRole("option", { name: /^Kobold Vermin #6/ }));
    expect(within(dialog).getByRole("status").textContent).toBe("Kobold Vermin (Lv 1–2): 900 xp · about 36 kills");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(ringNotes()).toEqual(["Checkpoint: +900 xp", "Stands for: about 36 Kobold Vermin kills"]);
  });

  it("grinds with no kill XP at a guide multiplier of zero", async () => {
    const { open, user } = mount({ text: "-- @sim killmult=0\n" + guide });
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Grind" }));
    expect(within(dialog).getByLabelText<HTMLInputElement>("Target .xp").value).toBe("3");
    await user.type(within(dialog).getByRole("combobox", { name: "Mob" }), "Kobold Vermin");
    await user.click(within(dialog).getByRole("option", { name: /^Kobold Vermin #6/ }));
    expect(within(dialog).getByRole("status").textContent).toBe("Kobold Vermin (Lv 1–2): 900 xp · kills unknown for this mob");
  });

  it("keeps the XP ring, state, popover, and warnings in sync after a checkpoint Add and one undo", async () => {
    const { open, user, stores, text } = mount();
    await user.click(screen.getByRole("button", { name: "State" }));
    const state = screen.getByRole("region", { name: "Simulated state" });
    const ring = () => document.querySelector("#step-1 .step-side .sr-only")!.textContent;
    await user.click(warningsButton());
    const warnings = screen.getByRole("region", { name: "Warnings" });
    const initialWarnings = warnings.textContent;
    expect(ring()).toContain(" Level 2, 0%, ");
    expect(within(state).getByText(/^after step/).textContent).toBe("after step 2");
    expect(within(state).getByText("2 · 0/900 xp")).toBeTruthy();
    const dialog = await open();
    expect(head(dialog)).toBe("Add after step 2 · Level 2 (0/900) · Elwynn Forest · log 3/40");
    await user.click(within(dialog).getByRole("tab", { name: "Checkpoint" }));
    const input = within(dialog).getByLabelText("-- @sim level=");
    const note = async (level: string) => {
      await user.clear(input);
      if (level) await user.type(input, level);
      return within(dialog).getByRole("status").textContent;
    };
    expect(await note("")).toBe("Jumps the simulated level to the target and reports the gap.");
    expect(await note("1.5")).toBe("1.5 is 200 xp behind the simulated level; the simulation reports it.");
    expect(await note("2")).toBe("The simulated level is already 2.");
    expect(await note("3.5")).toBe("Jumps to 3.5 and reports the gap: 1,600 xp not accounted for.");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toContain("step\n    .accept 33\n    -- @sim level=3.5\nstep\n");
    expect(stores.editor.getState().selection).toEqual({ step: 1, line: 1 });
    expect(ring()).toContain(" Level 3, 50%, ");
    expect(within(state).getByText("3 · 700/1,400 xp")).toBeTruthy();
    expect(head(await open())).toBe("Add after step 2 · Level 3 (700/1,400) · Elwynn Forest · log 3/40");
    await user.keyboard("{Escape}");
    await user.click(warningsButton());
    const gap = /Checkpoint level 3 \+ 700 xp is 1,600 xp ahead/;
    expect(await screen.findByRole("button", { name: gap })).toBeTruthy();

    act(() => stores.editor.undo());
    expect(text()).toBe(guide);
    expect(stores.editor.getState().canUndo).toBe(false);
    expect(ring()).toContain(" Level 2, 0%, ");
    expect(within(state).getByText("2 · 0/900 xp")).toBeTruthy();
    await waitFor(() => expect(warnings.textContent).toBe(initialWarnings));
    expect(head(await open())).toBe("Add after step 2 · Level 2 (0/900) · Elwynn Forest · log 3/40");
  });

  it("updates the XP ring, state, and warnings when Mark done enables a step, and restores them in one undo", async () => {
    const source = "#group G\n#name Fix\nstep\n    .accept 18\nstep\n    .isQuestTurnedIn 783\n    -- @sim level=3\n";
    const { user, stores, text, open } = mount({ text: source });
    await user.click(screen.getByRole("button", { name: "State" }));
    const state = screen.getByRole("region", { name: "Simulated state" });
    const selected = () => document.getElementById("step-1")!;
    expect(selected().textContent).toContain("Skipped");
    expect(within(state).getByText("2 · 0/900 xp")).toBeTruthy();
    await user.click(warningsButton());
    await user.click(await screen.findByRole("button", { name: "Mark A Threat Within (783) done in header" }));

    expect(text()).toContain("-- @sim done=783\nstep");
    expect(selected().querySelector(".step-side .sr-only")!.textContent).toContain(" Level 3, 0%, ");
    expect(within(state).getByText("3 · 0/1,400 xp")).toBeTruthy();
    expect(within(state).getByText("Quests done").nextElementSibling!.textContent).toBe("1");
    expect(await screen.findByRole("button", { name: /Checkpoint level 3 is 900 xp ahead/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Mark / })).toBeNull();
    expect(head(await open())).toContain("Add after step 2 · Level 3 (0/1,400)");
    await user.keyboard("{Escape}");

    act(() => stores.editor.undo());
    expect(text()).toBe(source);
    expect(stores.editor.getState().canUndo).toBe(false);
    expect(selected().textContent).toContain("Skipped");
    expect(within(state).getByText("2 · 0/900 xp")).toBeTruthy();
    expect(within(state).getByText("Quests done").nextElementSibling!.textContent).toBe("0");
    await user.click(warningsButton());
    expect(await screen.findByRole("button", { name: "Mark A Threat Within (783) done in header" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Checkpoint level 3 is 900 xp ahead/ })).toBeNull();
  });

  it("adds a blank step from its tab", async () => {
    const { open, user, stores, text, button } = mount();
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Blank step" }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toContain("    .accept 33\nstep\nstep\n    >> Later");
    expect(stores.editor.getState().selection).toEqual({ step: 2, line: null });
    expect(document.activeElement).toBe(button);
  });

  it("offers Grind without an estimate, Checkpoint, and Blank step before the simulation is ready", async () => {
    const { open, user } = mount({ names: false });
    const dialog = await open();
    expect(head(dialog)).toBe("Add after step 2");
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Grind", "Checkpoint", "Blank step"]);
    expect(dialog.querySelector(".add-note")!.textContent).toBe(
      "The simulation is not ready, so there are no quest suggestions or XP estimates.",
    );
    await user.type(within(dialog).getByLabelText("Target .xp"), "4");
    expect(within(dialog).getByRole("status").textContent).toBe("");
  });

  it("works from the keyboard: arrow keys move through all four tabs, and Escape closes and returns focus", async () => {
    const { user, button } = mount();
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tablist").children).toHaveLength(4);
    const tab = (name: string) => screen.getByRole("tab", { name });
    expect(document.activeElement).toBe(tab("Quests"));
    for (const name of ["Grind", "Checkpoint", "Blank step", "Quests"]) {
      await user.keyboard("{ArrowRight}");
      expect(document.activeElement).toBe(tab(name));
      expect(tab(name).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tabpanel", { name })).toBeTruthy();
    }
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tab("Blank step"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tab("Quests"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tab("Blank step"));
    await user.keyboard("{Home}");
    const toggle = screen.getByRole("button", { name: /^A Threat Within/ });
    toggle.focus();
    await user.keyboard("{Enter}");
    const details = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    act(() => within(details).getAllByRole("link")[0]!.focus());
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps its height inside the window as the window resizes", async () => {
    const { open } = mount();
    const dialog = await open();
    // jsdom lays nothing out, so + sits at the top and the popover 8 px below it.
    expect(dialog.style.getPropertyValue("--size-h")).toBe(`${innerHeight - 16}px`);
    const height = innerHeight;
    try {
      act(() => {
        innerHeight = 500;
        dispatchEvent(new Event("resize"));
      });
      expect(dialog.style.getPropertyValue("--size-h")).toBe("484px");
    } finally {
      innerHeight = height;
    }
  });
});

describe("Add step popover placement and editing", () => {
  it("starts Grind with the selected step's override mob", async () => {
    const { open, user, text } = mount({ text: "#group G\n#name Grind\nstep\n-- @sim mob=6\n.xp 2\n", step: 0 });
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Grind" }));
    expect(within(dialog).getByRole("combobox", { name: "Mob" }).getAttribute("value")).toBe("Kobold Vermin");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toContain(".mob Kobold Vermin::6");
  });

  it("writes the mob a grind names by ID, so the simulation counts the kills the popover estimated", async () => {
    expect(northshire.entities.entityByName("Jade")?.kind).toBe("ambiguous");
    const { open, user, text } = mount({ settings: { startLevel: { level: 47, xp: 0 } } });
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Grind" }));
    await user.type(within(dialog).getByRole("combobox", { name: "Mob" }), "Jade");
    await user.click(within(dialog).getByRole("option", { name: /^Jade #1063/ }));
    const estimate = within(dialog).getByRole("status").textContent;
    const [, xp, kills] = estimate.match(/: ([\d,]+) xp · about (\d+) kills$/)!;
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toContain("step\n    .xp 48\n    .mob Jade::1063\nstep\n");
    expect(ringNotes()).toEqual([`Checkpoint: +${xp} xp`, `Stands for: about ${kills} Jade kills`]);
  });

  const skipping = `#group G
#name Skip
step
    .accept 5261
step << Mage
    .accept 33
step
    >> Later
`;

  it("adds a new step after a skipped step instead of joining it", async () => {
    const { open, user, text, stores } = mount({ text: skipping });
    const dialog = await open();
    await user.click(within(dialog).getByRole("button", { name: "Add Eagan Peltskinner → Eagan Peltskinner" }));
    expect(text()).toMatch(
      /^step << Mage\n {4}\.accept 33\nstep\n {4}\.goto Elwynn Forest,[\d.]+,[\d.]+\n {4}\.turnin 5261\nstep\n {4}>> Later$/m,
    );
    expect(stores.editor.getState().selection).toEqual({ step: 2, line: null });
    expect(document.querySelector("#step-2 .step-side")!.textContent).toContain("+85 quest xp");
  });

  it("puts a checkpoint after a skipped step in a new step", async () => {
    const { open, user, text, stores } = mount({ text: skipping });
    const dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Checkpoint" }));
    expect(within(dialog).getByText(/^Adds the line/).textContent).toBe("Adds the line in a new step: the character skips step 2.");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toContain("step << Mage\n    .accept 33\nstep\n    -- @sim level=3\nstep\n");
    expect(stores.editor.getState().selection).toEqual({ step: 2, line: 0 });
  });

  it("adds at the start from the header: quests in a new first step, a checkpoint in the header", async () => {
    const { open, user, text, stores } = mount({ step: null });
    let dialog = await open();
    expect(head(dialog)).toBe("Add at the start · Level 2 (0/900) · no position yet · log 0/40");
    const add = within(dialog.querySelector<HTMLElement>(".add-accept:not(.locked)")!).getByRole("button", { name: /^Add / });
    const name = add.getAttribute("aria-label")!.slice("Add ".length).split(" · ")[0];
    await user.click(add);
    const added = text().match(/^#name Sim\nstep\n(?: {4}\.goto .+\n)? {4}\.accept (\d+)\nstep\n {4}\.accept 783\n/m);
    expect(northshire.data.quest(Number(added![1]), "Alliance")!.name).toBe(name);
    expect(stores.editor.getState().selection).toEqual({ step: 0, line: null });

    act(() => stores.editor.select({ step: null, line: null }));
    dialog = await open();
    await user.click(within(dialog).getByRole("tab", { name: "Checkpoint" }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(text()).toMatch(/^#group G\n#name Sim\n-- @sim level=3\nstep\n/);
  });

  it("adds after the last step at the end", async () => {
    const { open, user, text, stores } = mount({ step: 2 });
    const dialog = await open();
    expect(head(dialog)).toMatch(/^Add after step 3 · /);
    await user.click(within(dialog).getByRole("button", { name: "Add Eagan Peltskinner → Eagan Peltskinner" }));
    expect(text()).toMatch(/ {4}>> Later\nstep\n {4}\.goto Elwynn Forest,[\d.]+,[\d.]+\n {4}\.turnin 5261\n$/);
    expect(stores.editor.getState().selection).toEqual({ step: 3, line: null });
  });

  it("copies a built-in on Add, as any edit does, in one undo step", async () => {
    const { open, user, stores } = mount({ builtin: true });
    const dialog = await open();
    await user.click(within(dialog).getByRole("button", { name: "Add Eagan Peltskinner → Eagan Peltskinner" }));
    const state = stores.editor.getState();
    expect(state.current).toMatchObject({ builtin: false, group: "Built-ins (custom)" });
    expect(state.current!.record.text).toContain("    .accept 33\n    .turnin 5261\n");
    expect(state.builtins.get(BUILTIN_ID)!.text).toBe(builtinText);
    act(() => stores.editor.undo());
    expect(stores.editor.getState()).toMatchObject({ canUndo: false, current: { id: BUILTIN_ID, builtin: true }, guides: new Map() });
  });

  it("opens a built-in's existing copy on Add, changes nothing, and closes with no error", async () => {
    const { open, user, stores, text } = mount({ builtin: true });
    act(() => void stores.editor.edit((d) => insertStep(d, 0)));
    const copy = stores.editor.getState().current!;
    act(() => stores.editor.open(BUILTIN_ID));
    const dialog = await open();
    await user.click(within(dialog).getByRole("button", { name: "Add Eagan Peltskinner → Eagan Peltskinner" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stores.editor.getState()).toMatchObject({
      current: { id: copy.id },
      notice: "Opened your copy in “Built-ins (custom)”. Make the change there.",
    });
    expect(text()).toBe(copy.record.text);
  });

  it("keeps the Insert key adding a blank step at once", async () => {
    const { user, text } = mount();
    screen.getByRole("listbox").focus();
    await user.keyboard("{Insert}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(text()).toContain("    .accept 33\nstep\nstep\n    >> Later");
  });

  it("closes on a click outside", async () => {
    const { open, user, button, text } = mount();
    await open();
    await user.click(document.getElementById("step-0")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(text()).toBe(guide);
  });
});
