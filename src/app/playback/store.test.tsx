// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightNodes, type WorldLocation } from "../../data/index.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { parseGuide, setCommandArgs, updateLine, type CommandLine } from "../../guide/index.ts";
import { PlaybackRouting, type Playback, type PlaybackInput } from "../../routing/playback.ts";
import { createProfile, simulateRoute, type SimData } from "../../rules/index.ts";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { unrelatedEntities } from "../renderPlanner.tsx";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";
import { useAttachPlayback } from "./input.ts";
import { PlaybackStore, stepBefore, type HostRouting, type PlaybackSession, type PlaybackState } from "./store.ts";
import { testRules } from "../../rules/testing.ts";

afterEach(cleanup);

const straight: HostRouting = { router: null, unavailable: "not loaded" };
const session: PlaybackSession = { view: "g0", start: "g0" };
const loc = (x: number): WorldLocation => ({ instance: 0, x: -58 + x, y: -8873 });

function input(x: number, ...then: number[]): PlaybackInput {
  const ends = then.length ? [0, x, ...then] : [0, x, x + 70];
  const places = Object.fromEntries(ends.map((end, i) => [`Elwynn Forest,${i + 1},${i + 1}`, loc(end)]));
  const data: SimData = {
    quest: () => undefined,
    npc: () => undefined,
    item: () => undefined,
    rules: testRules,
    entityByName: () => undefined,
    flights: new FlightNodes(),
    uiMapNamed: () => undefined,
    locateGoto: (args) => places[args.join(",")],
  };
  const guides = [parseGuide(`#group G\n#name A\n${ends.map((_, i) => `step\n.goto Elwynn Forest,${i + 1},${i + 1}\n+Walk\n`).join("")}`)];
  const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
  return { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: {} };
}

function chain(): PlaybackInput {
  const route = input(70, 140, 210);
  const goto = (i: number) => `step\n.goto Elwynn Forest,${i},${i}\n+Walk\n`;
  route.guides = [
    parseGuide(`#group G\n#name A\n#next B\n${goto(1)}${goto(2)}`),
    parseGuide(`#group G\n#name B\n#next C\n${goto(3)}`),
    parseGuide(`#group G\n#name C\n${goto(4)}`),
  ];
  route.simulation = simulateRoute(route.guides, 0, route.profile, route.data);
  return route;
}

const priced = (playback: Playback) => playback.chain.map((g) => g.priced !== undefined);

const ready = (state: PlaybackState) => (state.status.kind === "ready" && !state.status.stale ? state.status.playback : undefined);

async function settled(store: PlaybackStore) {
  await waitFor(() => expect(ready(store.getState())).toBeTruthy());
  return ready(store.getState())!;
}

