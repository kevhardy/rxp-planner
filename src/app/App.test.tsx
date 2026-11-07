// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { GameData } from "../data/index.ts";
import { extractGuides } from "../guide/index.ts";
import { exportAddon, type Builtins } from "../io/index.ts";
import * as storage from "../storage/index.ts";
import { loadLibrary, loadSetting, saveLibrary, saveSetting } from "../storage/index.ts";
import { renderPlanner } from "./renderPlanner.tsx";
import { zoneData, questRow, redo, selectText, showLine, shownText, slowFile, undo, unzip, ZONES, zonePoint } from "./testing.ts";
import { DEFAULT_LAYOUT } from "./layout.ts";
import { DEFAULT_SETTINGS } from "./preview/settings.ts";
import { cascade } from "./ui/testing.ts";

const root = join(import.meta.dirname, "../..");
const noGameData = () => new Promise<GameData>(() => {});

const bundledGuides = (files: string[]) =>
  files.flatMap((file) =>
    extractGuides(readFileSync(join(root, "guides/rxp-forever", file), "utf8")).map((g) => g.text.replace(/\r\n?/g, "\n")),
  );
const mageAddon = new File(
  [exportAddon("Mage Guides", bundledGuides(["Alliance-Mage-1-12.lua", "Alliance-Mage-12-21.lua", "Horde-Mage-12-21.lua"]).reverse()).zip],
  "Mage_Guides.zip",
  { type: "application/zip" },
);

beforeEach(async () => {
  localStorage.clear();
  const { guides } = await loadLibrary();
  await saveLibrary(
    [],
    guides.map((g) => g.id),
    { guideId: null, step: null, line: null },
  );
  await saveSetting("preview", { ...DEFAULT_SETTINGS, class: "MAGE" });
  await saveSetting("layout", DEFAULT_LAYOUT);
});

afterEach(() => cleanup());

async function mount(builtins: Builtins | null = null) {
  return renderPlanner({ initial: await loadLibrary(), builtins, loadGameData: noGameData });
}

async function openImport(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "More guide actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Import guide" }));
}

async function upload(user: UserEvent, files: File | File[]) {
  await openImport(user);
  const dialog = screen.getByRole("dialog", { name: "Import guide" });
  await user.upload(within(dialog).getByLabelText("Import files"), files);
  return dialog;
}

async function importMageAddon(user: UserEvent) {
  const dialog = await upload(user, mageAddon);
  await within(dialog).findByText("Found 7 guides in 1 file.");
  await user.click(within(dialog).getByRole("button", { name: "Import 7 guides" }));
}

async function addBlankStep(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Add step" }));
  const dialog = screen.getByRole("dialog", { name: /^Add (after|at)/ });
  await user.click(within(dialog).getByRole("tab", { name: "Blank step" }));
  await user.click(within(dialog).getByRole("button", { name: "Add" }));
}

async function selectStep(user: UserEvent, index: number) {
  await user.click(document.getElementById(`step-${index}`)!);
}

async function exportZip(user: UserEvent, options: { title?: string; name?: string } = {}) {
  let blob: Blob | undefined;
  const createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:test"));
  Object.assign(URL, { createObjectURL, revokeObjectURL: () => {} });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  await user.click(screen.getByRole("button", { name: "Export guide" }));
  const dialog = screen.getByRole("dialog", { name: "Export guide" });
  if (options.title !== undefined) {
    await user.clear(within(dialog).getByLabelText("Addon title"));
    await user.type(within(dialog).getByLabelText("Addon title"), options.title);
  }
  if (options.name !== undefined) await user.type(within(dialog).getByLabelText("Addon name (folder)"), options.name);
  await user.click(within(dialog).getByRole("button", { name: /^Download / }));
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
  return unzip(new Uint8Array(await blob!.arrayBuffer()));
}

const guidesIn = (files: Map<string, string>, path: string) => extractGuides(files.get(path)!).map((g) => g.text);

