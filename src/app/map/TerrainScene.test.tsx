// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { worldMap } from "../../data/terrainFixture.ts";
import { StoresContext } from "../context.ts";
import { createStores } from "../stores.ts";
import { MapCanvas, type Frame } from "./MapCanvas.tsx";
import { MapView } from "./view.ts";
import { DEFAULT_MAP_SETTINGS, MapSettingsStore } from "./mapSettings.ts";
import { TerrainMarkers } from "./TerrainScene.tsx";
import { placeFeatures, type TerrainFeatures } from "./terrain.ts";
import { canvasSize } from "./viewport.ts";

const map = { ...worldMap, canvas: { left: 0, width: 1000, height: 500 }, places: [], pois: [], routes: [] };
const base = placeFeatures(worldMap).pois.find((p) => p.category.key === "innkeeper")!;
const poi = (name: string, id: number, x: number, y = 50): TerrainFeatures["pois"][number] => ({
  ...base,
  poi: { ...base.poi, name, area: "eastern-kingdoms", side: 1, entity: { type: "npc", id } },
  at: { x, y },
});
const features: TerrainFeatures = {
  pois: [
    poi("Innkeeper Farley", 295, 25),
    poi("Innkeeper Brianna", 6727, 75),
    poi("Amisi Azuregaze", 28687, 18.8),
    poi("Afsaneh Asrar", 32411, 18.65),
    poi("Innkeeper Heather", 8931, 22.6, 57.4),
    poi("Innkeeper Allison", 6740, 17.9, 45),
  ],
  places: [],
  routes: [],
};
const frame: Frame = { left: 20, top: 45, width: 10, height: 10 };
const distant: Frame = { ...frame, left: 70 };

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width: 1000, height: 500 }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(marked: TerrainFeatures["pois"] = [], onPick = (_poi: typeof base.poi) => {}) {
  const stores = createStores();
  const mapView = new MapView();
  const canvas = (fit: Frame, shown: TerrainFeatures) => (
    <StoresContext.Provider value={stores}>
      <MapCanvas
        mapView={mapView}
        aspect={2}
        maxZoom={() => 40}
        scene={() => null}
        overlay={(view, pxPerPercent, openMenu) => (
          <div
            onContextMenu={(e) => {
              const button = e.target instanceof Element ? e.target.closest("button") : null;
              if (!button) return;
              e.preventDefault();
              e.stopPropagation();
              openMenu({ title: "Marker actions", items: [{ label: "Choose marker", run: () => {} }] }, button);
            }}
          >
            <TerrainMarkers
              map={map}
              features={shown}
              shows={() => true}
              marked={{ pois: marked, places: [] }}
              onPick={onPick}
              frame={view}
              pxPerPercent={pxPerPercent}
            />
          </div>
        )}
        pins={[]}
        shapes={[]}
        areas={[]}
        spawns={[]}
        label="Map"
        describe={() => ""}
        menu={() => undefined}
        view={{ fit }}
      />
    </StoresContext.Provider>
  );
  const view = render(canvas(frame, features));
  return { pan: (fit: Frame, shown = features) => view.rerender(canvas(fit, shown)) };
}

const button = (name: string) => screen.getByRole("button", { name });
const rowName = "2 markers: Amisi Azuregaze, Afsaneh Asrar";

