// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { EntityIndex, type GameData } from "../data/index.ts";
import { plannerData, plannerNames } from "../data/plannerFixture.ts";
import { textureKey, type GuideIcon } from "../../packages/data-contract/guideIcons.ts";
import { guideIconCatalog } from "../data/guideIcons.ts";
import { EntityContext, GameDataContext, GuideIconsContext, StoresContext } from "./context.ts";
import { RouteStrip } from "./preview/RouteStrip.tsx";
import { DEFAULT_SETTINGS, type PreviewSettings } from "./preview/settings.ts";
import { unrelatedEntities } from "./renderPlanner.tsx";
import { StepList } from "./StepList.tsx";
import { createStores, DEFAULT_SAVED_SETTINGS } from "./stores.ts";
import { cascade } from "./ui/testing.ts";

afterEach(() => cleanup());

const data = {
  quest: (id: number) =>
    id === 33 ? { name: "Wolves Across The Border", preQuestSingle: [], preQuestGroup: [], types: [], objectives: [] } : undefined,
  npcName: (id: number) => (id === 196 ? "Eagan Peltskinner" : undefined),
  locateGoto: ([, x, y]: string[]) => ({ ok: true, uiMapId: 1429, x: Number(x), y: Number(y) }),
  mapName: (uiMapId: number) => (uiMapId === 1429 ? "Elwynn Forest" : `Map ${uiMapId}`),
} as unknown as GameData;

const text = `#group G
#name Sample
step << Warrior
    #sticky
    .goto Elwynn Forest,49.1,38.3
    .goto Elwynn Forest,47.6,36.7
    .waypoint Elwynn Forest,50,40
    .waypoint Elwynn Forest,51,41
    .waypoint Elwynn Forest,52,42 << Mage
    .accept 33
    .complete 33,1
    .target 196
    .mob Young Wolf;Timber Wolf
    .destroy 6948
    >> Kill Young Wolves
step << Mage
    #optional
    .goto Elwynn Forest,40,50
    .accept 7
    >> Mage note
step
    .accept 999
step
    .waypoint Elwynn Forest,53,43 << Mage
    .accept 33
`;

function mount(guide = text, icons = guideIconCatalog(undefined)) {
  const stores = createStores({ guides: [{ id: "g", text: guide, order: 0 }], session: { guideId: "g", step: 0, line: null } });
  render(
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={data}>
        <GuideIconsContext.Provider value={{ catalog: icons, sheet: undefined }}>
          <StepList />
        </GuideIconsContext.Provider>
      </GameDataContext.Provider>
    </StoresContext.Provider>,
  );
  return { user: userEvent.setup(), settings: stores.preview, store: stores.editor, layout: stores.layout };
}

const description = (el: Element) => document.getElementById(el.getAttribute("aria-describedby")!)!.textContent;
const lines = (row: Element, part: string) =>
  [...row.querySelectorAll(`.${part} .row-line`)].map((line) => [line.querySelector(".mk")!.className, line.textContent]);
const footer = (row: Element) => [...row.querySelectorAll(".foot-item")].map((item) => [item.className, item.textContent]);

function icon(fileDataId: number, raw: string): GuideIcon {
  const path = textureKey(raw);
  if (path === undefined) throw new Error(`The icon fixture path is not a texture key: ${raw}`);
  return { fileDataId, path };
}

