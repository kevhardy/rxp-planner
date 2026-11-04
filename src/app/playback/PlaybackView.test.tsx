// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { EntityIndex, GameData } from "../../data/index.ts";
import { plannerContext, plannerFile, plannerNames } from "../../data/plannerFixture.ts";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import type { NativeFrame } from "../../routing/frame.ts";
import { PlaybackRouting } from "../../routing/playback.ts";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { Dialog } from "../Dialog.tsx";
import { searchLane, type RoutingEngine, type RoutingLoad } from "../routing/engine.ts";
import { DEFAULT_SETTINGS, type PreviewSettings } from "../preview/settings.ts";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";
import { PlaybackView } from "./PlaybackView.tsx";
import type { HostRouting } from "./store.ts";

const host = vi.hoisted(() => ({ routing: undefined as HostRouting | undefined }));
vi.mock("./router.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./router.ts")>();
  return {
    usePlaybackRouter: () => {
      const loaded = real.usePlaybackRouter();
      return host.routing ?? loaded;
    },
  };
});

const routing = vi.hoisted(() => ({ load: null as (() => Promise<RoutingLoad>) | null, lane: null as RoutingEngine | null }));
vi.mock("../routing/engine.ts", async (original) => {
  const actual = await original<typeof import("../routing/engine.ts")>();
  return {
    ...actual,
    loadRouting: () => routing.load?.() ?? actual.loadRouting(),
    searchLane: vi.fn((engine: RoutingEngine) => routing.lane ?? actual.searchLane(engine)),
  };
});

afterEach(cleanup);
afterEach(() => {
  host.routing = undefined;
  routing.load = null;
  routing.lane = null;
  vi.mocked(searchLane).mockClear();
});

const guide = `#group G
#name Sim
step
    .accept 783
    .turnin 783
    .accept 7
    .accept 33
step
    .complete 7,1 -- @sim kills=10
step
    .complete 33,1,3
step
    .turnin 7
    .turnin 33
`;

function mount(dialog?: ReactNode, texts = [guide], preview: Partial<PreviewSettings> = {}, strict = false) {
  const guides = texts.map((text, i) => ({ id: `g${i}`, order: i, text }));
  const stores = createStores({ guides, session: { guideId: "g0", step: 0, line: null } }, undefined, {
    ...DEFAULT_SAVED_SETTINGS,
    preview: { ...DEFAULT_SETTINGS, ...preview },
  });
  const npcNames = Object.fromEntries(plannerNames.entities.npc);
  const view = (
    <StoresContext value={stores}>
      <GameDataContext value={new GameData({ ...plannerFile(), npcNames }, plannerContext)}>
        <EntityContext value={new EntityIndex(plannerNames)}>
          <div id="app">
            <PlaybackView />
          </div>
          {dialog}
        </EntityContext>
      </GameDataContext>
    </StoresContext>
  );
  render(strict ? <StrictMode>{view}</StrictMode> : view);
  return stores;
}

