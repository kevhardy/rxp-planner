// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { guideIconCatalog } from "../data/guideIcons.ts";
import { EntityIndex } from "../data/index.ts";
import { guideIconsFixture } from "../data/manifestFixture.ts";
import { plannerData, plannerNames } from "../data/plannerFixture.ts";
import { extractGuides, setText, updateLine, type CommandLine } from "../guide/index.ts";
import type { Builtins } from "../io/index.ts";
import type { StoredLibrary } from "../storage/index.ts";
import { EntityContext, EntityErrorContext, GameDataContext, GuideIconsContext, StoresContext } from "./context.ts";
import { editSection, readDraft, writeDraft, type DraftOwner } from "./drafts.ts";
import { EditorDock, EditorNotices } from "./EditorDock.tsx";
import { loadLayout, useEditorPanel, type DockTab } from "./layout.ts";
import { DEFAULT_SETTINGS } from "./preview/settings.ts";
import { StepList } from "./StepList.tsx";
import type { EditorStore } from "./store.ts";
import { createStores, DEFAULT_SAVED_SETTINGS } from "./stores.ts";
import { questNames, selectText, showLine, shownText } from "./testing.ts";
import { cascade } from "./ui/testing.ts";

const styles = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

const TEXT = "#group G\n#name A\nstep\n#label Start\n.accept 1 >> Hello\n.goto Elwynn Forest,49.1,38.3\n";

const entities = new EntityIndex({
  version: 2,
  entities: {
    item: [[6948, "Hearthstone"]],
    quest: [[33, "Wolves Across the Border"]],
    npc: [[196, "Eagan Peltskinner"]],
    spell: [[133, "Fireball", "Rank 1"]],
    object: [[1617, "Silverleaf"]],
  },
});

const quests = questNames([[33, "Wolves Across the Border"]]);

const icons = { catalog: guideIconCatalog(guideIconsFixture().guideIcons), sheet: undefined };

function mount(text = TEXT, tab: DockTab = "lines", options: { styles?: boolean } = {}) {
  const stores = createStores({ guides: [{ id: "g", text, order: 0 }], session: { guideId: "g", step: 0, line: null } });
  stores.layout.update({ dockTab: tab }, { save: false });
  if (options.styles) document.head.appendChild(document.createElement("style")).textContent = styles;
  render(
    <StoresContext.Provider value={stores}>
      <EntityContext.Provider value={entities}>
        <GameDataContext.Provider value={quests}>
          <GuideIconsContext.Provider value={icons}>
            <EditorDock />
          </GuideIconsContext.Provider>
        </GameDataContext.Provider>
      </EntityContext.Provider>
    </StoresContext.Provider>,
  );
  return { store: stores.editor, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  document.head.replaceChildren();
});