describe("step row", () => {
  it("shows what to do, where, the notes, and who and when, each line after its mark", () => {
    mount();
    const row = document.getElementById("step-0")!;
    expect(lines(row, "step-does")).toEqual([
      ["mk mk-accept tex", "Accept Wolves Across The Border"],
      ["mk mk-complete", "Wolves Across The Border · Objective 1"],
      ["mk mk-destroy tex", "Destroy Item #6948"],
    ]);
    const where = [...row.querySelectorAll(".where-part")].map((p) => {
      const mark = p.querySelector(".where-mark")!.firstElementChild!;
      return [mark.getAttribute("class") ?? mark.tagName, p.textContent];
    });
    expect(where).toEqual([
      ["mk mk-goto tex", "Go to Elwynn Forest 49.1, 38.3 →\u00a047.6, 36.7"],
      ["svg", "2 waypoints"],
      ["mk mk-target", "Target Eagan Peltskinner"],
      ["mk mk-kill tex", "Mobs Young Wolf, Timber Wolf"],
    ]);
    expect(lines(row, "step-notes")).toEqual([["mk mk-note", "Kill Young Wolves"]]);

    expect(footer(row)).toEqual([
      ["foot-item foot-condition", "Warrior only"],
      ["foot-item foot-tag", ", ·Sticky"],
    ]);
    expect(description(row.querySelector(".foot-tag")!)).toBe("Stays on screen until done");
  });

  it("draws a step's first action line at medium weight and the later ones at the regular weight", () => {
    mount();
    const texts = [...document.getElementById("step-0")!.querySelectorAll(".step-does .row-text")];
    expect(texts.map((t) => cascade(t, "font-weight")?.value)).toEqual(["var(--font-weight-medium)", undefined, undefined]);
  });

  it("binds each arrow of a coordinate chain to the point after it, so a wrap starts the line with the arrow", () => {
    mount();
    expect(document.querySelector("#step-0 .where-part")!.textContent).toBe("Go to Elwynn Forest 49.1, 38.3 →\u00a047.6, 36.7");
  });

  it("draws a mark's vector icon, else its guide icon when the icon sheet holds it, else its shape", () => {
    const icons = guideIconCatalog({
      version: 1,
      image: "guide-icons/icons.png",
      columns: 1,
      icons: [
        icon(132049, "interface/gossipframe/availablequesticon"),
        icon(134414, "interface/icons/inv_misc_rune_01"),
        { ...icon(136441, "interface/minimap/poiicons"), crop: { width: 128, height: 128, left: 72, right: 81, top: 0, bottom: 4 } },
      ],
    });
    mount("#group G\n#name Icons\nstep\n    .accept 33\n    .equip 16,6948\n    .hs >>Hearth to Goldshire\n    .deathskip\n", icons);
    const marks = [...document.querySelectorAll("#step-0 .mk")].map((mark) => {
      const shown = mark.querySelector<HTMLElement>(":scope > .guide-icon");
      if (!shown) return [mark.className, mark.firstElementChild!.tagName];
      return [mark.className, shown.className, shown.style.getPropertyValue("--icon-url") || shown.style.getPropertyValue("--cell-y")];
    });
    expect(marks).toEqual([
      ["mk mk-accept tex", "guide-icon vector vivid", 'url("/src/app/guideIcons/accept.svg?no-inline")'],
      ["mk mk-equip", "svg"],
      ["mk mk-hs item", "guide-icon framed", "-1.09375"],
      ["mk mk-deathskip tex", "guide-icon vector deep", 'url("/src/app/guideIcons/deathskip.svg?no-inline")'],
    ]);
  });

  it("puts settings last in who and when, and marks a footer of only settings", () => {
    mount("#group G\n#name Settings\nstep << Warrior\n    .disablecheckbox\n    #sticky\nstep\n    .disablecheckbox\n");
    expect(footer(document.getElementById("step-0")!)).toEqual([
      ["foot-item foot-condition", "Warrior only"],
      ["foot-item foot-tag", ", ·Sticky"],
      ["foot-item foot-setting", ", ·Hide checkbox"],
    ]);
    expect(document.querySelector("#step-1 .step-footer")!.className).toBe("step-footer only-settings");
  });

  it("shows notes and actions with their icons", () => {
    mount(`#group G
#name Markup
step
    .vendor >>|cRXP_BUY_Purchase|r |T132815:0|t|cRXP_LOOT_Ice Cold Milk|r
    >>Kill |cRXP_ENEMY_Boars|r for |T133970:0|t|cRXP_LOOT_[Boar Meat]|r and |T134414:0|t
step
    >>|T134414:20|t
`);
    const row = document.getElementById("step-0")!;
    const icons = (el: Element) =>
      within(el as HTMLElement)
        .getAllByRole("img")
        .map((img) => img.getAttribute("aria-label"));
    expect(row.querySelector(".step-does .row-text")!.textContent).toBe("Purchase Ice Cold Milk");
    expect(icons(row.querySelector(".step-does")!)).toEqual(["Icon 132815"]);
    expect(row.querySelector(".step-notes .row-text")!.textContent).toBe("Kill Boars for [Boar Meat] and ");
    expect(icons(row.querySelector(".step-notes")!)).toEqual(["Icon 133970", "Icon 134414"]);
    const iconOnly = document.getElementById("step-1")!.querySelector(".step-notes .row-line")!;
    expect(icons(iconOnly.querySelector(".mk")!)).toEqual(["Icon 134414"]);
    expect(iconOnly.textContent).toBe("");
  });

  it("shows a step's route warnings in a badge with no count, each warning in its description", () => {
    mount("#group G\n#name Warned\nstep\n.accept 33\nstep\n.accept 999\n.accept 998\nstep\n.accept 997\n");
    const badge = (step: number) => document.querySelector(`#step-${step} .step-warn-badge`);
    expect(badge(0)).toBeNull();
    expect(badge(1)!.textContent).toBe("");
    expect(description(badge(1)!)).toBe("Line 1: Quest 999 is not in the quest data\nLine 2: Quest 998 is not in the quest data");
    expect(badge(2)!.textContent).toBe("");
    expect(description(badge(2)!)).toBe("Line 1: Quest 997 is not in the quest data");
    const name =
      "2Accept Quest #999Accept Quest #998· 2 warnings: Line 1: Quest 999 is not in the quest data; Line 2: Quest 998 is not in the quest data";
    expect(screen.getByRole("option", { name }).id).toBe("step-1");
  });

  it("pins a badge's description on a click without selecting its step", async () => {
    const { user, store } = mount();
    const badge = document.querySelector("#step-2 .step-warn-badge")!;
    const tip = document.getElementById(badge.getAttribute("aria-describedby")!)!;
    await user.click(badge);
    await user.unhover(badge);
    expect(tip.hidden).toBe(false);
    expect(store.getState().selection.step).toBe(0);
    await user.click(badge);
    expect(tip.hidden).toBe(true);
    expect(store.getState().selection.step).toBe(0);
  });

  it("names partial quests and reports their unverified prerequisites", () => {
    const partial = { ...data.quest(33)!, preQuestSingle: null, preQuestGroup: null };
    const lookup = vi.spyOn(data, "quest").mockReturnValue(partial);
    try {
      mount("#group G\n#name Partial\nstep\n.accept 33\n");
      expect(description(document.querySelector("#step-0 .step-warn-badge")!)).toBe(
        "Line 1: Wolves Across The Border (33) has unverified prerequisite data",
      );
    } finally {
      lookup.mockRestore();
    }
  });

  it("collapses a skipped step to its reason until Show skipped is on", async () => {
    const { user, settings } = mount();
    const row = document.getElementById("step-1")!;
    const skip = row.querySelector(".step-skip")!;
    expect(row.querySelector(".step-main")!.textContent).toBe("Skipped · Only for Mage");
    expect(skip.hasAttribute("aria-describedby")).toBe(false);

    const header = screen.getByRole("region", { name: "Steps" });
    expect(within(header).getByRole("heading").textContent).toBe("Steps 3 of 4");
    expect([...within(header).getByRole("heading").querySelectorAll(".ui-mono")].map((e) => e.textContent)).toEqual(["3", "4"]);
    const eye = within(header).getByRole("button", { name: "Show skipped steps" });
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    await user.click(eye);
    expect(settings.getState().showAll).toBe(true);
    expect(eye.getAttribute("aria-pressed")).toBe("true");

    expect(row.querySelector(".step-skip")).toBeNull();
    expect(row.classList).toContain("step-skipped");
    expect(lines(row, "step-does")).toEqual([["mk mk-accept tex", "Accept Quest #7"]]);
    expect(row.querySelector(".where-part")!.textContent).toBe("Go to Elwynn Forest 40.0, 50.0");
    expect(row.querySelector(".where-part .ui-mono")!.textContent).toBe("40.0, 50.0");
    expect(lines(row, "step-notes")).toEqual([["mk mk-note", "Mage note"]]);
    expect(footer(row)).toEqual([
      ["foot-item foot-condition", "Mage only"],
      ["foot-item foot-tag", ", ·Optional"],
    ]);
    expect(description(row.querySelector(".step-no")!)).toBe("Skipped: Only for Mage");
    expect(row.textContent).toContain("Skipped: Only for Mage");
    await user.click(eye);
    expect(settings.getState().showAll).toBe(false);
    expect(row.querySelector(".step-does")).toBeNull();
  });

  it("counts skipped waypoints apart, with their reason, under Show skipped", async () => {
    const { user } = mount();
    const waypoints = (step: number) => document.querySelectorAll(`#step-${step} .where-part`)[step === 0 ? 1 : 0]!;
    expect(waypoints(0).textContent).toBe("2 waypoints");
    expect(document.querySelector("#step-3 .where-part")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show skipped steps" }));
    expect(waypoints(0).textContent).toBe("2 waypoints, 1 skipped (skipped: Only for Mage)");
    const skipped = waypoints(0).querySelector(".line-skipped")!;
    expect(description(skipped)).toBe("Skipped: Only for Mage");
    const only = waypoints(3).querySelector(".line-skipped")!;
    expect(only.textContent).toBe("1 waypoint (skipped: Only for Mage)");
    expect(description(only)).toBe("Skipped: Only for Mage");
  });

  it("deletes its step with its button, keeping the selected step", async () => {
    const { user, store } = mount("#group G\n#name Three\nstep\n.accept 1\nstep\n.accept 2\nstep\n.accept 3\n");
    const del = (step: number) => screen.getByLabelText(`Delete step ${step}`);
    const accepts = () => store.getState().current!.doc.steps.map((s) => s.body[0]!.raw);
    await user.click(document.getElementById("step-1")!);
    await user.click(del(1));
    expect(accepts()).toEqual([".accept 2", ".accept 3"]);
    expect(store.getState().selection.step).toBe(0);
    await user.click(del(1));
    expect(accepts()).toEqual([".accept 3"]);
    expect(store.getState().selection.step).toBe(0);
  });
});

describe("the list", () => {
  it("scrolls the selected step into view when Tab focuses the list, and not when a click does", async () => {
    const scrolled: string[] = [];
    // Chromium returns a promise from scrollIntoView.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
      return Promise.resolve() as unknown as void;
    };
    onTestFinished(() => void Reflect.deleteProperty(Element.prototype, "scrollIntoView"));
    const { user } = mount();
    await user.click(document.getElementById("step-1")!);
    expect(scrolled).toEqual(["step-0", "step-1"]);

    scrolled.length = 0;
    act(() => screen.getByRole("button", { name: "Move step down" }).focus());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("listbox"));
    expect(scrolled).toEqual(["step-1"]);
  });
});