describe("terrain marker viewport", () => {
  it("culls distant controls, keeps complete boundary groups and vertical padding, and restores controls after pan", () => {
    const { pan } = mount();
    expect(button("Innkeeper Farley: Innkeepers").className).toContain("poi");
    expect(screen.queryByRole("button", { name: "Innkeeper Brianna: Innkeepers" })).toBeNull();
    expect(button(rowName).getAttribute("aria-label")).toBe(rowName);
    expect(button("Innkeeper Heather: Innkeepers").className).toContain("poi");
    expect(button("Innkeeper Allison: Innkeepers").textContent).toBe("Innkeeper Allison");
    pan({ ...frame, left: 20.05 });
    expect(button(rowName).getAttribute("aria-label")).toBe(rowName);
    pan(distant);
    expect(button("Innkeeper Brianna: Innkeepers").className).toContain("poi");
    expect(screen.queryByRole("button", { name: "Innkeeper Farley: Innkeepers" })).toBeNull();
    expect(screen.queryByRole("button", { name: rowName })).toBeNull();
    pan(frame);
    expect(button(rowName).getAttribute("aria-label")).toBe(rowName);
    expect(button("Innkeeper Farley: Innkeepers").className).toContain("poi");
  });

  it("keeps a marked group and its unmarked members outside the viewport", () => {
    const { pan } = mount([features.pois[2]!]);
    pan(distant);
    const row = button(rowName);
    expect(row.closest(".poi-group")?.classList.contains("marked")).toBe(true);
    act(() => row.focus());
    expect(button("Amisi Azuregaze: Innkeepers").classList.contains("marked")).toBe(true);
    expect(button("Afsaneh Asrar: Innkeepers").classList.contains("marked")).toBe(false);
  });

  it("keeps keyboard focus and Escape return while a different row is hovered and the map pans", async () => {
    const user = userEvent.setup();
    const { pan } = mount();
    const near = button("Innkeeper Farley: Innkeepers");
    const row = button(rowName);
    act(() => near.focus());
    fireEvent.pointerEnter(row.closest(".poi-group")!);
    pan(distant);
    expect(document.activeElement).toBe(near);
    expect(button(rowName)).toBe(row);
    fireEvent.pointerLeave(row.closest(".poi-group")!);
    expect(screen.queryByRole("button", { name: rowName })).toBeNull();
    expect(button("Innkeeper Farley: Innkeepers")).toBe(near);
    pan(frame);
    act(() => button(rowName).focus());
    await user.keyboard("{ArrowDown}");
    const leader = button("Amisi Azuregaze: Innkeepers");
    expect(document.activeElement).toBe(leader);
    pan(distant);
    expect(document.activeElement).toBe(leader);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(button(rowName));
    expect(button(rowName).getAttribute("aria-expanded")).toBe("true");
  });

  it("retains the activated control after focus moves elsewhere", () => {
    const picked: string[] = [];
    const { pan } = mount([], (p) => picked.push(p.name));
    const near = button("Innkeeper Farley: Innkeepers");
    fireEvent.click(near);
    act(() => button("Zoom in").focus());
    pan(distant);
    expect(picked).toEqual(["Innkeeper Farley"]);
    expect(button("Innkeeper Farley: Innkeepers")).toBe(near);
    fireEvent.click(button("Innkeeper Brianna: Innkeepers"));
    expect(screen.queryByRole("button", { name: "Innkeeper Farley: Innkeepers" })).toBeNull();
    expect(picked).toEqual(["Innkeeper Farley", "Innkeeper Brianna"]);
  });

  it("keeps an open row's list beside its row as a marker joins the row and as the map pans", () => {
    const { pan } = mount();
    const row = button(rowName);
    const list = document.querySelector<HTMLElement>(".map-viewport > .poi-list")!;
    let rowAt = { x: 100, y: 100, width: 20, height: 20 };
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this === row ? rowAt : { width: 1000, height: 500 });
    });
    Object.defineProperties(list, { scrollHeight: { get: () => list.children.length * 100 }, offsetWidth: { value: 200 } });
    const placed = () => [list.style.top, list.style.left, list.style.maxHeight];
    fireEvent.pointerEnter(row.closest(".poi-group")!);
    expect(placed()).toEqual(["120px", "100px", "200px"]);

    const joined = { ...features, pois: [...features.pois, poi("Innkeeper Janene", 6272, 18.7)] };
    pan(frame, joined);
    expect(row.getAttribute("aria-label")).toBe("3 markers: Amisi Azuregaze, Afsaneh Asrar, Innkeeper Janene");
    expect(placed()).toEqual(["120px", "100px", "300px"]);

    rowAt = { x: 300, y: 300, width: 20, height: 20 };
    pan({ ...frame, left: 20.05 }, joined);
    expect(placed()).toEqual(["4px", "300px", "296px"]);
  });

  it("throws when a marker row renders outside a MapCanvas", () => {
    expect(() =>
      render(
        <StoresContext.Provider value={createStores()}>
          <TerrainMarkers
            map={map}
            features={features}
            shows={() => true}
            marked={{ pois: [], places: [] }}
            onPick={() => {}}
            frame={{ left: 0, top: 0, width: 100, height: 100 }}
            pxPerPercent={100}
          />
        </StoresContext.Provider>,
      ),
    ).toThrow("useMapView needs a MapCanvas");
  });

  it.each(["Innkeeper Farley: Innkeepers", rowName])(
    "retains the right-click menu anchor %s and returns focus with Escape after pan",
    async (name) => {
      const user = userEvent.setup();
      const { pan } = mount();
      const anchor = button(name);
      fireEvent.contextMenu(anchor);
      expect(screen.getByRole("menu", { name: "Marker actions" }).textContent).toContain("Choose marker");
      pan(distant);
      expect(button(name)).toBe(anchor);
      await user.keyboard("{Escape}");
      expect(document.activeElement).toBe(anchor);
      expect(screen.queryByRole("menu")).toBeNull();
      pan(frame);
      expect(button(name)).toBe(anchor);
    },
  );
});