describe("Playback routing", () => {
  const manifest: RoutingEngine["manifest"] = {
    id: "m0",
    scope: syntheticScope(),
    frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles: [],
  };
  const engine: RoutingEngine = { manifest, maps: [{ manifest }], route: () => new Promise(() => {}), release() {} };
  const laneOf = () => {
    const release = vi.fn();
    routing.load = () => Promise.resolve({ ok: true, engine, missing: [] });
    routing.lane = { ...engine, release };
    return release;
  };

  it("searches on a lane of its own, made once, and ends the lane when Playback closes", async () => {
    const release = laneOf();
    mount();
    await waitFor(() => expect(searchLane).toHaveBeenCalledWith(engine));
    expect([vi.mocked(searchLane).mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
    cleanup();
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("keeps the lane through StrictMode's remount", async () => {
    const release = laneOf();
    mount(undefined, [guide], {}, true);
    await waitFor(() => expect(searchLane).toHaveBeenCalledWith(engine));
    await screen.findByRole("group", { name: "Timeline" });
    expect(release).not.toHaveBeenCalled();
    cleanup();
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
});

describe("Playback steps", () => {
  it("scrolls to the current step when deferred rows appear without moving the playhead", async () => {
    const scrolled: { step: string | null; options: boolean | ScrollIntoViewOptions | undefined }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, options) {
      scrolled.push({ step: this.querySelector(".playback-no")?.textContent ?? null, options });
    };
    onTestFinished(() => void Reflect.deleteProperty(Element.prototype, "scrollIntoView"));
    const stores = mount();
    expect(within(screen.getByRole("region", { name: "Steps" })).queryAllByRole("listitem")).toEqual([]);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem")).toHaveLength(4));
    expect(stores.playback.getState().playhead).toBe(0);
    await waitFor(() => expect(scrolled).toEqual([{ step: "Step 1", options: { block: "nearest" } }]));
  });

  it("shows each step's start time under its number, and its own time only when it is more than 0:00", async () => {
    mount(undefined, [`${guide}step\n    >>Read the note\n`]);
    const rows = await waitFor(() => {
      const found = within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem");
      expect(found).toHaveLength(5);
      return found;
    });
    expect(
      rows.map((row) => [
        ...[...row.querySelector(".playback-gutter")!.children].map((part) => part.textContent),
        row.querySelector(".playback-length")?.firstElementChild!.textContent ?? null,
      ]),
    ).toEqual([
      ["Step 1", "0:00", "0:23"],
      ["Step 2", "0:23", "3:06"],
      ["Step 3", "3:29", "2:06"],
      ["Step 4", "5:35", "0:16"],
      ["Step 5", "5:51", null],
    ]);
  });

  it("draws a title's leading icon as its mark, and the note mark on a title without one", async () => {
    mount(undefined, [
      "#group G\n#name A\nstep\n    >>|Tinterface/worldmap/chatbubble_64grey.blp:20|tTalk to Marshal\nstep\n    >>Read the note\n",
    ]);
    const rows = await waitFor(() => {
      const found = within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(
      rows.map((row) => {
        const head = row.querySelector(".playback-head")!;
        return [head.firstElementChild!.className, head.querySelector(".playback-title-text")!.textContent];
      }),
    ).toEqual([
      ["mk tex", "Talk to Marshal"],
      ["mk mk-note", "Read the note"],
    ]);
  });

  it("draws the time split under the current step's time only", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = readFileSync(join(import.meta.dirname, "playback.css"), "utf8");
    onTestFinished(() => style.remove());
    mount();
    const rows = await waitFor(() => {
      const found = within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem");
      expect(found).toHaveLength(4);
      return found;
    });
    const shown = () => rows.map((row) => getComputedStyle(row.querySelector(".step-bars")!).visibility);
    expect(shown()).toEqual(["visible", "hidden", "hidden", "hidden"]);
    fireEvent.click(within(rows[2]!).getByRole("button"));
    await waitFor(() => expect(shown()).toEqual(["hidden", "hidden", "visible", "hidden"]));
  });

  it("shows the kills of each step after the kill mark, with its mobs", async () => {
    mount();
    const rows = await waitFor(() => within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem"));
    expect(rows[1]!.querySelector(".playback-kills")!.firstElementChild!.className).toBe("mk mk-kill tex");
    expect(rows.map((row) => row.querySelector(".playback-kills")?.textContent ?? "")).toEqual([
      "",
      "10 kills · Kobold Vermin",
      "6 kills · Defias Thug ×1, Kobold Miner ×1, Timber Wolf ×1, Stonetusk Boar ×1, Kobold Worker ×1, Young Wolf ×1",
      "10 kills · Defias Thug ×2, Kobold Miner ×2, Timber Wolf ×1, Stonetusk Boar ×1, Kobold Worker ×1, Young Wolf ×1, Kobold Tunneler ×1, Murloc Streamrunner ×1",
    ]);
  });

  it("lists the items held for numbered item objectives and for a text row whose link is an item", async () => {
    mount(undefined, [
      "#group G\n#name A\nstep\n    .accept 33\n    .accept 76160\n    .collect 750,2,33,1\n    .collect 206170,3,76160,1\nstep\n    +Walk\n",
    ]);
    const slider = await waitFor(() => {
      const playhead = screen.getByRole<HTMLInputElement>("slider", { name: "Playhead" });
      if (playhead.disabled) throw new Error("no playback yet");
      return playhead;
    });
    fireEvent.change(slider, { target: { value: slider.max } });
    const held = await waitFor(() => screen.getByText("Items held").closest("details")!);
    expect([...held.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Tough Wolf Meat 2/8", "Windfury Cone 3/8"]);
    const card = screen.getByRole("complementary", { name: "Character" });
    expect([...card.querySelectorAll("summary")].map((s) => s.textContent?.trim())).toEqual([
      "Quest log 2/40",
      "Items held 2",
      "Flight paths 1",
    ]);
  });

  it("shows a quest accepted below its level on its step", async () => {
    mount(undefined, ["#group G\n#name 12-14 C\nstep\n    .goto Elwynn Forest,40,50\n    .accept 62\n"], {
      startLevel: { level: 1, xp: 0 },
    });
    const row = await waitFor(() => within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem")[0]!);
    expect(row.querySelector(".playback-warnings")?.textContent).toBe("Accepts The Fargodeep Mine (62) at level 1; it requires level 4");
  });

  it("shows a step's warning on that step only, when another guide on the route has the same name", async () => {
    mount(
      undefined,
      [
        "#group G\n#name 12-14 C\nstep\n    .goto Elwynn Forest,40,50\n    .accept 62\n",
        "#group H\n#name 12-14 C\n#next G\\12-14 C\nstep\n    .goto Elwynn Forest,42,50\n",
      ],
      { startLevel: { level: 1, xp: 0 }, start: "g1" },
    );
    const rows = await waitFor(() => within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem"));
    expect(rows.map((row) => row.querySelector(".playback-warnings")?.textContent)).toEqual([
      undefined,
      "Accepts The Fargodeep Mine (62) at level 1; it requires level 4",
    ]);
  });

  it("draws the spirit healer mark before a death skip's resurrection", async () => {
    const healer = vi.spyOn(GameData.prototype, "nearestSpiritHealer").mockImplementation((from) => from);
    onTestFinished(() => healer.mockRestore());
    mount(undefined, ["#group G\n#name A\nstep\n.goto Elwynn Forest,40,50\n+Walk\nstep\n#softcore\n.deathskip\n"]);
    const action = await waitFor(() => {
      const rows = within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem");
      const line = rows[1]!.querySelector(".playback-actions .row-line");
      if (!line) throw new Error("no resurrection yet");
      return line;
    });
    expect([action.firstElementChild!.className, action.textContent]).toEqual(["mk mk-deathskip tex", "Resurrect at Spirit Healer"]);
  });

  it("shows whole titles, and clamps titles and kills to two lines except on the current step", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = ["../styles.css", "playback.css"].map((f) => readFileSync(join(import.meta.dirname, f), "utf8")).join("\n");
    try {
      const long = "Kill Kobold Vermin in the mine east of the abbey until you have ten of them for Marshal McBride";
      mount(undefined, [guide.replace("    .complete 7,1", `    >>${long}\n    .complete 7,1`)]);
      const rows = await waitFor(() => within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem"));
      const shown = (row: HTMLElement) =>
        [".playback-title-text", ".playback-kills-text"].map((s) => {
          const style = getComputedStyle(row.querySelector(s)!);
          return [style.display, style.webkitLineClamp];
        });
      expect(rows[1]!.querySelector(".playback-title-text")!.textContent).toBe(long);
      expect(shown(rows[1]!)).toEqual([
        ["-webkit-box", "2"],
        ["-webkit-box", "2"],
      ]);
      fireEvent.click(within(rows[1]!).getByRole("button"));
      await waitFor(() => expect(within(rows[1]!).getByRole("button").getAttribute("aria-current")).toBe("step"));
      expect(shown(rows[1]!).map(([display]) => display)).toEqual(["block", "block"]);
    } finally {
      style.remove();
    }
  });
});

describe("Playback notices", () => {
  const notices = () =>
    ["Map", "Steps"].map((name) => screen.getByRole("region", { name }).querySelector(".map-body .empty, .playback-notice")?.textContent);
  const onMap = "No guide steps loaded.";

  it("names the guide and the character when no step applies, with the reason the guide never runs, and leaves nothing to play", async () => {
    mount(undefined, ["#group G\n#name Durotar\n<< Horde\nstep\n    .goto Durotar,43.3,68.5\n    +Walk\n"]);
    const text = "No steps of “Durotar” apply to Human Warrior (Only for Horde). Change the character under Preview as.";
    await waitFor(() => expect(notices()).toEqual([onMap, text]));
    expect([
      screen.getAllByRole("status").filter((status) => status.textContent === text).length,
      screen.getByRole<HTMLButtonElement>("button", { name: "Play" }).disabled,
      screen.getByRole<HTMLButtonElement>("button", { name: "Next step" }).disabled,
      screen.getByRole<HTMLInputElement>("slider", { name: "Playhead" }).disabled,
      screen.queryByText("Route finished"),
    ]).toEqual([1, true, true, true, null]);
  });

  it("says that Playback could not price the route when routing fails, and logs the error", async () => {
    const play = vi.spyOn(PlaybackRouting.prototype, "play").mockRejectedValue(new Error("Worker crashed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => (play.mockRestore(), log.mockRestore()));
    mount();
    const text = "Playback could not price the route. Reload the page to try again.";
    await waitFor(() => expect(notices()).toEqual([onMap, text]));
    expect(log).toHaveBeenCalledWith("Playback", new Error("Worker crashed"));
  });
});

const frame: NativeFrame = {
  scope: { map: 0 },
  frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
};

describe("Playback step time parts", () => {
  const runs =
    "#group G\n#name A\n" + ["40", "42", "42.43", "42.51"].map((x) => `step\n    .goto Elwynn Forest,${x},50\n    +Walk\n`).join("");

  async function times() {
    host.routing = {
      router: {
        frames: [frame],
        route: async () => ({
          journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [{ kind: "no-terrain", endpoint: "end" }] }],
        }),
      },
    };
    mount(undefined, [runs]);
    return waitFor(() => {
      const rows = within(screen.getByRole("region", { name: "Steps" }))
        .getAllByRole("listitem")
        .map((row) => {
          const length = row.querySelector(".playback-length");
          return [length?.firstElementChild!.textContent ?? null, length?.querySelector(".sr-only")!.textContent ?? null];
        });
      expect(rows.filter(([shown]) => shown !== null)).toHaveLength(3);
      return rows;
    });
  }

  it("lists a step's time parts so that they add up to its shown time", async () => {
    expect((await times())[2]).toEqual(["≈ 0:02", " (Travel 0:02; straight-line travel, no terrain at a stop)"]);
  });

  it("names the part of a step that shows 0:01, with no empty list", async () => {
    expect((await times())[3]).toEqual(["≈ 0:01", " (Travel 0:01; straight-line travel, no terrain at a stop)"]);
  });
});

describe("Playback straight-line estimates", () => {
  it("says that routing did not load and what to do, and logs the technical reason once, not on each render", async () => {
    host.routing = { router: null, unavailable: "No routing artifact is installed." };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    mount();
    const routing = () => document.querySelector(".playback-routing [role=status]")?.textContent;
    await waitFor(() => expect(routing()).toBe("Routing did not load, so travel times use straight lines. Reload the page to try again."));
    const speed = screen.getByRole<HTMLSelectElement>("combobox", { name: "Speed" });
    await userEvent.setup().selectOptions(speed, "32");
    expect([speed.value, log.mock.calls]).toEqual(["32", [["Routing did not load", "No routing artifact is installed."]]]);
  });

  it("names a stop with no terrain as the reason for a step's straight-line travel", async () => {
    host.routing = {
      router: {
        frames: [frame],
        route: async () => ({
          journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [{ kind: "no-terrain", endpoint: "end" }] }],
        }),
      },
    };
    mount(undefined, [
      "#group G\n#name A\nstep\n    .goto Elwynn Forest,40,50\n    +Walk\nstep\n    .goto Elwynn Forest,42,50\n    +Walk\n",
    ]);
    const reasons = () =>
      within(screen.getByRole("region", { name: "Steps" }))
        .queryAllByRole("listitem")
        .flatMap((row) => row.querySelector(".playback-length .sr-only")?.textContent?.match(/straight-line travel, ([^)]*)/)?.[1] ?? []);
    await waitFor(() => expect(reasons()).toEqual(["no terrain at a stop"]));
  });

  it("shows a meter beside a guide's name while its legs route, and a check in its place once they are done", async () => {
    let finish!: () => void;
    const legs = new Promise<void>((resolve) => (finish = resolve));
    host.routing = {
      router: {
        frames: [frame],
        route: async () => {
          await legs;
          return { journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [{ kind: "no-terrain", endpoint: "end" }] }] };
        },
      },
    };
    mount(undefined, [
      "#group G\n#name A\nstep\n    .goto Elwynn Forest,40,50\n    +Walk\nstep\n    .goto Elwynn Forest,42,50\n    +Walk\n",
    ]);
    const guide = () => {
      const button = within(screen.getByRole("list", { name: "Guides" })).getByRole("button");
      const meter = button.querySelector("progress");
      return [button.textContent, meter && `${meter.value}/${meter.max}`, !!button.querySelector("svg")];
    };
    await waitFor(() => expect(guide()).toEqual(["A: Routing 0 of 1 legs", "0/1", false]));
    await within(screen.getByRole("region", { name: "Steps" })).findByRole("heading", { name: "A" });
    const shown = screen.getAllByText("Routing 0 of 1 legs").map((el) => el.closest("[aria-label]")?.getAttribute("aria-label"));
    expect(shown).toEqual(["Timeline"]);
    finish();
    await waitFor(() => expect(guide()).toEqual(["A: Routed 0 of 1 legs", null, true]));
  });
});

describe("Playback character card", () => {
  it("keeps the level and XP in the card's flow, not over the stats below", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = readFileSync(join(import.meta.dirname, "playback.css"), "utf8");
    try {
      mount();
      const level = (await screen.findByRole("progressbar", { name: "XP through level 1" })).parentElement!;
      expect(getComputedStyle(level).position).toBe("static");
    } finally {
      style.remove();
    }
  });
});

describe("Playback settings menu", () => {
  it("changes the settings, counts the changed ones on its button, and resets them", async () => {
    const stores = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("checkbox", { name: "Ignore death skips" }));
    expect(screen.getByRole("button", { name: "Settings (1)" }).getAttribute("aria-expanded")).toBe("true");
    const respawn = screen.getByRole("textbox", { name: "Mob respawn" });
    await user.clear(respawn);
    await user.type(respawn, "0{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Enter a number from 1 to 1800.");
    await user.clear(respawn);
    await user.type(respawn, "45{Enter}");
    expect(stores.playbackSettings.getState()).toEqual({ ignoreDeathskip: true, respawn: 45 });
    await user.click(screen.getByRole("button", { name: "Settings (2)" }));
    await user.click(screen.getByRole("button", { name: "Settings (2)" }));
    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(stores.playbackSettings.getState()).toEqual({});
    expect([
      screen.getByRole("button", { name: "Settings" }).textContent,
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Ignore death skips" }).checked,
      screen.getByRole<HTMLInputElement>("textbox", { name: "Mob respawn" }).value,
      screen.getByRole<HTMLInputElement>("textbox", { name: "Kill area" }).value,
    ]).toEqual(["Settings", false, "300", "500"]);
  });
});

describe("Playback step buttons", () => {
  it("moves to the next step per Next step press, and disables it on the last step", async () => {
    mount();
    const user = userEvent.setup();
    const stepButtons = await waitFor(() =>
      within(screen.getByRole("region", { name: "Steps" }).querySelector("ol")!).getAllByRole("button"),
    );
    const next = screen.getByRole<HTMLButtonElement>("button", { name: "Next step" });
    await waitFor(() => expect(next.disabled).toBe(false));
    const current = () => stepButtons.findIndex((b) => b.getAttribute("aria-current") === "step");

    const seen = [current()];
    for (let press = 0; press < 3; press++) {
      await user.click(next);
      seen.push(current());
    }
    expect([seen, next.disabled]).toEqual([[0, 1, 2, 3], true]);
  });

  it("counts the current step out of the total in the Steps header as Next step moves", async () => {
    mount();
    const user = userEvent.setup();
    const next = screen.getByRole<HTMLButtonElement>("button", { name: "Next step" });
    await waitFor(() => expect(next.disabled).toBe(false));
    const count = () =>
      [...screen.getByRole("region", { name: "Steps" }).querySelectorAll(".panel-head .count > span")].map((span) => span.textContent);

    const seen = [await waitFor(() => expect(count()).toHaveLength(2)).then(count)];
    await user.click(next);
    await user.click(next);
    seen.push(count());
    expect(seen).toEqual([
      ["1/4", "1 of 4 steps"],
      ["3/4", "3 of 4 steps"],
    ]);
  });

  it("keeps the step time legend in the description of the Steps header's info button", async () => {
    mount();
    const steps = screen.getByRole("region", { name: "Steps" });
    const info = await within(steps).findByRole("button", { name: "Step time colors" });
    const legend = document.getElementById(info.getAttribute("aria-describedby") ?? "");
    expect([legend?.textContent, within(steps).queryByText("Travel")]).toEqual([
      "Step time: Travel Combat Interact Wait ≈Straight-line estimate",
      null,
    ]);
  });
});

describe("Playback clock", () => {
  it("rounds the playhead to the nearest second, as the agent's guide_timeline prints a time", async () => {
    const stores = mount();
    const slider = await waitFor(() => {
      const playhead = screen.getByRole<HTMLInputElement>("slider", { name: "Playhead" });
      if (playhead.disabled) throw new Error("no playback yet");
      return playhead;
    });
    act(() => stores.playback.seek(59.6));
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^1:00 of /);
  });
});

describe("Playback Space key", () => {
  it("plays and pauses once per press when no control has focus, and leaves Space to fields", async () => {
    mount();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Play" }).disabled).toBe(false));
    const play = () => screen.getByRole("button", { name: /^(Play|Pause)$/ }).getAttribute("aria-label");

    await user.keyboard(" ");
    expect(play()).toBe("Pause");

    await user.keyboard("[Space>2][/Space]");
    expect(play()).toBe("Play");

    expect(fireEvent.keyDown(document.body, { key: " " })).toBe(false);
    expect(fireEvent.keyUp(document.body, { key: " " })).toBe(false);
    expect(play()).toBe("Pause");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    screen.getByRole("checkbox", { name: "Ignore death skips" }).focus();
    await user.keyboard(" ");
    await user.type(screen.getByRole("textbox", { name: "Mob respawn" }), " ");
    expect([
      play(),
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Ignore death skips" }).checked,
      screen.getByRole<HTMLInputElement>("textbox", { name: "Mob respawn" }).value,
    ]).toEqual(["Pause", true, "300 "]);
  });

  it("presses a focused button with Space, and plays and pauses from the Playhead slider", async () => {
    mount();
    const user = userEvent.setup();
    const stepButtons = await waitFor(() =>
      within(screen.getByRole("region", { name: "Steps" }).querySelector("ol")!).getAllByRole("button"),
    );
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Play" }).disabled).toBe(false));
    const play = () => screen.getByRole("button", { name: /^(Play|Pause)$/ }).getAttribute("aria-label");
    const current = () => stepButtons.findIndex((b) => b.getAttribute("aria-current") === "step");

    stepButtons[3]!.focus();
    await user.keyboard(" ");
    expect([play(), current()]).toEqual(["Play", 3]);

    screen.getByRole("slider", { name: "Playhead" }).focus();
    await user.keyboard(" ");
    expect([play(), current()]).toEqual(["Pause", 3]);
    await user.keyboard(" ");
    expect([play(), current()]).toEqual(["Play", 3]);
  });

  it("leaves Space to an open dialog", async () => {
    const ok = vi.fn();
    mount(
      <Dialog title="Rename" onClose={() => {}}>
        <button type="button" data-autofocus onClick={ok}>
          OK
        </button>
      </Dialog>,
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Play", hidden: true }).disabled).toBe(false));
    await user.keyboard(" ");
    expect([
      document.activeElement?.textContent,
      ok.mock.calls.length,
      screen.getByRole("button", { name: "Play", hidden: true }).getAttribute("aria-label"),
    ]).toEqual(["OK", 1, "Play"]);
  });
});

describe("Playback of a chain of guides", () => {
  const walk = (x: number) => `step\n    .goto Elwynn Forest,${x},50\n    +Walk\n`;
  const chain = [
    `#group G\n#name A\n#next B\n${walk(40)}${walk(42)}`,
    `#group G\n#name B\n#next C\nstep\n    +Read the sign\n`,
    `#group G\n#name C\n${walk(44)}`,
  ];
  const dock = () => screen.getByRole("list", { name: "Guides" });
  const guides = () =>
    within(dock())
      .getAllByRole("button")
      .map((b) => b.textContent);
  const calculate = (name: string) => within(screen.getByRole("region", { name: "Map" })).queryByRole("button", { name });
  const left = () => within(screen.getByRole("group", { name: "Calculate routing" })).getByText(/left$/).textContent;

  it("shows the Guides list and no calculate buttons before the first playback", () => {
    mount(undefined, chain);
    expect([
      within(dock()).queryAllByRole("listitem").length,
      screen.getByRole<HTMLButtonElement>("button", { name: "Play" }).disabled,
      screen.queryByRole("button", { name: "Calculate next guide" }),
      screen.queryByRole("button", { name: "Calculate all guides" }),
    ]).toEqual([0, true, null, null]);
  });

  it("shows the open guide in the dock and its heading, and calculates one more guide per Calculate next guide", async () => {
    mount(undefined, chain);
    await waitFor(() => expect(guides()).toEqual(["A: Straight-line travel"]));
    const heading = (await screen.findByRole("heading", { name: "A" })).parentElement!;
    expect([
      heading.textContent,
      screen.queryAllByRole("progressbar", { name: /^Routing/ }),
      left(),
      calculate("Calculate next guide")?.textContent,
      calculate("Calculate all guides")?.textContent,
    ]).toEqual(["ALevel 1–1", [], "2 guides left", "Next guide", "All guides"]);
    const user = userEvent.setup();
    await user.click(calculate("Calculate next guide")!);
    await waitFor(() => expect(guides()).toEqual(["A: Straight-line travel", "B: Straight-line travel"]));
    await screen.findByRole("heading", { name: "B" });
    expect([
      dock().querySelectorAll(".boundary").length,
      left(),
      calculate("Calculate next guide")?.textContent,
      calculate("Calculate all guides")?.textContent,
    ]).toEqual([1, "1 guide left", "Next guide", "All guides"]);
    await user.click(calculate("Calculate next guide")!);
    await waitFor(() => expect(guides()).toEqual(["A: Straight-line travel", "B: Straight-line travel", "C: Straight-line travel"]));
  });

  it("keeps the step list where the reader left it when routing publishes again", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent);
    };
    onTestFinished(() => void Reflect.deleteProperty(Element.prototype, "scrollIntoView"));
    mount(undefined, chain);
    await screen.findByRole("heading", { name: "A" });
    await userEvent.setup().click(calculate("Calculate next guide")!);
    await screen.findByRole("heading", { name: "B" });
    expect(scrolled).toHaveLength(1);
  });

  it("shows the Calculate routing prompt over the map, not over the steps that playback follows", async () => {
    const stores = mount(undefined, chain);
    const prompt = await within(screen.getByRole("region", { name: "Map" })).findByRole("group", { name: "Calculate routing" });
    await userEvent.setup().click(within(prompt).getByRole("button", { name: "Calculate next guide" }));
    expect([
      within(screen.getByRole("region", { name: "Steps" })).queryByRole("group", { name: "Calculate routing" }),
      stores.playback.getState().reach,
    ]).toEqual([null, 2]);
  });

  it("calculates every later guide from Calculate all guides, then hides both buttons", async () => {
    const stores = mount(undefined, chain);
    await waitFor(() => expect(guides()).toHaveLength(1));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Calculate all guides" }));
    await waitFor(() => expect(guides()).toHaveLength(3));
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["A", "B", "C"]));
    expect([
      stores.playback.getState().reach,
      screen.queryByRole("button", { name: "Calculate next guide" }),
      screen.queryByRole("button", { name: "Calculate all guides" }),
    ]).toEqual([Infinity, null, null]);
  });
});
