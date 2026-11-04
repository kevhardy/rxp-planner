// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { GameData } from "../../data/index.ts";
import { plannerContext, plannerData, plannerFile } from "../../data/plannerFixture.ts";
import { GameDataContext, StoresContext } from "../context.ts";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";
import { PreviewAs } from "./PreviewBar.tsx";
import { DEFAULT_SETTINGS, loadPreviewSettings, type PreviewSettings } from "./settings.ts";

afterEach(() => {
  cleanup();
  document.head.replaceChildren();
});

function mount(game: GameData = plannerData(), preview: PreviewSettings = DEFAULT_SETTINGS) {
  const stores = createStores(undefined, null, { ...DEFAULT_SAVED_SETTINGS, preview });
  stores.preview.setGame(game);
  render(
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={game}>
        <PreviewAs />
        <p>Outside</p>
      </GameDataContext.Provider>
    </StoresContext.Provider>,
  );
  return userEvent.setup();
}

async function character(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: /^Preview as / }));
  return screen.getByRole("region", { name: "Character preview" });
}

const selectIn = (popover: HTMLElement, label: string) => within(popover).getByLabelText<HTMLSelectElement>(label);
const values = (select: HTMLSelectElement) => [...select.options].map((o) => o.value);

describe("PreviewAs", () => {
  it("hangs the Preview as popover under its button, not fixed to the window", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");
    const popover = getComputedStyle(await character(mount()));
    expect([popover.position, popover.right]).toEqual(["absolute", "0px"]);
  });

  it("offers the Skyborne races on their own side, with only the classes each can be", async () => {
    const user = mount();
    const popover = await character(user);
    const race = selectIn(popover, "Race");
    const sides = [...race.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]);
    expect(sides).toEqual([
      ["Alliance", ["Human", "Dwarf", "Night Elf", "Gnome", "High Order"]],
      ["Horde", ["Orc", "Undead", "Tauren", "Troll", "Windshaper"]],
    ]);

    await user.selectOptions(selectIn(popover, "Class"), "PALADIN");
    await user.selectOptions(race, "HighOrder");
    expect(values(selectIn(popover, "Class"))).toEqual(["WARRIOR", "HUNTER", "ROGUE", "MAGE", "DRUID"]);
    expect(selectIn(popover, "Class").value).toBe("WARRIOR");
    expect(within(popover).getByRole("status").textContent).toBe("High Order cannot be a Paladin. Class set to Warrior.");
    expect(document.activeElement).toBe(race);
    screen.getByRole("button", { name: "Preview as High Order Warrior · AH" });

    await user.selectOptions(selectIn(popover, "Class"), "MAGE");
    expect(within(popover).queryByRole("status")).toBeNull();
    await user.selectOptions(race, "Windshaper");
    expect(values(selectIn(popover, "Class"))).toEqual(["WARRIOR", "HUNTER", "ROGUE", "SHAMAN", "DRUID"]);
    expect(within(popover).getByRole("status").textContent).toBe("Windshaper cannot be a Mage. Class set to Warrior.");
  });

  it("offers the classes the dataset gives each race, such as Dwarf Shaman and Undead Paladin", async () => {
    const user = mount();
    const popover = await character(user);
    const race = selectIn(popover, "Race");
    const cls = selectIn(popover, "Class");
    await user.selectOptions(race, "Dwarf");
    expect(values(cls)).toEqual(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN"]);
    await user.selectOptions(cls, "SHAMAN");
    await user.selectOptions(race, "Scourge");
    expect(values(cls)).toEqual(["WARRIOR", "PALADIN", "ROGUE", "PRIEST", "MAGE", "WARLOCK"]);
    expect(within(popover).getByRole("status").textContent).toBe("Undead cannot be a Shaman. Class set to Warrior.");
    await user.selectOptions(cls, "PALADIN");
    screen.getByRole("button", { name: "Preview as Undead Paladin · AH" });
  });

  it("offers every class and keeps the saved class when the dataset does not list race classes", async () => {
    const { raceClasses: _, ...file } = plannerFile();
    const user = mount(new GameData(file, plannerContext), { ...DEFAULT_SETTINGS, race: "Tauren", class: "MAGE" });
    const cls = selectIn(await character(user), "Class");
    expect(values(cls)).toEqual(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"]);
    expect(cls.value).toBe("MAGE");
    expect(screen.getByRole("button", { name: /^Preview as / }).textContent).toBe("Preview as Tauren Mage · AH");
  });

  it("opens a popover of the preview controls and closes it with Escape", async () => {
    const user = mount();
    const button = screen.getByRole("button", { name: "Preview as Human Warrior · AH" });
    const popover = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(popover.hidden).toBe(true);

    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(popover.hidden).toBe(false);
    const labels = within(popover)
      .getAllByRole<HTMLSelectElement>("combobox")
      .map((c) => c.labels?.[0]?.textContent);
    expect(labels).toEqual(["Race", "Class", "Trading", "XP rate"]);
    expect(document.activeElement).toBe(within(popover).getByLabelText("Race"));

    await user.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(popover.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("closes the popover on a click outside it", async () => {
    const user = mount();
    const popover = await character(user);
    await user.click(within(popover).getByLabelText("Trading"));
    expect(popover.hidden).toBe(false);
    await user.click(screen.getByText("Outside"));
    expect(popover.hidden).toBe(true);
    expect(screen.getByRole("button", { name: /^Preview as / }).getAttribute("aria-expanded")).toBe("false");
  });

  it("lists RXP's Forever XP rates and keeps a saved rate outside them, as RXP does", async () => {
    const user = mount(plannerData(), { ...DEFAULT_SETTINGS, xpRate: 3 });
    const select = selectIn(await character(user), "XP rate");
    const options = () => [...select.options].map((o) => o.textContent);
    expect(options().slice(0, 4)).toEqual(["Default (1×)", "3× (saved, outside RXP's slider)", "1×", "1.05×"]);
    expect(options().at(-1)).toBe("2×");
    expect(options()).toHaveLength(23);
    expect(select.value).toBe("3");

    await user.selectOptions(select, "2");
    expect(options()).not.toContain("3× (saved, outside RXP's slider)");
    expect(await loadPreviewSettings()).toMatchObject({ xpRate: 2 });
  });
});