describe("editor", () => {
  it("imports an exported addon into its groups in #next order", async () => {
    const { user } = await mount();
    await importMageAddon(user);

    const library = screen.getByRole("navigation", { name: "Library" });
    const horde = within(library).getByRole("region", { name: "Group RestedXP Forever Guide (H)" });
    const alliance = within(library).getByRole("region", { name: "Group RestedXP Forever Guide (A)" });
    const names = (group: HTMLElement) =>
      within(group)
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".lib-name")!.textContent);
    expect(names(horde)).toEqual(["12-17 The Barrens AoE", "17-21 Stonetalon/Barrens AoE"]);
    expect(names(alliance)).toEqual([
      "1-10 Dun Morogh Mage AoE",
      "1-10 Elwynn Forest Mage AoE",
      "10-12 Loch Modan Mage AoE",
      "12-18 Darkshore Mage AoE",
      "18-21 Redridge Mage AoE",
    ]);
    screen.getByRole("listbox", { name: "Steps of 17-21 Stonetalon/Barrens AoE" });
  });

  it("changes only the edited line in the exported text when a form field changes", async () => {
    const a =
      "#group Mine\n#name A\nstep\n    .xp 2\nstep\n.target Deputy Willem\n>>Talk to |cRXP_FRIENDLY_Deputy Willem|r\n    .frob  1,,2\n    .accept 5261 >> Accept Eagan Peltskinner\n";
    const b = "#group Mine\n#name B\nstep\n    .turnin 5261\n";
    await saveLibrary(
      [
        { id: "a", text: a, order: 0 },
        { id: "b", text: b, order: 1 },
      ],
      [],
      { guideId: "a", step: 1, line: null },
    );
    const { user } = await mount();

    const line = await showLine(user, 4);
    const questId = within(line).getByLabelText("Quest ID");
    expect(questId).toHaveProperty("value", "5261");
    await user.clear(questId);
    await user.type(questId, "5262{Enter}");
    const text = within(line).getByLabelText(">> Text");
    selectText(text, "Accept ".length, "Accept Eagan Peltskinner".length);
    await user.click(within(line).getByRole("button", { name: "Friendly" }));
    await user.keyboard("{Enter}");

    const files = await exportZip(user);
    expect(guidesIn(files, "Mine/guides.lua")).toEqual([
      a.replace("    .accept 5261 >> Accept Eagan Peltskinner", "    .accept 5262 >> Accept |cRXP_FRIENDLY_Eagan Peltskinner|r"),
      b,
    ]);
  });

  describe("drafts belong to their step", () => {
    const importGuide = async (user: UserEvent, text: string) => {
      const dialog = await upload(user, new File([text], "guide.txt", { type: "text/plain" }));
      await within(dialog).findByText("Found 1 guide in 1 file.");
      await user.click(within(dialog).getByRole("button", { name: "Import 1 guide" }));
      await user.click(screen.getByRole("tab", { name: "Raw" }));
    };

    it("undoes the colored text field's draft with Ctrl+Z, and the guide only outside it", async () => {
      const { user } = await mount();
      await importGuide(user, "#group T\n#name One\nstep\n.accept 1 >> First\n");
      await user.click(screen.getByRole("tab", { name: "Lines" }));
      const line = () => screen.getByRole("group", { name: "Line 1, Accept quest" });
      const questId = () => within(line()).getByLabelText("Quest ID");
      await user.clear(questId());
      await user.type(questId(), "10{Enter}");
      const text = within(line()).getByLabelText(">> Text");
      selectText(text, "First".length);
      await user.keyboard("!");
      await user.keyboard("{Control>}z{/Control}");
      expect([shownText(text), questId()]).toEqual(["First", expect.objectContaining({ value: "10" })]);

      await user.click(document.body);
      await user.keyboard("{Control>}z{/Control}");
      expect(questId()).toHaveProperty("value", "1");
    });
  });

  it("undoes and redoes edits with Ctrl+Z and Ctrl+Shift+Z outside a text field", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n.accept 1\n", order: 0 }], [], {
      guideId: "a",
      step: 0,
      line: null,
    });
    const { user } = await mount();
    await user.click(screen.getByRole("tab", { name: "Step settings" }));

    const optional = screen.getByRole("checkbox", { name: "Optional" });
    await user.click(optional);
    expect(optional).toHaveProperty("checked", true);
    await addBlankStep(user);
    screen.getByRole("heading", { name: "Step 2 of 2" });
    expect(document.getElementById("step-1")!.textContent).toBe("2");
    within(screen.getByRole("group", { name: "Values" }))
      .getByRole("textbox", { name: "Label" })
      .focus();
    await user.keyboard("{Control>}z{/Control}");
    screen.getByRole("heading", { name: "Step 2 of 2" });

    await undo(user);
    screen.getByRole("heading", { name: "Step 1 of 1" });
    await undo(user);
    expect(screen.getByRole("checkbox", { name: "Optional" })).toHaveProperty("checked", false);
    await redo(user);
    expect(screen.getByRole("checkbox", { name: "Optional" })).toHaveProperty("checked", true);
  });

  it("restores the library and session after a reload", async () => {
    await saveLibrary(
      [
        { id: "a", text: "#group Mine\n#name A\nstep\n.xp 2\n", order: 0 },
        { id: "b", text: "#group Mine\n#name B\nstep\n.xp 3\nstep\n.xp 4\nstep\n.xp 5\n", order: 1 },
      ],
      [],
      { guideId: "a", step: 0, line: null },
    );
    const first = await mount();
    await first.user.click(screen.getByRole("button", { name: "B" }));
    await selectStep(first.user, 2);
    await first.user.click(screen.getByRole("tab", { name: "Step settings" }));
    // Unlike user.click, fireEvent edits without yielding, so the autosave delay cannot end before the next check.
    fireEvent.click(screen.getByRole("checkbox", { name: "Optional" }));
    await vi.waitFor(async () => expect((await loadLibrary()).guides.some((g) => g.text.includes("#optional"))).toBe(true), {
      timeout: 3000,
    });
    first.unmount();

    const second = await mount();
    const library = screen.getByRole("navigation", { name: "Library" });
    expect(within(library).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Step 3 of 3" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Optional" })).toHaveProperty("checked", true);
    expect(within(library).getByRole("button", { name: "B" }).getAttribute("aria-current")).toBe("true");
    second.unmount();
  });

  it("keeps the editor's height and tab through Playback and a reload, and opens it for the restored step", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n.xp 2\nstep\n.xp 3\n", order: 0 }], [], {
      guideId: "a",
      step: null,
      line: null,
    });
    const first = await mount();
    await selectStep(first.user, 1);
    screen.getByRole("separator", { name: "Resize editor" }).focus();
    await first.user.keyboard("{ArrowUp}{ArrowUp}");
    await first.user.click(screen.getByRole("tab", { name: "XP simulation" }));
    await first.user.click(screen.getByRole("button", { name: "Close editor" }));

    await first.user.click(screen.getByRole("button", { name: "Playback" }));
    expect(screen.queryByRole("region", { name: "Editor" })).toBeNull();
    await first.user.click(screen.getByRole("button", { name: "Edit" }));
    screen.getByRole("button", { name: "Open editor" });
    expect(screen.queryByRole("tab")).toBeNull();
    await vi.waitFor(async () =>
      expect(await loadSetting("layout")).toMatchObject({ dockHeight: 352, dockTab: "simulation", mode: "edit" }),
    );
    await vi.waitFor(async () => expect((await loadLibrary()).session).toMatchObject({ step: 1 }), { timeout: 3000 });
    first.unmount();

    const second = await mount();
    expect(document.getElementById("app")!.style.getPropertyValue("--dock-h")).toBe("352px");
    expect(screen.queryByRole("button", { name: "Open editor" })).toBeNull();
    expect(screen.getByRole("heading", { name: /^Step 2 of/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "XP simulation" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("separator", { name: "Resize editor" }).getAttribute("aria-valuenow")).toBe("352");
    second.unmount();
  });

  it("shows a failed save, keeps the edit, and saves it with the next edit", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n    .accept 1 >>Hello\n", order: 0 }], [], {
      guideId: "a",
      step: 0,
      line: null,
    });
    const put = IDBObjectStore.prototype.put;
    let failed = false;
    const guidePut = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === "guides" && !failed) {
        failed = true;
        throw new DOMException("full", "QuotaExceededError");
      }
      return put.apply(this, args);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      guidePut.mockRestore();
      consoleError.mockRestore();
    });
    const first = await mount();
    const saveFailed = () => within(screen.getByRole("banner")).queryByRole("alert")?.textContent;
    const text = () => within(screen.getByRole("group", { name: "Line 1, Accept quest" })).getByLabelText(">> Text");

    selectText(text(), "Hello".length);
    await first.user.keyboard("abc{Enter}");
    await vi.waitFor(() => expect(saveFailed()).toBe("Save failed"), { timeout: 3000 });
    expect(console.error).toHaveBeenCalledWith("Could not save the library", expect.objectContaining({ name: "QuotaExceededError" }));
    expect(shownText(text())).toBe("Helloabc");

    guidePut.mockRestore();
    await first.user.keyboard("def{Enter}");
    await vi.waitFor(async () => expect((await loadLibrary()).guides[0]!.text).toContain(">> Helloabcdef"), { timeout: 3000 });
    expect(saveFailed()).toBeUndefined();
    first.unmount();

    await mount();
    expect(shownText(text())).toBe("Helloabcdef");
  });

  it("ignores Ctrl+Z while a dialog makes the app inert, and redoes with Ctrl+Y", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n.accept 1\n", order: 0 }], [], { guideId: "a", step: 0, line: null });
    const { user } = await mount();
    await user.click(screen.getByRole("tab", { name: "Step settings" }));
    const optional = () => screen.getByRole("checkbox", { name: "Optional" });
    await user.click(optional());
    const prevented = (key: string) => !fireEvent.keyDown(window, { key, ctrlKey: true });

    document.getElementById("app")!.setAttribute("inert", "");
    expect(prevented("z")).toBe(false);
    expect(optional()).toHaveProperty("checked", true);
    document.getElementById("app")!.removeAttribute("inert");
    expect(prevented("a")).toBe(false);
    expect(prevented("z")).toBe(true);
    expect(optional()).toHaveProperty("checked", false);
    expect(prevented("y")).toBe(true);
    expect(optional()).toHaveProperty("checked", true);
  });

  it("asks before leaving only when the unsaved edit cannot be kept", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n.accept 1\n", order: 0 }], [], { guideId: "a", step: 0, line: null });
    const { user } = await mount();
    await user.click(screen.getByRole("tab", { name: "Step settings" }));
    const setItem = Storage.prototype.setItem;
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("restedxp-planner:unsaved:tab:")) throw new DOMException("full", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      full.mockRestore();
      consoleError.mockRestore();
    });
    const leave = (type: string) => {
      const event = new Event(type, { cancelable: true });
      act(() => void window.dispatchEvent(event));
      return event.defaultPrevented;
    };
    const unsaved = () => Object.keys(localStorage).filter((key) => key.startsWith("restedxp-planner:unsaved:tab:"));

    fireEvent.click(screen.getByRole("checkbox", { name: "Optional" }));
    expect(leave("pagehide")).toBe(false);
    expect(leave("beforeunload")).toBe(true);
    expect(unsaved()).toEqual([]);

    full.mockRestore();
    fireEvent.click(screen.getByRole("checkbox", { name: "Optional" }));
    expect(leave("beforeunload")).toBe(false);
    expect(unsaved()).toHaveLength(1);
  });

  it("stops listening for leaving, stops autosave, and then saves the pending edit when the planner closes", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n.accept 1\n", order: 0 }], [], { guideId: "a", step: 0, line: null });
    const calls: string[] = [];
    const start = storage.startAutosave;
    vi.spyOn(storage, "startAutosave").mockImplementation((...args) => {
      const autosave = start(...args);
      return {
        ...autosave,
        stop: () => (calls.push("stop"), autosave.stop()),
        flush: () => (calls.push("flush"), autosave.flush()),
      };
    });
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, "removeEventListener").mockImplementation((type, ...rest) => {
      if (type === "beforeunload" || type === "pagehide") calls.push(`remove ${type}`);
      remove(type, ...rest);
    });
    onTestFinished(() => void vi.restoreAllMocks());
    const view = await mount();
    await view.user.click(screen.getByRole("tab", { name: "Step settings" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Optional" }));
    view.unmount();
    expect(calls).toEqual(["remove beforeunload", "remove pagehide", "stop", "flush"]);
    window.dispatchEvent(new Event("beforeunload"));
    expect(Object.keys(localStorage).filter((key) => key.startsWith("restedxp-planner:unsaved:tab:"))).toEqual([]);
    await vi.waitFor(async () => expect((await loadLibrary()).guides[0]!.text).toContain("#optional"));
  });

  it("registers the agent tools when the dataset loads, and removes them when the planner closes", async () => {
    const tools = new Set<string>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool({ name }: { name: string }, { signal }: { signal: AbortSignal }) {
          tools.add(name);
          signal.addEventListener("abort", () => tools.delete(name));
          return Promise.resolve();
        },
      },
    });
    onTestFinished(() => void delete (document as { modelContext?: unknown }).modelContext);
    const view = await renderPlanner({ initial: { guides: [] }, loadGameData: () => Promise.resolve(zoneData([])) });
    await vi.waitFor(() => expect(tools.has("editor_state")).toBe(true));
    view.unmount();
    expect(tools.size).toBe(0);
  });

  it("exports the edited guide text in a zip with the chosen name and title", async () => {
    await saveLibrary([{ id: "a", text: "#group Mine\n#name A\nstep\n    .accept 1 >> Hi\nstep\n    .xp 3\n", order: 0 }], [], {
      guideId: "a",
      step: null,
      line: null,
    });
    const { user } = await mount();
    await selectStep(user, 0);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    const raw = screen.getByLabelText("Raw text of step 1");
    await user.type(raw, "{Enter}.xp 21");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const files = await exportZip(user, { title: "My Mage Route", name: "MyMage" });
    expect([...files.keys()]).toEqual(["MyMage/MyMage.toc", "MyMage/guides.lua"]);
    expect(files.get("MyMage/MyMage.toc")).toContain("## Title: My Mage Route\n");
    expect(guidesIn(files, "MyMage/guides.lua")).toEqual(["#group Mine\n#name A\nstep\n    .accept 1 >> Hi\n.xp 21\nstep\n    .xp 3\n"]);
  });
});