describe("PlaybackStore", () => {
  it("seeks a step and keeps its step when a new playback arrives", async () => {
    const store = new PlaybackStore();
    store.attach(input(70), straight, session);
    const first = await settled(store);
    expect(first.timeline.steps.map((s) => s.start)).toEqual([0, 0, 12]);
    store.seekStep(2);
    store.seek(18);
    expect([store.getState().playhead, store.currentStep()]).toEqual([18, 2]);
    store.attach(input(140), straight, session);
    const second = await settled(store);
    expect([second.timeline.steps[2]!.start, store.getState().playhead, store.currentStep()]).toEqual([24, 30, 2]);
  });

  it("steps back past a step with no time, which the playhead cannot stop on", async () => {
    const store = new PlaybackStore();
    store.attach(input(70, 70, 140), straight, session);
    const playback = await settled(store);
    expect(playback.timeline.steps.map((s) => s.start)).toEqual([0, 0, 12, 12]);
    store.seekStep(3);
    store.seekStep(stepBefore(playback.timeline.steps, store.currentStep()));
    expect(store.currentStep()).toBe(1);
    expect(stepBefore(playback.timeline.steps, store.currentStep())).toBe(-1);
  });

  it("keeps the playhead on its step when the first frame began before Play", async () => {
    const store = new PlaybackStore();
    store.attach(input(70), straight, session);
    await settled(store);
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      store.seekStep(2);
      store.setSpeed(64);
      store.play();
      frames.shift()!(990);
      expect([store.getState().playhead, store.currentStep()]).toEqual([12, 2]);
      frames.shift()!(1010);
      expect(store.getState().playhead).toBe(12.64);
    } finally {
      store.pause();
      raf.mockRestore();
      clock.mockRestore();
    }
  });

  it("advances only once per frame after clearing and restarting playback", async () => {
    const store = new PlaybackStore();
    store.attach(input(70), straight, session);
    await settled(store);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      store.setSpeed(1);
      store.play();
      store.attach(null, straight, session);
      store.attach(input(70), straight, session);
      await settled(store);
      store.play();
      vi.advanceTimersToNextFrame();
      expect(store.getState().playhead).toBe(0.016);
    } finally {
      store.pause();
      vi.useRealTimers();
    }
  });

  it("keeps playing when a new input replaces the attached one, and pauses on the last detach", async () => {
    const store = new PlaybackStore();
    const detach = store.attach(input(70), straight, session);
    await settled(store);
    store.play();
    detach();
    const last = store.attach(input(140), straight, session);
    await Promise.resolve();
    const replaced = store.getState().playing;
    last();
    await Promise.resolve();
    expect([replaced, store.getState().playing]).toEqual([true, false]);
  });

  it("shows the playback as current after a detach and a re-attach of the same input", async () => {
    const store = new PlaybackStore();
    const route = input(70);
    const detach = store.attach(route, straight, session);
    await settled(store);
    detach();
    store.attach(route, straight, { view: "g1", start: "g1" });
    await new Promise((resolve) => setTimeout(resolve));
    expect(store.getState().status).toMatchObject({ kind: "ready", stale: false });
  });

  it("fails when routing fails, and prices again on the next input", async () => {
    const play = vi.spyOn(PlaybackRouting.prototype, "play").mockRejectedValueOnce(new Error("Worker crashed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = new PlaybackStore();
      store.attach(input(70), straight, session);
      await waitFor(() => expect(store.getState().status).toEqual({ kind: "failed", error: "Worker crashed" }));
      store.attach(input(140), straight, session);
      await Promise.resolve();
      expect(store.getState().status).toEqual({ kind: "pricing" });
      expect((await settled(store)).timeline.steps.map((s) => s.start)).toEqual([0, 0, 24]);
    } finally {
      play.mockRestore();
      log.mockRestore();
    }
  });

  describe("on a chain of guides", () => {
    it("prices through the open guide and no further", async () => {
      const store = new PlaybackStore();
      store.attach(chain(), straight, session);
      store.follow(0, null);
      const playback = await settled(store);
      expect([store.getState().reach, priced(playback), playback.timeline.totals.seconds]).toEqual([1, [true, false, false], 12]);
    });

    it("prices every guide up to an open guide later in the chain", async () => {
      const store = new PlaybackStore();
      store.attach(chain(), straight, session);
      store.follow(2, null);
      const playback = await settled(store);
      expect([store.getState().reach, priced(playback), playback.timeline.totals.seconds]).toEqual([3, [true, true, true], 36]);
    });

    it("seeks a step of a guide past the reach once a playback shows it", async () => {
      const store = new PlaybackStore();
      store.attach(chain(), straight, session);
      store.follow(0, null);
      await settled(store);
      store.follow(2, 0);
      await waitFor(() => expect([store.getState().playhead, store.currentStep()]).toEqual([24, 3]));
    });

    it("drops a pending seek of a step when the person plays first", async () => {
      const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(0);
      try {
        const store = new PlaybackStore();
        store.attach(chain(), straight, session);
        store.follow(0, null);
        await settled(store);
        store.follow(2, 0);
        store.play();
        await waitFor(() => expect(ready(store.getState())?.timeline.totals.seconds).toBe(36));
        expect([store.getState().playhead, store.getState().playing]).toEqual([0, true]);
      } finally {
        raf.mockRestore();
      }
    });

    it("never shrinks the reach that the person asked for", async () => {
      const store = new PlaybackStore();
      store.attach(chain(), straight, session);
      store.follow(0, null);
      await settled(store);
      store.extend(2);
      store.extend(1);
      await Promise.resolve();
      const shown = store.getState().status;
      const playback = await settled(store);
      expect([shown.kind === "ready" && shown.stale, store.getState().reach, priced(playback)]).toEqual([true, 2, [true, true, false]]);
    });

    it("keeps the asked reach across an edit, and forgets it in a new session", async () => {
      const store = new PlaybackStore();
      store.attach(chain(), straight, session);
      store.follow(0, null);
      store.extend(3);
      await settled(store);
      store.attach(chain(), straight, { ...session });
      const edited = await settled(store);
      store.attach(chain(), straight, { ...session, view: "g1" });
      const other = await settled(store);
      expect([priced(edited), priced(other), store.getState().reach]).toEqual([[true, true, true], [true, false, false], 1]);
    });
  });

  it("gives the same character through one activity, as a subscriber needs", async () => {
    const store = new PlaybackStore();
    store.attach(input(70), straight, session);
    await settled(store);
    store.seek(13);
    const a = store.character();
    store.seek(20);
    expect([a?.level, store.character() === a, Math.round(store.moment()!.place!.x)]).toEqual([1, true, 59]);
  });
});