describe("EditorDock tabs", () => {
  it("sets the numbers in its heading in Mono, apart from the words", () => {
    mount();
    const heading = screen.getByRole("heading", { name: "Step 1 of 1" });
    expect([...heading.querySelectorAll(".ui-mono")].map((e) => e.textContent)).toEqual(["1", "1"]);
  });

  it("edits kill XP overrides, clears back to the guide default, and undoes the edit", async () => {
    const { store, user } = mount(
      "-- @sim killmult=0.5\n#displayname Orc guide << Orc -- @sim killmult=0\nstep\n.mob 705 -- keep this\n",
      "simulation",
    );
    const multiplier = () => screen.getByRole("textbox", { name: "Kill XP multiplier" });
    const exact = () => screen.getByRole("textbox", { name: "Exact XP per kill" });
    expect(multiplier()).toHaveProperty("placeholder", "0.5");
    await user.type(multiplier(), "0.25{Enter}");
    expect(store.getState().current!.record.text).toContain("-- @sim killmult=0.25");
    await user.type(exact(), "0{Enter}");
    expect(screen.getByText("Multiplier off while exact XP is set.")).toBeTruthy();
    await user.clear(exact());
    await user.keyboard("{Enter}");
    expect(store.getState().current!.record.text).not.toContain("killxp=");
    await user.clear(multiplier());
    await user.keyboard("{Enter}");
    expect(screen.queryByText("Multiplier off while exact XP is set.")).toBeNull();
    expect(store.getState().current!.record.text).toContain(".mob 705 -- keep this");
    act(() => store.undo());
    expect(multiplier()).toHaveProperty("value", "0.25");
    act(() => store.select({ step: null, line: null }));
    expect(screen.getByRole("tab", { name: "Lines" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("group", { name: "Guide simulation defaults" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Exact XP per kill" })).toBeNull();
    await user.clear(multiplier());
    await user.type(multiplier(), "0.75{Enter}");
    expect(store.getState().current!.record.text).toMatch(/^-- @sim killmult=0.75\n/);
    expect(store.getState().current!.record.text).toContain("#displayname Orc guide << Orc -- @sim killmult=0");
  });
  it("toggles a tag from its checkbox label and shows it checked", async () => {
    const { store, user } = mount(TEXT, "settings");
    const sticky = within(screen.getByRole("group", { name: "Tags" })).getByRole("checkbox", { name: "Sticky" });
    const label = sticky.closest("label")!;
    expect(label.matches(":has(:checked)")).toBe(false);

    await user.click(label);
    expect(sticky).toHaveProperty("checked", true);
    expect(label.matches(":has(:checked)")).toBe(true);
    expect(store.getState().current!.doc.steps[0]!.body.some((l) => l.kind === "tag" && l.name === "sticky")).toBe(true);
  });

  it("shows the step condition's field in the row that its Condition label names", () => {
    mount("#group G\n#name A\nstep << Orc\n.accept 1 >> Hello\n", "settings");
    const condition = within(screen.getByRole("group", { name: "Condition" })).getByRole("textbox", { name: "Step condition" });
    expect(condition).toHaveProperty("value", "Orc");
  });

  it("lists each value tag with its label", () => {
    mount(TEXT, "settings");
    const values = screen.getByRole("group", { name: "Values" });
    const labels = [...values.querySelectorAll("input")].map((input) => input.labels?.[0]?.textContent);
    expect(labels).toEqual(["Label", "Complete with", "Requires", "Minimum level", "XP rate range", "Seasons", "Phase"]);
    expect(within(values).getByRole("textbox", { name: "Label" })).toHaveProperty("value", "Start");
  });

  it("adds each source token to titles, tag fields, and line types while Show guide syntax is on", async () => {
    // user-event refuses to click an element whose computed style has `pointer-events: none`, so with the real stylesheet these clicks also check that the dock's CSS lets its controls take clicks.
    const { user } = mount(TEXT, "lines", { styles: true });
    const outline = () => [...document.querySelectorAll(".outline-title")].map((t) => t.textContent);
    expect(outline()).toEqual(["Label", "Accept quest", "Go to"]);
    const toggle = screen.getByRole("checkbox", {
      name: "Show guide syntax",
      description: "Show syntax, such as .goto, beside each name",
    });
    await user.click(toggle);
    await waitFor(async () => expect((await loadLayout()).showGuideSyntax).toBe(true));
    expect(outline()).toEqual(["Label #label", "Accept quest .accept", "Go to .goto"]);
    expect(screen.getByRole("heading", { level: 3, name: "Accept quest .accept" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add line" }));
    const goto = within(screen.getByRole("combobox", { name: "New line type" })).getByRole("option", { name: "Go to (.goto)" });
    expect(goto).toHaveProperty("value", "goto");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Step settings" }));
    expect(within(screen.getByRole("group", { name: "Values" })).getByRole("textbox", { name: "Label #label" })).toHaveProperty(
      "value",
      "Start",
    );
    expect(within(screen.getByRole("group", { name: "Tags" })).getByRole("checkbox", { name: "Sticky #sticky" })).toBeTruthy();
  });

  it("changes a text line's marker from Text kind", async () => {
    const { store, user } = mount("#group G\n#name A\nstep\n>>Kill wolves\n");
    await user.selectOptions(screen.getByRole("combobox", { name: "Text kind" }), "+");
    expect(store.getState().current!.record.text).toBe("#group G\n#name A\nstep\n+Kill wolves\n");
  });

  it("keeps rejected drafts of a line's text fields when the selection leaves the step and returns", async () => {
    const text = "#group G\n#name A\nstep\n.accept 1 >> Hello\n>>Note\n.foo 1\nstep\n.accept 2\n";
    const { store, user } = mount(text);
    const field = (card: HTMLElement, n: number) =>
      n === 3
        ? within(card).getByRole("combobox", { name: "Line text" })
        : within(card).getByRole("textbox", { name: n === 1 ? ">> Text" : "Text" });
    const drafts = ["Hello -- there", "Note -- there", "step"];
    const shown = [
      'RXP would read ".accept 1 >> Hello -- there" differently',
      'RXP would read ">>Note -- there" differently',
      "A step line starts a new step; use Add step instead.",
    ];
    for (const n of [1, 2, 3]) {
      const card = await showLine(user, n);
      await user.clear(field(card, n));
      await user.type(field(card, n), `${drafts[n - 1]}{Enter}`);
      expect(within(card).getByRole("alert").textContent).toBe(shown[n - 1]);
    }

    act(() => store.select({ step: 1, line: null }));
    act(() => store.select({ step: 0, line: null }));
    for (const n of [1, 2, 3]) {
      const card = await showLine(user, n);
      const draft = field(card, n);
      expect(n === 3 ? (draft as HTMLInputElement).value : shownText(draft)).toBe(drafts[n - 1]);
      expect(within(card).getByRole("alert").textContent).toBe(shown[n - 1]);
    }
    expect(store.getState().current!.record.text).toBe(text);
  });
});

describe("EditorDock command forms", () => {
  it("adds and edits item and level commands, keeping their other arguments and comments", async () => {
    const text = "#group G\n#name A\nstep\n.xp 8+1200,1,Later -- keep\n.maxlevel 14,Later\nstep\n#label Later\n";
    const { store, user } = mount(text);
    const record = () => store.getState().current!.record.text;
    const xp = await showLine(user, 1);
    expect(xp.getAttribute("aria-label")).toBe("Line 1, Reach XP");
    expect(within(xp).getByRole("heading", { level: 3, name: "Reach XP" })).toBeTruthy();
    expect(xp.querySelector(".line-description")!.textContent).toBe(
      "Grind to an XP threshold, or with `skipStep`, skip the step once it is reached.",
    );
    expect(within(xp).getByText("1,200 XP into level 8")).toBeTruthy();
    const level = within(xp).getByRole("textbox", { name: "Level" });
    await user.clear(level);
    await user.type(level, "<9.5{Enter}");
    expect(within(xp).getByText("50% into level 9, reversed")).toBeTruthy();
    const maxlevel = await showLine(user, 2);
    expect(within(maxlevel).getByRole("textbox", { name: "Ref" })).toHaveProperty("value", "Later");
    await user.type(within(maxlevel).getByRole("textbox", { name: "Level" }), "{Backspace}5{Enter}");
    expect(record()).toBe(text.replace(".xp 8+1200,1,Later", ".xp <9.5,1,Later").replace(".maxlevel 14", ".maxlevel 15"));

    await user.click(screen.getByRole("button", { name: "Add line" }));
    const types = [...screen.getByRole<HTMLSelectElement>("combobox", { name: "New line type" }).options];
    expect(types.map((o) => o.value)).toEqual(expect.arrayContaining(["collect", "use", "buy", "xp", "maxlevel"]));
    expect(types.flatMap((o) => (["goto", ">>", "+"].includes(o.value) ? [o.textContent] : []))).toEqual([
      "Go to",
      "Instruction",
      "Text objective",
    ]);
    await user.selectOptions(screen.getByRole("combobox", { name: "New line type" }), "buy");
    await user.click(screen.getByRole("button", { name: "Insert" }));
    const buy = screen.getByRole("group", { name: /^Line 3,/ });
    expect(buy.getAttribute("aria-label")).toBe("Line 3, Buy items");
    expect(document.activeElement).toBe(within(buy).getByRole("combobox", { name: "Item ID" }));
    await user.keyboard("6948{Enter}");
    expect(record()).toContain(".maxlevel 15,Later\n.buy 6948\n");
    act(() => store.undo());
    expect(record()).toContain(".maxlevel 15,Later\n.buy\n");
  });

  it("shows a repeating argument once more, optional arguments one at a time, and every argument of a form command, in sentence case", async () => {
    const lines = [
      [".skipgossip 5,1", ["NPC ID?", "Option", "Option"]],
      [".collect 6948", ["Item ID", "Count?"]],
      [".aura 133", ["Spell ID", "Check?"]],
      [".xp 5", ["Level", "Skip step?", "Ref?"]],
      [".goto Elwynn Forest,48.9,40.1", ["Zone", "X", "Y", "Radius?"]],
      [".fly Stormwind,Ironforge", ["Destination?", "Arg 2"]],
    ] as const;
    const { user } = mount(`#group G\n#name A\nstep\n${lines.map(([line]) => line).join("\n")}\n`);
    const fields = async (n: number) =>
      [...(await showLine(user, n)).querySelector(".command-form")!.querySelectorAll("label")].map(
        (l) => `${l.textContent}${l.control?.getAttribute("placeholder") === "optional" ? "?" : ""}`,
      );
    for (const [i, [, shown]] of lines.entries()) expect(await fields(i + 1)).toEqual(shown);
  });
});

describe("EditorDock kill controls", () => {
  const forever = { data: plannerData(), entities: new EntityIndex(plannerNames) };
  const guide = `#group G
#name Sim
step
    .accept 783
    .turnin 783
    .accept 7
    .accept 33
step
    .complete 7,1 --Kobold Vermin (10)
    .complete 33,1,3
    -- grind here @sim extra=2 mob=299
`;

  function mountSim(builtin = false, text = guide) {
    const builtins = builtin ? { version: "v9.9.9", guides: [{ id: "rxp:test.lua#1", text, order: 0, fileName: "test.lua" }] } : null;
    const library = builtin ? { guides: [], session: { guideId: "rxp:test.lua#1", step: 1, line: null } } : undefined;
    const stores = createStores(
      library ?? { guides: [{ id: "g", text, order: 0 }], session: { guideId: "g", step: 1, line: null } },
      builtins,
      DEFAULT_SAVED_SETTINGS,
    );
    stores.layout.update({ dockTab: "simulation" }, { save: false });
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={forever.data}>
          <EntityContext.Provider value={forever.entities}>
            <EditorDock />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    return { store: stores.editor, user: userEvent.setup() };
  }
  const text = (store: ReturnType<typeof mountSim>["store"]) => store.getState().current!.record.text;
  const kobolds = () => screen.getByRole("group", { name: "Line 1: Kobold Camp Cleanup, Kobold Vermin" });
  const field = (group: HTMLElement, name: string) => within(group).getByRole(name === "Mob" ? "combobox" : "textbox", { name });
  const hints = (group: HTMLElement) => [...group.querySelectorAll(".ui-field-hint")].map((h) => h.textContent);
  const badge = (group: HTMLElement) => group.querySelector<HTMLElement>(".sim-kill-xp")!;
  const breakdown = (group: HTMLElement) =>
    document.getElementById(badge(group).getAttribute("aria-describedby")!)!.querySelector(".sr-only")!.textContent;

  it("sets and clears an objective's kills and mob, keeping the line's comment, one undo step each", async () => {
    const { store, user } = mountSim();
    expect(field(kobolds(), "Kills here")).toHaveProperty("placeholder", "10");
    expect(field(kobolds(), "Mob")).toHaveProperty("placeholder", "Kobold Vermin");
    expect(hints(kobolds())).toEqual(["from quest data", "the objective's mob"]);
    expect(badge(kobolds()).textContent).toBe("+507 xpDING 2 · reaches level 2");
    expect(breakdown(kobolds()).split("\n")).toEqual([
      "10 kills: +507 xp",
      "5 Kobold Vermin at Lv 1",
      "5 Kobold Vermin at Lv 2",
      "Count: from quest data",
      "Mob: the objective's mob",
      "XP: 4 × 50 + 4 × 52 + 1 × 44 + 1 × 55",
      "Level 2 at kill 8 of 10",
    ]);
    await user.hover(badge(kobolds()));
    const card = screen.getByRole("tooltip").querySelector(".sim-card")!;
    expect([...card.children].map((part) => part.textContent)).toEqual([
      "10 kills+507 xp",
      "Kobold VerminLv 1×5Lv 2×5",
      "Countfrom quest dataMobthe objective's mobXP4 × 50 + 4 × 52 + 1 × 44 + 1 × 55",
      "DING 2 · reaches level 2 at kill 8 of 10",
    ]);
    await user.unhover(badge(kobolds()));

    await user.type(field(kobolds(), "Kills here"), "4{Enter}");
    expect(text(store)).toContain(".complete 7,1 --Kobold Vermin (10) @sim kills=4\n");
    expect(hints(kobolds())[0]).toBe("from kills=");
    expect(breakdown(kobolds())).toMatch(/^4 kills: \+\d+ xp\n2 Kobold Vermin at Lv 1\n2 Kobold Vermin at Lv 2\nCount: from kills=\n/);

    await user.type(field(kobolds(), "Mob"), "young");
    await user.keyboard("{ArrowDown}{Enter}{Enter}");
    expect(text(store)).toContain(".complete 7,1 --Kobold Vermin (10) @sim kills=4 mob=299\n");
    expect(breakdown(kobolds())).toMatch(/^4 kills: .*\n4 Young Wolf at Lv \d+\nCount: from kills=\nMob: from mob=\n/);

    act(() => store.undo());
    expect(text(store)).toContain(".complete 7,1 --Kobold Vermin (10) @sim kills=4\n");
    expect(field(kobolds(), "Mob")).toHaveProperty("value", "");

    await user.type(field(kobolds(), "Mob"), "299{Enter}");
    await user.clear(field(kobolds(), "Mob"));
    await user.keyboard("{Enter}");
    expect(text(store)).toContain(".complete 7,1 --Kobold Vermin (10) @sim kills=4\n");
    await user.clear(field(kobolds(), "Kills here"));
    await user.keyboard("{Enter}");
    expect(text(store)).toBe(guide);

    await user.type(field(kobolds(), "Kills here"), "x{Enter}");
    expect(within(kobolds()).getByRole("alert").textContent).toBe("Enter a whole number of zero or more.");
    expect(text(store)).toBe(guide);
  });

  it("adds, edits, and removes extra kills, keeping other comment text, one undo step each", async () => {
    const { store, user } = mountSim();
    const extra = () => screen.getByRole("group", { name: "Extra kills, line 3" });
    const added = () => screen.getByRole("group", { name: "Extra kills, line 4" });
    const adding = () => screen.getByRole("group", { name: "New extra kills" });
    expect(field(extra(), "Count")).toHaveProperty("value", "2");
    expect(field(extra(), "Mob")).toHaveProperty("value", "299");

    await user.type(field(extra(), "Count"), "5{Enter}");
    expect(text(store)).toContain("    -- grind here @sim extra=25 mob=299\n");

    const add = () => within(adding()).getByRole("button", { name: "Add" });
    expect(add()).toHaveProperty("disabled", true);
    await user.type(field(adding(), "Count"), "3");
    expect(add()).toHaveProperty("disabled", true);
    await user.type(field(adding(), "Mob"), "young");
    expect(add()).toHaveProperty("disabled", true);
    await user.clear(field(adding(), "Mob"));
    await user.type(field(adding(), "Mob"), "6");
    expect(add()).toHaveProperty("disabled", false);
    await user.click(add());
    expect(text(store)).toBe(guide.replace("extra=2 ", "extra=25 ") + "    -- @sim extra=3 mob=6\n");
    expect(field(added(), "Count")).toHaveProperty("value", "3");
    expect(field(adding(), "Count")).toHaveProperty("value", "");

    await user.click(within(added()).getByRole("button", { name: "Remove" }));
    await user.click(within(extra()).getByRole("button", { name: "Remove" }));
    expect(text(store)).toContain("    .complete 33,1,3\n    -- grind here\n");
    expect(screen.queryByRole("group", { name: /^Extra kills, / })).toBeNull();

    act(() => store.undo());
    expect(text(store)).toBe(guide.replace("extra=2 ", "extra=25 "));
    act(() => store.undo());
    expect(text(store)).toBe(guide.replace("extra=2 ", "extra=25 ") + "    -- @sim extra=3 mob=6\n");
  });

  it("says what extra kills do only while the step has none", async () => {
    const { user } = mountSim();
    const kills = () => screen.getByRole("group", { name: "Extra kills" });
    const hint = "Add mobs killed beyond quest goals, so the simulation counts their XP.";
    expect(within(kills()).queryByText(hint)).toBeNull();

    await user.click(within(screen.getByRole("group", { name: "Extra kills, line 3" })).getByRole("button", { name: "Remove" }));
    expect(within(kills()).getByText(hint).className).toBe("muted");

    const adding = within(kills()).getByRole("group", { name: "New extra kills" });
    await user.type(field(adding, "Count"), "3");
    await user.type(field(adding, "Mob"), "6");
    await user.click(within(adding).getByRole("button", { name: "Add" }));
    expect(within(kills()).queryByText(hint)).toBeNull();
  });

  it("leaves a mob= that a .complete line shares with its extra kills to Raw", async () => {
    const shared = "    .complete 33,1,3 --meat @sim extra=2 mob=299\n";
    const { store, user } = mountSim(false, guide.replace("    .complete 33,1,3\n", shared));
    const wolves = () => screen.getByRole("group", { name: /^Line 2: Wolves Across the Border/ });
    const extra = () => screen.getByRole("group", { name: "Extra kills, line 2" });
    await user.type(field(wolves(), "Mob"), "6{Enter}");
    expect(within(wolves()).getByRole("alert").textContent).toMatch(/^This line's mob= also names its extra kills/);
    await user.type(field(extra(), "Mob"), "{Backspace}8{Enter}");
    expect(within(extra()).getByRole("alert").textContent).toMatch(/^This line's mob= also names its extra kills/);
    expect(text(store)).toContain(shared);

    await user.type(field(extra(), "Count"), "{Backspace}3{Enter}");
    expect(text(store)).toContain("    .complete 33,1,3 --meat @sim extra=3 mob=299\n");
    await user.click(within(extra()).getByRole("button", { name: "Remove" }));
    expect(text(store)).toContain("    .complete 33,1,3 --meat\n");
    expect(field(wolves(), "Mob")).toHaveProperty("value", "6");
  });

  it("keeps a field's draft with its line when the line moves", async () => {
    const { user } = mountSim();
    await user.type(field(kobolds(), "Mob"), "Kob");
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    expect(screen.getByRole("group", { name: /^Line 1,/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move line down" }));
    await user.click(screen.getByRole("tab", { name: "XP simulation" }));
    expect(field(screen.getByRole("group", { name: /^Line 2: Kobold Camp Cleanup/ }), "Mob")).toHaveProperty("value", "Kob");
    expect(field(screen.getByRole("group", { name: /^Line 1: Wolves Across the Border/ }), "Mob")).toHaveProperty("value", "");
  });

  it("names a .complete line's text-row objective in the kill group title and the objective hint", async () => {
    const { user } = mountSim(false, "#group G\n#name Sim\nstep\n    .accept 76160\nstep\n    .complete 76160,2\n");
    expect(screen.getByRole("group", { name: "Line 1: Stalk With The Earthmother, Windfury Cone" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    expect(hints(await showLine(user, 1))).toContain("Windfury Cone");
  });

  it("edits a built-in's copy and undoes to the built-in", async () => {
    const { store, user } = mountSim(true);
    await user.type(field(kobolds(), "Kills here"), "0{Enter}");
    expect(store.getState().current).toMatchObject({ builtin: false, group: "G (custom)" });
    expect(text(store)).toContain(".complete 7,1 --Kobold Vermin (10) @sim kills=0\n");
    expect(field(kobolds(), "Kills here")).toHaveProperty("value", "0");

    act(() => store.undo());
    expect(store.getState().current).toMatchObject({ id: "rxp:test.lua#1", builtin: true });
    expect(text(store)).toBe(guide);
  });
});

describe("EditorDock raw text guard", () => {
  const BLOCKED = "Step 1 has raw text that is not applied. Apply or discard it before changing its points.";
  const raw = () => screen.getByLabelText("Raw text of step 1") as HTMLTextAreaElement;
  const text = (store: ReturnType<typeof mount>["store"]) => store.getState().current!.record.text;

  it.each(["Enter", "blur"])(
    "refuses a form's coordinate edit committed by %s while raw text waits, keeping both drafts",
    async (commit) => {
      const { store, user } = mount("#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n");
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      await user.type(raw(), "\n.xp 2");
      await user.click(screen.getByRole("tab", { name: "Lines" }));
      const x = () => screen.getByRole("textbox", { name: "X" }) as HTMLInputElement;
      await user.clear(x());
      await user.type(x(), "55");
      if (commit === "Enter") await user.keyboard("{Enter}");
      else await user.tab();
      expect(x().value).toBe("55");
      expect(screen.getByText(BLOCKED)).toBeTruthy();
      expect(text(store)).toBe("#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n");

      await user.click(screen.getByRole("tab", { name: "Raw" }));
      expect(raw().value).toBe("step\n.goto Elwynn Forest,48.94,40.16\n.xp 2");
      await user.click(screen.getByRole("button", { name: "Revert" }));
      await user.click(screen.getByRole("tab", { name: "Lines" }));
      expect(x().value).toBe("55");
      await user.click(x());
      await user.keyboard("{Enter}");
      expect(screen.queryByText(BLOCKED)).toBeNull();
      expect(text(store)).toBe("#group T\n#name One\nstep\n.goto Elwynn Forest,55,40.16\n");
    },
  );

  it("refuses a .line path edit committed by Enter while raw text waits, and takes it after Apply", async () => {
    const { store, user } = mount("#group T\n#name One\nstep\n.line Elwynn Forest,10,20,30,40\n");
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.type(raw(), "\n.xp 2");
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    const line = () => screen.getAllByLabelText("Line text")[0] as HTMLInputElement;
    await user.clear(line());
    await user.type(line(), ".line Elwynn Forest,15,25,35,45");
    await user.keyboard("{Enter}");
    expect(line().value).toBe(".line Elwynn Forest,15,25,35,45");
    expect(screen.getByText(BLOCKED)).toBeTruthy();
    expect(text(store)).toBe("#group T\n#name One\nstep\n.line Elwynn Forest,10,20,30,40\n");

    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(raw().value).toBe("step\n.line Elwynn Forest,10,20,30,40\n.xp 2");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    expect(line().value).toBe(".line Elwynn Forest,10,20,30,40");
    await user.clear(line());
    await user.type(line(), ".line Elwynn Forest,15,25,35,45");
    await user.click(line());
    await user.keyboard("{Enter}");
    expect(screen.queryByText(BLOCKED)).toBeNull();
    expect(text(store)).toBe("#group T\n#name One\nstep\n.line Elwynn Forest,15,25,35,45\n.xp 2\n");
  });
});

describe("EditorDock markup", () => {
  const NOTE = ">>Kill |cRXP_ENEMY_Boars|r for |T133970:0|t|cRXP_LOOT_[Boar Meat]|r";
  const DESTROY = ".destroy 6948 >> Discard |T134414:0|t[Hearthstone]";

  it("shows marked-up text readably and keeps the markup through edits", async () => {
    const { store, user } = mount(`#group G\n#name A\nstep\n${NOTE}\n${DESTROY}\n.accept 1 >> |cFFfa9602Hello|r\n`);
    const shows = (card: HTMLElement) => card.querySelector(".shows-as")!.textContent;
    const note = await showLine(user, 1);
    expect(shows(note)).toBe("Shows as: Kill Boars for [Boar Meat]");
    const shownColors = [...note.querySelectorAll<HTMLElement>(".shows-as .rxp-colored")].map((el) => [el.dataset.color, el.textContent]);
    expect(shownColors).toEqual([
      ["ENEMY", "Boars"],
      ["LOOT", "[Boar Meat]"],
    ]);
    const noteText = within(note).getByRole("textbox", { name: "Text" });
    expect(shownText(noteText)).toBe("Kill Boars for |T133970:0|t[Boar Meat]");
    expect([...noteText.querySelectorAll(".rxp-colored")].map((el) => el.textContent)).toEqual(["Boars", "[Boar Meat]"]);
    const destroy = await showLine(user, 2);
    expect(shows(destroy)).toBe("Shows as: Discard [Hearthstone]");
    expect(within(destroy).getByRole("combobox", { name: "Item ID" })).toHaveProperty("value", "6948");
    expect(shownText(within(destroy).getByRole("textbox", { name: ">> Text" }))).toBe(DESTROY.slice(".destroy 6948 >> ".length));
    const accept = await showLine(user, 3);
    expect(shows(accept)).toBe("Shows as: Hello");
    expect(shownText(within(accept).getByRole("textbox", { name: ">> Text" }))).toBe("|cFFfa9602Hello|r");

    await user.click(screen.getByRole("tab", { name: "Step settings" }));
    await user.click(within(screen.getByRole("group", { name: "Tags" })).getByRole("checkbox", { name: "Sticky" }));
    const record = store.getState().current!.record;
    expect(record.text).toContain(`${NOTE}\n${DESTROY}\n.accept 1 >> |cFFfa9602Hello|r\n`);
  });
});

describe("EditorDock entity links", () => {
  const links = (el: HTMLElement) =>
    within(el)
      .queryAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);

  it("links command IDs beside their fields and keeps the arguments as written", async () => {
    const lines = [".turnin -33", ".target +196;Brother Danil;Old::240", ".use 6948:p", ".skipgossip 3", ".collect 6948/99999,3,33"];
    const text = `#group G\n#name A\nstep\n${lines.join("\n")}\n`;
    const { store, user } = mount(text);
    expect(links(await showLine(user, 2))).toEqual([
      ["Eagan Peltskinner", "https://www.wowhead.com/forever/npc=196"],
      ["npc #240", "https://www.wowhead.com/forever/npc=240"],
    ]);
    expect(links(await showLine(user, 3))).toEqual([["Hearthstone", "https://www.wowhead.com/forever/item=6948"]]);
    expect(links(await showLine(user, 4))).toEqual([]);
    expect(links(await showLine(user, 5))).toEqual([
      ["Hearthstone", "https://www.wowhead.com/forever/item=6948"],
      ["item #99999", "https://www.wowhead.com/forever/item=99999"],
      ["Wolves Across the Border", "https://www.wowhead.com/forever/quest=33"],
    ]);

    const turnin = await showLine(user, 1);
    expect(links(turnin)).toEqual([["Wolves Across the Border", "https://www.wowhead.com/forever/quest=33"]]);
    const quest = within(turnin).getByRole("combobox", { name: "Quest ID" });
    expect(quest).toHaveProperty("value", "-33");
    await user.clear(quest);
    await user.type(quest, "-34");
    expect(links(turnin)).toEqual([["quest #34", "https://www.wowhead.com/forever/quest=34"]]);
    expect(store.getState().current!.record.text).toBe(text);
  });

  it("chooses a .macro icon from the guide's icons and writes its FileDataID", async () => {
    const text = "#group G\n#name A\nstep\n.macro Roar,134400 >>/cast |T132121:0|tRoar\n";
    const { store, user } = mount(text);
    const card = await showLine(user, 1);
    const icon = within(card).getByRole("textbox", { name: "Icon" });
    await user.click(within(card).getByRole("button", { name: "Choose icon" }));
    const dialog = screen.getByRole("dialog", { name: "Choose icon" });
    await user.click(within(dialog).getByRole("checkbox", { name: "In this guide" }));
    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option) => option.textContent.trim()),
    ).toEqual(["ability druid demoralizingroar ability #132121"]);
    await user.click(within(dialog).getByRole("combobox", { name: "Icon name or ID" }));
    await user.keyboard("{Enter}");
    expect([screen.queryByRole("dialog"), icon]).toEqual([null, expect.objectContaining({ value: "132121" })]);
    await user.click(icon);
    await user.keyboard("{Enter}");
    expect(store.getState().current!.record.text).toBe("#group G\n#name A\nstep\n.macro Roar,132121 >> /cast |T132121:0|tRoar\n");
  });

  it("links references in the text as RXP shows it, never color names or textures", async () => {
    const note = ">>Use Hearthstone (item #6948) and talk to |cRXP_FRIENDLY_Eagan::196|r";
    const loot = ">>Loot |cRXP_LOOT_Hearthstone|r |T134414:0|t[Hearthstone]";
    const { user } = mount(`#group G\n#name A\nstep\n${note}\n${loot}\n`);
    const card = await showLine(user, 1);
    const shows = card.querySelector<HTMLElement>(".shows-as")!;
    expect(shows.textContent).toBe("Shows as: Use Hearthstone (item #6948) and talk to Eagan Peltskinner");
    expect(links(shows)).toEqual([
      ["Hearthstone (item #6948)", "https://www.wowhead.com/forever/item=6948"],
      ["Eagan Peltskinner", "https://www.wowhead.com/forever/npc=196"],
    ]);
    expect(shownText(within(card).getByRole("textbox", { name: "Text" }))).toBe("Use Hearthstone (item #6948) and talk to Eagan::196");
    const lootCard = await showLine(user, 2);
    expect(lootCard.querySelector(".shows-as")!.textContent).toBe("Shows as: Loot Hearthstone [Hearthstone]");
    expect(links(lootCard)).toEqual([]);
  });
});

describe("EditorDock outline", () => {
  const STEP = "#group G\n#name A\nstep\n#sticky\n.accept 1\n-- @sim extra=2 mob=6\n.goto Elwynn Forest,1,1\n";
  const shownGroup = () => screen.getByRole("group", { name: /^Line \d+, / });
  const record = (store: ReturnType<typeof mount>["store"]) => store.getState().current!.record.text;
  const insertAt = async (user: ReturnType<typeof mount>["user"], label: string) => {
    await user.click(screen.getByRole("button", { name: label }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
  };

  it("marks each line's heading as the steps list does, and sets a note's leading icon apart from its text in the outline", () => {
    mount("#group G\n#name A\nstep\n.accept 33\n>>|T308474:0|t Ask him\n");
    expect(document.querySelector(".line-title .mk")!.className).toBe("mk mk-accept tex");
    const outline = [...document.querySelectorAll(".outline-summary")];
    expect(outline.map((row) => [...row.children].map((item) => item.getAttribute("aria-label") ?? item.textContent))).toEqual([
      ["Accept Wolves Across the Border"],
      ["chatbubble 64grey", " Ask him"],
    ]);
  });

  it("shows the first line that Lines edits without selecting it, and links settings and simulation rows to their tabs", async () => {
    const { store, user } = mount(STEP);
    expect(shownGroup().getAttribute("aria-label")).toBe("Line 2, Accept quest");
    expect(store.getState().selection).toEqual({ step: 0, line: null });

    const sticky = await showLine(user, 1);
    expect(sticky.getAttribute("aria-label")).toBe("Line 1, Sticky");
    expect(store.getState().selection).toEqual({ step: 0, line: 0 });
    await user.click(within(sticky).getByRole("button", { name: "Open Step settings" }));
    expect(screen.getByRole("tab", { name: "Step settings" }).getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Lines" }));
    const sim = await showLine(user, 3);
    expect(sim.getAttribute("aria-label")).toBe("Line 3, Simulation data");
    await user.click(within(sim).getByRole("button", { name: "Open XP simulation" }));
    expect(screen.getByRole("tab", { name: "XP simulation" }).getAttribute("aria-selected")).toBe("true");
  });

  it("summarizes each line in the outline, with names for IDs and without markup", () => {
    mount(
      [
        "#group G",
        "#name A",
        "step",
        "#label Start",
        ".accept 33",
        ".mob Young Wolf",
        ">>Loot |cRXP_LOOT_Hearthstone|r |T134414:0|t[Hearthstone]",
        ".destroy 6948 >> Discard |T134414:0|t[Hearthstone]",
        ".destroy 6948",
        "<< Orc",
        "--   keep this ",
        "bare text",
        "",
      ].join("\n"),
    );
    const rows = [...document.querySelectorAll(".outline-row")].map((row) => [
      row.querySelector(".outline-title")!.textContent,
      row.querySelector(".outline-summary")!.textContent,
    ]);
    expect(rows).toEqual([
      ["Label", "Label Start"],
      ["Accept quest", "Accept Wolves Across the Border"],
      ["Kill", "Young Wolf"],
      ["Instruction", "Loot Hearthstone [Hearthstone]"],
      ["Destroy item", "Discard [Hearthstone]"],
      ["Destroy item", "Destroy Hearthstone"],
      ["Condition only", "Orc"],
      ["Comment", "keep this"],
      ["Unrecognized line", "bare text"],
    ]);
  });

  it("explains a step with only settings and simulation lines, and an empty step", async () => {
    const { store, user } = mount("#group G\n#name A\nstep\n#sticky\n-- @sim extra=2 mob=6\nstep\n");
    expect(screen.queryByRole("group", { name: /^Line / })).toBeNull();
    expect(screen.getByText("This step has only settings or simulation lines")).toBeTruthy();
    expect(store.getState().selection).toEqual({ step: 0, line: null });
    await user.click(screen.getByRole("button", { name: "Open XP simulation" }));
    expect(screen.getByRole("tab", { name: "XP simulation" }).getAttribute("aria-selected")).toBe("true");

    act(() => store.select({ step: 1, line: null }));
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    expect(screen.getByText("No lines in this step")).toBeTruthy();
    await insertAt(user, "Add line");
    expect(record(store)).toBe("#group G\n#name A\nstep\n#sticky\n-- @sim extra=2 mob=6\nstep\n.accept\n");
  });

  it("inserts at each gap's line around settings and simulation rows, and Add line appends with no selected line", async () => {
    const { store, user } = mount(STEP);
    await insertAt(user, "Add line");
    expect(record(store)).toBe(`${STEP}.accept\n`);
    expect(store.getState().selection).toEqual({ step: 0, line: 4 });
    expect(document.activeElement).toBe(within(shownGroup()).getByRole("combobox", { name: "Quest ID" }));

    await insertAt(user, "Insert a line before line 3");
    expect(record(store)).toBe(
      "#group G\n#name A\nstep\n#sticky\n.accept 1\n.accept\n-- @sim extra=2 mob=6\n.goto Elwynn Forest,1,1\n.accept\n",
    );
    expect(shownGroup().getAttribute("aria-label")).toBe("Line 3, Accept quest");
    await insertAt(user, "Insert a line first");
    expect(record(store)).toMatch(/^#group G\n#name A\nstep\n\.accept\n#sticky\n/);
    expect(store.getState().selection).toEqual({ step: 0, line: 0 });
  });

  it("focuses an inserted line's first field only once, so a later edit keeps the focus the user moved", async () => {
    const { store, user } = mount(STEP);
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "New line type" }), "buy");
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await user.keyboard("6948{Enter}");
    const count = within(shownGroup()).getByRole("textbox", { name: "Count" });
    await user.type(count, "2{Enter}");
    expect(record(store)).toBe(`${STEP}.buy 6948,2\n`);
    expect(document.activeElement).toBe(count);
  });

  it("offers Focus on map on a line that names a place, and says why when no map can show it", async () => {
    const { user } = mount("#group G\n#name A\nstep\n.goto Elwynn Forest,1,1\n+Talk to someone\n>>Find Eagan Peltskinner (npc #196)\n");
    const focusOf = (line: HTMLElement) => within(line).queryByRole("button", { name: "Focus on map" });
    const coordinate = await showLine(user, 1);
    await user.click(focusOf(coordinate)!);
    expect(within(coordinate).getByRole("status").textContent).toBe("Open the Edit map to focus on a place.");
    expect(focusOf(await showLine(user, 2))).toBeNull();
    expect(focusOf(await showLine(user, 3))).not.toBeNull();
  });

  it("moves and deletes the shown line by its place in the step, and undo restores it", async () => {
    const { store, user } = mount(STEP);
    await showLine(user, 4);
    await user.click(screen.getByRole("button", { name: "Move line up" }));
    expect(record(store)).toBe("#group G\n#name A\nstep\n#sticky\n.accept 1\n.goto Elwynn Forest,1,1\n-- @sim extra=2 mob=6\n");
    expect(shownGroup().getAttribute("aria-label")).toBe("Line 3, Go to");
    await user.click(screen.getByRole("button", { name: "Delete line" }));
    expect(record(store)).toBe("#group G\n#name A\nstep\n#sticky\n.accept 1\n-- @sim extra=2 mob=6\n");
    act(() => store.undo());
    expect(record(store)).toBe("#group G\n#name A\nstep\n#sticky\n.accept 1\n.goto Elwynn Forest,1,1\n-- @sim extra=2 mob=6\n");
  });

  it("edits a header tag as its own line, and keeps the guide's kill XP multiplier on header Lines", async () => {
    const { store, user } = mount("#group G\n#name A\n-- @sim killmult=0.5\nstep\n.accept 1\n");
    act(() => store.select({ step: null, line: null }));
    expect([...document.querySelectorAll(".outline-title")].map((t) => t.textContent)).toEqual([
      "Guide group",
      "Guide name",
      "Simulation data",
    ]);
    const name = await showLine(user, 2);
    const field = within(name).getByRole("combobox", { name: "Line text" });
    await user.clear(field);
    await user.type(field, "#name B{Enter}");
    expect(record(store)).toBe("#group G\n#name B\n-- @sim killmult=0.5\nstep\n.accept 1\n");
    const multiplier = within(screen.getByRole("group", { name: "Guide simulation defaults" })).getByRole("textbox", {
      name: "Kill XP multiplier",
    });
    await user.clear(multiplier);
    await user.type(multiplier, "0.25{Enter}");
    expect(record(store)).toBe("#group G\n#name B\n-- @sim killmult=0.25\nstep\n.accept 1\n");
  });

  it("summarizes More options while closed, and keeps it open with its rejected draft while the draft has an error", async () => {
    const { store, user } = mount("#group G\n#name A\nstep\n.accept 1,2 << Orc -- note\n.goto Elwynn Forest,1,1\n");
    const more = () => screen.getByRole("button", { name: /^More options/ });
    const condition = () => screen.getByRole("textbox", { name: "Line condition" });
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect(more().textContent).toBe("More options · Condition Orc · flags 2 · Comment");
    expect(screen.queryByRole("textbox", { name: "Line condition" })).toBeNull();

    await user.click(more());
    await user.clear(condition());
    await user.type(condition(), "Orc -- x{Enter}");
    const error = screen.getByRole("alert").textContent;
    await user.click(more());
    expect(more().getAttribute("aria-expanded")).toBe("true");
    await showLine(user, 2);
    await showLine(user, 1);
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(condition()).toHaveProperty("value", "Orc -- x");
    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(record(store)).toBe("#group G\n#name A\nstep\n.accept 1,2 << Orc -- note\n.goto Elwynn Forest,1,1\n");
  });

  it("keeps More options open, with the focus in its field, after its rejected draft is fixed", async () => {
    const { store, user } = mount("#group G\n#name A\nstep\n.accept 1 << Orc\n.goto Elwynn Forest,1,1\n");
    const more = () => screen.getByRole("button", { name: /^More options/ });
    const condition = () => screen.getByRole("textbox", { name: "Line condition" });
    await user.click(more());
    await user.clear(condition());
    await user.type(condition(), "Orc -- x{Enter}");
    await user.click(more());
    await showLine(user, 2);
    await showLine(user, 1);

    await user.clear(condition());
    await user.type(condition(), "Troll{Enter}");
    expect(record(store)).toBe("#group G\n#name A\nstep\n.accept 1 << Troll\n.goto Elwynn Forest,1,1\n");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(condition());
  });
});

describe("EditorDock button looks", () => {
  it("gives each line's insert button the 24px square of an icon button", () => {
    mount();
    const inserts = screen.getAllByRole("button", { name: /^Insert a line/ });
    expect(inserts.length).toBeGreaterThan(1);
    // A round button takes clicks only inside its circle, so the line rows under its corners would take them.
    expect(inserts.map((button) => ["height", "width", "border-radius"].map((property) => cascade(button, property)?.value))).toEqual(
      Array(inserts.length).fill(["var(--control-small)", "var(--control-small)", "var(--radius-control)"]),
    );
  });

  it("draws no open-trigger look on More options and the line condition filters, which show content in place", async () => {
    const { user } = mount("#group G\n#name A\nstep\n.accept 1,2 << Orc -- note\n.goto Elwynn Forest,1,1\n");
    await user.click(screen.getByRole("button", { name: /^More options/ }));
    await user.click(screen.getByRole("button", { name: "Show line condition filters" }));
    const shown = [
      screen.getByRole("button", { name: /^More options/ }),
      screen.getByRole("button", { name: "Hide line condition filters" }),
    ];
    expect(
      shown.map((button) => [
        button.getAttribute("aria-expanded"),
        cascade(button, "background")?.value,
        cascade(button, "box-shadow")?.value,
      ]),
    ).toEqual(Array(2).fill(["true", "none", undefined]));
  });
});

describe("EditorDock drafts", () => {
  const raw = () => screen.getByLabelText<HTMLTextAreaElement>("Raw text of step 1");

  it("keeps a rejected draft when an edit of another field on its line is undone", async () => {
    const { store, user } = mount("#group T\n#name One\nstep\n.accept 1 >> First\n");
    const line = () => screen.getByRole("group", { name: "Line 1, Accept quest" });
    const text = () => within(line()).getByLabelText(">> Text");
    await user.clear(text());
    await user.type(text(), "Rejected -- draft{Enter}");
    expect(within(line()).getByRole("alert").textContent).toMatch(/RXP would read/);

    await user.clear(within(line()).getByLabelText("Quest ID"));
    await user.type(within(line()).getByLabelText("Quest ID"), "10{Enter}");
    expect(within(line()).getByLabelText("Quest ID")).toHaveProperty("value", "10");
    expect(shownText(text())).toBe("Rejected -- draft");

    act(() => store.undo());
    expect(within(line()).getByLabelText("Quest ID")).toHaveProperty("value", "1");
    expect(shownText(text())).toBe("Rejected -- draft");
    expect(within(line()).getByRole("alert").textContent).toMatch(/RXP would read/);
  });

  it("keeps a raw draft when an edit of its step is undone and redone", async () => {
    const { store, user } = mount("#group T\n#name Two\nstep\n.accept 1\nstep\n.accept 2\n", "raw");
    await user.type(raw(), "0");
    await user.click(screen.getByRole("tab", { name: "Step settings" }));
    await user.click(screen.getByRole("checkbox", { name: "Sticky" }));
    act(() => store.undo());
    expect(screen.getByRole("checkbox", { name: "Sticky" })).toHaveProperty("checked", false);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(raw().value).toBe("step\n.accept 10");
    act(() => store.redo());
    expect(raw().value).toBe("step\n.accept 10");
  });

  it("keeps a new extra kill's count and mob for Add when the form leaves the page", async () => {
    const { user } = mount("#group T\n#name One\nstep\n.accept 1\n", "simulation");
    const adding = () => screen.getByRole("group", { name: "New extra kills" });
    await user.type(within(adding()).getByLabelText("Count"), "3{Enter}");
    await user.type(within(adding()).getByLabelText("Mob"), "6");
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.click(screen.getByRole("tab", { name: "XP simulation" }));
    expect(within(adding()).getByLabelText("Count")).toHaveProperty("value", "3");
    expect(within(adding()).getByLabelText("Mob")).toHaveProperty("value", "6");

    await user.click(within(adding()).getByRole("button", { name: "Add" }));
    expect(within(adding()).getByLabelText("Count")).toHaveProperty("value", "");
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(raw().value).toBe("step\n.accept 1\n-- @sim extra=3 mob=6");
  });
});

describe("EditorDock without names", () => {
  const TEXT = "#group G\n#name A\nstep\n.use 6948\n>>Use Hearthstone (item #6948)\nstep\n.xp 2\n";
  const names = new EntityIndex({
    version: 2,
    entities: { item: [[6948, "Hearthstone"]], quest: [[1, "Q"]], npc: [[1, "N"]], spell: [[1, "S"]], object: [[1, "O"]] },
  });
  const open = (index: EntityIndex | null) =>
    render(
      <StoresContext.Provider
        value={createStores({ guides: [{ id: "g", text: TEXT, order: 0 }], session: { guideId: "g", step: 0, line: null } })}
      >
        <GameDataContext.Provider value={plannerData()}>
          <EntityContext.Provider value={index}>
            <EntityErrorContext.Provider value={!index}>
              <EditorDock />
            </EntityErrorContext.Provider>
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
  const lineLinks = async (user: ReturnType<typeof userEvent.setup>, n: number) =>
    within(await showLine(user, n))
      .getAllByRole("link")
      .map((a) => a.textContent);

  it("links by ID when names fail to load and by name after a remount", async () => {
    const user = userEvent.setup();
    const view = open(null);
    expect(await lineLinks(user, 1)).toEqual(["item #6948"]);
    expect(await lineLinks(user, 2)).toEqual(["(item #6948)"]);

    view.unmount();
    open(names);
    expect(await lineLinks(user, 1)).toEqual(["Hearthstone"]);
    expect(await lineLinks(user, 2)).toEqual(["Hearthstone (item #6948)"]);
  });
});

describe("EditorNotices", () => {
  it("says why no guide is open when RXP removed the saved open guide, and does not open the guide now at its dungeon ID", () => {
    const builtins = {
      version: "v4.11.26",
      guides: [
        {
          id: "rxp:dungeon/Horde-12-22_Barrens.lua#5",
          text: "#group RestedXP Forever Dungeon Guide (H)\n#name 12-22 The Barrens\nstep\n",
          order: 0,
          fileName: "dungeon/Horde-12-22_Barrens.lua",
        },
      ],
    };
    const stores = createStores({ guides: [], session: { guideId: "rxp:Horde-12-22_Barrens.lua#3", step: 0, line: null } }, builtins);
    render(
      <StoresContext.Provider value={stores}>
        <EditorNotices />
      </StoresContext.Provider>,
    );
    expect(stores.editor.getState().current).toBeNull();
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([
      "The guide open last time (rxp:Horde-12-22_Barrens.lua#3) is no longer in the library.",
    ]);
  });
});

describe("EditorDock beside the step list", () => {
  const bundled = (file: string) =>
    extractGuides(readFileSync(join(import.meta.dirname, "../../guides/rxp-forever", file), "utf8")).map((g) =>
      g.text.replace(/\r\n?/g, "\n"),
    );
  const mage = [...bundled("Alliance-Mage-1-12.lua"), ...bundled("Alliance-Mage-12-21.lua")];
  const mageParts = mage[0]!.split(/\n(?=step\b)/);
  const OpenEditor = () => (useEditorPanel() === "open" ? <EditorDock /> : null);

  function mountBeside(library: StoredLibrary, builtins?: Builtins) {
    const stores = createStores(library, builtins, { ...DEFAULT_SAVED_SETTINGS, preview: { ...DEFAULT_SETTINGS, class: "MAGE" } });
    render(
      <StoresContext.Provider value={stores}>
        <EntityContext.Provider value={entities}>
          <StepList />
          <EditorNotices />
          <OpenEditor />
        </EntityContext.Provider>
      </StoresContext.Provider>,
    );
    return { store: stores.editor, user: userEvent.setup() };
  }
  const openGuides = (texts: string[]) =>
    mountBeside({ guides: texts.map((text, i) => ({ id: `g${i}`, text, order: i })), session: { guideId: "g0", step: null, line: null } });
  const selectStep = (user: UserEvent, index: number) => user.click(document.getElementById(`step-${index}`)!);
  const addBlankStep = async (user: UserEvent) => {
    await user.click(screen.getByRole("button", { name: "Add step" }));
    const dialog = screen.getByRole("dialog", { name: /^Add (after|at)/ });
    await user.click(within(dialog).getByRole("tab", { name: "Blank step" }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
  };

  it("edits a step as raw text", async () => {
    const { user } = openGuides(mage);
    await selectStep(user, 1);
    await user.click(screen.getByRole("tab", { name: "Raw" }));

    const raw = screen.getByLabelText("Raw text of step 2");
    expect((raw as HTMLTextAreaElement).value).toBe(mageParts[2]);

    await user.clear(raw);
    await user.type(raw, ".xp 22");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe("Step text must start with a step line.");
    expect((raw as HTMLTextAreaElement).value).toBe(".xp 22");

    await user.clear(raw);
    await user.type(raw, "step << Mage{Enter}.xp 22{Enter}step{Enter}.hs >> Hearth");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Guide text" }));
    const text = screen.getByLabelText("Guide text, read only").textContent;
    expect(text).toContain(`${mageParts[0]}\n${mageParts[1]}\n`);
    expect(text).toContain("step << Mage\n.xp 22\nstep\n.hs >> Hearth\nstep\n    .goto 1429/0,-162.62,-8902.59");
    expect(document.getElementById("step-2")!.textContent).toContain("Hearth");
  });

  it("keeps a Raw draft when the selection or view changes, and refuses it after its section changes", async () => {
    const { user } = openGuides(mage);
    await selectStep(user, 1);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.type(screen.getByLabelText("Raw text of step 2"), "{Enter}.xp 22");

    await selectStep(user, 3);
    await selectStep(user, 1);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Raw text of step 2").value).toMatch(/\n\.xp 22$/);
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Raw text of step 2").value).toMatch(/\n\.xp 22$/);

    await user.click(screen.getByRole("tab", { name: "Step settings" }));
    await user.click(screen.getByRole("checkbox", { name: "Sticky" }));
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "This section changed after this Raw draft began. Copy the draft if needed, then Revert to load the current section.",
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("Raw text of step 2").value).toBe(`${mageParts[2]}\n.xp 22`);
    await user.click(screen.getByRole("button", { name: "Revert" }));
    const current = (screen.getByLabelText("Raw text of step 2") as HTMLTextAreaElement).value;
    expect(current.split("\n").slice(0, 2)).toEqual(["step", "    #sticky"]);
    await user.type(screen.getByLabelText("Raw text of step 2"), "{Enter}.xp 23");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Raw text of step 2").value).toBe(`${current}\n.xp 23`);
  });

  describe("drafts belong to their step", () => {
    const openRaw = async (text: string) => {
      const mounted = openGuides([text]);
      await mounted.user.click(screen.getByRole("tab", { name: "Raw" }));
      return mounted;
    };
    const raw = (step: number) => screen.getByLabelText(`Raw text of step ${step}`) as HTMLTextAreaElement;
    const apply = () => screen.getByRole("button", { name: "Apply" });

    it("drops a deleted step's draft and brings it back on undo", async () => {
      const { store, user } = await openRaw("#group T\n#name Two\nstep\n.accept 1\nstep\n.accept 2\n");
      await selectStep(user, 0);
      await user.type(raw(1), "0");
      await user.click(screen.getByLabelText("Delete step 1"));
      expect(raw(1).value).toBe("step\n.accept 2");
      expect(apply()).toHaveProperty("disabled", true);
      act(() => store.undo());
      await selectStep(user, 0);
      expect(raw(1).value).toBe("step\n.accept 10");
    });

    it("moves a draft with its step and keeps it through edits of that step", async () => {
      const { user } = await openRaw("#group T\n#name Two\nstep\n.accept 1\nstep\n.accept 2\n");
      await selectStep(user, 0);
      await user.type(raw(1), "0");
      await user.click(screen.getByRole("button", { name: "Move step down" }));
      expect(raw(2).value).toBe("step\n.accept 10");
      await user.click(screen.getByRole("tab", { name: "Step settings" }));
      await user.click(screen.getByRole("checkbox", { name: "Sticky" }));
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      expect(raw(2).value).toBe("step\n.accept 10");
      await selectStep(user, 0);
      expect(raw(1).value).toBe("step\n.accept 2");
      expect(apply()).toHaveProperty("disabled", true);
    });

    it("does not give a deleted step's draft to an identical step", async () => {
      const { user } = await openRaw("#group T\n#name Twins\nstep\n.accept 1\nstep\n.accept 1\n");
      await selectStep(user, 0);
      await user.type(raw(1), "0");
      await user.click(screen.getByLabelText("Delete step 1"));
      expect(raw(1).value).toBe("step\n.accept 1");
      expect(apply()).toHaveProperty("disabled", true);
    });
  });

  describe("built-in drafts", () => {
    const text = "#group G\n#name A\nstep\n.accept 1 >> Hello\n";
    const builtins = { version: "v1", guides: [{ id: "rxp:a", text, order: 0 }] };
    const mountStore = () => mountBeside({ guides: [], session: { guideId: "rxp:a", step: 0, line: null } }, builtins);
    const lineOwner = (store: EditorStore): DraftOwner => {
      const { doc, id } = store.getState().current!;
      return { object: doc.steps[0]!.body[0]!, guide: id };
    };
    const typeRaw = async (user: UserEvent, value: string) => {
      const raw = screen.getByLabelText("Raw text of step 1");
      await user.clear(raw);
      await user.type(raw, value);
    };
    it("keeps both guides' drafts when an edit of the built-in opens its copy", async () => {
      const { store, user } = mountStore();
      act(
        () =>
          void editSection(store, 0, (d) => updateLine(d, { step: 0, index: 0 }, (l) => setText(l as CommandLine, "Copy")), undefined, 0),
      );
      const copy = store.getState().current!.id;
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      await typeRaw(user, "step\n.accept 77");
      writeDraft(lineOwner(store), "questId", { draft: "77", error: null });

      act(() => store.open("rxp:a"));
      await typeRaw(user, "step\n.accept 88");
      writeDraft(lineOwner(store), "questId", { draft: "88", error: null });
      await user.click(screen.getByRole("tab", { name: "Lines" }));
      selectText(screen.getByLabelText(">> Text"), "Hello".length);
      await user.keyboard("X{Enter}");

      const message = "Opened your copy in “G (custom)”. Make the change there.";
      expect(store.getState().current!.id).toBe(copy);
      expect(screen.getByText(message).getAttribute("role")).toBe("status");
      expect(shownText(screen.getByLabelText(">> Text"))).toBe("Copy");
      expect(readDraft(lineOwner(store), "questId").draft).toBe("77");
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");

      act(() => store.open("rxp:a"));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 88");
      expect(readDraft(lineOwner(store), "questId").draft).toBe("88");
      await user.click(screen.getByRole("tab", { name: "Lines" }));
      expect(shownText(screen.getByLabelText(">> Text"))).toBe("HelloX");
      expect(screen.getByRole("alert").textContent).toBe(message);

      await user.click(screen.getByRole("button", { name: "Close editor" }));
      act(() => store.open("rxp:a"));
      act(
        () =>
          void editSection(store, 0, (d) => updateLine(d, { step: 0, index: 0 }, (l) => setText(l as CommandLine, "Map")), undefined, 0),
      );
      expect(document.getElementById("step-detail")).toBeNull();
      expect(screen.getByText(message).getAttribute("role")).toBe("status");
    });

    it("moves a built-in's drafts to the copy that Add step makes", async () => {
      const { store, user } = mountStore();
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      await typeRaw(user, "step\n.accept 77");
      await addBlankStep(user);
      expect(store.getState().current!.builtin).toBe(false);

      await user.click(document.getElementById("step-0")!);
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");
      act(() => store.open("rxp:a"));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 1 >> Hello");
    });

    it("gives the drafts back when the first copy is undone, and moves them to the next copy", async () => {
      const { store, user } = mountStore();
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      await typeRaw(user, "step\n.accept 77");
      await addBlankStep(user);
      const first = store.getState().current!.id;

      act(() => store.undo());
      await user.click(document.getElementById("step-0")!);
      expect(store.getState().current!.id).toBe("rxp:a");
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");

      await addBlankStep(user);
      expect(store.getState().canRedo).toBe(false);
      expect(store.getState().current!.id).not.toBe(first);
      await user.click(document.getElementById("step-0")!);
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");
      act(() => store.open("rxp:a"));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 1 >> Hello");
    });

    it("moves the drafts back to the copy when the first copy is redone", async () => {
      const { store, user } = mountStore();
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      await typeRaw(user, "step\n.accept 77");
      await addBlankStep(user);
      const copy = store.getState().current!.id;

      act(() => store.undo());
      await user.click(document.getElementById("step-0")!);
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");

      act(() => store.redo());
      expect(store.getState().current!.id).toBe(copy);
      await user.click(document.getElementById("step-0")!);
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");
      act(() => store.open("rxp:a"));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 1 >> Hello");
    });

    const copyWithDraft = async (user: UserEvent) => {
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      await typeRaw(user, "step\n.accept 77");
      await addBlankStep(user);
      await user.click(document.getElementById("step-0")!);
    };

    it("does not bring back an applied draft when a copy and later edits are redone", async () => {
      const { store, user } = mountStore();
      await copyWithDraft(user);
      await user.click(screen.getByRole("button", { name: "Apply" }));
      await user.click(screen.getByRole("tab", { name: "Lines" }));
      await user.clear(screen.getByLabelText("Quest ID"));
      await user.type(screen.getByLabelText("Quest ID"), "88{Enter}");

      act(() => [0, 1, 2].forEach(() => store.undo()));
      expect(store.getState().current!.id).toBe("rxp:a");
      act(() => [0, 1, 2].forEach(() => store.redo()));
      await user.click(screen.getByRole("tab", { name: "Raw" }));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 88");
      expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty("disabled", true);
      act(() => store.open("rxp:a"));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 1 >> Hello");
    });

    it("does not bring back a draft discarded in the copy when the copy is redone", async () => {
      const { store, user } = mountStore();
      await copyWithDraft(user);
      await user.click(screen.getByRole("button", { name: "Revert" }));

      act(() => store.undo());
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");
      act(() => store.redo());
      await user.click(document.getElementById("step-0")!);
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 1 >> Hello");
      expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty("disabled", true);
    });

    it("keeps a draft pending in the copy through undo and redo of the copy", async () => {
      const { store, user } = mountStore();
      await copyWithDraft(user);
      await typeRaw(user, "step\n.accept 99");

      act(() => store.undo());
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 77");
      act(() => store.redo());
      await user.click(document.getElementById("step-0")!);
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 99");
      act(() => store.open("rxp:a"));
      expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.accept 1 >> Hello");
    });
  });

  it("keeps links out of the step list and buttons, and following one keeps the selection", async () => {
    const { user } = mountBeside({
      guides: [{ id: "g", text: "#group G\n#name A\nstep\n.use 6948\n>>Use Hearthstone (item #6948)\nstep\n.xp 2\n", order: 0 }],
      session: { guideId: "g", step: 0, line: null },
    });
    within(screen.getByRole("region", { name: "Editor" })).getByRole("link", { name: "Hearthstone" });
    const link = within(await showLine(user, 2)).getByRole("link", { name: "Hearthstone (item #6948)" });
    expect(document.querySelectorAll("[role=listbox] a, [role=option] a, button a, a button, a a")).toHaveLength(0);
    link.addEventListener("click", (e) => e.preventDefault());
    await user.click(link);
    expect(document.getElementById("step-0")!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Step 1 of 2" })).toBeTruthy();
  });
});
