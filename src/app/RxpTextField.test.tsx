// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ContextType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { textureKey } from "../../packages/data-contract/guideIcons.ts";
import { guideIconCatalog, type GuideIconSheet } from "../data/guideIcons.ts";
import { guideIconsFixture } from "../data/manifestFixture.ts";
import { coloredText, insertEntityReference } from "../guide/index.ts";
import { GuideIconsContext } from "./context.ts";
import { RxpTextField } from "./RxpTextField.tsx";
import { renderRxpText, sourceRange } from "./rxpTextDom.ts";

afterEach(cleanup);

const catalog = guideIconCatalog(guideIconsFixture().guideIcons);
const ICONS = { catalog, sheet: undefined };

function mount(
  initial: string,
  check: (value: string) => string | null = () => null,
  icons: ContextType<typeof GuideIconsContext> = { catalog: guideIconCatalog(undefined), sheet: undefined },
) {
  const commits: string[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        <RxpTextField
          label="Text"
          draftName="Text"
          value={value}
          onCommit={(next) => {
            const error = check(next);
            if (error) return error;
            commits.push(next);
            setValue(next);
            return null;
          }}
          tools={(field) => (
            <button
              type="button"
              onClick={() => {
                const inserted = insertEntityReference(field.text, ...field.selection(), {
                  type: "npc",
                  id: 196,
                  label: "Eagan Peltskinner",
                });
                field.replace(inserted.text, inserted.caret);
              }}
            >
              Insert NPC
            </button>
          )}
        />
        <button type="button">Elsewhere</button>
        <button type="button" onClick={() => setValue(`${value} again`)}>
          Reload
        </button>
      </>
    );
  }
  const user = userEvent.setup();
  render(
    <GuideIconsContext.Provider value={icons}>
      <Harness />
    </GuideIconsContext.Provider>,
  );
  const box = screen.getByRole("textbox", { name: "Text" });
  return { user, box, commits };
}

function select(box: HTMLElement, start: string, from: number, end = start, to = end.length) {
  const node = (shown: string) => [...box.querySelectorAll("span")].find((s) => s.textContent === shown)!.firstChild!;
  box.focus();
  document.getSelection()!.setBaseAndExtent(node(start), from, node(end), to);
}