describe("top bar", () => {
  const twoGuides = () =>
    saveLibrary(
      [
        { id: "a", text: "#group Mine\n#name A\nstep\n", order: 0 },
        { id: "b", text: "#group Mine\n#name B\nstep\n", order: 1 },
      ],
      [],
      { guideId: "a", step: null, line: null },
    );

  it("labels its controls and describes them", async () => {
    await twoGuides();
    await mount();
    const bar = screen.getByRole("banner");
    within(bar).getByRole("heading", { level: 1, name: "RXP Planner" });
    const mode = within(bar).getByRole("group", { name: "Mode" });
    expect(within(mode).getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(mode).getByRole("button", { name: "Playback" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(bar).getByRole("button", { name: "Library" }).getAttribute("aria-expanded")).toBe("false");
    const actions = within(bar).getByRole("group", { name: "Guide file actions" });
    expect(
      within(actions).getByRole("button", {
        name: "Export guide",
        description: "Download guides as an addon for RestedXP Guides",
      }),
    ).toHaveProperty("disabled", false);
    expect(within(actions).getByRole("button", { name: "More guide actions" }).getAttribute("aria-haspopup")).toBe("menu");
  });

  it("opens the Export guide dialog from the split button and the Import guide dialog from its menu", async () => {
    await twoGuides();
    const { user } = await mount();
    expect(cascade(screen.getByRole("button", { name: "More guide actions" }), "background")?.value).toBe("var(--primary-bg)");
    await user.click(screen.getByRole("button", { name: "Export guide" }));
    const exporting = screen.getByRole("dialog", { name: "Export guide" });
    await user.click(within(exporting).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    const more = screen.getByRole("button", { name: "More guide actions" });
    await user.click(more);
    const menu = screen.getByRole("menu", { name: "More guide actions" });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const item = within(menu).getByRole("menuitem", {
      name: "Import guide",
      description: "Addon zip, Lua file, or guide text. You can also drop files.",
    });
    await user.click(item);
    screen.getByRole("dialog", { name: "Import guide" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables Export guide with no guide, and keeps Import guide in reach on a secondary arrow", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Export guide" })).toHaveProperty("disabled", true);
    const more = screen.getByRole<HTMLButtonElement>("button", { name: "More guide actions" });
    expect([more.disabled, cascade(more, "background")?.value, cascade(more, "border-color")?.value]).toEqual([
      false,
      "transparent",
      "var(--disabled-border)",
    ]);
  });

  it("gives Import guide in the library the field height of the buttons beside fields", async () => {
    await mount();
    const library = screen.getByRole("navigation", { name: "Library" });
    expect(cascade(within(library).getByRole("button", { name: "Import guide" }), "height")?.value).toBe("var(--control-field)");
  });

  it.each(["{Enter}", " ", "{ArrowDown}"])("opens the guide actions menu with %s, and Escape closes it to the arrow", async (key) => {
    const { user } = await mount();
    const more = screen.getByRole("button", { name: "More guide actions" });
    act(() => more.focus());
    await user.keyboard(key);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Import guide" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
  });

  it("closes the guide actions menu on a click outside it", async () => {
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "More guide actions" }));
    screen.getByRole("menu", { name: "More guide actions" });
    await user.click(screen.getByRole("region", { name: "Steps" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens another guide from the library drawer in Playback", async () => {
    await twoGuides();
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Playback" }));
    await user.click(screen.getByRole("button", { name: "Library" }));
    await user.click(within(screen.getByRole("navigation", { name: "Library" })).getByRole("button", { name: "B" }));
    expect(
      within(screen.getByRole("region", { name: "Route" }))
        .getByRole("button", { current: "page" })
        .getAttribute("aria-label"),
    ).toBe("B, guide 1 of 1, open guide");
    expect(screen.getByRole("button", { name: "Playback" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the library drawer with focus inside and closes it with Escape or its close button", async () => {
    await twoGuides();
    const { user } = await mount();
    const button = screen.getByRole("button", { name: "Library" });
    const library = screen.getByRole("navigation", { name: "Library" });
    const open = () => button.getAttribute("aria-expanded") === "true" && document.getElementById("app")!.dataset.drawer === "library";

    await user.click(button);
    expect(open()).toBe(true);
    expect(library.contains(document.activeElement)).toBe(true);
    await user.click(within(library).getByRole("button", { name: "B" }));
    screen.getByRole("listbox", { name: "Steps of B" });
    expect(open()).toBe(true);

    await user.keyboard("{Escape}");
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await user.click(within(library).getByRole("button", { name: "Close library" }));
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("draws open Preview as and Warnings as pressed toggles, and the open Library as a quieter wash with a bold label", async () => {
    await twoGuides();
    const { user } = await mount();
    const look = (button: HTMLElement) => [
      button.getAttribute("aria-expanded") ?? button.getAttribute("aria-pressed"),
      cascade(button, "border-color")?.value,
      cascade(button, "box-shadow")?.value,
      cascade(button, "background")?.value,
      cascade(button, "font-weight")?.value,
    ];
    const looks = [];
    for (const name of [/^Preview as /, /^Warnings/, /^Library$/]) {
      const trigger = screen.getByRole("button", { name });
      await user.click(trigger);
      looks.push(look(trigger));
    }
    const pressed = ["true", "var(--accent)", "var(--ring-pressed)"];
    expect(looks.slice(0, 2).map((l) => l.slice(0, 3))).toEqual([pressed, pressed]);
    expect(looks[2]).toEqual(["true", "1px solid transparent", undefined, "var(--pressed-wash)", "var(--font-weight-bold)"]);
    expect(look(screen.getByRole("button", { name: "Edit" })).slice(0, 3)).not.toEqual(pressed);
  });

  it("closes the Preview as popover on the first Escape and the library drawer on the second", async () => {
    await twoGuides();
    const { user } = await mount();
    const libraryButton = screen.getByRole("button", { name: "Library" });
    const previewButton = screen.getByRole("button", { name: /^Preview as / });
    await user.click(libraryButton);
    await user.click(previewButton);
    expect(previewButton.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    expect(previewButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(previewButton);
    expect(libraryButton.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    expect(libraryButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(libraryButton);
  });
});

describe("import", () => {
  const batch = (xp: number) => new File([`#group Batch\n#name Same\nstep\n.xp ${xp}\n`], `guide-${xp}.txt`, { type: "text/plain" });
  const importBatch = async (user: UserEvent) => {
    const dialog = await upload(user, [batch(1), batch(2)]);
    await within(dialog).findByText("Found 2 guides in 2 files.");
    const submit = within(dialog).getByRole("button", { name: "Import 2 guides" });
    expect(submit).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("group", { name: "Name taken in this import:" })).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: "Keep both" }));
    await user.click(submit);
    return within(screen.getByRole("navigation", { name: "Library" })).getAllByRole("listitem");
  };

  it("shows neither conflict choice as chosen until the user picks one", async () => {
    const { user } = await mount();
    const dialog = await upload(user, [batch(1), batch(2)]);
    await within(dialog).findByText("Found 2 guides in 2 files.");
    const group = within(dialog).getAllByRole("group", { name: "Name taken in this import:" })[0]!;
    const dots = () =>
      ["Replace", "Keep both"].map((name) => cascade(within(group).getByRole("radio", { name }).nextElementSibling!, "visibility")?.value);
    expect(dots()).toEqual(["hidden", "hidden"]);
    await user.click(within(group).getByRole("radio", { name: "Keep both" }));
    expect(dots()).toEqual(["hidden", "visible"]);
  });

  it("refuses to export two guides that RXP would load under one name", async () => {
    const { user } = await mount();
    expect(await importBatch(user)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Export guide" }));
    const dialog = screen.getByRole("dialog", { name: "Export guide" });
    const download = within(dialog).getByRole("button", { name: /^Download / });
    expect(within(dialog).getByRole("alert").textContent).toContain("Batch / Same");
    expect(download).toHaveProperty("disabled", true);
    await user.click(within(dialog).getAllByRole("checkbox", { name: /^Same/ })[0]!);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(download).toHaveProperty("disabled", false);
  });

  it("reads the files dropped on the page", async () => {
    const { user } = await mount();
    fireEvent.drop(document.getElementById("app")!, { dataTransfer: { files: [batch(1), batch(2)], types: ["Files"] } });
    const dialog = screen.getByRole("dialog", { name: "Import guide" });
    await within(dialog).findByText("Found 2 guides in 2 files.");
    await user.click(within(dialog).getByRole("radio", { name: "Keep both" }));
    await user.click(within(dialog).getByRole("button", { name: "Import 2 guides" }));
    expect(within(screen.getByRole("navigation", { name: "Library" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("hides the drop hint after a drop that holds no files", async () => {
    await mount();
    const app = document.getElementById("app")!;
    fireEvent.dragOver(app, { dataTransfer: { files: [], types: ["Files"] } });
    expect(screen.getByText("Drop to import guides")).toBeTruthy();
    fireEvent.drop(app, { dataTransfer: { files: [], types: ["Files"] } });
    expect(screen.queryByText("Drop to import guides")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Import guide" })).toBeNull();
  });

  it("drops a read that finishes after the dialog closes", async () => {
    const { user } = await mount();
    const late = slowFile("#group Late\n#name Late\nstep\n", "late.txt");
    let dialog = await upload(user, late.file);
    within(dialog).getByText("Reading late.txt…");
    await user.keyboard("{Escape}");
    dialog = await upload(user, batch(1));
    await within(dialog).findByText("Found 1 guide in 1 file.");
    await act(async () => late.arrive());
    within(dialog).getByText("Found 1 guide in 1 file.");
    expect(
      within(dialog)
        .getAllByRole("row")
        .map((r) => r.textContent),
    ).toEqual(["GuideGroupStatus", "SameBatchNew"]);
  });

  it("imports pasted guide text", async () => {
    const { user } = await mount();
    await openImport(user);
    const dialog = screen.getByRole("dialog", { name: "Import guide" });
    expect(within(dialog).getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByText("Add guides to import")).toBeTruthy();
    await user.type(within(dialog).getByLabelText("Guide text"), "#group Pasted{Enter}#name P{Enter}step{Enter}.xp 3{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Add text" }));
    await within(dialog).findByText("Found 1 guide in 1 pasted text.");
    expect(within(dialog).queryByText("Add guides to import")).toBeNull();
    await user.upload(within(dialog).getByLabelText("Import files"), batch(1));
    await within(dialog).findByText("Found 2 guides in 1 file and 1 pasted text.");
    await user.type(within(dialog).getByLabelText("Guide text"), "step{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Add text" }));
    await within(dialog).findByText("Found 3 guides in 1 file and 2 pasted texts.");
    expect(
      within(dialog)
        .getAllByRole("row")
        .map((r) => r.textContent),
    ).toEqual(["GuideGroupStatus", "PPastedNew", "SameBatchNew", "(no #name)(no group)Missing #name. Missing #group. "]);
    await user.click(within(dialog).getByRole("checkbox", { name: "Import (no #name)" }));
    await user.click(within(dialog).getByRole("button", { name: "Import 2 guides" }));

    await user.click(within(screen.getByRole("navigation", { name: "Library" })).getByRole("button", { name: "P" }));
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.getByLabelText("Raw text of step 1")).toHaveProperty("value", "step\n.xp 3");
  });

  it("asks for a choice when an addon holds guides that are in the library", async () => {
    const { user } = await mount();
    await importMageAddon(user);
    const dialog = await upload(user, mageAddon);
    await within(dialog).findByText("Found 7 guides in 1 file.");
    const submit = within(dialog).getByRole("button", { name: "Import 7 guides" });
    expect(submit).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("button", { name: "Replace all" }));
    await user.click(submit);
    expect(within(screen.getByRole("navigation", { name: "Library" })).getAllByRole("listitem")).toHaveLength(7);
  });

  it("lists kept copies together in route order, each with its own label", async () => {
    const { user } = await mount();
    await importMageAddon(user);
    const dialog = await upload(user, mageAddon);
    await within(dialog).findByText("Found 7 guides in 1 file.");
    await user.click(within(dialog).getByRole("button", { name: "Keep both for all" }));
    await user.click(within(dialog).getByRole("button", { name: "Import 7 guides" }));

    const alliance = screen.getByRole("region", { name: "Group RestedXP Forever Guide (A)" });
    const rows = within(alliance)
      .getAllByRole("button", { name: /^\d/ })
      .map((b) => b.textContent);
    expect(rows.slice(0, 6)).toEqual([
      "1-10 Dun Morogh Mage AoEcopy 1 of 2",
      "1-10 Dun Morogh Mage AoEcopy 2 of 2",
      "1-10 Elwynn Forest Mage AoEcopy 1 of 2",
      "1-10 Elwynn Forest Mage AoEcopy 2 of 2",
      "10-12 Loch Modan Mage AoEcopy 1 of 2",
      "10-12 Loch Modan Mage AoEcopy 2 of 2",
    ]);
    within(alliance).getByRole("button", { name: "Delete 1-10 Dun Morogh Mage AoE (copy 2 of 2)" });

    await user.click(within(alliance).getByRole("button", { name: "Rename 1-10 Dun Morogh Mage AoE (copy 2 of 2)" }));
    const rename = screen.getByRole("dialog", { name: "Rename “1-10 Dun Morogh Mage AoE” (copy 2 of 2)" });
    expect(within(rename).getByLabelText("Guide name (#name)")).toHaveProperty("value", "1-10 Dun Morogh Mage AoE");
  });
});

describe("built-in guides", () => {
  const G = "Test Group";
  const builtins: Builtins = {
    version: "v9.9.9",
    guides: [{ id: "rxp:test.lua#1", text: `#group ${G}\n#name A\nstep\n    .accept 1 >>Hello\n`, order: 0, fileName: "test.lua" }],
  };

  it("copies a built-in on the first edit and keeps typing in the same field", async () => {
    await saveLibrary([], [], { guideId: "rxp:test.lua#1", step: 0, line: null });
    const { user } = await mount(builtins);
    const text = within(screen.getByRole("group", { name: "Line 1, Accept quest" })).getByLabelText(">> Text");
    selectText(text, "Hello".length);
    await user.keyboard("abc{Enter}def{Enter}");

    expect(document.activeElement).toBe(text);
    expect(shownText(text)).toBe("Helloabcdef");
    const library = screen.getByRole("navigation", { name: "Library" });
    expect(within(library).getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Guide text" }));
    expect(screen.getByLabelText("Guide text, read only").textContent).toBe(`#group ${G}\n#name A\nstep\n    .accept 1 >> Helloabcdef\n`);

    const files = await exportZip(user);
    const lua = [...files.keys()].find((f) => f.endsWith("guides.lua"))!;
    expect(guidesIn(files, lua)).toEqual([`#group ${G}\n#name A\nstep\n    .accept 1 >> Helloabcdef\n`]);
    expect(files.get(lua)).toContain(`[=[\n${G} (custom)]=]`);
  });
});

const factionRows = (() => {
  const giver = (zone: { id: number; uiMapId: number }, x: number, y: number, sourceId: number, sourceName: string) =>
    zonePoint(zone, x, y, { kind: "start", sourceType: "npc", sourceId, sourceName });
  return zoneData([
    questRow(687, "Theldurin the Lost", {
      startPoints: [],
      preQuestSingle: null,
      byFaction: {
        Alliance: { startPoints: [giver(ZONES.ironforge, 50.83, 5.62, 2786, "Gerrig Bonegrip")], preQuestSingle: [653] },
        Horde: { startPoints: [giver(ZONES.arathi, 74.54, 35.64, 2787, "Zaruk")], preQuestSingle: [688] },
      },
    }),
    questRow(653, "Myzrael's Allies"),
    questRow(688, "Myzrael's Allies"),
  ]);
})();

describe("faction rows", () => {
  it("reads the preview character's faction in every quest view, and again when the race changes it", async () => {
    const text = "#group T\n#name One\nstep\n    .accept 687\n";
    await saveSetting("preview", DEFAULT_SETTINGS);
    const { user } = await renderPlanner({
      initial: { guides: [{ id: "g0", text, order: 0 }], session: { guideId: "g0", step: 0, line: 0 } },
      loadGameData: () => Promise.resolve(factionRows),
    });
    await screen.findByRole("combobox", { name: "Map shown" });
    const quests = () => screen.getByRole("region", { name: "Search" });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" }), "687");
    await user.click(within(quests()).getByRole("button", { name: /Theldurin the Lost/ }));
    const shown = () => ({
      markers: within(screen.getByRole("group", { name: /^Map of / }))
        .queryAllByRole("button", { name: /^Starts / })
        .map((m) => m.getAttribute("aria-label")),
      warning: document.getElementById(document.querySelector("#step-0 .step-warn-badge")?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
      givers: [...within(quests()).getByLabelText("Accept at").querySelectorAll("option")].map((o) => o.textContent),
      accept: within(quests()).getByLabelText("Accept step text").textContent,
    });
    await user.selectOptions(within(quests()).getByLabelText("Accept at"), "-1");
    expect(shown()).toEqual({
      markers: ["Starts Theldurin the Lost: Gerrig Bonegrip (Ironforge 50.8, 5.6). Adds a point here."],
      warning: "Line 1: Accepts Theldurin the Lost (687) before turning in Myzrael's Allies (653)",
      givers: ["Gerrig Bonegrip · Ironforge,50.83,5.62", "No .goto"],
      accept: "step\n    .accept 687",
    });

    await user.click(screen.getByRole("button", { name: /^Preview as / }));
    await user.selectOptions(within(screen.getByRole("region", { name: "Character preview" })).getByLabelText("Race"), "Orc");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(shown()).toEqual({
      markers: ["Starts Theldurin the Lost: Zaruk (Arathi Highlands 74.5, 35.6). Adds a point here."],
      warning: "Line 1: Accepts Theldurin the Lost (687) before turning in Myzrael's Allies (688)",
      givers: ["Zaruk · Arathi Highlands,74.54,35.64", "No .goto"],
      accept: "step\n    .goto Arathi Highlands,74.54,35.64\n    .accept 687",
    });
  });
});
