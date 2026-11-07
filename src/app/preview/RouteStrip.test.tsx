// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { EntityIndex } from "../../data/index.ts";
import { plannerData, plannerNames } from "../../data/plannerFixture.ts";
import { guideMeta } from "../../rules/registration.ts";
import { loadSetting } from "../../storage/index.ts";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { unrelatedEntities } from "../renderPlanner.tsx";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";
import { cascade, type State } from "../ui/testing.ts";
import { RouteStrip } from "./RouteStrip.tsx";
import { DEFAULT_SETTINGS, type PreviewSettings } from "./settings.ts";

afterEach(() => cleanup());

const data = plannerData();
const forever = { data, entities: new EntityIndex(plannerNames) };

function mount(texts: string[], open: string, preview: Partial<PreviewSettings> = {}, entities: EntityIndex = unrelatedEntities) {
  const guides = texts.map((text, i) => ({ id: `g${i}`, text, order: i }));
  const guideId = guides.find((g) => guideMeta(g).name === open)!.id;
  const stores = createStores({ guides, session: { guideId, step: 0, line: null } }, null, {
    ...DEFAULT_SAVED_SETTINGS,
    preview: { ...DEFAULT_SETTINGS, ...preview },
  });
  stores.preview.setGame(data);
  render(
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={data}>
        <EntityContext.Provider value={entities}>
          <RouteStrip />
        </EntityContext.Provider>
      </GameDataContext.Provider>
    </StoresContext.Provider>,
  );
  return { user: userEvent.setup(), stores };
}

const routeBar = () => screen.getByRole("region", { name: "Route" });
const startSettings = () => within(routeBar()).getByRole("button", { name: /^Start settings/ });

async function startPanel(user: UserEvent) {
  if (startSettings().getAttribute("aria-expanded") !== "true") await user.click(startSettings());
  return screen.getByRole("region", { name: "Route start" });
}

const guideCards = () =>
  within(screen.getByRole("toolbar", { name: "Guides on the route" })).getAllByRole("button", { name: /, guide \d+ of \d+/ });

const routeNames = () => guideCards().map((card) => /^(.*), guide \d+ of/.exec(card.getAttribute("aria-label")!)![1]);

const startCard = () => [guideCards()[0]!.getAttribute("aria-label"), startSettings().getAttribute("aria-label")];

const startFrom = async (user: UserEvent) => within(await startPanel(user)).getByLabelText<HTMLSelectElement>("Start from");
const startLevel = async (user: UserEvent) => within(await startPanel(user)).getByLabelText<HTMLSelectElement>("Start level");
const openName = (stores: ReturnType<typeof createStores>) => guideMeta(stores.editor.getState().current!.record).name;

