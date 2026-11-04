// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityIndex, type EntityDataFile, type GameData } from "../data/index.ts";
import { EntityContext, EntityErrorContext, GameDataContext, StoresContext, type Stores } from "./context.ts";
import { entityNames, type EntityNames } from "./EntityLink.tsx";
import { argumentSuggestions } from "./EntitySearch.tsx";
import { placePopup } from "./fields.tsx";
import { EditorDock } from "./EditorDock.tsx";
import type { EditorStore } from "./store.ts";
import { createStores } from "./stores.ts";
import { readRxpSelection } from "./rxpTextDom.ts";
import { questNames, selectText, showLine, shownText } from "./testing.ts";

const rows = {
  item: [
    [6948, "Hearthstone"],
    [2589, "Linen Cloth"],
    [4306, "Silk Cloth"],
    [9999, "Bad -- Name"],
  ],
  quest: [
    [33, "Wolves Across the Border"],
    [34, "Wolves Across the Border"],
    [7, "Kobold Camp Cleanup"],
  ],
  npc: [
    [196, "Eagan Peltskinner"],
    [5, "Test Gossiper"],
  ],
  spell: [
    [145, "Fireball", "Rank 3"],
    [133, "Fireball", "Rank 1"],
    [143, "Fireball", "Rank 2"],
    [120, "Cone of Cold", "Rank 1"],
    [2136, "Fire Blast", "Rank 1"],
  ],
  object: [[1617, "Silverleaf"]],
} satisfies EntityDataFile["entities"];
const index = new EntityIndex({ version: 2, entities: rows });

const quests = questNames([
  [33, "Wolves Across the Border"],
  [34, "Wolves Across the Border"],
  [7, "Kobold Camp Cleanup"],
]);

const guide = (...lines: string[]) => `#group G\n#name A\nstep\n${lines.join("\n")}\n`;

