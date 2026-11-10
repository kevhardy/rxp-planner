// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import type { LoadedWorldMap } from "../../data/index.ts";
import { guideIconCatalog } from "../../data/guideIcons.ts";
import { fixture, interiorsFixture } from "../../data/manifestFixture.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { fromSurfaces, type SurfaceMap } from "../../data/surfaces.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { saveSetting } from "../../storage/index.ts";
import { DatasetContext, EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { renderPlanner, unrelatedEntities } from "../renderPlanner.tsx";
import { DEFAULT_LAYOUT } from "../layout.ts";
import { MapColumn } from "../map/MapPanel.tsx";
import { DEFAULT_MAP_SETTINGS } from "../map/mapSettings.ts";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { createStores } from "../stores.ts";
import { useAttachPlayback } from "./input.ts";
import { PlaybackStage } from "./PlaybackStage.tsx";
import type { HostRouting } from "./store.ts";

beforeEach(async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("map-stage")) return DOMRect.fromRect({ width: 1000, height: 1000 });
    const [x = 0, y = 0] = this.style
      .getPropertyValue("--pan")
      .match(/-?[\d.]+/g)!
      .map(Number);
    const scale = Number(this.closest<HTMLElement>(".map-viewport")!.style.getPropertyValue("--zoom"));
    return DOMRect.fromRect({ x, y, width: 1000 * scale, height: 1000 * scale });
  });
  await saveSetting("preview", DEFAULT_SETTINGS);
  await saveSetting("map", DEFAULT_MAP_SETTINGS);
  await saveSetting("layout", DEFAULT_LAYOUT);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FOLLOW = `#group G\n#name Follow\n${[40, 40.1, 60, 65].map((x) => `step\n>>Talk to Innkeeper Farley (npc #295)\n.goto Elwynn Forest,${x},80\n+Walk\n`).join("")}`;

const straight: HostRouting = { router: null, unavailable: "not loaded" };
let stores: ReturnType<typeof createStores>;

async function start(loadWorldMap: () => Promise<LoadedWorldMap> = () => Promise.resolve(worldMap), text = FOLLOW, edit = false) {
  stores = createStores({ guides: [{ id: "g", order: 0, text }], session: { guideId: "g", step: 0, line: null } });
  const game = plannerData();
  stores.preview.setGame(game);
  const data = {
    manifest: fixture().manifest,
    game,
    entities: unrelatedEntities,
    transports: { version: 1 as const, nodes: [], links: [] },
    worldMap: await loadWorldMap(),
    guideIcons: guideIconCatalog(undefined),
    base: "/",
  };
  function Stage() {
    useAttachPlayback(straight);
    return <PlaybackStage />;
  }
  render(
    <StoresContext.Provider value={stores}>
      <DatasetContext.Provider value={{ data }}>
        <GameDataContext.Provider value={game}>
          <EntityContext.Provider value={unrelatedEntities}>{edit ? <MapColumn /> : <Stage />}</EntityContext.Provider>
        </GameDataContext.Provider>
      </DatasetContext.Provider>
    </StoresContext.Provider>,
    { reactStrictMode: true },
  );
}

async function mount(loadWorldMap?: () => Promise<LoadedWorldMap>, text?: string, edit = false) {
  await start(loadWorldMap, text, edit);
  if (edit) await screen.findByRole("combobox", { name: "Map shown" });
  else await screen.findByRole("img", { name: "Character" });
}

const follow = () => screen.getByRole("button", { name: "Follow character" });
const viewport = () => document.querySelector<HTMLElement>(".map-viewport")!;
const transform = () => document.querySelector<HTMLElement>(".map-stage")!.style.getPropertyValue("--pan");
const next = () => {
  act(() => stores.playback.seekStep(stores.playback.currentStep() + 1));
};
const zoom = () => Number(viewport().style.getPropertyValue("--zoom"));
const pan = () => {
  fireEvent.pointerDown(viewport(), { clientX: 500, clientY: 500 });
  fireEvent.pointerMove(viewport(), { clientX: 700, clientY: 600 });
  fireEvent.pointerUp(viewport(), { clientX: 700, clientY: 600 });
};
const CENTER = [476, 500];
const markerCenter = () => {
  const marker = screen.getByRole("img", { name: "Character" });
  const [x = 0, y = 0] = transform()
    .match(/-?[\d.]+/g)!
    .map(Number);
  return [
    Math.round(parseFloat(marker.style.getPropertyValue("--at-x")) + x),
    Math.round(parseFloat(marker.style.getPropertyValue("--at-y")) + y),
  ];
};

describe("Playback following", () => {
  it("opens zoomed in on the character", async () => {
    await mount();
    expect([follow().getAttribute("aria-pressed"), zoom() > 1, markerCenter()]).toEqual(["true", true, CENTER]);
  });

  it("starts pressed, toggles off without moving, and stays off across steps", async () => {
    await mount();
    expect(follow().getAttribute("aria-pressed")).toBe("true");
    const before = transform();
    fireEvent.click(follow());
    expect(follow().getAttribute("aria-pressed")).toBe("false");
    expect(transform()).toBe(before);
    next();
    next();
    next();
    expect(transform()).toBe(before);
    expect(follow().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(follow());
    expect(follow().getAttribute("aria-pressed")).toBe("true");
    expect(markerCenter()).toEqual(CENTER);
  });

  it("keeps following and the user's zoom through wheel and button zooms, and stops on a pan or Reset zoom", async () => {
    await mount();
    const followed = zoom();
    fireEvent.wheel(viewport(), { deltaY: 1, clientX: 100, clientY: 900 });
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    const zoomed = zoom();
    expect([follow().getAttribute("aria-pressed"), (zoomed / followed).toFixed(4), markerCenter()]).toEqual([
      "true",
      (0.8 / 1.5).toFixed(4),
      CENTER,
    ]);
    const moves = [0, 1].map(() => {
      next();
      return [zoom(), ...markerCenter()];
    });
    expect(moves).toEqual([
      [zoomed, ...CENTER],
      [zoomed, ...CENTER],
    ]);

    pan();
    expect(follow().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(follow());
    expect([follow().getAttribute("aria-pressed"), zoom(), markerCenter()]).toEqual(["true", zoomed, CENTER]);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect([follow().getAttribute("aria-pressed"), zoom()]).toEqual(["false", 1]);
    fireEvent.click(follow());
    expect([follow().getAttribute("aria-pressed"), zoom(), markerCenter()]).toEqual(["true", followed, CENTER]);
  });

  it("keeps the character centered on every frame while it walks", async () => {
    await mount();
    act(() => stores.playback.seekStep(2));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      act(() => stores.playback.play());
      const frames = [0, 1, 2, 3].map(() => {
        act(() => {
          vi.advanceTimersToNextFrame();
        });
        return [transform(), ...markerCenter()];
      });
      expect([new Set(frames.map(([pan]) => pan)).size, ...frames.map(([, x, y]) => [x, y])]).toEqual([4, CENTER, CENTER, CENTER, CENTER]);
    } finally {
      act(() => stores.playback.pause());
      vi.useRealTimers();
    }
  });

  it("zooms about the character after it has moved from where following began", async () => {
    await mount();
    next();
    const followed = zoom();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect([(zoom() / followed).toFixed(4), markerCenter()]).toEqual([(1 / 1.5).toFixed(4), CENTER]);
  });

  it("stops moving the camera after a pan while the character walks on", async () => {
    await mount();
    pan();
    const panned = transform();
    next();
    next();
    expect([follow().getAttribute("aria-pressed"), transform()]).toEqual(["false", panned]);
  });

  it("keeps the user's zoom when following resumes before the character moves", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    const zoomed = zoom();
    pan();
    fireEvent.click(follow());
    expect([follow().getAttribute("aria-pressed"), zoom(), markerCenter()]).toEqual(["true", zoomed, CENTER]);
  });

  it("recenters on the current marker rather than the last automatic target", async () => {
    await mount();
    next();
    pan();
    fireEvent.click(follow());
    expect(markerCenter()).toEqual(CENTER);
  });

  it("lets Follow resume after a pan made before the character has a place", async () => {
    await start(undefined, `#group G\n#name Late\nstep\n.vendor\n${FOLLOW.slice(FOLLOW.indexOf("step"))}`);
    await waitFor(() => expect(viewport()).not.toBeNull());
    pan();
    const panned = transform();
    next();
    expect([follow().getAttribute("aria-pressed"), follow().hasAttribute("disabled"), transform()]).toEqual(["false", false, panned]);
    fireEvent.click(follow());
    expect([follow().getAttribute("aria-pressed"), markerCenter()]).toEqual(["true", CENTER]);
  });

  it("opens following after a Focus on map press in Edit", async () => {
    await renderPlanner({
      initial: { guides: [{ id: "g", order: 0, text: FOLLOW }], session: { guideId: "g", step: 0, line: null } },
      builtins: null,
      loadGameData: () => Promise.resolve(plannerData()),
    });
    fireEvent.click((await screen.findAllByRole("button", { name: /Talk to Innkeeper Farley/ }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Focus on map" }));
    await screen.findByText("Innkeeper Farley: 1 location in Elwynn Forest");
    fireEvent.click(screen.getByRole("button", { name: "Playback" }));
    await screen.findByRole("img", { name: "Character" });
    expect(follow().getAttribute("aria-pressed")).toBe("true");
    expect(follow().hasAttribute("disabled")).toBe(false);
    expect(markerCenter()).toEqual(CENTER);
  });

  it("ends a feature card's Show when Follow resumes, with the playhead still", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Innkeeper Farley: Innkeepers" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Innkeeper Farley" })).getByRole("button", { name: /^Show on map:/ }));
    expect(document.querySelector(".focus-caption")?.textContent).toBe("Innkeeper Farley: Elwynn Forest 43.80, 65.80");
    fireEvent.click(follow());
    expect(document.querySelector(".focus-caption")).toBeNull();
    expect(markerCenter()).toEqual(CENTER);
  });

  it("discards a revealed location on resume so toggling off keeps the view", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Innkeeper Farley: Innkeepers" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Innkeeper Farley" })).getByRole("button", { name: /^Show on map:/ }));
    expect(follow().getAttribute("aria-pressed")).toBe("false");
    const revealed = transform();
    fireEvent.click(follow());
    expect(markerCenter()).toEqual(CENTER);
    expect(transform()).not.toBe(revealed);
    fireEvent.click(follow());
    fireEvent.click(follow());
    const resumed = transform();
    fireEvent.click(follow());
    expect(follow().getAttribute("aria-pressed")).toBe("false");
    expect(transform()).toBe(resumed);
  });
});

