import { beforeAll, describe, expect, it } from "vitest";
import { mapToWorld, type GameData, type WorldMapData } from "../../data/index.ts";
import { terrainFixture } from "../../data/terrainFixture.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { terrainSurface } from "./surfaces.ts";
import { groupMarkers, placeFeatures, showsSide, tileZoom, visibleTiles, zoomLevel, type PlacedPoi } from "./terrain.ts";
import { canvasSize, canvasToView } from "./viewport.ts";

let data: GameData;
let map: WorldMapData;

beforeAll(async () => {
  data = plannerData();
  map = structuredClone(terrainFixture);
});

const firstStep = (body: string) => parseGuide(`#group T\n#name One\nstep\n${body}\n`).steps[0]!;
const ELWYNN = 1429;
const ZEPHRAS = 2521;
const DARKSPEAR = 2524;

describe("terrain tiles", () => {
  it("picks the stored zoom that is at least as sharp as the screen", () => {
    expect(zoomLevel(map, 1)).toBe(map.nativeZoom);
    expect(tileZoom(map, 1)).toBe(map.nativeZoom);
    expect(tileZoom(map, 0.5)).toBe(map.nativeZoom - 1);
    expect(tileZoom(map, 0.3)).toBe(map.nativeZoom - 1);
    expect(tileZoom(map, 4)).toBe(map.nativeZoom);
    expect(tileZoom(map, 1 / 1024)).toBe(map.minZoom);
  });

  it("lists the stored tiles a frame shows, placed on the stage", () => {
    const all = visibleTiles(map, map.minZoom, { left: 0, top: 0, width: 100, height: 100 });
    const stored = map.areas.reduce((n, a) => n + (a.tiles[map.minZoom] ?? []).reduce((m, [, first, last]) => m + last - first + 1, 0), 0);
    expect(all).toHaveLength(stored);
    for (const t of all) {
      expect(t.left).toBeGreaterThanOrEqual(-t.width);
      expect(t.left).toBeLessThan(100);
      expect(t.top).toBeGreaterThanOrEqual(0);
      expect(t.top).toBeLessThan(100);
    }
    const ek = map.areas.find((a) => a.key === "eastern-kingdoms")!;
    const size = canvasSize(map);
    const frame = {
      left: ((ek.canvasX + 2000 - size.left) / size.width) * 100,
      top: ((ek.canvasY + 4000) / size.height) * 100,
      width: 4,
      height: 4,
    };
    const some = visibleTiles(map, map.nativeZoom, frame);
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(80);
    expect(new Set(some.map((t) => t.area))).toEqual(new Set(["eastern-kingdoms"]));
  });
});

describe("terrain markers", () => {
  it("hides NPCs friendly only to the other faction, unless every faction shows", () => {
    const [alliance, horde, neutral] = ([1, 2, 0] as const).map((side) => ({
      ...map.pois[0]!,
      side,
      entity: { type: "npc" as const, id: 1 },
    }));
    const ship = map.pois.find((p) => p.category === "zeppelin" && p.side === 2)!;
    expect([alliance, horde, neutral, ship].map((p) => showsSide(p!, "Alliance", false))).toEqual([true, false, true, true]);
    expect([alliance, horde, neutral].map((p) => showsSide(p!, "Horde", false))).toEqual([false, true, true]);
    expect([alliance, horde].map((p) => showsSide(p!, "Horde", true))).toEqual([true, true]);
  });

  it("puts markers closer than an icon on screen in the row of the first", () => {
    const [template] = placeFeatures(map).pois;
    const at = (x: number, y = 0): PlacedPoi => ({
      ...template!,
      poi: { ...template!.poi, name: `${x},${y}` },
      at: canvasToView(map, { x, y }),
    });
    const pois = [at(0), at(15), at(30), at(100), at(0, 19), at(105, 5)];
    const names = (k: number) => groupMarkers(map, pois, k).map((row) => row.map((p) => p.poi.name));
    expect(names(1)).toEqual([["0,0", "15,0", "0,19"], ["30,0"], ["100,0", "105,5"]]);
    expect(names(0.1)).toEqual([pois.map((p) => p.poi.name)]);
    expect(names(4)).toEqual(pois.map((p) => [p.poi.name]));
  });
});

describe("surfaces", () => {
  const cache = () => new WeakMap();

  it("fits the maps the terrain shows, and no map off its art", () => {
    const terrain = terrainSurface(data, map, cache());
    expect(terrain.fitMap(ZEPHRAS)).toBeDefined();
    expect(terrain.fitMap(DARKSPEAR)).toBeUndefined();

    const kalimdor = terrain.fitMap(1414)!;
    expect("left" in kalimdor && kalimdor.left).toBe(0);
    const elwynn = terrain.fitMap(ELWYNN)!;
    expect("left" in elwynn && elwynn.width).toBeGreaterThan(5);
  });

  it("follows continent points to the zone under them and reports points off the art", () => {
    const terrain = terrainSurface(data, map, cache());
    const placed = terrain.place(firstStep(".goto 1415/0,-1258.63,-10513.89\n.goto 2524,50,50"));
    expect(placed.points).toHaveLength(1);
    expect(terrain.mapOf(placed.points[0]!)).toBe(1431);
    expect(terrain.describe(placed.points[0]!)).toMatch(/^Duskwood \d+\.\d\d, \d+\.\d\d$/);
    expect(placed.problems.map((p) => p.message)).toEqual(["The terrain map does not show Darkspear Islands."]);
    expect(placed.points[0]!.at).toEqual(terrain.project(placed.points[0]!));
  });

  it("projects outline points past the terrain art's edges, as it projects locations on it", () => {
    const elwynn = data.zoneByUiMapId(ELWYNN)!;
    const terrain = terrainSurface(data, map, cache());
    const world = { instance: 0, ...mapToWorld(elwynn.bounds!, 50, 50) };
    const inside = { uiMapId: ELWYNN, x: 50, y: 50, world };
    const at = terrain.projectOutline(world)!;
    expect(at.x).toBeCloseTo(terrain.project(inside)!.x, 9);
    expect(at.y).toBeCloseTo(terrain.project(inside)!.y, 9);
    expect(terrain.projectOutline({ ...world, instance: 99 })).toBeUndefined();
    const far = { ...world, x: world.x - 1e6 };
    expect(terrain.project({ ...inside, world: far })).toBeUndefined();
    expect(terrain.projectOutline(far)!.x).toBeGreaterThan(100);
  });
});