describe("runs of skipped steps", () => {
  const runs = `#group G
#name Runs
step
    .accept 33
step << Mage
    .accept 33
step << Mage
    .accept 33
step << Hunter
    .accept 33
step
    .accept 33
`;
  const shownRows = () => [...document.querySelectorAll(".step-list [role=option]")].map((row) => row.id);

  it("fold into one row that the arrow keys pass as one step", async () => {
    const { user, store } = mount(runs);
    const fold = document.getElementById("step-1")!;
    expect(fold.textContent).toBe("Steps 2–4 skipped · Only for Mage; Only for Hunter · Right arrow shows each step");
    expect(shownRows()).toEqual(["step-header", "step-0", "step-1", "step-4"]);

    await user.click(document.getElementById("step-0")!);
    await user.keyboard("{ArrowDown}");
    expect(store.getState().selection.step).toBe(1);
    await user.keyboard("{ArrowDown}");
    expect(store.getState().selection.step).toBe(4);
    await user.keyboard("{ArrowUp}{ArrowRight}");
    expect(shownRows()).toEqual(["step-header", "step-0", "step-1", "step-2", "step-3", "step-4"]);
    expect(screen.getByRole("group").getAttribute("aria-labelledby")).toBe("run-1");

    await user.keyboard("{ArrowDown}{ArrowLeft}");
    expect(store.getState().selection.step).toBe(1);
    expect(shownRows()).toEqual(["step-header", "step-0", "step-1", "step-4"]);
  });

  it("open with their button, or when a step inside is selected", async () => {
    const error = vi.spyOn(console, "error");
    const { user, store } = mount(runs);
    const toggle = () => document.querySelector<HTMLElement>(".fold-toggle")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle());
    expect(shownRows()).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Steps 2–4" }));
    expect(shownRows()).toHaveLength(4);
    expect(store.getState().selection.step).toBe(0);

    act(() => store.select({ step: 3, line: null }));
    expect(shownRows()).toHaveLength(6);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("draw no open-trigger look on an open run's button, which shows the steps in place", async () => {
    const { user } = mount(runs);
    await user.click(document.querySelector<HTMLElement>(".fold-toggle")!);
    const toggle = screen.getByRole("button", { name: "Steps 2–4" });
    expect([toggle.getAttribute("aria-expanded"), cascade(toggle, "background")?.value, cascade(toggle, "box-shadow")?.value]).toEqual([
      "true",
      "none",
      undefined,
    ]);
  });

  it("show each step under Show skipped", async () => {
    const { user } = mount(runs);
    await user.click(screen.getByRole("button", { name: "Show skipped steps" }));
    expect(document.querySelector(".step-fold")).toBeNull();
    expect(shownRows()).toHaveLength(6);
  });
});

describe("Forever simulation", () => {
  const forever = { data: plannerData(), entities: new EntityIndex(plannerNames) };

  const guide = `#group G
#name Sim
step
    .accept 783
    .turnin 783
    .accept 7
    .accept 33
    .accept 5261
step
    .complete 7,1 -- @sim kills=10
step
    .complete 33,1,3
step
    .turnin 7
    .turnin 33
    .turnin 5261
step
    .xp 4
step
    -- @sim level=5
step
    .accept 3904
    .complete 3904,1
step << 9
    >> Later
`;

  function mountSim(text = guide) {
    const stores = createStores({ guides: [{ id: "g", text, order: 0 }], session: { guideId: "g", step: 0, line: null } }, null, {
      ...DEFAULT_SAVED_SETTINGS,
      preview: { ...DEFAULT_SETTINGS, showAll: true },
    });
    stores.layout.setAppWidth(1280);
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={forever.data}>
          <EntityContext.Provider value={forever.entities}>
            <StepList />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    return stores;
  }
  const row = (step: number) => document.getElementById(`step-${step}`)!;
  const ringText = (step: number) => [...row(step).querySelectorAll(".step-side > .sr-only")].map((e) => e.textContent);
  const ding = (step: number) => row(step).querySelector(".step-side .level-mark")?.textContent;

  it("rings each shown step's level and progress beside its first line, and opens each level with a band", () => {
    mountSim();
    const ring = (id: string) => document.getElementById(id)!.querySelector(".step-side .sr-only")?.textContent;
    expect(ring("step-0")).toBe(" · Level 1, 10%, 40/400 xp, 360 to level 2, +40 quest xp · ");
    expect(ring("step-4")).toBe(" · Level 4, 0%, 0/2,100 xp, 2,100 to level 5, +777 xp from a checkpoint · ");
    expect(ring("step-header")).toBeUndefined();
    expect(ring("step-7")).toBeUndefined();
    const bands = [...document.querySelectorAll(".level-band")].map((b) => [b.previousElementSibling!.id, b.textContent]);
    expect(bands).toEqual([
      ["step-header", "Level 1steps 1–2 · 400 xp"],
      ["step-1", "Level 2steps 2–4 · 900 xp"],
      ["step-3", "Level 3steps 4–5 · 1,400 xp"],
      ["step-4", "Level 4steps 5–6 · 2,100 xp"],
      ["step-5", "Level 50% · 0/2,800 xp"],
    ]);
    expect([...document.querySelectorAll(".level-band")[0]!.querySelectorAll(".ui-mono")].map((e) => e.textContent)).toEqual([
      "1",
      "1–2",
      "400",
    ]);
    expect(row(4).querySelector(".sim-ring.dinged .sim-jump")).not.toBeNull();
  });

  it("opens a second band for a level that a step's state= sets again", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mountSim(`#group G
#name Reset
step
    .xp 2
step
    .xp 3
step
    -- @sim state={"level": 2}
    >> Again
`);
    const bands = [...document.querySelectorAll(".level-band")].map((b) => b.textContent);
    expect(bands).toEqual(["Level 1step 1 · 400 xp", "Level 2steps 1–2 · 900 xp", "Level 30% · 0/1,400 xp", "Level 20% · 0/900 xp"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("shows the selected step's XP card while keys move through the list", async () => {
    mountSim();
    const user = userEvent.setup();
    const card = () => [...document.querySelectorAll(".tip:not([hidden]) .sim-cards > .sr-only")].map((t) => t.textContent);
    screen.getByRole("listbox").focus();
    await user.keyboard("{ArrowDown}");
    expect(card()).toEqual([
      [
        "Level 2: 16%",
        "XP: 147/900",
        "To level 3: 753 xp",
        "10 kills: +507 xp",
        "5 Kobold Vermin at Lv 1",
        "5 Kobold Vermin at Lv 2",
        "Count: from @sim kills=10",
        "Mob: the objective's mob",
        "XP: 4 × 50 + 4 × 52 + 1 × 44 + 1 × 55",
        "Level 2 at kill 8 of 10",
      ].join("\n"),
    ]);
    const mono = [...document.querySelectorAll(".tip:not([hidden]) .sim-card .ui-mono")].map((e) => e.textContent);
    expect(mono).toEqual(["16%", "147/900", "753", "+507"]);
    await user.click(row(0));
    expect(card()).toEqual([]);
  });

  it("marks each level up under its ring, which shows the level", () => {
    mountSim();
    expect([0, 1, 2, 3, 4, 5, 6].map(ding)).toEqual([
      undefined,
      "DING · reaches level 2",
      undefined,
      "DING · reaches level 3",
      "DING · reaches level 4",
      "DING · reaches level 5",
      undefined,
    ]);
    expect(row(3).querySelector(".sim-level")!.textContent).toBe("3");
  });

  it("shows a level= comment line as an Assume action", () => {
    mountSim();
    expect(lines(row(5), "step-does")).toEqual([["mk mk-checkpoint", "Assume level 5"]]);
  });

  it("reads each step's ring label and then its card's notes, a line's @sim comment in place of the source it names", () => {
    mountSim();
    expect(ringText(1)).toEqual([
      " · Level 2, 16%, 147/900 xp, 753 to level 3, +507 kill xp · ",
      [
        "10 kills: +507 xp",
        "5 Kobold Vermin at Lv 1",
        "5 Kobold Vermin at Lv 2",
        "Count: from @sim kills=10",
        "Mob: the objective's mob",
        "XP: 4 × 50 + 4 × 52 + 1 × 44 + 1 × 55",
        "Level 2 at kill 8 of 10 · ",
      ].join("\n"),
    ]);
    expect(ringText(5)[1]).toBe("Checkpoint: +2,100 xp\nStands for: about 29 Kobold Miner kills\nComment: @sim level=5 · ");
    expect(ringText(0)).toEqual([" · Level 1, 10%, 40/400 xp, 360 to level 2, +40 quest xp · "]);
  });

  it("counts a turn-in's kills in their section, and lists an item from objects as not counted", () => {
    mountSim();
    expect(
      ringText(3)[1]!
        .split("\n")
        .filter((l) => /^(10 kills|Counted)/.test(l)),
    ).toEqual(["10 kills for item #750: +607 xp", "Counted: here, at the turn-in"]);
    expect(ringText(6)[1]).toBe("Not counted here\n8 Milly's Harvest: from objects: no kills · ");
  });

  it("pins a ring's card on a click without selecting its step, and unpins it on a second click", async () => {
    const user = userEvent.setup();
    const stores = mountSim();
    const ring = row(1).querySelector(".sim-ring")!;
    const tip = document.getElementById(ring.getAttribute("aria-describedby")!)!;
    await user.click(ring);
    await user.unhover(ring);
    expect([tip.hidden, tip.textContent.startsWith("Level 2"), stores.editor.getState().selection.step]).toEqual([false, true, 0]);
    await user.click(ring);
    expect([tip.hidden, stores.editor.getState().selection.step]).toEqual([true, 0]);
  });

  it("marks a ring whose card has notes, and leaves a ring with only its level and gains plain", () => {
    mountSim();
    expect([0, 1, 4, 5, 6].map((i) => row(i).querySelector(".sim-ring .sim-mark")?.className)).toEqual([
      undefined,
      "sim-mark notes",
      undefined,
      "sim-mark notes",
      "sim-mark notes",
    ]);
  });
});

describe("the preview character", () => {
  const game = plannerData();
  const names = new EntityIndex(plannerNames);

  function mountGuide(text: string, preview: Partial<PreviewSettings> = {}, entities = unrelatedEntities, ui: ReactNode = <StepList />) {
    const stores = createStores({ guides: [{ id: "g", text, order: 0 }], session: { guideId: "g", step: 0, line: null } }, null, {
      ...DEFAULT_SAVED_SETTINGS,
      preview: { ...DEFAULT_SETTINGS, ...preview },
    });
    render(
      <StoresContext.Provider value={stores}>
        <GameDataContext.Provider value={game}>
          <EntityContext.Provider value={entities}>{ui}</EntityContext.Provider>
        </GameDataContext.Provider>
      </StoresContext.Provider>,
    );
    return { user: userEvent.setup(), settings: stores.preview };
  }

  function stepStatus(index: number): string {
    const row = document.getElementById(`step-${index}`)!;
    return row.querySelector(".step-skip")?.textContent?.replace(/^Skipped · /, "") ?? "shown";
  }

  it("hides and shows steps as the race and class change", async () => {
    const guide =
      "#name Classes\n#group G\nstep << Warrior\n#xprate >1.59\n.accept 1\nstep << Mage\n.accept 2\n" +
      "step << !Human\n.accept 3\nstep << Human\n.accept 4\n";
    const { user, settings } = mountGuide(guide);
    const steps = async () => {
      for (let fold; (fold = document.querySelector(".fold-toggle[aria-expanded=false]"));) await user.click(fold);
      return [0, 1, 2, 3].map(stepStatus);
    };
    expect(await steps()).toEqual(["XP rate >1.59 only", "Only for Mage", "Skipped for Human", "shown"]);
    expect(document.getElementById("step-1")!.classList).toContain("collapsed");

    act(() => settings.update({ class: "MAGE" }));
    expect(await steps()).toEqual(["Only for Warrior", "shown", "Skipped for Human", "shown"]);

    act(() => settings.update({ race: "Gnome" }));
    expect(await steps()).toEqual(["Only for Warrior", "shown", "shown", "Only for Human"]);

    await user.click(screen.getByRole("button", { name: "Show skipped steps" }));
    const warriorStep = document.getElementById("step-0")!;
    expect(warriorStep.classList).not.toContain("collapsed");
    expect(warriorStep.textContent).toContain("Skipped: Only for Warrior");
  });

  it("hides an #xprate step by the preview XP rate, reading a rate outside RXP's slider as it is", () => {
    const { settings } = mountGuide("#name A\n#group G\nstep\n    #xprate >2.5\n.accept 1\n", { xpRate: 3 });
    expect(stepStatus(0)).toBe("shown");
    act(() => settings.update({ xpRate: 2 }));
    expect(stepStatus(0)).toBe("XP rate >2.5 only");
  });

  it("applies the character level to level conditions", () => {
    const { settings } = mountGuide("#name Levels\n#group G\nstep << 20\n    .accept 7\nstep\n    #maxlevel 10\n    .accept 8\n");
    expect([0, 1].map(stepStatus)).toEqual(["Only for level 20+", "shown"]);
    act(() => settings.update({ startLevel: { level: 20, xp: 0 } }));
    expect([0, 1].map(stepStatus)).toEqual(["shown", "Above level 10"]);
  });

  it("skips every step of a guide the character never runs, and its route card says why", () => {
    const ui = (
      <>
        <StepList />
        <RouteStrip />
      </>
    );
    mountGuide("#name Horde only\n#group G\n<< Horde\nstep\n    .accept 7\n", {}, unrelatedEntities, ui);
    expect(stepStatus(0)).toBe("the guide never runs (Only for Horde)");
    expect(document.getElementById("step-0")!.classList).toContain("collapsed");
    expect(screen.getByRole("heading", { name: /^Steps/ }).textContent).toBe("Steps 0 of 1");
    screen.getByRole("button", { name: /^Horde only,/, description: "0 of 1 steps · Never runs: Only for Horde" });
  });

  it("marks a skipped note with its reason under Show skipped", async () => {
    const { user } = mountGuide("#name Notes\n#group G\nstep\n    >> Mage-only note << Mage\n    .accept 7\n");
    expect(document.querySelector("#step-0 .step-notes")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show skipped steps" }));
    const note = document.querySelector("#step-0 .step-notes .row-line")!;
    expect(note.classList).toContain("line-skipped");
    expect(description(note)).toBe("Skipped: Only for Mage");
    expect(note.querySelector(".mk")!.className).toBe("mk mk-note");
    expect(note.textContent).toBe("Mage-only note (skipped: Only for Mage)");
  });

  const sim = "#name Sim\n#group G\nstep << 3\n    >> Before\nstep\n    .accept 830\nstep\n    .turnin 830\nstep << 3\n    >> After\n";

  it("shows each step by the level the route reaches from the start level and XP", () => {
    const { settings } = mountGuide(sim, { startLevel: { level: 1, xp: 300 } }, names);
    expect([0, 3].map(stepStatus)).toEqual(["Only for level 3+", "Only for level 3+"]);
    act(() => settings.update({ startLevel: { level: 2, xp: 300 } }));
    expect([0, 3].map(stepStatus)).toEqual(["Only for level 3+", "shown"]);
  });

  it("gives a skipped step or line its reason at the level reached before it", async () => {
    const text =
      "#name Mage\n#group G\nstep\n    .accept 830\nstep\n    .turnin 830\nstep << 3 Mage\n    >> Mage step\n" +
      "step\n    >> Mage note << 3 Mage\n    .accept 7\n";
    const { user } = mountGuide(text, { startLevel: { level: 2, xp: 300 } }, names);
    expect(stepStatus(2)).toBe("Only for Mage");
    await user.click(screen.getByRole("button", { name: "Show skipped steps" }));
    expect(document.querySelector("#step-3 .step-notes")!.textContent).toBe("Mage note (skipped: Only for Mage)");
  });
});