describe("RxpTextField", () => {
  it("shows named colors in their color and hides their delimiters", () => {
    const { box } = mount("Kill |cRXP_ENEMY_Boars|r now");
    expect(box.textContent).toBe("Kill Boars now");
    const colored = box.querySelector<HTMLElement>(".rxp-colored")!;
    expect([colored.textContent, colored.dataset.color]).toEqual(["Boars", "ENEMY"]);
  });

  it("colors a selection across a color boundary at the right source offsets", async () => {
    const { user, box, commits } = mount("Kill |cRXP_ENEMY_Boars|r now");
    select(box, "Kill ", 2, "Boars", 3);
    await user.click(screen.getByRole("button", { name: "Loot" }));
    await user.keyboard("{Enter}");
    expect(commits).toEqual(["Ki|cRXP_LOOT_ll Boa|r|cRXP_ENEMY_rs|r now"]);
  });

  it("keeps the selection on the words after a color button", async () => {
    const { user, box, commits } = mount("|cRXP_ENEMY_Red Boar|r");
    select(box, "Red Boar", 4);
    await user.click(screen.getByRole("button", { name: "Loot" }));
    expect([document.activeElement, document.getSelection()!.toString()]).toEqual([box, "Boar"]);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.keyboard("{Enter}");
    expect(commits).toEqual(["|cRXP_ENEMY_Red |rBoar"]);
  });

  it("inserts a reference at source offsets after a hidden color start", async () => {
    const { user, box, commits } = mount("Talk to |cRXP_FRIENDLY_Eagan|r");
    select(box, "Eagan", 0);
    await user.click(screen.getByRole("button", { name: "Insert NPC" }));
    expect(document.activeElement).toBe(box);
    await user.keyboard("!{Enter}");
    expect(commits).toEqual(["Talk to |cRXP_FRIENDLY_Eagan Peltskinner (npc #196)!|r"]);
  });

  it("commits on Enter and when focus leaves the field and its tools", async () => {
    const { user, box, commits } = mount("Go");
    select(box, "Go", 2);
    await user.keyboard(" now{Enter}");
    await user.keyboard(" fast");
    await user.click(screen.getByRole("button", { name: "Insert NPC" }));
    expect(commits).toEqual(["Go now"]);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(commits).toEqual(["Go now", "Go now fastEagan Peltskinner (npc #196)"]);
  });

  it("keeps a draft that fails to commit, with the error", async () => {
    const { user, box, commits } = mount("Go", (value) => (value.includes("--") ? "No comments here." : null));
    select(box, "Go", 2);
    await user.keyboard(" -- x{Enter}");
    expect([box.textContent, box.getAttribute("aria-invalid"), screen.getByRole("alert").textContent]).toEqual([
      "Go -- x",
      "true",
      "No comments here.",
    ]);
    expect(commits).toEqual([]);
  });

  it("drops the draft on Escape", async () => {
    const { user, box, commits } = mount("Go");
    select(box, "Go", 2);
    await user.keyboard(" now{Escape}");
    expect(box.textContent).toBe("Go");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(commits).toEqual([]);
  });

  it("shows a texture as a chip, types beside it, and removes it whole with Backspace", async () => {
    const { user, box, commits } = mount("Use |T134414:0|t[Hearthstone]");
    const chip = box.querySelector<HTMLElement>(".rxp-chip")!;
    expect([chip.textContent, chip.title, chip.contentEditable]).toEqual(["icon", "|T134414:0|t", "false"]);
    select(box, "Use ", 4, "Use ", 4);
    await user.keyboard("a ");
    select(box, "[Hearthstone]", 0, "[Hearthstone]", 0);
    await user.keyboard("{Backspace}{Enter}");
    expect(commits).toEqual(["Use a [Hearthstone]"]);
  });

  it("pastes plain text on one line", async () => {
    const { user, box, commits } = mount("Go");
    select(box, "Go", 2);
    await user.paste(" north\r\nthen |cRXP_WARN_east|r");
    await user.keyboard("{Enter}");
    expect(commits).toEqual(["Go north then |cRXP_WARN_east|r"]);
  });

  it("copies a selection that starts at a color's end without the hidden end", async () => {
    const { user, box } = mount("|cRXP_ENEMY_a |r|T1:0|t[B]");
    select(box, "a ", 2, "[B]", 3);
    expect((await user.copy())!.getData("text/plain")).toBe("|T1:0|t[B]");
  });

  it("undoes and redoes the draft's typing and colors with Ctrl+Z and Ctrl+Shift+Z", async () => {
    const { user, box, commits } = mount("Kill Boar");
    select(box, "Kill Boar", 5);
    await user.click(screen.getByRole("button", { name: "Enemy" }));
    select(box, "Boar", 4, "Boar", 4);
    await user.keyboard("s");
    await user.keyboard("{Control>}z{/Control}");
    const colored = box.querySelector<HTMLElement>(".rxp-colored")!;
    expect([box.textContent, colored.textContent, colored.dataset.color]).toEqual(["Kill Boar", "Boar", "ENEMY"]);
    await user.keyboard("{Control>}z{/Control}");
    expect(box.querySelector(".rxp-colored")).toBeNull();
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}{Enter}");
    expect(commits).toEqual(["Kill |cRXP_ENEMY_Boar|r"]);
  });

  it("does not commit an Enter that ends an IME composition", () => {
    const { box, commits } = mount("Go");
    select(box, "Go", 2);
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.compositionEnd(box, { data: "語" });
    expect([box.textContent, commits]).toEqual(["Go語", []]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(commits).toEqual(["Go語"]);
  });

  it("names each color button's code and meaning", async () => {
    const { user } = mount("Go");
    const enemy = screen.getByRole("button", { name: "Enemy" });
    await user.hover(enemy);
    expect(document.getElementById(enemy.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Enemy (RXP_ENEMY_). A hostile mob to kill. The leveling simulation picks its grind mob from these names, so this can change simulated XP.",
    );
  });
});

describe("RxpTextField icons", () => {
  const options = () => screen.getAllByRole("option").map((option) => option.textContent.trim());

  it("shows a texture that the catalog has as its named icon, and copies it as source", async () => {
    const { user, box } = mount("Cut |T7792229:20|t to |T134414:0|t", undefined, ICONS);
    const knife = screen.getByRole("img", { name: "inv knife 1h skybornec60 b 01" });
    const { style } = knife.querySelector("span")!;
    expect([
      knife.title,
      knife.textContent,
      knife.contentEditable,
      Object.fromEntries([...style].map((name) => [name, style.getPropertyValue(name)])),
    ]).toEqual([
      "|T7792229:20|t",
      "",
      "false",
      {
        "--icon-w": "20px",
        "--icon-h": "20px",
        "--icon-ratio": "1",
        "--sheet-w": "2.125",
        "--sheet-h": "2.125",
        "--cell-x": "-0.03125",
        "--cell-y": "-1.09375",
      },
    ]);
    expect(box.querySelectorAll(".rxp-chip")[1]!.textContent).toBe("icon");
    select(box, "Cut ", 0, " to ", 4);
    expect((await user.copy())!.getData("text/plain")).toBe("Cut |T7792229:20|t to ");
  });

  it("maps a position inside an icon to the icon's start or end", () => {
    const root = document.createElement("div");
    renderRxpText(root, coloredText("a|T308474:20|tb"), catalog);
    const chip = root.querySelector(".rxp-icon-chip")!;
    const at = (node: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(node, offset);
      return sourceRange(root, range);
    };
    expect([at(chip.firstChild!, 0), at(chip, 0), at(chip, 1)]).toEqual([
      [1, 1],
      [1, 1],
      [14, 14],
    ]);
  });

  it("replaces a clicked icon's key, keeps its size, and undoes the replacement", async () => {
    const { user, box, commits } = mount("Use |T308474:020|t now", undefined, ICONS);
    fireEvent.mouseDown(box.querySelector(".rxp-icon-chip .guide-icon")!);
    const dialog = screen.getByRole("dialog", { name: "Replace icon" });
    expect(dialog.querySelector(".icon-current")!.textContent).toBe("Replacing  chatbubble 64grey");
    await user.keyboard("knife{Enter}");
    expect([screen.queryByRole("dialog"), document.activeElement]).toEqual([null, box]);
    expect(screen.getByRole("img", { name: "inv knife 1h skybornec60 b 01" }).title).toBe("|T7792229:020|t");
    await user.keyboard("{Control>}z{/Control}");
    expect(box.querySelector(".rxp-icon-chip")!.getAttribute("title")).toBe("|T308474:020|t");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}{Enter}");
    expect(commits).toEqual(["Use |T7792229:020|t now"]);
  });

  it("makes no edit when the text changed after the picker opened", async () => {
    const { user, box, commits } = mount("Use |T308474:20|t", undefined, ICONS);
    fireEvent.mouseDown(box.querySelector(".rxp-icon-chip")!);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("The text changed after the picker opened, so the picker changed nothing.");
    await user.keyboard("{Escape}");
    expect([screen.queryByRole("dialog"), box.querySelector(".rxp-icon-chip")!.getAttribute("title"), commits]).toEqual([
      null,
      "|T308474:20|t",
      [],
    ]);
  });

  it("finds an icon by the item name that the text writes after it, and shows that name first", async () => {
    const file = guideIconsFixture().guideIcons;
    const rune = { fileDataId: 134414, path: textureKey("interface/icons/inv_misc_rune_01")! };
    const icons = { catalog: guideIconCatalog({ ...file, icons: [...file.icons, rune] }), sheet: undefined };
    const { user, box } = mount(
      "Use |T134414:0|t[Hearthstone], |T134414:0|t[Rune A], |T134414:0|t[Rune B], |T134414:0|t[Rune C]",
      undefined,
      icons,
    );
    select(box, "Use ", 0, "Use ", 0);
    await user.click(screen.getByRole("button", { name: "Insert icon" }));
    const dialog = screen.getByRole("dialog", { name: "Insert icon" });
    await user.type(within(dialog).getByRole("combobox", { name: "Icon name or ID" }), "hearth");
    expect([within(dialog).getByRole("status").textContent, options()]).toEqual([
      "1 icon",
      ["Hearthstone Rune A, Rune B +1 inv misc rune 01 inv #134414"],
    ]);
    const option = within(dialog).getByRole("option", { name: "Hearthstone Rune A, Rune B +1 inv misc rune 01 inv #134414" });
    expect(option.getAttribute("aria-selected")).toBe("true");
  });

  it("finds icons by name, category, and use in the guide, and inserts one at the caret with the keyboard", async () => {
    const { user, box, commits } = mount("Go |T7792229:0|t", undefined, ICONS);
    select(box, "Go ", 3, "Go ", 3);
    await user.click(screen.getByRole("button", { name: "Insert icon" }));
    const dialog = screen.getByRole("dialog", { name: "Insert icon" });
    expect([within(dialog).getByRole("status").textContent, options()]).toEqual([
      "3 icons",
      [
        "ability druid demoralizingroar ability #132121",
        "chatbubble 64grey chatbubble #308474",
        "inv knife 1h skybornec60 b 01 inv #7792229",
      ],
    ]);
    await user.click(within(dialog).getByRole("checkbox", { name: "In this guide" }));
    expect(options()).toEqual(["inv knife 1h skybornec60 b 01 inv #7792229"]);
    await user.click(within(dialog).getByRole("checkbox", { name: "In this guide" }));
    const bubbles = within(dialog).getByRole("button", { name: "chatbubble" });
    await user.click(bubbles);
    expect([bubbles.getAttribute("aria-pressed"), options()]).toEqual(["true", ["chatbubble 64grey chatbubble #308474"]]);
    await user.click(within(dialog).getByRole("button", { name: "All" }));
    const query = within(dialog).getByRole("combobox", { name: "Icon name or ID" });
    await user.click(query);
    await user.keyboard("{ArrowDown}");
    expect(document.getElementById(query.getAttribute("aria-activedescendant")!)!.textContent.trim()).toBe(
      "chatbubble 64grey chatbubble #308474",
    );
    await user.type(query, "zzz");
    expect(within(dialog).getByRole("status").textContent).toBe("No icons match.");
    await user.clear(query);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(document.activeElement).toBe(box);
    await user.keyboard("{Enter}");
    expect(commits).toEqual(["Go |T308474:0|t|T7792229:0|t"]);
  });

  it.each([
    ["Insert icon", "|T308474:20|tABCDE|T132121:0|t"],
    ["Insert NPC", "|T308474:20|tABCDEEagan Peltskinner (npc #196)"],
  ])("keeps the latest caret for %s before selectionchange arrives", async (tool, expected) => {
    const { user, box, commits } = mount("|T308474:20|tABCDE", undefined, ICONS);
    box.focus();
    document.getSelection()!.setBaseAndExtent(box, 0, box, 0);
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    act(() => {
      select(box, "ABCDE", 5, "ABCDE", 5);
      screen.getByRole("button", { name: tool }).focus();
    });
    fireEvent.click(screen.getByRole("button", { name: tool }));
    if (tool === "Insert icon") await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(commits).toEqual([expected]);
  });

  it("offers Replace icon when the caret follows an icon", async () => {
    const { user, box, commits } = mount("Use |T308474:20|t now", undefined, ICONS);
    select(box, " now", 0, " now", 0);
    // jsdom does not fire this when a script moves the selection.
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    await user.click(screen.getByRole("button", { name: "Replace icon" }));
    await user.keyboard("1321{Enter}{Enter}");
    expect(commits).toEqual(["Use |T132121:20|t now"]);
  });

  it("shows the sheet's failure with a Retry that loads it again", async () => {
    const listeners = new Set<() => void>();
    const sheet: GuideIconSheet = {
      state: "failed",
      subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
      retry() {
        Object.assign(this, { state: "loading" });
        listeners.forEach((listener) => listener());
      },
    };
    const { user } = mount("Go", undefined, { catalog, sheet });
    await user.click(screen.getByRole("button", { name: "Insert icon" }));
    const dialog = screen.getByRole("dialog", { name: "Insert icon" });
    expect(dialog.querySelector(".error")!.textContent).toBe("The icon images did not load. The icons show as outlines. Retry");
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect([dialog.querySelector(".error"), within(dialog).getByText("Loading the icon images…").tagName]).toEqual([null, "P"]);
  });

  it("says that a release without guide icons has none to insert", async () => {
    const { user, box } = mount("Use |T308474:20|t");
    expect(box.querySelector(".rxp-chip")!.textContent).toBe("icon");
    await user.click(screen.getByRole("button", { name: "Insert icon" }));
    expect(within(screen.getByRole("dialog", { name: "Insert icon" })).getByRole("status").textContent).toBe(
      "This dataset release has no guide icons. You can still write a texture escape, such as |T134414:0|t, in the text.",
    );
  });
});
