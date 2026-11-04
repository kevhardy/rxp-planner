// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { EntityIndex } from "../../data/index.ts";
import { plannerData, plannerNames } from "../../data/plannerFixture.ts";
import { guideMeta } from "../../rules/registration.ts";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { createStores } from "../stores.ts";
import { StateButton } from "./StateButton.tsx";

afterEach(() => cleanup());

const data = plannerData();
const names = new EntityIndex(plannerNames);

const route = [
  "#name A\n#group G\n#next B\nstep\n    .accept 783\n    .accept 62\nstep\n    .turnin 783\n    .accept 33\n    .accept 830\n" +
    "step\n    .complete 33,1\n    -- @sim kils=3\n",
  "#name B\n#group G\n-- @sim level=5\nstep\n    .accept 18\n",
];

function mount(open: string, texts = route) {
  const guides = texts.map((text, i) => ({ id: `g${i}`, text, order: i }));
  const stores = createStores({ guides, session: { guideId: guides.find((g) => guideMeta(g).name === open)!.id, step: 0, line: null } });
  render(
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={data}>
        <EntityContext.Provider value={names}>
          <StateButton />
        </EntityContext.Provider>
      </GameDataContext.Provider>
    </StoresContext.Provider>,
  );
  return { user: userEvent.setup(), store: stores.editor };
}

const stats = (panel: HTMLElement) =>
  Object.fromEntries([...panel.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]));

describe("StateButton", () => {
  it("shows the character after the selected step", async () => {
    const { user, store } = mount("A");
    await user.click(screen.getByRole("button", { name: "State" }));
    const panel = screen.getByRole("region", { name: "Simulated state" });
    within(panel).getByRole("heading", { name: "State" });
    expect(panel.querySelector(".panel-head .count")!.textContent).toBe("after step 1");
    act(() => store.select({ step: 1, line: null }));
    expect(panel.querySelector(".panel-head .count")!.textContent).toBe("after step 2");
    expect(stats(panel)).toEqual({
      Level: "1 · 40/400 xp",
      "Quest log": "3/40",
      "Ready to turn in": "1",
      "Quests done": "1",
      "Guide started at": "1 · 0%",
    });
    expect(within(panel).getByRole("progressbar", { name: "XP through level 1" }).getAttribute("value")).toBe("40");
    const details = panel.querySelector("details")!;
    expect(details.open).toBe(false);
    await user.click(within(panel).getByText("In the log"));
    expect(details.open).toBe(true);
    const log = within(within(panel).getByRole("list")).getAllByRole("listitem");
    expect(log.map((li) => [...li.children].map((c) => c.textContent))).toEqual([
      ["The Fargodeep Mine", "Scout through the Fargodeep Mine"],
      ["Wolves Across the Border", "0/8 Tough Wolf Meat"],
      ["The Admiral's Orders", "ready"],
    ]);

    act(() => store.select({ step: null, line: null }));
    expect(panel.querySelector(".panel-head .count")!.textContent).toBe("at the guide's start");
  });

  it("starts a guide that another leads to with an empty quest log", async () => {
    const { user, store } = mount("B");
    await user.click(screen.getByRole("button", { name: "State" }));
    act(() => store.select({ step: null, line: null }));
    expect(stats(screen.getByRole("region", { name: "Simulated state" }))).toEqual({
      Level: "5 · 0/2,800 xp",
      "Quest log": "0/40",
      "Ready to turn in": "0",
      "Quests done": "0",
      "Guide started at": "5 · 0%",
    });
  });

  it("starts an Auto start at the low end of the start guide's range", async () => {
    const { user, store } = mount("12-14 Loch Modan", ["#name 12-14 Loch Modan\n#group G\nstep\n    .accept 7\n"]);
    await user.click(screen.getByRole("button", { name: "State" }));
    act(() => store.select({ step: null, line: null }));
    const panel = screen.getByRole("region", { name: "Simulated state" });
    expect(within(panel).getByText("Guide started at").nextElementSibling!.textContent).toBe("12 · 0%");
  });

  it("opens the state in a window that stays open while steps are selected", async () => {
    const { user, store } = mount("A");
    const button = screen.getByRole("button", { name: "State" });
    expect(screen.queryByRole("region", { name: "Simulated state" })).toBeNull();
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await user.click(document.body);
    act(() => store.select({ step: 1, line: null }));
    const panel = screen.getByRole("region", { name: "Simulated state" });
    expect(panel.querySelector(".panel-head .count")!.textContent).toBe("after step 2");

    await user.click(within(panel).getByText("In the log"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Simulated state" })).toBeNull();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Close state" }));
    expect(screen.queryByRole("region", { name: "Simulated state" })).toBeNull();
  });
});
