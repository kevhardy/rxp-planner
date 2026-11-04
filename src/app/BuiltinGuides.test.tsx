// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameData } from "../data/index.ts";
import { BUILTIN_PATH, decodeBuiltins, type Builtins } from "../io/builtin.ts";
import { loadLibrary, saveLibrary, saveSetting, type StoredLibrary } from "../storage/index.ts";
import { renderPlanner } from "./renderPlanner.tsx";
import { StoresContext } from "./context.ts";
import { EditorDock } from "./EditorDock.tsx";
import { DEFAULT_LAYOUT } from "./layout.ts";
import { LibraryDrawer } from "./Library.tsx";
import { createStores } from "./stores.ts";
import { shownText } from "./testing.ts";
import { DEFAULT_SETTINGS } from "./preview/settings.ts";

const root = join(import.meta.dirname, "../..");
const noGameData = () => new Promise<GameData>(() => {});

// jsdom's Blob has no stream(), which decoding the built-in file needs.
globalThis.Blob = NodeBlob as typeof Blob;

let builtins: Builtins;

beforeAll(async () => {
  const bundled = await decodeBuiltins(new Uint8Array(readFileSync(join(root, "public", BUILTIN_PATH))));
  const firstStep = (text: string) => text.replace(/(\n[ \t]*step\b[^]*?\r?\n)[ \t]*step\b[^]*/, "$1");
  builtins = { ...bundled, guides: bundled.guides.map((g) => ({ ...g, text: firstStep(g.text) })) };
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

afterEach(() => cleanup());

async function mount() {
  const { user } = await renderPlanner({ initial: await loadLibrary(), builtins, loadGameData: noGameData });
  return user;
}

function mountDrawer(library: StoredLibrary = { guides: [] }, beside?: ReactNode) {
  const stores = createStores(library, builtins);
  render(
    <StoresContext.Provider value={stores}>
      <LibraryDrawer open onClose={() => {}} />
      {beside}
    </StoresContext.Provider>,
  );
  return { stores, user: userEvent.setup() };
}

const library = () => screen.getByRole("navigation", { name: "Library" });
const hint = () => screen.getByRole("region", { name: "Editor" }).querySelector(".builtin-hint")?.textContent;
const section = () => within(library()).getByRole("region", { name: "RestedXP Guides" });

const rows = () =>
  [...section().querySelectorAll(".lib-toggle, .lib-guide")].map((el) => {
    const expanded = el.getAttribute("aria-expanded");
    return `${expanded === null ? "" : expanded === "true" ? "▾ " : "▸ "}${el.querySelector(".lib-name")!.textContent}`;
  });

async function expand(user: UserEvent, ...names: string[]) {
  for (const name of names) {
    const button = within(section())
      .getAllByRole("button", { expanded: false })
      .find((b) => b.querySelector(".lib-name")!.textContent === name);
    await user.click(button!);
  }
}

describe("built-in guides in the library", () => {
  it("lists the groups and subgroups for the preview character's faction", async () => {
    const { stores, user } = mountDrawer();
    expect(rows()).toEqual(["▸ RestedXP Guides"]);
    expect(within(section()).getByRole("button", { name: "RestedXP Guides v4.11.26" }).getAttribute("aria-expanded")).toBe("false");

    await expand(user, "RestedXP Guides", "RestedXP Forever Guide (A)");
    expect(within(section()).getByRole("link", { name: "CC BY-NC-SA 4.0" }).getAttribute("href")).toBe(
      "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    );
    expect(within(section()).getByRole("link", { name: "RestedXP" }).getAttribute("href")).toBe("https://github.com/RestedXP/RXPGuides");
    expect(section().querySelector("[title]")).toBeNull();
    expect(rows()).toEqual([
      "▾ RestedXP Guides",
      "▸ RestedXP Forever Dungeon Guide (A)",
      "▾ RestedXP Forever Guide (A)",
      "▸ Speedrun Guide 1-20",
    ]);

    act(() => stores.preview.update({ race: "Orc" }));
    await expand(user, "RestedXP Forever Guide (H)");
    expect(rows()).toEqual([
      "▾ RestedXP Guides",
      "▸ RestedXP Forever Dungeon Guide (H)",
      "▾ RestedXP Forever Guide (H)",
      "▸ Speedrun Guide 1-22",
    ]);
    await expand(user, "Speedrun Guide 1-22");
    expect(rows()).toContain("1-9 Zephras Isle");
    expect(rows()).toContain("1-6 Durotar");
  });

  it("lists #internal guides, with their reason, only under Show all", async () => {
    const { stores, user } = mountDrawer();
    await expand(user, "RestedXP Guides");
    expect(rows()).not.toContain("Skyborne Druid Class Quests");

    await user.click(within(section()).getByRole("button", { name: "Show all RestedXP guides" }));
    await expand(user, "RestedXP Forever Dungeon Guide (A)");
    const helper = within(section()).getByRole("button", {
      name: "Skyborne Druid Class Quests Internal guide",
    });
    expect(within(section()).getAllByRole("button", { name: /^Skyborne Druid Class Quests Internal guide$/ })).toHaveLength(1);
    await user.click(helper);
    expect(stores.editor.getState().current).toMatchObject({ name: "Skyborne Druid Class Quests", builtin: true });
  });

  it("opens a built-in with a hint in the editor, and lists its copy after the first edit", async () => {
    const user = await mount();
    await expand(user, "RestedXP Guides", "RestedXP Forever Guide (A)", "Speedrun Guide 1-20");
    await user.click(within(section()).getByRole("button", { name: "1-6 Northshire" }));
    expect(hint()).toBe("Your first edit saves a copy in “RestedXP Forever Guide (A) (custom)” and opens it.Got it");

    within(screen.getByRole("region", { name: "Steps" }))
      .getByRole("listbox")
      .focus();
    await user.keyboard("{Insert}");
    const copies = within(library()).getByRole("region", { name: "Group RestedXP Forever Guide (A) (custom)" });
    expect(within(copies).getByRole("button", { name: "1-6 Northshire" }).getAttribute("aria-current")).toBe("true");
    expect(hint()).toBeUndefined();

    await user.click(within(section()).getByRole("button", { name: "1-6 Northshire" }));
    expect(hint()).toBe("You have a copy in “RestedXP Forever Guide (A) (custom)”.Open your copyGot it");
    await user.click(within(section()).getByRole("button", { name: "Open your copy of 1-6 Northshire" }));
    expect(within(copies).getByRole("button", { name: "1-6 Northshire" }).getAttribute("aria-current")).toBe("true");
  });

  it("hides a built-in's hint after Got it, also after a reload, and still shows another built-in's hint", async () => {
    const user = await mount();
    await expand(user, "RestedXP Guides", "RestedXP Forever Guide (A)", "Speedrun Guide 1-20");
    await user.click(within(section()).getByRole("button", { name: "1-6 Northshire" }));
    await user.click(within(screen.getByRole("region", { name: "Editor" })).getByRole("button", { name: "Got it" }));
    expect(hint()).toBeUndefined();
    cleanup();

    const again = await mount();
    await expand(again, "RestedXP Guides", "RestedXP Forever Guide (A)", "Speedrun Guide 1-20");
    await again.click(within(section()).getByRole("button", { name: "1-6 Northshire" }));
    expect(screen.getByRole("region", { name: "Steps" }).textContent).toContain("1-6 Northshire");
    expect(hint()).toBeUndefined();
    await again.click(within(section()).getByRole("button", { name: "6-11 Elwynn Forest" }));
    expect(hint()).toBe("Your first edit saves a copy in “RestedXP Forever Guide (A) (custom)” and opens it.Got it");
  });

  it("opens the latest registered copy from both built-in links despite map and display order", async () => {
    const copies = [0, 2, 1].map((order) => ({
      id: `copy-${order}`,
      order,
      text: `#group RestedXP Forever Guide (A) (custom)\n#name 1-6 Northshire\nstep\n    >> Copy ${order}\n`,
    }));
    const { stores, user } = mountDrawer({ guides: copies }, <EditorDock />);
    await expand(user, "RestedXP Guides", "RestedXP Forever Guide (A)", "Speedrun Guide 1-20");
    const openBuiltin = () => user.click(within(section()).getByRole("button", { name: "1-6 Northshire" }));
    const expectLatest = () => expect(stores.editor.getState().current!.id).toBe("copy-2");

    await openBuiltin();
    await user.click(screen.getByRole("button", { name: "Open your copy" }));
    expectLatest();
    await openBuiltin();
    await user.click(within(section()).getByRole("button", { name: "Open your copy of 1-6 Northshire" }));
    expectLatest();
  });

  it("lists only the last built-in registered under a group and name", async () => {
    const shared = (order: number, text: string) => ({
      id: `rxp:test.lua#${order}`,
      order,
      fileName: "test.lua",
      text: `#group Test Group\n#name Shared\nstep\n    >> ${text}\n`,
    });
    const both = { version: "v9.9.9", guides: [shared(0, "First"), shared(1, "Last")] };
    const { user } = await renderPlanner({ initial: { guides: [] }, builtins: both, loadGameData: noGameData });
    await expand(user, "RestedXP Guides", "Test Group");
    await user.click(within(section()).getByRole("button", { name: "Shared" }));
    expect(shownText(within(screen.getByRole("region", { name: "Editor" })).getByRole("textbox", { name: "Text" }))).toBe("Last");
  });

  it("customizes a group into copies and opens the first", async () => {
    const { stores, user } = mountDrawer();
    await expand(user, "RestedXP Guides");
    await user.click(within(section()).getByRole("button", { name: "Customize group RestedXP Forever Guide (A)" }));
    const dialog = screen.getByRole("dialog", { name: "Customize RestedXP Forever Guide (A)?" });
    expect(dialog.textContent).toContain("copies its 16 listed guides into “RestedXP Forever Guide (A) (custom)”");
    await user.click(within(dialog).getByRole("button", { name: "Customize" }));

    const copies = within(library()).getByRole("region", { name: "Group RestedXP Forever Guide (A) (custom)" });
    expect(within(copies).getAllByRole("listitem")).toHaveLength(16);
    expect(stores.editor.getState().current).toMatchObject({ group: "RestedXP Forever Guide (A) (custom)", name: "1-9 Zephras Isle" });
  });

  it("opens the Horde copy of a guide whose group depends on the faction from the Alliance group", async () => {
    const { stores, user } = mountDrawer();
    act(() => stores.preview.update({ race: "Orc" }));
    await expand(user, "RestedXP Guides");
    await user.click(within(section()).getByRole("button", { name: "Customize group RestedXP Forever Guide (H)" }));
    const dialog = screen.getByRole("dialog", { name: "Customize RestedXP Forever Guide (H)?" });
    await user.click(within(dialog).getByRole("button", { name: "Customize" }));

    act(() => stores.preview.update({ race: "Human" }));
    await expand(user, "RestedXP Forever Guide (A)", "Speedrun Guide 1-20");
    await user.click(within(section()).getByRole("button", { name: "1-9 Zephras Isle" }));
    expect(stores.editor.getState().current).toMatchObject({ name: "1-9 Zephras Isle", builtin: true });
    await user.click(within(section()).getByRole("button", { name: "Open your copy of 1-9 Zephras Isle" }));
    expect(stores.editor.getState().current).toMatchObject({ group: "RestedXP Forever Guide (H) (custom)", name: "1-9 Zephras Isle" });
  });

  it("starts the route at an earlier built-in chosen under Start from", async () => {
    const user = await mount();
    await expand(user, "RestedXP Guides", "RestedXP Forever Guide (A)", "Speedrun Guide 1-20");
    await user.click(within(section()).getByRole("button", { name: "6-11 Elwynn Forest" }));
    await user.click(screen.getByRole("button", { name: /^Start settings/ }));
    const start = within(screen.getByRole("region", { name: "Route start" })).getByLabelText<HTMLSelectElement>("Start from");
    expect([...start.options].map((o) => o.textContent)).toEqual(["This guide (6-11 Elwynn Forest)", "1-6 Northshire (1 guide earlier)"]);

    await user.selectOptions(start, "1-6 Northshire (1 guide earlier)");
    const cards = within(screen.getByRole("toolbar", { name: "Guides on the route" })).getAllByRole("button", { name: /, guide \d+ of/ });
    expect(cards.slice(0, 2).map((card) => card.getAttribute("aria-label"))).toEqual([
      "1-6 Northshire, guide 1 of 8",
      "6-11 Elwynn Forest, guide 2 of 8, open guide",
    ]);
  });
});

describe("the start screen", () => {
  const steps = () => screen.getByRole("region", { name: "Steps" });

  it("lists the built-in guides and Import while no guide is open, and opens a guide from the list", async () => {
    const user = await mount();
    expect(within(steps()).getByText("Choose a RestedXP guide below, or import your own.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Warnings/ })).toBeNull();
    const start = within(within(steps()).getByRole("region", { name: "RestedXP Guides" }));
    await user.click(start.getByRole("button", { name: "RestedXP Forever Guide (A)" }));
    await user.click(start.getByRole("button", { name: "Speedrun Guide 1-20" }));
    await user.click(start.getByRole("button", { name: "1-6 Northshire" }));
    expect(within(steps()).getByRole("listbox", { name: "Steps of 1-6 Northshire" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Warnings/ })).toBeTruthy();
  });

  it("opens the Import dialog from the start screen", async () => {
    const user = await mount();
    await user.click(within(steps()).getByRole("button", { name: "Import guide" }));
    expect(screen.getByRole("dialog", { name: "Import guide" })).toBeTruthy();
  });

  it("leaves the start screen out of reach while the Library covers it", async () => {
    const user = await mount();
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.queryByRole("region", { name: "Steps" })).toBeNull();
    expect(screen.getAllByRole("region", { name: "RestedXP Guides" })).toEqual([section()]);
    await user.keyboard("{Escape}");
    expect(steps().hasAttribute("inert")).toBe(false);
  });
});

describe("your guides in the library", () => {
  it("says how to add your own guides above the built-in guides only while you have none", async () => {
    const { user } = mountDrawer();
    const empty = "Import a guide, start one with New group, or edit a RestedXP guide to save a copy.";
    expect(within(library()).getByText(empty)).toBeTruthy();
    await user.click(within(library()).getByRole("button", { name: "New group" }));
    await user.type(within(screen.getByRole("dialog", { name: "New group" })).getByLabelText("Group name"), "Mine{Enter}");
    expect(within(library()).getByRole("region", { name: "Group Mine" })).toBeTruthy();
    expect(within(library()).queryByText(empty)).toBeNull();
  });
});