function mount(text: string, options: { entities?: EntityIndex | null; failed?: boolean; data?: GameData | null; stores?: Stores } = {}) {
  const stores = options.stores ?? createStores({ guides: [{ id: "g", text, order: 0 }], session: { guideId: "g", step: 0, line: null } });
  render(
    <StoresContext.Provider value={stores}>
      <EntityContext.Provider value={options.entities === undefined ? index : options.entities}>
        <EntityErrorContext.Provider value={options.failed ?? false}>
          <GameDataContext.Provider value={options.data === undefined ? quests : options.data}>
            <EditorDock />
          </GameDataContext.Provider>
        </EntityErrorContext.Provider>
      </EntityContext.Provider>
    </StoresContext.Provider>,
  );
  return { store: stores.editor, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (n: number) => screen.getByRole("group", { name: new RegExp(`^Line ${n},`) });
const optionItems = () => {
  const list = screen.queryByRole("listbox");
  return list ? within(list).getAllByRole("option") : [];
};
const options = () => optionItems().map((o) => o.textContent);
const text = (store: EditorStore) => store.getState().current!.record.text;

async function tabThroughColors(user: ReturnType<typeof userEvent.setup>) {
  for (const color of within(within(card(1)).getByRole("group", { name: "Text colors" })).getAllByRole("button")) {
    await user.tab();
    expect(document.activeElement).toBe(color);
  }
}

describe("entity argument search", () => {
  it("finds a quest and puts its ID in the draft without committing", async () => {
    const { store, user } = mount(guide(".accept 1"));
    const input = within(card(1)).getByRole("combobox", { name: "questId" });
    await user.clear(input);
    await user.type(input, "kobold");
    expect(options()[0]).toBe("Kobold Camp Cleanup #7");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveProperty("value", "7");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(text(store)).toBe(guide(".accept 1"));
    await user.keyboard("{Enter}");
    expect(text(store)).toBe(guide(".accept 7"));
  });

  it("ranks exact names by ID, keeps duplicate names apart, and shows spell ranks", async () => {
    const { user } = mount(guide(".cast 1", ".accept 1"));
    await user.clear(within(card(1)).getAllByRole("combobox", { name: "spellId" })[0]!);
    await user.type(within(card(1)).getAllByRole("combobox", { name: "spellId" })[0]!, "fire");
    expect(options()).toEqual(["Fire Blast Rank 1 #2136", "Fireball Rank 1 #133", "Fireball Rank 2 #143", "Fireball Rank 3 #145"]);
    await user.type(within(card(1)).getAllByRole("combobox", { name: "spellId" })[0]!, "ball");
    expect(options()).toEqual(["Fireball Rank 1 #133", "Fireball Rank 2 #143", "Fireball Rank 3 #145"]);
    await user.clear(within(card(1)).getAllByRole("combobox", { name: "spellId" })[0]!);
    await user.type(within(card(1)).getAllByRole("combobox", { name: "spellId" })[0]!, "143");
    expect(options()[0]).toBe("Fireball Rank 2 #143");

    const quest = within(await showLine(user, 2)).getByRole("combobox", { name: "questId" });
    await user.clear(quest);
    await user.type(quest, "wolves");
    expect(options()).toEqual(["Wolves Across the Border #33", "Wolves Across the Border #34"]);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(quest.getAttribute("aria-activedescendant")).toBe(optionItems()[1]!.id);
    await user.keyboard("{Enter}");
    expect(quest).toHaveProperty("value", "34");
  });

  it("replaces only the ID and keeps signs, parent markers, names, suffixes, and other arguments", async () => {
    const lines = [".turnin -33", ".target +196;Old::240", ".use 6948:p", ".collect 6948/99,3,33"];
    const { store, user } = mount(guide(...lines));
    const choose = async (n: number, field: string, nth: number, typed: string, expected: string) => {
      const input = within(await showLine(user, n)).getAllByRole("combobox", { name: field })[nth]!;
      await user.clear(input);
      await user.type(input, typed);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(input).toHaveProperty("value", expected);
      await user.keyboard("{Enter}");
    };
    await choose(1, "questId", 0, "-kobold", "-7");
    await choose(2, "npc", 1, "Old::eagan", "Old::196");
    await choose(2, "npc", 2, "+eag", "+196");
    await choose(3, "itemId", 0, "silk:p", "4306:p");
    await choose(4, "itemId", 0, "6948/linen", "6948/2589");
    expect(text(store)).toBe(guide(".turnin -7", ".target +196;Old::196;+196", ".use 4306:p", ".collect 6948/2589,3,33"));
  });

  it("keeps a lone gossip option and shows an error for an NPC that RXP would read as one", async () => {
    const { store, user } = mount(guide(".skipgossip 3"));
    const input = within(card(1)).getByRole("combobox", { name: "npcId" });
    await user.type(input, "{ArrowDown}");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.clear(input);
    await user.type(input, "gossiper");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(within(card(1)).getByRole("alert").textContent).toBe("RXP would not read 5 here as npc #5.");
    expect(input).toHaveProperty("value", "gossiper");
    expect(text(store)).toBe(guide(".skipgossip 3"));
  });

  it("closes the list on Escape, then drops the draft, and a click chooses without committing", async () => {
    const { store, user } = mount(guide(".accept 1"));
    const input = within(card(1)).getByRole("combobox", { name: "questId" });
    await user.clear(input);
    await user.type(input, "wolves");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(optionItems()[0]!.id);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveProperty("value", "wolves");
    await user.keyboard("{Escape}");
    expect(input).toHaveProperty("value", "1");

    await user.type(input, "{Backspace}wolves");
    await user.click(optionItems()[1]!);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveProperty("value", "34");
    expect(text(store)).toBe(guide(".accept 1"));
    await user.tab();
    expect(text(store)).toBe(guide(".accept 34"));
  });

  it("follows the caret to the part it is in, by keyboard or pointer, and drops a stale choice", async () => {
    const { store, user } = mount(guide(".collect 99,3"));
    const input = within(card(1)).getByRole<HTMLInputElement>("combobox", { name: "itemId" });
    await user.clear(input);
    await user.type(input, "silk/lin");
    expect(options()).toEqual(["Linen Cloth #2589"]);
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();

    await user.keyboard("{Home}");
    expect(options()).toEqual(["Silk Cloth #4306"]);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveProperty("value", "4306/lin");
    expect(input.selectionStart).toBe(4);

    await user.pointer({ target: input, offset: 8, keys: "[MouseLeft]" });
    await user.keyboard("{ArrowDown}");
    expect(options()).toEqual(["Linen Cloth #2589"]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveProperty("value", "4306/2589");
    await user.keyboard("{Enter}");
    expect(text(store)).toBe(guide(".collect 4306/2589,3"));
  });

  it("does not choose an option for the caret's old place when Enter follows a move at once", async () => {
    const { user } = mount(guide(".collect 99,3"));
    const input = within(card(1)).getByRole<HTMLInputElement>("combobox", { name: "itemId" });
    await user.clear(input);
    await user.type(input, "silk/lin{ArrowDown}");
    input.setSelectionRange(0, 0);
    await user.keyboard("{Enter}");
    expect(input).toHaveProperty("value", "silk/lin");
    expect(options()).toEqual(["Silk Cloth #4306"]);
  });

  it("shows the search's status in a status region", async () => {
    const { user } = mount(guide(".use 1"), { entities: null });
    const input = within(card(1)).getAllByRole("combobox", { name: "itemId" })[0]!;
    await user.clear(input);
    await user.type(input, "zz");
    expect(screen.getByRole("status").textContent).toBe("Loading names…");
  });
});

describe("argumentSuggestions", () => {
  const loaded = entityNames(index, false, quests);
  const suggest = (command: string, args: string[], at: number, caret = args[at]!.length, names: EntityNames = loaded) => {
    const found = argumentSuggestions(names, command, args, at, caret);
    return found && { status: found.status, options: found.options.map((o) => ({ value: o.value, caret: o.caret, error: o.error })) };
  };
  const only = (value: string, caret: number) => ({ status: undefined, options: [{ value, caret, error: undefined }] });

  it.each([
    ["a quest by name", "accept", ["kobold"], 0, undefined, only("7", 1)],
    ["a quest by ID", "accept", ["33"], 0, undefined, only("33", 2)],
    ["an NPC", "target", ["eagan"], 0, undefined, only("196", 3)],
    ["an item", "use", ["hearth"], 0, undefined, only("6948", 4)],
    ["an item by ID", "destroy", ["2589"], 0, undefined, only("2589", 4)],
    ["a spell", "train", ["cone"], 0, undefined, only("120", 3)],
    ["a quest after a sign", "turnin", ["-kobold"], 0, undefined, only("-7", 2)],
    ["an NPC after a name", "target", ["+196", "Old::eagan"], 1, undefined, only("Old::196", 8)],
    ["an NPC in an added repeated argument", "target", ["+196", "Old::240", "+eag"], 2, undefined, only("+196", 4)],
    ["an item before a suffix", "use", ["silk:p"], 0, undefined, only("4306:p", 4)],
    ["an item after a parent", "collect", ["6948/linen", "3", "33"], 0, undefined, only("6948/2589", 9)],
    ["the part before the caret", "collect", ["silk/lin", "3"], 0, 0, only("4306/lin", 4)],
  ])("puts the ID of %s in the argument's ID part", (_, command, args, at, caret, expected) => {
    expect(suggest(command, args, at, caret)).toEqual(expected);
  });

  it("gives an error for an NPC that RXP would read as a lone gossip option", () => {
    expect(suggest("skipgossip", ["gossiper"], 0)).toEqual({
      status: undefined,
      options: [{ value: "5", caret: 1, error: "RXP would not read 5 here as npc #5." }],
    });
  });

  it("gives no list for an ID that the names lack", () => {
    expect(suggest("skipgossip", ["3"], 0)).toBeUndefined();
    expect(suggest("accept", ["2345"], 0)).toBeUndefined();
  });

  it.each([
    ["names that load", "use", null, false, quests, "Loading names…"],
    ["names that failed", "use", null, true, quests, "Names failed to load. Enter an ID."],
    ["an item that no name matches", "use", index, false, quests, "No Item matches."],
    ["quest data that loads", "accept", index, false, null, "Loading quest data…"],
    ["loaded quest data, whatever the index", "accept", null, true, quests, "No Quest matches."],
    ["quest data that failed", "accept", index, true, null, "Quest data unavailable. Enter an ID."],
  ] as const)("gives the status of %s", (_, command, entities, failed, data, status) => {
    expect(suggest(command, ["zz"], 0, 2, entityNames(entities, failed, data))).toEqual({ status, options: [] });
  });
});

describe("quest names", () => {
  const data = questNames([[990001, "Wolves (data)"]]);
  const stale = new EntityIndex({
    version: 2,
    entities: {
      ...rows,
      quest: [
        [990001, "Wolves (indexed)"],
        [990002, "Boars (indexed)"],
      ],
    },
  });

  it("searches and inserts the game data's names, never the index's", async () => {
    const { store, user } = mount(guide(".accept 1 >>Go"), { entities: stale, data });
    const input = within(card(1)).getByRole("combobox", { name: "questId" });
    const search = async (query: string) => {
      await user.clear(input);
      await user.type(input, query);
      return screen.queryByRole("status")?.textContent ?? options();
    };
    expect(await search("wolves")).toEqual(["Wolves (data) #990001"]);
    expect(await search("indexed")).toBe("No Quest matches.");
    expect(await search("boars")).toBe("No Quest matches.");
    expect(await search("990002")).toEqual([]);
    expect(within(card(1)).getByRole("link").textContent).toBe("quest #990002");
    await search("1");

    const field = within(card(1)).getByRole("textbox", { name: ">> text" });
    selectText(field, shownText(field).length);
    await user.keyboard(" ");
    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    const picker = screen.getByRole("dialog", { name: "Insert reference" });
    await user.click(within(within(picker).getByRole("group", { name: "Type" })).getByRole("button", { name: "Quest" }));
    await user.type(within(picker).getByRole("combobox"), "wolves");
    expect(options()).toEqual(["Wolves (data) #990001"]);
    await user.click(within(picker).getByRole("button", { name: "Insert" }));
    await user.keyboard("{Enter}");
    expect(text(store)).toBe(guide(".accept 1 >> Go Wolves (data) (quest #990001)"));
  });
});

describe("suggestion list placement", () => {
  const pane = { top: 100, right: 400, bottom: 600, left: 0 };
  const at = (left: number, top: number, width = 100) => ({ left, top, bottom: top + 30, width });

  it("goes under the input, at least 300 wide, moved left or narrowed to stay in the pane", () => {
    expect(placePopup(at(20, 200), 200, pane)).toEqual({ left: 20, top: 234, width: 300, maxHeight: 260 });
    expect(placePopup(at(250, 200), 200, pane)).toEqual({ left: 96, top: 234, width: 300, maxHeight: 260 });
    expect(placePopup(at(20, 200), 200, { ...pane, right: 250 })).toEqual({ left: 4, top: 234, width: 242, maxHeight: 260 });
  });

  it("goes above when the room below cannot show it and above has more, cut to the room it has", () => {
    expect(placePopup(at(20, 567), 200, pane)).toEqual({ left: 20, top: 363, width: 300, maxHeight: 260 });
    expect(placePopup(at(20, 200), 500, pane)).toEqual({ left: 20, top: 234, width: 300, maxHeight: 260 });
    expect(placePopup(at(20, 400), 500, pane)).toEqual({ left: 20, top: 136, width: 300, maxHeight: 260 });
    expect(placePopup(at(20, 250), 500, { ...pane, bottom: 400 })).toEqual({ left: 20, top: 104, width: 300, maxHeight: 142 });
    expect(placePopup(at(20, 500), 50, pane)).toEqual({ left: 20, top: 534, width: 300, maxHeight: 62 });
  });

  it("renders outside the pane, follows the input, closes when the pane scrolls it away, and shows the active option", async () => {
    let input = new DOMRect(250, 540, 100, 30);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return new DOMRect(0, 100, 400, 500);
      return this.getAttribute("role") === "combobox" ? input : new DOMRect();
    });
    const option = (el: HTMLElement) => Number(el.id.split("-").pop());
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "option" ? 4 + 30 * option(this) : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return { option: 30, listbox: 62 }[this.getAttribute("role") ?? ""] ?? 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "listbox" ? 60 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "listbox" ? 128 : 0;
    });
    const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const { user } = mount(guide(".cast 1"));
    const field = within(card(1)).getAllByRole("combobox", { name: "spellId" })[0]!;
    await user.clear(field);
    await user.type(field, "fire");
    const list = screen.getByRole("listbox");
    expect(field.closest("[data-tip-bounds]")!.contains(list)).toBe(false);
    expect([list.style.left, list.style.top, list.style.width]).toEqual(["96px", "406px", "300px"]);

    input = new DOMRect(20, 200, 100, 30);
    await frame();
    expect([list.style.left, list.style.top]).toEqual(["20px", "234px"]);

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(list.scrollTop).toBe(34);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(list.scrollTop).toBe(4);

    input = new DOMRect(20, 620, 100, 30);
    await frame();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(field);
  });
});

