// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityIndex } from "../../data/index.ts";
import { EntityContext, GameDataContext } from "../context.ts";
import { zoneData, questRow, zonePoint } from "../testing.ts";
import { QuestDetails, QuestPreview } from "./QuestInfo.tsx";

// React reports list and key mistakes only through console.error.
beforeEach(() => void vi.spyOn(console, "error"));
afterEach(() => {
  cleanup();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const names = new EntityIndex({
  version: 2,
  entities: {
    item: [
      [11583, "Cactus Apple"],
      [11584, "Cactus Apple Surprise"],
      [247840, "Mining for Dummies"],
      [247841, "Wild Harvest"],
      [247846, "Pelt Collecting for Beginners"],
      [264163, "Taming Rod"],
    ],
    quest: [[4402, "Galgar's Cactus Apple Surprise"]],
    npc: [[9796, "Galgar"]],
    spell: [[585, "Smite", "Rank 1"]],
    object: [[142075, "Mailbox"]],
  },
});

const data = zoneData(
  [
    questRow(788, "Cutting Teeth"),
    questRow(5401, "Argent Dawn Commission"),
    questRow(5405, "Argent Dawn Commission"),
    questRow(5503, "Argent Dawn Commission"),
    questRow(5461, "The Human, Ras Frostwhisper"),
    questRow(5462, "The Dying, Ras Frostwhisper"),
    questRow(94979, "Taming the Beast"),
    questRow(5402, "Minion's Scourgestones", {
      questLevel: 55,
      requiredLevel: 50,
      requiredFaction: "Alliance",
      preQuestGroup: [5461, 5462],
      preQuestSingle: [5401, 5405, 5503],
      objectives: [{ index: 1, type: "item", id: 12840, ids: [12840], name: "Minion's Scourgestone", count: 20 }],
    }),
    questRow(94013, "Taming the Beast", {
      questLevel: 10,
      requiredLevel: 10,
      raceRequirement: "Race restriction",
      preQuestSingle: [94979],
      textObjectives: [
        { name: "Taming Rod", count: 1, need: "providedItem", link: { kind: "item", id: 264163 } },
        { name: "Tame a Vuldren", count: 1, need: "action" },
      ],
    }),
    questRow(4402, "Galgar's Cactus Apple Surprise", {
      questLevel: 3,
      requiredLevel: 1,
      raceRequirement: "Horde",
      requiredFaction: "Horde",
      zoneIds: [14],
      baseXp: 380,
      objectiveText: ["Bring Galgar 10 Cactus Apples. You remember him saying that they could be found near cactuses."],
      objectives: [{ index: 1, type: "item", id: 11583, ids: [11583], name: "Cactus Apple", count: 10 }],
      startPoints: [
        zonePoint({ id: 14, uiMapId: 1411 }, 42.73, 67.23, { kind: "start", sourceType: "npc", sourceId: 9796, sourceName: "Galgar" }),
      ],
      preQuestSingle: [788],
      rewardItems: [{ item: 11584, count: 10 }],
      rewardChoices: [
        { item: 247840, count: 1 },
        { item: 247841, count: 1 },
        { item: 247846, count: 1 },
      ],
      rewardMoney: 50,
      rewardReputation: [
        { faction: 76, value: 200 },
        { faction: 530, value: 200 },
      ],
    }),
  ],
  { factionNames: { 76: "Orgrimmar", 530: "Darkspear Trolls" } },
);

const facts = (details: HTMLElement) =>
  Object.fromEntries([...details.querySelectorAll("dt")].map((dt) => [dt.textContent, (dt.nextElementSibling as HTMLElement).textContent]));

describe("QuestPreview", () => {
  it("shows XP at the character's level and linked rewards, and opens to the quest's details", async () => {
    render(
      <EntityContext.Provider value={names}>
        <GameDataContext.Provider value={data}>
          <QuestPreview data={data} quest={data.quest(4402)!} level={10} status="Available" />
        </GameDataContext.Provider>
      </EntityContext.Provider>,
    );
    const brief = document.querySelector<HTMLElement>(".quest-brief")!;
    expect(brief.textContent).toMatch(/^230 XP · .* · 50c$/);
    const href = (name: string) => within(brief).getByRole("link", { name }).getAttribute("href");
    expect(["Cactus Apple Surprise ×10", "Mining for Dummies", "Wild Harvest", "Pelt Collecting for Beginners"].map(href)).toEqual([
      "https://www.wowhead.com/forever/item=11584",
      "https://www.wowhead.com/forever/item=247840",
      "https://www.wowhead.com/forever/item=247841",
      "https://www.wowhead.com/forever/item=247846",
    ]);

    const toggle = screen.getByRole("button", { name: "Galgar's Cactus Apple Surprise (level 3)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".quest-details")).toBeNull();
    await userEvent.setup().click(toggle);
    const details = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(facts(details)).toEqual({
      Objectives: "Cactus Apple ×10",
      Experience: "230 at level 10, 380 in full",
      Rewards:
        "Cactus Apple Surprise ×10Choose one:Mining for DummiesWild HarvestPelt Collecting for Beginners50c+200 Orgrimmar+200 Darkspear Trolls",
      Starts: "Galgar",
      After: "Cutting Teeth",
    });
    expect(within(details).getByText("Level 3, requires 1 · Horde")).toBeTruthy();
    expect(within(details).getByRole("link", { name: "Galgar" }).getAttribute("href")).toBe("https://www.wowhead.com/forever/npc=9796");
  });
});

describe("QuestDetails", () => {
  it("shows unknown objective types as text without an inherited entity link", () => {
    const quest = {
      ...data.quest(5402)!,
      objectives: [
        { index: 1, type: "toString", id: 12840, ids: [12840], name: "Unknown objective", count: 1 },
        { index: 2, type: "item", id: 12840, ids: [12840], name: "Known objective", count: 1 },
      ],
    };
    render(<QuestDetails data={data} quest={quest} level={null} />);
    expect([
      screen.getByText(/^Unknown objective(?: ×1)?$/).closest("a"),
      screen.getByRole("link", { name: "Known objective" }).getAttribute("href"),
    ]).toEqual([null, "https://www.wowhead.com/forever/item=12840"]);
  });

  const details = (id: number) => {
    render(
      <EntityContext.Provider value={names}>
        <GameDataContext.Provider value={data}>
          <QuestDetails data={data} quest={data.quest(id)!} level={null} />
        </GameDataContext.Provider>
      </EntityContext.Provider>,
    );
    return document.querySelector<HTMLElement>(".quest-details")!;
  };

  it("names the faction and reads prerequisites as the route check does", () => {
    const shown = details(5402);
    expect(within(shown).getByText("Level 55, requires 50 · Alliance")).toBeTruthy();
    expect(facts(shown)).toMatchObject({
      After: "one of Argent Dawn Commission, Argent Dawn Commission, Argent Dawn Commission",
    });
  });

  it("shows the full XP of a level 60 quest below the cap", () => {
    const quest = { ...data.quest(4402)!, questLevel: 60, baseXp: 1000 };
    render(
      <EntityContext.Provider value={names}>
        <GameDataContext.Provider value={data}>
          <QuestDetails data={data} quest={quest} level={59} />
        </GameDataContext.Provider>
      </EntityContext.Provider>,
    );
    expect(facts(document.querySelector<HTMLElement>(".quest-details")!).Experience).toBe("1,000");
  });

  it("lists captured rows", () => {
    expect(facts(details(94013))).toMatchObject({
      Objectives: "Taming Rod ×1 (provided)Tame a Vuldren ×1",
      After: "Taming the Beast",
    });
  });
});