describe("Start settings with the Forever simulation", () => {
  const guide = "#name Sim\n#group G\nstep << 3\n    >> Before\nstep\n    .accept 830\nstep\n    .turnin 830\nstep << 3\n    >> After\n";

  it("keeps the saved start XP while the typed value is not a whole number the level holds", async () => {
    const { user, stores } = mount([guide], "Sim", { startLevel: { level: 5, xp: 100 } }, forever.entities);
    const panel = await startPanel(user);
    const xp = within(panel).getByLabelText("Start XP");
    for (const value of ["2800", "1.5", ""]) {
      fireEvent.change(xp, { target: { value } });
      expect(xp.getAttribute("aria-invalid")).toBe("true");
      expect(within(panel).getByRole("alert").textContent).toBe("Enter a whole number from 0 to 2,799.");
      expect(stores.preview.getState().startLevel).toEqual({ level: 5, xp: 100 });
    }
    fireEvent.change(xp, { target: { value: "2799" } });
    expect(xp.getAttribute("aria-invalid")).toBeNull();
    expect(within(panel).queryByRole("alert")).toBeNull();
    expect(stores.preview.getState().startLevel).toEqual({ level: 5, xp: 2799 });
  });

  const route = [
    "#name A\n#group G\n#next B\nstep\n    .accept 783\n    .accept 62\nstep\n    .turnin 783\n    .accept 33\n    .accept 830\n" +
      "step\n    .complete 33,1\n    -- @sim kils=3\n",
    "#name B\n#group G\n-- @sim level=5\nstep\n    .accept 18\n",
  ];

  it("describes each guide's simulated start and end level, and when the next guide starts above it", () => {
    mount(route, "A", {}, forever.entities);
    const a = screen.getByRole("button", {
      name: /^A,/,
      description: "3 of 3 steps · Level 1 to 2 (64%) · B starts higher, at 5",
    });
    const b = screen.getByRole("button", {
      name: "B, guide 2 of 2",
      description: "1 of 1 steps · Level 5 to 5",
    });
    expect(guideCards()).toEqual([a, b]);
  });

  it("starts a guide that another leads to at the start level", async () => {
    const { user } = mount(route, "B", {}, forever.entities);
    const start = await startPanel(user);
    const selected = (label: string) => within(start).getByLabelText<HTMLSelectElement>(label).selectedOptions[0]!.textContent;
    expect([selected("Start from"), selected("Start level")]).toEqual(["This guide (B)", "Auto (1)"]);
    expect(routeNames()).toEqual(["B"]);
  });

  it("builds the route from the open guide when the start's route goes another way", async () => {
    const guides = [
      "#name 1-2 A\n#group G\n#next 1-3 B;C\n-- @sim level=5\nstep\n",
      "#name 1-3 B\n#group G\n#maxlevel 3\nstep\n",
      "#name C\n#group G\nstep\n",
    ];
    const { user } = mount(guides, "1-3 B", { start: "g0" }, forever.entities);
    screen.getByRole("button", { name: /^1-3 B,/, description: "1 of 1 steps · Level 1 to 1" });
    expect(routeNames()).toEqual(["1-3 B"]);
    expect((await startFrom(user)).selectedOptions[0]!.textContent).toBe("This guide (1-3 B)");
  });

  const ranged = "#name 12-14 Loch Modan\n#group G\nstep\n    .accept 7\n";

  it("starts Auto at the low end of the start guide's range", async () => {
    const { user } = mount([ranged], "12-14 Loch Modan", {}, forever.entities);
    const start = await startPanel(user);
    expect(within(start).getByLabelText<HTMLSelectElement>("Start level").selectedOptions[0]!.textContent).toBe("Auto (12)");
    const xp = within(start).getByLabelText<HTMLInputElement>("Start XP");
    expect([xp.disabled, xp.value]).toEqual([true, "0"]);
  });

  it("ignores Start XP for Auto", async () => {
    const { user } = mount([ranged], "12-14 Loch Modan", {}, forever.entities);
    const panel = await startPanel(user);
    const level = within(panel).getByLabelText<HTMLSelectElement>("Start level");
    const xp = within(panel).getByLabelText<HTMLInputElement>("Start XP");
    const start = () => [level.selectedOptions[0]!.textContent, xp.value, xp.disabled];
    await user.selectOptions(level, "5");
    await user.clear(xp);
    await user.type(xp, "100");
    expect(start()).toEqual(["5", "100", false]);
    await user.selectOptions(level, "auto");
    expect(start()).toEqual(["Auto (12)", "0", true]);
    await user.selectOptions(level, "5");
    expect(start()).toEqual(["5", "0", false]);
  });
});