describe("Insert reference", () => {
  const picker = () => screen.getByRole("dialog", { name: "Insert reference" });
  const search = () => within(picker()).getByRole("combobox");
  const pickType = (user: ReturnType<typeof userEvent.setup>, type: string) =>
    user.click(within(within(picker()).getByRole("group", { name: "Type" })).getByRole("button", { name: type }));

  it("distinguishes unavailable quest lookup from direct command ID entry", async () => {
    const original = guide(".accept 1", ">>Hello");
    const { store, user } = mount(original, { data: null, failed: true });
    await user.click(within(await showLine(user, 2)).getByRole("button", { name: "Insert reference" }));
    await pickType(user, "Quest");
    await user.type(search(), "999999{Enter}");
    expect(within(picker()).getByRole("status").textContent).toBe("Quest data unavailable.");
    expect(within(picker()).getByRole("button", { name: "Insert" })).toHaveProperty("disabled", true);
    expect(text(store)).toBe(original);
    await user.click(within(picker()).getByRole("button", { name: "Close" }));

    const input = within(await showLine(user, 1)).getByRole("combobox", { name: "questId" });
    await user.clear(input);
    await user.type(input, "999999");
    expect(screen.getByRole("status").textContent).toBe("Quest data unavailable. Enter an ID.");
    await user.keyboard("{Enter}");
    expect(text(store)).toBe(guide(".accept 999999", ">>Hello"));
  });

  it("replaces the selection in the draft, keeps the rest, and returns the caret to the field", async () => {
    const other = ".accept 33 >>Old  text  kept";
    const { store, user } = mount(guide(">>Use this now.", other));
    const input = within(card(1)).getByRole("textbox", { name: "Text" });
    selectText(input, "Use this now.".length);
    await user.keyboard(" Go");
    selectText(input, 4, 8);
    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    expect(search()).toHaveProperty("value", "this");
    await pickType(user, "Item");
    await user.clear(search());
    await user.type(search(), "hearth");
    expect(options()).toEqual(["Hearthstone #6948"]);
    const preview = picker().querySelector(".shows-as")!;
    expect(preview.textContent).toBe("Shows as: Use Hearthstone (item #6948) now. Go");
    expect(
      within(preview as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe("https://www.wowhead.com/forever/item=6948");

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(shownText(input)).toBe("Use Hearthstone (item #6948) now. Go");
    expect(readRxpSelection(input)).toEqual([28, 28]);
    expect(text(store)).toBe(guide(">>Use this now.", other));

    await user.keyboard("!{Enter}");
    expect(text(store)).toBe(guide(">>Use Hearthstone (item #6948)! now. Go", other));
    expect(card(1).querySelector(".shows-as")!.textContent).toBe("Shows as: Use Hearthstone (item #6948)! now. Go");
  });

  it.each([
    ["Item", "linen", "Linen Cloth (item #2589)"],
    ["Quest", "kobold", "Kobold Camp Cleanup (quest #7)"],
    ["NPC", "196", "Eagan Peltskinner (npc #196)"],
    ["Spell", "fireball", "Fireball (spell #133)"],
    ["Object", "silver", "Silverleaf (object #1617)"],
  ])("inserts a %s into a command's >> text", async (type, query, inserted) => {
    const { store, user } = mount(guide(".goto Elwynn Forest,49.1,38.3 >>Go"));
    const input = within(card(1)).getByRole("textbox", { name: ">> text" });
    selectText(input, "Go".length);
    await user.keyboard(" to ");
    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    await pickType(user, type);
    await user.type(search(), query);
    await user.click(within(picker()).getByRole("button", { name: "Insert" }));
    await user.keyboard("{Enter}");
    expect(text(store)).toBe(guide(`.goto Elwynn Forest,49.1,38.3 >> Go to ${inserted}`));
  });

  it("cancels on Escape, keeping the draft, returns focus to the button, and commits once focus leaves it", async () => {
    const { store, user } = mount(guide(">>Hello"));
    const input = within(card(1)).getByRole("textbox", { name: "Text" });
    selectText(input, "Hello".length);
    await user.keyboard(" there");
    const button = within(card(1)).getByRole("button", { name: "Insert reference" });
    await user.click(button);
    await user.type(search(), "hearth");
    await user.tab();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(shownText(input)).toBe("Hello there");
    expect(text(store)).toBe(guide(">>Hello"));

    await user.tab();
    await tabThroughColors(user);
    await user.tab();
    expect(document.activeElement).toBe(within(card(1)).getByRole("button", { name: /^More options/ }));
    expect(text(store)).toBe(guide(">>Hello there"));
  });

  it("commits when focus passes through the tool buttons and leaves, by keyboard or pointer", async () => {
    const { store, user } = mount(guide(">>Hello", ">>Bye"));
    const input = within(card(1)).getByRole("textbox", { name: "Text" });
    const button = within(card(1)).getByRole("button", { name: "Insert reference" });
    selectText(input, "Hello".length);
    await user.keyboard(" there");
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.tab();
    expect(document.activeElement).toBe(within(card(1)).getByRole("button", { name: "Insert icon" }));
    await tabThroughColors(user);
    expect(text(store)).toBe(guide(">>Hello", ">>Bye"));
    await user.tab();
    expect(text(store)).toBe(guide(">>Hello there", ">>Bye"));

    selectText(input, "Hello there".length);
    await user.keyboard("!");
    await user.tab();
    await showLine(user, 2);
    expect(text(store)).toBe(guide(">>Hello there!", ">>Bye"));
  });

  it("commits a built-in's draft to its copy when focus leaves through the tool buttons", async () => {
    const G = "RestedXP Forever Guide (A)";
    const original = `#group ${G}\n#name A\nstep\n    >>Take the boat\n`;
    const builtins = { version: "v9.9.9", guides: [{ id: "rxp:test.lua#1", text: original, order: 0, fileName: "test.lua" }] };
    const stores = createStores({ guides: [], session: { guideId: "rxp:test.lua#1", step: 0, line: null } }, builtins);
    const { store, user } = mount("", { stores });
    selectText(within(card(1)).getByRole("textbox", { name: "Text" }), "Take the boat".length);
    await user.keyboard(" now");
    await user.tab();
    await user.tab();
    await tabThroughColors(user);
    expect(store.getState().guides.size).toBe(0);
    await user.tab();
    expect(store.getState().current).toMatchObject({ builtin: false, group: `${G} (custom)` });
    expect(text(store)).toBe(original.replace("boat", "boat now"));
    expect(shownText(within(card(1)).getByRole("textbox", { name: "Text" }))).toBe("Take the boat now");
  });

  it("keeps a failed save's error while the picker changes the draft, until a save succeeds", async () => {
    const { store, user } = mount(guide(">>Hello"));
    const input = within(card(1)).getByRole("textbox", { name: "Text" });
    selectText(input, "Hello".length);
    await user.keyboard(" --{Enter}");
    const error = within(card(1)).getByRole("alert").textContent;
    expect(input.getAttribute("aria-invalid")).toBe("true");

    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    await pickType(user, "Item");
    await user.type(search(), "hearth{Enter}");
    expect(shownText(input)).toBe("Hello --Hearthstone (item #6948)");
    expect(within(card(1)).getByRole("alert").textContent).toBe(error);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(text(store)).toBe(guide(">>Hello"));

    await user.clear(input);
    await user.type(input, "Hello Hearthstone (item #6948){Enter}");
    expect(within(card(1)).queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(text(store)).toBe(guide(">>Hello Hearthstone (item #6948)"));
  });

  it("shows an error for a name that guide text cannot hold, and keeps the picker open", async () => {
    const { user } = mount(guide(">>Hello"));
    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    await pickType(user, "Item");
    await user.type(search(), "bad");
    await user.keyboard("{Enter}");
    expect(within(picker()).getByRole("alert").textContent).toBe("“Bad -- Name” cannot be written as a reference in guide text.");
    expect(shownText(within(card(1)).getByRole("textbox", { name: "Text" }))).toBe("Hello");
  });

  it("keeps the inserted reference in the draft when the commit fails", async () => {
    const { store, user } = mount(guide(">>Hello"));
    const input = within(card(1)).getByRole("textbox", { name: "Text" });
    selectText(input, "Hello".length);
    await user.keyboard(" --");
    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    await pickType(user, "Item");
    await user.type(search(), "hearth{Enter}");
    await user.keyboard("{Enter}");
    expect(within(card(1)).getByRole("alert")).toBeTruthy();
    expect(shownText(input)).toBe("Hello --Hearthstone (item #6948)");
    expect(text(store)).toBe(guide(">>Hello"));
  });

  it("edits a built-in's copy on commit and undoes to the built-in", async () => {
    const G = "RestedXP Forever Guide (A)";
    const original = `#group ${G}\n#name A\nstep\n    >>Take the boat\n    .accept 33\n`;
    const builtins = { version: "v9.9.9", guides: [{ id: "rxp:test.lua#1", text: original, order: 0, fileName: "test.lua" }] };
    const stores = createStores({ guides: [], session: { guideId: "rxp:test.lua#1", step: 0, line: null } }, builtins);
    const { store, user } = mount("", { stores });
    const input = within(card(1)).getByRole("textbox", { name: "Text" });
    selectText(input, "Take the boat".length);
    await user.keyboard(" with ");
    await user.click(within(card(1)).getByRole("button", { name: "Insert reference" }));
    await pickType(user, "Item");
    await user.type(search(), "hearth{Enter}");
    expect(store.getState().guides.size).toBe(0);
    await user.keyboard("{Enter}");
    const { current } = store.getState();
    expect(current).toMatchObject({ builtin: false, group: `${G} (custom)` });
    const edited = original.replace(">>Take the boat", ">>Take the boat with Hearthstone (item #6948)");
    expect(current!.record.text).toBe(edited);

    store.undo();
    expect(store.getState().current).toMatchObject({ id: "rxp:test.lua#1", builtin: true });
    expect(text(store)).toBe(original);
  });
});