describe("terrain marker thresholds", () => {
  it("reveals terrain pins and names at their published thresholds", () => {
    const published = {
      ...worldMap,
      places: [{ ...worldMap.places[1]!, minZoom: 3 }],
      pois: [
        { ...worldMap.pois[0]!, level: 5 },
        { ...worldMap.pois.find((p) => p.category === "dungeon")!, level: 3 },
      ],
      categories: worldMap.categories.map((c) => (c.key === "dungeon" ? { ...c, labelMinZoom: 4 } : c)),
    };
    const placed = placeFeatures(published);
    const stores = { ...createStores(), map: new MapSettingsStore({ ...DEFAULT_MAP_SETTINGS, allFactions: true }) };
    const scene = (level: number) => (
      <StoresContext.Provider value={stores}>
        <TerrainMarkers
          map={published}
          features={placed}
          shows={() => true}
          marked={{ pois: [], places: [] }}
          onPick={() => {}}
          frame={{ left: 0, top: 0, width: 100, height: 100 }}
          pxPerPercent={(canvasSize(published).width / 100) * 2 ** (level - published.nativeZoom)}
        />
      </StoresContext.Provider>
    );
    const { container, rerender } = render(scene(2.99));
    expect(container.querySelectorAll(".poi, .place")).toHaveLength(0);
    rerender(scene(3));
    expect(container.querySelectorAll(".place-zone, .poi-instances")).toHaveLength(2);
    expect(container.querySelectorAll(".poi-name")).toHaveLength(0);
    rerender(scene(4));
    expect(container.querySelectorAll(".poi-name")).toHaveLength(1);
    expect(container.querySelectorAll(".poi-services")).toHaveLength(0);
    rerender(scene(5));
    expect(container.querySelectorAll(".poi-services")).toHaveLength(1);
    expect(container.querySelectorAll(".poi-name")).toHaveLength(1);
    rerender(scene(7));
    expect(container.querySelectorAll(".poi-name")).toHaveLength(2);
  });
});

describe("terrain marker order", () => {
  it("draws a named marker after the unnamed markers, so its name paints over them", () => {
    const published = {
      ...worldMap,
      places: [],
      pois: [
        { ...worldMap.pois.find((p) => p.category === "dungeon")!, level: 3 },
        { ...worldMap.pois[0]!, level: 3 },
      ],
      categories: worldMap.categories.map((c) => (c.key === "dungeon" ? { ...c, labelMinZoom: 4 } : c)),
    };
    const stores = { ...createStores(), map: new MapSettingsStore({ ...DEFAULT_MAP_SETTINGS, allFactions: true }) };
    const { container } = render(
      <StoresContext.Provider value={stores}>
        <TerrainMarkers
          map={published}
          features={placeFeatures(published)}
          shows={() => true}
          marked={{ pois: [], places: [] }}
          onPick={() => {}}
          frame={{ left: 0, top: 0, width: 100, height: 100 }}
          pxPerPercent={(canvasSize(published).width / 100) * 2 ** (5 - published.nativeZoom)}
        />
      </StoresContext.Provider>,
    );
    expect([...container.querySelectorAll(".poi")].map((el) => el.className)).toEqual([
      "ui-mark poi poi-services",
      "ui-mark poi poi-instances named",
    ]);
  });
});