describe("route", () => {
  it("shows one card per guide with its shown and total steps, and keeps the route when one opens", async () => {
    const { user, stores } = mount(
      ["#name A\n#group G\n#next B\nstep\n    .accept 1\nstep << Mage\n    .accept 2\n", "#name B\n#group G\nstep\n    .accept 3\n"],
      "A",
    );
    const a = screen.getByRole("button", {
      name: "A, guide 1 of 2, open guide",
      current: "page",
      description: "1 of 2 steps · Level 1 to 1",
    });
    const b = screen.getByRole("button", {
      name: "B, guide 2 of 2",
      current: false,
      description: "1 of 1 steps · Level 1 to 1",
    });
    expect(guideCards()).toEqual([a, b]);

    await user.click(b);
    expect(openName(stores)).toBe("B");
    expect(routeNames()).toEqual(["A", "B"]);
    expect(screen.getByRole("button", { name: "B, guide 2 of 2, open guide", current: "page" })).toBe(guideCards()[1]);
    expect((await startFrom(user)).selectedOptions[0]!.textContent).toBe("A (1 guide earlier)");
  });

  const chain = [
    "#name A\n#group G\n#next B\nstep\n",
    "#name B\n#group G\n#next C\nstep\n",
    "#name C\n#group G\nstep\n",
    "#name D\n#group G\nstep\n",
  ];

  it("opens the guide of a card whose place on the route differs from its place in the library", async () => {
    const texts = [
      "#group G\n#name Start\n#next Copy\nstep",
      "#group G\n#name Copy\n#next Old end\nstep",
      "#group G\n#name Copy\n#next New end\nstep",
      "#group G\n#name Old end\nstep",
      "#group G\n#name New end\nstep",
    ];
    const { user, stores } = mount(texts, "Start");
    expect(routeNames()).toEqual(["Start", "Copy", "New end"]);
    await user.click(screen.getByRole("button", { name: "Copy, guide 2 of 3" }));
    expect(stores.editor.getState().current!.record.id).toBe("g2");
  });

  it("offers the guides that lead to the open guide, nearest first", async () => {
    const { user } = mount(chain, "C");
    const select = await startFrom(user);
    expect([...select.options].map((o) => o.textContent)).toEqual(["This guide (C)", "B (1 guide earlier)", "A (2 guides earlier)"]);
    expect(select.querySelector("optgroup")).toBeNull();
    expect(routeNames()).toEqual(["C"]);
  });

  it("groups the earlier guides meant for the preview character first, by #defaultfor", async () => {
    const { user } = mount(
      [
        "#name A\n#group G\n#defaultfor Gnome/Dwarf\n#next E\nstep\n",
        "#name B\n#group G\n#defaultfor Human\n#next E\nstep\n",
        "#name C\n#group G\n#next B\nstep\n",
        "#name D\n#group G\n#defaultfor Skyborne\n#next A\nstep\n",
        "#name E\n#group G\nstep\n",
      ],
      "E",
    );
    const select = await startFrom(user);
    const groups = [...select.querySelectorAll("optgroup")].map((g) => [g.label, ...[...g.children].map((o) => o.textContent)]);
    expect(groups).toEqual([
      ["Default for Human Warrior", "B (1 guide earlier)", "C (2 guides earlier)"],
      ["For other characters", "A (1 guide earlier)", "D (2 guides earlier)"],
    ]);
    expect(select.options[0]!.parentElement).toBe(select);
    await user.selectOptions(select, "D (2 guides earlier)");
    expect(routeNames()).toEqual(["D", "A", "E"]);
  });

  it("starts at a chosen earlier guide and keeps the open guide on the route", async () => {
    const { user } = mount(chain, "C");
    await user.selectOptions(await startFrom(user), "A (2 guides earlier)");
    expect(guideCards().map((card) => [card.getAttribute("aria-label"), card.getAttribute("aria-current")])).toEqual([
      ["A, guide 1 of 3", null],
      ["B, guide 2 of 3", null],
      ["C, guide 3 of 3, open guide", "page"],
    ]);
  });

  it("starts at the open guide when the saved start does not lead to it", async () => {
    const { user } = mount(chain, "C", { start: "g3" });
    expect(routeNames()).toEqual(["C"]);
    expect((await startFrom(user)).selectedOptions[0]!.textContent).toBe("This guide (C)");
    expect(within(await startPanel(user)).queryByText(/does not reach/)).toBeNull();
  });

  it("offers an earlier guide by its #next at the open guide's start level, and starts the route from it at its own level", async () => {
    const { user } = mount(
      ["#name A\n#group G\n#next B;5-6 C\nstep\n", "#name B\n#group G\n#maxlevel 3\nstep\n", "#name 5-6 C\n#group G\nstep\n"],
      "5-6 C",
      { start: "g0" },
    );
    expect([...(await startFrom(user)).options].map((o) => o.textContent)).toEqual(["This guide (5-6 C)", "A (1 guide earlier)"]);
    expect([routeNames(), within(await startPanel(user)).getByText(/does not reach/).textContent]).toEqual([
      ["5-6 C"],
      "The route from A does not reach 5-6 C, so the route starts at 5-6 C.",
    ]);
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

  it("warns when a fixed level is below the start guide's range, and offers Auto and an earlier guide", async () => {
    const { user } = mount(ranged(), "12-14 C", { startLevel: { level: 1, xp: 0 } });
    expect(startCard()).toEqual(["12-14 C, guide 1 of 1, open guide", "Start settings, with a warning"]);
    expect(await warning(user)).toEqual(["Level 1 is below this guide's range, 12 to 14.", ["Use Auto (level 12)", "Start from 1-6 A"]]);
    await user.selectOptions(await startFrom(user), "6-11 B (1 guide earlier)");
    expect(await warning(user)).toEqual(["Level 1 is below the range of 6-11 B, 6 to 11.", ["Use Auto (level 6)", "Start from 1-6 A"]]);
    await user.click(within(await startPanel(user)).getByRole("button", { name: "Start from 1-6 A" }));
    expect([routeNames(), await warning(user)]).toEqual([["1-6 A", "6-11 B", "12-14 C"], null]);
    await user.selectOptions(await startFrom(user), "This guide (12-14 C)");
    await user.click(within(await startPanel(user)).getByRole("button", { name: "Use Auto (level 12)" }));
    expect([(await startLevel(user)).selectedOptions[0]!.textContent, await warning(user)]).toEqual(["Auto (12)", null]);
    expect(startCard()).toEqual(["12-14 C, guide 1 of 1, open guide", "Start settings"]);
  });

  it.each([
    ["Use Auto (level 12)", "Start level"],
    ["Start from 1-6 A", "Start from"],
  ])("keeps Escape working after %s removes the level warning", async (action, field) => {
    const { user } = mount(ranged(), "12-14 C");
    const panel = await startPanel(user);
    await user.selectOptions(within(panel).getByLabelText("Start level"), "1");
    await user.click(within(panel).getByRole("button", { name: action }));
    expect(document.activeElement).toBe(within(panel).getByLabelText(field));
    await user.keyboard("{Escape}");
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start settings" }));
  });

  it("drops a Start XP draft when Use Auto changes the start level", async () => {
    const { user } = mount(ranged(), "12-14 C", { startLevel: { level: 1, xp: 0 } });
    const panel = await startPanel(user);
    const xp = within(panel).getByLabelText<HTMLInputElement>("Start XP");
    const shown = async () => [
      (await startLevel(user)).selectedOptions[0]!.textContent,
      xp.value,
      xp.disabled,
      within(panel).queryByRole("alert")?.textContent,
    ];
    await user.clear(xp);
    await user.type(xp, "5000");
    expect(await shown()).toEqual(["1", "5000", false, "Enter a whole number from 0 to 399."]);
    await user.click(within(panel).getByRole("button", { name: "Use Auto (level 12)" }));
    expect(await shown()).toEqual(["Auto (12)", "0", true, undefined]);
  });
});

describe("route card looks", () => {
  const route = ["#name A\n#group G\n#next B\nstep\n    .accept 1\n", "#name B\n#group G\n#xprate >1.49\nstep\n    .accept 2\n"];
  const looks = (card: Element, states: State[]) =>
    ["background", "border-color"].map((property) => cascade(card, property, { states })?.value);

  it("shows an inactive card's status on its border, under the shared hover and press fills", () => {
    mount(route, "A");
    const card = guideCards()[1]!;
    expect([
      card.classList.contains("inactive"),
      ...([[], ["hover"], ["active"]] satisfies State[][]).map((states) => looks(card, states)),
    ]).toEqual([true, ["var(--chain-card)", "var(--warn)"], ["var(--hover)", "var(--warn)"], ["var(--press)", "var(--warn)"]]);
  });

  it("edges the current card, and a plain card only on hover, in the arrows' ink", () => {
    mount(["#name A\n#group G\n#next B\nstep\n    .accept 1\n", "#name B\n#group G\nstep\n    .accept 2\n"], "A");
    const current = guideCards()[0]!.closest(".chain-card")!;
    const plain = guideCards()[1]!;
    expect([looks(current, []), looks(plain, []), looks(plain, ["hover"])]).toEqual([
      ["var(--selection)", "1px solid var(--chain-edge)"],
      ["var(--chain-card)", "transparent"],
      ["var(--hover)", "var(--chain-link-ink)"],
    ]);
  });

  it("keeps a hidden start card's status border under the current look", () => {
    // RXP never runs an #internal guide (`IsGuideActive` in GuideWindow.lua), so only a route's start guide can be hidden.
    mount(["#name C\n#group G\n#internal 1\nstep\n    .accept 3\n"], "C");
    const start = guideCards()[0]!.closest(".chain-card")!;
    expect([start.classList.contains("hidden"), looks(start, [])]).toEqual([true, ["var(--selection)", "var(--danger)"]]);
  });

  it("keeps a hidden start card's danger border when its fixed start level also warns", () => {
    mount(["#name 12-14 C\n#group G\n#internal 1\nstep\n    .accept 3\n"], "12-14 C", { startLevel: { level: 1, xp: 0 } });
    const start = guideCards()[0]!.closest(".chain-card")!;
    expect([
      ["flagged", "hidden"].map((status) => start.classList.contains(status)),
      cascade(start, "border-color")?.value,
      cascade(start, "box-shadow")?.value,
    ]).toEqual([[true, true], "var(--danger)", "var(--ink-bar-start), var(--ring-warn)"]);
  });

  it("fits Start settings and the start guide in the 24px control height, inside the card's 1px frame", () => {
    mount(route, "A");
    const start = guideCards()[0]!.closest(".chain-card")!;
    expect([start, guideCards()[1]].map((card) => cascade(card!, "height")?.value)).toEqual(
      Array(2).fill("calc(var(--control-small) + 2px)"),
    );
    expect(cascade(startSettings(), "height")?.value).toBe("var(--control-small)");
  });
});

describe("route strip", () => {
  const long = Array.from(
    { length: 13 },
    (_, i) => `#name ${i + 1}-${i + 2} Zone ${i + 1}\n#group Long\n${i < 12 ? `#next ${i + 2}-${i + 3} Zone ${i + 2}\n` : ""}step\n`,
  );
  const toolbar = () => screen.getByRole("toolbar", { name: "Guides on the route" });
  const page = () => within(toolbar()).getByRole("status").textContent;
  const focused = () => document.activeElement!.getAttribute("aria-label");

  function trackWidth(width: number) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          if (!target.classList.contains("chain-track")) return;
          Object.defineProperty(target, "clientWidth", { value: Math.round(width) });
          Object.defineProperty(target, "getBoundingClientRect", { value: () => new DOMRect(0, 0, width, 52) });
          this.callback([], this);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
  }

  it("shows the group, and a linked card per guide with its level range and zone", () => {
    mount(long.slice(9), "11-12 Zone 11", { start: "g0" });
    within(routeBar()).getByText("Long");
    expect([...toolbar().querySelectorAll(".chain-card-name")].map((name) => [...name.children].map((part) => part.textContent))).toEqual([
      ["10-11", "Zone 10"],
      ["11-12", "Zone 11"],
      ["12-13", "Zone 12"],
      ["13-14", "Zone 13"],
    ]);
    expect([...toolbar().querySelectorAll(".chain-link")].map((link) => link.className)).toEqual([
      "chain-link",
      "chain-link",
      "chain-link",
    ]);
    expect(guideCards().map((card) => card.getAttribute("aria-current"))).toEqual([null, "page", null, null]);
    expect(within(toolbar()).queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("opens the start guide from the Start card's left part, and the start settings from its right part", async () => {
    const { user, stores } = mount(long.slice(9), "11-12 Zone 11", { start: "g0" });
    const panel = await startPanel(user);
    expect(within(panel).getByText("Start guide").parentElement!.textContent).toBe("Start guide 10-11 Zone 10");
    expect(
      [within(panel).getByRole("combobox", { name: "Start from" }), within(panel).getByRole("combobox", { name: "Start level" })].map(
        (select) => (select as HTMLSelectElement).selectedOptions[0]!.textContent,
      ),
    ).toEqual(["10-11 Zone 10 (1 guide earlier)", "Auto (10)"]);
    within(panel).getByRole("spinbutton", { name: "Start XP" });
    expect(within(panel).queryAllByRole("button")).toEqual([]);
    await user.keyboard("{Escape}");
    expect([startSettings().getAttribute("aria-expanded"), document.activeElement]).toEqual(["false", startSettings()]);

    await user.click(guideCards()[0]!);
    expect(openName(stores)).toBe("10-11 Zone 10");
    expect([
      startCard(),
      guideCards().map((card) => card.getAttribute("aria-current")),
      startSettings().getAttribute("aria-expanded"),
    ]).toEqual([["10-11 Zone 10, guide 1 of 4, open guide", "Start settings"], ["page", null, null, null], "false"]);
  });

  it("keeps a saved start that does not apply when the open guide's Start card part is clicked", async () => {
    const { user } = mount(long, "7-8 Zone 7", { start: "g12" });
    expect(routeNames()).toEqual([
      "7-8 Zone 7",
      "8-9 Zone 8",
      "9-10 Zone 9",
      "10-11 Zone 10",
      "11-12 Zone 11",
      "12-13 Zone 12",
      "13-14 Zone 13",
    ]);
    await user.click(guideCards()[0]!);
    expect(guideCards()[0]!.getAttribute("aria-current")).toBe("page");
    await user.selectOptions(within(await startPanel(user)).getByLabelText("Start level"), "7");
    await vi.waitFor(async () => expect(await loadSetting("preview")).toMatchObject({ startLevel: { level: 7, xp: 0 } }));
    expect(await loadSetting("preview")).toMatchObject({ start: "g12" });
  });

  it("pages with the pager buttons, keeping one guide of the old page and the start and open guides", async () => {
    trackWidth(1500);
    const { user } = mount(long, "7-8 Zone 7", { start: "g0" });
    expect(routeNames()).toEqual(["1-2 Zone 1", "6-7 Zone 6", "7-8 Zone 7", "8-9 Zone 8", "9-10 Zone 9", "10-11 Zone 10"]);
    expect(within(toolbar()).getByRole("button", { name: "Show 4 earlier guides" }).textContent).toBe("4 earlier");
    expect(
      within(toolbar())
        .getAllByRole("button")
        .slice(0, 4)
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["1-2 Zone 1, guide 1 of 13", "Start settings", "Show 4 earlier guides", "6-7 Zone 6, guide 6 of 13"]);

    await user.click(within(toolbar()).getByRole("button", { name: "Show 3 later guides" }));
    expect([routeNames(), page()]).toEqual([
      ["1-2 Zone 1", "7-8 Zone 7", "9-10 Zone 9", "10-11 Zone 10", "11-12 Zone 11", "12-13 Zone 12", "13-14 Zone 13"],
      "Guides 9 to 13 of 13",
    ]);
    expect(within(toolbar()).queryByRole("button", { name: /later/ })).toBeNull();
    expect([...toolbar().querySelectorAll(".chain-link")].map((link) => link.className)).toEqual([
      "chain-link gap",
      "chain-link gap",
      "chain-link gap",
      "chain-link",
      "chain-link",
      "chain-link",
      "chain-link",
    ]);

    await user.click(within(toolbar()).getByRole("button", { name: "Show 6 earlier guides" }));
    expect(page()).toBe("Guides 5 to 9 of 13");

    await user.click(within(toolbar()).getByRole("button", { name: "Show 3 earlier guides" }));
    expect([page(), within(toolbar()).getByRole("button", { name: "Show 6 later guides" }).textContent]).toEqual([
      "Guides 1 to 7 of 13",
      "6 later",
    ]);
    expect(within(toolbar()).queryByRole("button", { name: /earlier/ })).toBeNull();
  });

  it("narrows the cards so that the start, the open guide, one more, and both pagers fit the track", async () => {
    trackWidth(871.86);
    const { user } = mount(long, "7-8 Zone 7", { start: "g0" });
    const track = toolbar().parentElement!;
    const px = (name: string) => parseFloat(track.style.getPropertyValue(name));
    const rowWidth = () => {
      const slots = guideCards().length + within(toolbar()).queryAllByRole("button", { name: /^Show / }).length;
      return [slots, px("--strip-start") + (slots - 1) * (px("--strip-link") + px("--strip-card"))] as const;
    };
    const [slots, width] = rowWidth();
    expect([slots, width <= 871.86]).toEqual([5, true]);
    await user.click(within(toolbar()).getByRole("button", { name: /later guides$/ }));
    expect(rowWidth()).toEqual([slots, width]);
  });

  it("opens the page around the open guide again when the start changes", async () => {
    trackWidth(1500);
    const { user } = mount(long, "7-8 Zone 7", { start: "g0" });
    await user.click(within(toolbar()).getByRole("button", { name: "Show 3 later guides" }));
    await user.selectOptions(within(await startPanel(user)).getByRole("combobox", { name: "Start from" }), "3-4 Zone 3 (4 guides earlier)");
    expect(routeNames()).toEqual(["3-4 Zone 3", "6-7 Zone 6", "7-8 Zone 7", "8-9 Zone 8", "9-10 Zone 9", "10-11 Zone 10"]);
  });

  it("moves focus one guide at a time from its one Tab stop, pages the strip, and opens the focused guide", async () => {
    trackWidth(1500);
    const { user, stores } = mount(long, "7-8 Zone 7", { start: "g0" });
    const tabStops = () => guideCards().filter((card) => card.tabIndex === 0);
    expect(tabStops().map((card) => card.getAttribute("aria-label"))).toEqual(["7-8 Zone 7, guide 7 of 13, open guide"]);
    expect(
      within(toolbar())
        .getAllByRole("button")
        .filter((button) => button.tabIndex === 0)
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Start settings", "7-8 Zone 7, guide 7 of 13, open guide"]);
    act(() => tabStops()[0]!.focus());

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect([focused(), page()]).toEqual(["10-11 Zone 10, guide 10 of 13", ""]);
    await user.keyboard("{ArrowRight}");
    expect([focused(), page()]).toEqual(["11-12 Zone 11, guide 11 of 13", "Guides 9 to 13 of 13"]);
    expect(tabStops()).toEqual([document.activeElement]);
    await user.keyboard("{Home}");
    expect(focused()).toBe("1-2 Zone 1, guide 1 of 13");
    await user.tab();
    expect([focused(), startSettings().getAttribute("aria-expanded")]).toEqual(["Start settings", "false"]);
    await user.keyboard("{Enter}");
    expect(startSettings().getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await user.tab({ shift: true });
    expect(focused()).toBe("1-2 Zone 1, guide 1 of 13");
    await user.keyboard("{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect([focused(), page()]).toEqual(["8-9 Zone 8, guide 8 of 13", "Guides 5 to 9 of 13"]);

    await user.keyboard("{Enter}");
    expect(openName(stores)).toBe("8-9 Zone 8");
    expect(focused()).toBe("8-9 Zone 8, guide 8 of 13, open guide");
  });

  describe("sea crossings", () => {
    const chain = (...steps: string[]) =>
      steps.map((body, i) => `#name ${i + 1}-${i + 2} Zone ${i + 1}\n#group Sea\n#next ${i + 2}-${i + 3} Zone ${i + 2}\n${body}`);
    const goto = (zone: string) => `step\n    .goto ${zone},40,50\n`;
    const joins = () =>
      [...toolbar().querySelectorAll(".chain-cards > li")].slice(1).map((li) => {
        const join = li.firstElementChild!;
        return join.getAttribute("aria-label") ?? join.className;
      });

    it("joins two guides on different continents by a boat that names the continent it crosses to", () => {
      mount(
        chain(
          goto("Elwynn Forest"),
          goto("Westfall"),
          `step << Horde\n    .goto Elwynn Forest,40,50\nstep\n    .goto Westfall,40,50 << Horde\n    .goto Durotar,40,50\n`,
          goto("The Barrens"),
        ),
        "1-2 Zone 1",
      );
      expect(joins()).toEqual(["chain-link", "Sea crossing to Kalimdor", "chain-link"]);
    });

    it("joins guides on one continent by plain links", () => {
      mount(chain(goto("Elwynn Forest"), goto("Westfall"), goto("Duskwood")), "1-2 Zone 1");
      expect(joins()).toEqual(["chain-link", "chain-link"]);
    });

    it("keeps the links plain around a guide with no map point", () => {
      mount(chain(goto("Elwynn Forest"), "step\n    .accept 7\n", goto("Durotar"), goto("Westfall")), "1-2 Zone 1");
      expect(joins()).toEqual(["chain-link", "chain-link", "Sea crossing to Eastern Kingdoms"]);
    });
  });
});