describe("Playback in the app", () => {
  it("plays again after an edit through the editor", async () => {
    const stores = createStores({
      guides: [
        { id: "g0", order: 0, text: "#group G\n#name A\nstep\n.goto Elwynn Forest,40,50\n+Walk\nstep\n.goto Elwynn Forest,42,50\n+Walk\n" },
      ],
      session: { guideId: "g0", step: 1, line: null },
    });
    function Host() {
      useAttachPlayback(straight);
      return null;
    }
    render(
      <StoresContext value={stores}>
        <GameDataContext value={plannerData()}>
          <EntityContext value={unrelatedEntities}>
            <Host />
          </EntityContext>
        </GameDataContext>
      </StoresContext>,
    );
    const travel = (state: PlaybackState) => ready(state)?.timeline.steps.map((s) => Math.round(s.seconds.travel));
    await waitFor(() => expect(travel(stores.playback.getState())).toEqual([0, 12]));
    act(() => {
      stores.editor.edit((doc) =>
        updateLine(doc, { step: 1, index: 0 }, (l) => setCommandArgs(l as CommandLine, ["Elwynn Forest", "60", "50"])),
      );
    });
    await waitFor(() => expect(travel(stores.playback.getState())).toEqual([0, 119]));
  });

  it("seeks the selected step of the open guide when a saved start leads elsewhere", async () => {
    const walk = (name: string, next: string) =>
      `#group G\n#name ${name}\n${next}${[40, 42, 44].map((x) => `step\n.goto Elwynn Forest,${x},50\n+Walk\n`).join("")}`;
    const stores = createStores(
      {
        guides: [
          { id: "g0", order: 0, text: walk("A", "#next B\n") },
          { id: "g1", order: 1, text: walk("B", "") },
          { id: "g2", order: 2, text: walk("C", "") },
        ],
        session: { guideId: "g2", step: 2, line: null },
      },
      null,
      { ...DEFAULT_SAVED_SETTINGS, preview: { ...DEFAULT_SETTINGS, start: "g0" } },
    );
    function Host() {
      useAttachPlayback(straight);
      return null;
    }
    render(
      <StoresContext value={stores}>
        <GameDataContext value={plannerData()}>
          <EntityContext value={unrelatedEntities}>
            <Host />
          </EntityContext>
        </GameDataContext>
      </StoresContext>,
    );
    await waitFor(() =>
      expect(ready(stores.playback.getState())?.timeline.steps.map((s) => [s.guide, Math.round(s.start)])).toEqual([
        ["C", 0],
        ["C", 0],
        ["C", 12],
      ]),
    );
    await waitFor(() => expect([Math.round(stores.playback.getState().playhead), stores.playback.currentStep()]).toEqual([12, 2]));
  });

  it("keeps the step that the person sought when the selected step shows only after a change of character", async () => {
    const goto = (x: number, when = "") => `step${when}\n.goto Elwynn Forest,${x},50\n+Walk\n`;
    const text = `#group G\n#name A\n${goto(40)}${goto(42, " << Mage")}${goto(44)}${goto(46)}`;
    const stores = createStores({ guides: [{ id: "g0", order: 0, text }], session: { guideId: "g0", step: 1, line: null } });
    function Host() {
      useAttachPlayback(straight);
      return null;
    }
    render(
      <StoresContext value={stores}>
        <GameDataContext value={plannerData()}>
          <EntityContext value={unrelatedEntities}>
            <Host />
          </EntityContext>
        </GameDataContext>
      </StoresContext>,
    );
    const shown = () => ready(stores.playback.getState())?.timeline.steps.map((s) => s.step);
    await waitFor(() => expect(shown()).toEqual([0, 2, 3]));
    act(() => stores.playback.seekStep(2));
    act(() => stores.preview.update({ class: "MAGE" }));
    await waitFor(() => expect(shown()).toEqual([0, 1, 2, 3]));
    expect(stores.playback.currentStep()).toBe(3);
  });

  it("keeps the guides asked for through the first edit of a built-in guide, and forgets them for another guide", async () => {
    const G = "RestedXP Forever Guide (A)";
    const builtin = (n: number, name: string, next: string) => ({
      id: `rxp:test.lua#${n}`,
      order: n - 1,
      fileName: "test.lua",
      text: `#group ${G}\n#name ${name}\n${next}step\n.goto Elwynn Forest,4${n},50\n+Walk\nstep\n.goto Elwynn Forest,4${n},52\n+Walk\n`,
    });
    const guides = [builtin(1, "A", "#next B\n"), builtin(2, "B", "#next C\n"), builtin(3, "C", ""), builtin(4, "D", "")];
    const stores = createStores({ guides: [], session: { guideId: guides[0]!.id, step: 0, line: null } }, { version: "v1", guides });
    function Host() {
      useAttachPlayback(straight);
      return null;
    }
    render(
      <StoresContext value={stores}>
        <GameDataContext value={plannerData()}>
          <EntityContext value={unrelatedEntities}>
            <Host />
          </EntityContext>
        </GameDataContext>
      </StoresContext>,
    );
    const shown = () => {
      const playback = ready(stores.playback.getState());
      return playback && [playback.chain.map((g) => [g.name, g.priced !== undefined]), stores.playback.getState().reach];
    };
    await waitFor(() => expect(shown()?.[1]).toBe(1));
    act(() => stores.playback.extend(3));
    const all = [
      [
        ["A", true],
        ["B", true],
        ["C", true],
      ],
      3,
    ];
    await waitFor(() => expect(shown()).toEqual(all));
    act(() => {
      stores.editor.edit((doc) =>
        updateLine(doc, { step: 1, index: 0 }, (l) => setCommandArgs(l as CommandLine, ["Elwynn Forest", "41", "60"])),
      );
    });
    await waitFor(() => expect(stores.editor.getState().current).toMatchObject({ builtin: false, viewId: guides[0]!.id }));
    const travel = () => ready(stores.playback.getState())?.timeline.steps.map((step) => [step.guide, Math.round(step.seconds.travel)]);
    await waitFor(() =>
      expect(travel()).toEqual([
        ["A", 0],
        ["A", 40],
        ["B", 40],
        ["B", 8],
        ["C", 10],
        ["C", 8],
      ]),
    );
    expect(shown()).toEqual(all);
    act(() => stores.editor.open(guides[3]!.id));
    await waitFor(() => expect(shown()).toEqual([[["D", true]], 1]));
  });

  it("plays again with the Playback settings, and again with the defaults after a reset", async () => {
    const text =
      "#group G\n#name A\nstep\n.goto Elwynn Forest,40,50\n+Walk\nstep\n#softcore\n#completewith next\n.deathskip\nstep\n.vendor\n";
    const stores = createStores({ guides: [{ id: "g0", order: 0, text }], session: { guideId: "g0", step: 0, line: null } });
    function Host() {
      useAttachPlayback(straight);
      return null;
    }
    render(
      <StoresContext value={stores}>
        <GameDataContext value={plannerData()}>
          <EntityContext value={unrelatedEntities}>
            <Host />
          </EntityContext>
        </GameDataContext>
      </StoresContext>,
    );
    const totals = (state: PlaybackState) => ready(state)?.timeline.steps.map((s) => [s.seconds.total, s.respawn]);
    await waitFor(() =>
      expect(totals(stores.playback.getState())).toEqual([
        [0, 300],
        [30, 300],
        [20, 300],
      ]),
    );
    act(() => stores.playbackSettings.update({ ignoreDeathskip: true, respawn: 90 }));
    await waitFor(() =>
      expect(totals(stores.playback.getState())).toEqual([
        [0, 90],
        [0, 90],
        [20, 90],
      ]),
    );
    act(() => stores.playbackSettings.reset());
    await waitFor(() =>
      expect(totals(stores.playback.getState())).toEqual([
        [0, 300],
        [30, 300],
        [20, 300],
      ]),
    );
  });
});