describe("Playback inside maps", () => {
  const { interiors, surfaces } = interiorsFixture();
  const hall: Interior = {
    ...interiors.interiors[0]!,
    id: "fargodeep-mine-210351",
    label: "Fargodeep Mine",
    bounds: { north: -9711.2, south: -9879.88, west: 230.61, east: 50.88 },
  };
  const loadWorldMap = () => {
    const loaded = new Map<Interior, SurfaceMap>();
    return Promise.resolve<LoadedWorldMap>({
      ...worldMap,
      interiors: {
        list: [hall],
        image: async (path) => `blob:${path}`,
        surfaces: async (interior) => loaded.set(interior, fromSurfaces(interior, surfaces)).get(interior)!,
        loadedSurfaces: (interior) => loaded.get(interior),
      },
    });
  };
  const box = () => screen.queryByRole("group", { name: "Fargodeep Mine" });
  const zoomOut = (times: number) => {
    for (let i = 0; i < times; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  };

  it("shows the inside map of the interior that holds the character after the view zooms out past it", async () => {
    await mount(loadWorldMap);
    expect(box()).not.toBeNull();
    zoomOut(4);
    expect(follow().getAttribute("aria-pressed")).toBe("true");
    expect(box()).not.toBeNull();
    next();
    next();
    next();
    expect(box()).toBeNull();
  });
});

describe("Playback coordinate readout", () => {
  it("shows only the cursor row, with its label for screen readers only", async () => {
    await mount();
    const terms = within(document.querySelector<HTMLElement>(".coord-readout")!).getAllByRole("term");
    expect(terms.map((t) => [t.textContent, t.className])).toEqual([["Cursor", "sr-only"]]);
  });
});

describe("Playback quest spots", () => {
  it("shows the step's quest-spot pins with no add menu, since Playback cannot edit the guide", async () => {
    const text = "#group G\n#name Spots\nstep\n.goto Elwynn Forest,40,80\n.accept 176\n";
    const spot = () => screen.getByRole("button", { name: /Wanted Poster \(Elwynn Forest 24\.6, 74\.7\)/ });
    await mount(undefined, text, true);
    fireEvent.contextMenu(spot());
    screen.getByRole("menuitem", { name: "Add .goto" });
    cleanup();

    await mount(undefined, text);
    const pin = spot();
    expect([pin.getAttribute("aria-label"), pin.getAttribute("aria-haspopup")]).toEqual([
      'Starts Wanted:  "Hogger": Wanted Poster (Elwynn Forest 24.6, 74.7)',
      null,
    ]);
    fireEvent.click(pin);
    fireEvent.contextMenu(pin);
    expect(screen.queryByRole("menuitem", { name: "Add .goto" })).toBeNull();
  });
});

describe("Playback layers", () => {
  it("hides the mob markers with the Mobs layer off, and shares the choice with Routes", async () => {
    await mount();
    const shown = !!document.querySelector(".mob-layer");
    fireEvent.click(await screen.findByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mobs and respawns" }));
    expect([shown, document.querySelector(".mob-layer"), stores.routeSettings.getState().layers.mobs]).toEqual([true, null, false]);
  });
});
