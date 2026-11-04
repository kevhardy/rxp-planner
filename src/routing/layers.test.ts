import type { Point } from "./frame.ts";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadArtifact, type Tile } from "./artifact.ts";
import type { FloorTile } from "./floor.ts";
import { ARTIFACT_DIR, fixturePin } from "./fixtures/repin.ts";
import { flat, TEST_FRAME, whole, withFloor } from "./fixtures/region.ts";
import { flatArtifact } from "./fixtures/synthetic.ts";
import { ROUTER_LAYERS, cellClasses, classColors, layerTile, type RouterLayer } from "./layers.ts";
import { HAZARD, createTerrain, type Terrain, type TerrainRegion, type TileBounds, type TileCache } from "./terrain.ts";

const names = (classes: Uint8Array, layer: RouterLayer, cells: [number, number][]) =>
  cells.map(([x, y]) => ROUTER_LAYERS[layer].classes[classes[y * 128 + x]!]);

describe("router layers of the version 3 fixture tile", () => {
  const terrain = async () => {
    const pin = await fixturePin();
    const load = await loadArtifact(async (path) => new Uint8Array(await readFile(`${ARTIFACT_DIR}${path}`)), pin);
    if (!load.ok) throw new Error(load.reason);
    return createTerrain(load.artifact);
  };
  const cells: [number, number][] = [
    [0, 0], // ground, one layer
    [4, 0], // WMO water without a layer
    [5, 0], // two layers and a ledge
    [4, 1], // a hazard water layer in a hazard swim node
    [7, 0], // the attach cell of door 0
    [9, 1], // the building footprint
    [15, 4], // the attach cell of door 1
    [20, 20], // outside the floor chunks
  ];

  it("gives each floor cell its layer count, water, and building", async () => {
    const ground = await terrain();
    const floors = await layerTile(ground, [9, 22], "floors", 49);
    expect(names(floors, "floors", cells)).toEqual([
      "one layer",
      "no walkable layer",
      "two or more layers",
      "one layer",
      "one layer",
      "no walkable layer",
      "one layer",
      "none",
    ]);
    const water = await layerTile(ground, [9, 22], "water", 49);
    expect(names(water, "water", cells.slice(0, 4))).toEqual(["none", "water", "none", "hazard"]);
    const buildings = await layerTile(ground, [9, 22], "buildings", 49);
    expect(names(buildings, "buildings", [...cells, [8, 1], [10, 5], [11, 8]])).toEqual([
      "none",
      "none",
      "none",
      "none",
      "door",
      "building",
      "door",
      "none",
      "door",
      "building",
      "none",
    ]);
  });

  it("colors each class, and leaves class 0 clear", async () => {
    const floors = await layerTile(await terrain(), [9, 22], "floors", 49);
    const rgba = classColors(floors, "floors");
    const pixel = (x: number, y: number) => [...rgba.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)];
    expect([pixel(0, 0), pixel(4, 0), pixel(20, 20)]).toEqual([
      [40, 200, 90, 130],
      [120, 65, 20, 220],
      [0, 0, 0, 0],
    ]);
  });
});

describe("router layers of a built tile", () => {
  const tile = (): TerrainRegion => flat(128, 128, 1600 / 3 / 128);
  const at = (x: number, y: number) => y * 128 + x;

  it("marks terrain steeper than the slope, and in a floor cell only a descent layer", async () => {
    const region = tile();
    region.slope[at(1, 0)] = 50;
    region.slope[at(2, 0)] = 49;
    region.slope[at(3, 0)] = 60;
    region.slope[at(4, 0)] = 60;
    withFloor(region, { [at(3, 0)]: { layers: [{ height: 0 }] }, [at(4, 0)]: { layers: [{ height: 0, descent: true }] } });
    const row: [number, number][] = [0, 1, 2, 3, 4].map((x) => [x, 0]);
    expect(names(cellClasses(region, [0, 0], "steep", 49), "steep", row)).toEqual(["none", "too steep", "none", "none", "too steep"]);
    expect(names(cellClasses(region, [0, 0], "steep", 50), "steep", row)).toEqual(["none", "none", "none", "none", "too steep"]);
    expect(names(cellClasses(region, [0, 0], "floors", 49), "floors", row)).toEqual(["none", "none", "none", "one layer", "descent"]);
    expect(names(await layerTile(whole(region), [0, 0], "steep", 49), "steep", row)).toEqual([
      "none",
      "too steep",
      "none",
      "none",
      "too steep",
    ]);
  });

  it("marks terrain water and hazards, and in a floor cell only its swim node and layers", () => {
    const region = tile();
    region.water[at(0, 0)] = 5;
    region.blocked[at(1, 0)] = HAZARD;
    region.water[at(2, 0)] = 5;
    withFloor(region, { [at(2, 0)]: { layers: [{ height: 0 }] }, [at(3, 0)]: { layers: [{ height: 0, hazard: true }] } });
    const row: [number, number][] = [0, 1, 2, 3, 4].map((x) => [x, 0]);
    expect(names(cellClasses(region, [0, 0], "water", 49), "water", row)).toEqual(["water", "hazard", "none", "hazard", "none"]);
  });

  it("shades flat ground evenly and lights a slope that faces the north-west", () => {
    const region = tile();
    for (let y = 0; y < 128; y++) for (let x = 64; x < 128; x++) region.elevation[at(x, y)] = (x - 64) * 2;
    region.elevation[at(0, 127)] = Number.NaN;
    const shades = cellClasses(region, [0, 0], "shading", 49);
    const shade = (x: number, y: number) => shades[y * 129 + x];
    expect([shade(10, 10), shade(100, 10), shade(0, 127)]).toEqual([181, 218, 0]);
    expect([shade(127, 10), shade(100, 0), shade(128, 10)]).toEqual([218, 218, 0]);
  });

  const tiled = (world: TerrainRegion): Terrain => {
    const bounds = ([[px, py] = [0, 0]]: readonly Point[], margin: number): TileBounds => {
      const span = (v: number, tiles: number) => [
        Math.max(0, Math.floor((v - margin) / 512)),
        Math.min(tiles - 1, Math.floor((v + margin) / 512)),
      ];
      const [x0 = 0, x1 = 0] = span(px, world.width / 128),
        [y0 = 0, y1 = 0] = span(py, world.height / 128);
      return { tile: [x0, y0], cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
    };
    return {
      frame: TEST_FRAME,
      bounds,
      region: async (points, margin) => {
        const { tile, cols, rows } = bounds(points, margin);
        const part = flat(cols * 128, rows * 128, world.spacing);
        for (let y = 0; y < part.height; y++)
          for (let x = 0; x < part.width; x++)
            part.elevation[y * part.width + x] = world.elevation[(tile[1] * 128 + y) * world.width + tile[0] * 128 + x]!;
        return { ...part, tile };
      },
    };
  };

  it("shades a tile's edges from the next tiles, so the tiles meet in one color at a steep edge and at a corner", async () => {
    const world = flat(256, 256, 1600 / 3 / 128);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) world.elevation[y * 256 + x] = (Math.max(0, x - 127) + Math.max(0, y - 127)) * 10;
    const shades = async (tile: Tile) => {
      const classes = await layerTile(tiled(world), tile, "shading", 49);
      expect(classes).toHaveLength(129 * 129);
      return (x: number, y: number) => classes[y * 129 + x];
    };
    const [nw, ne, sw, se] = await Promise.all([shades([0, 0]), shades([1, 0]), shades([0, 1]), shades([1, 1])]);
    expect([nw(126, 10), nw(127, 10), nw(128, 10), ne(0, 10), ne(1, 10)]).toEqual([181, 214, 187, 187, 187]);
    expect([nw(127, 127), nw(128, 128), ne(0, 128), sw(128, 0), se(0, 0)]).toEqual([247, 224, 224, 224, 224]);
    expect([ne(127, 10), ne(128, 10)]).toEqual([187, 0]);
  });

  it("keeps no more tiles than its cache keeps, with the home tile of a door outside the tiles around the shaded tile", async () => {
    const present: Tile[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) present.push([x, y]);
    const doors: FloorTile = { tile: [2, 1], chunks: [], buildings: [], doorRefs: [{ home: [1, 0], building: 0, door: 0 }], hints: [] };
    const { files, pin } = await flatArtifact(0, [0, 0], [4, 3], present, [doors]);
    const reads: string[] = [];
    const load = await loadArtifact(async (path) => {
      if (path.startsWith("tiles/")) reads.push(path);
      return files.get(path);
    }, pin);
    if (!load.ok) throw new Error(load.reason);
    const cache: TileCache = { keep: 9, tiles: new Map() };
    const terrain = createTerrain(load.artifact, cache);
    await layerTile(terrain, [1, 1], "shading", 49);
    expect(reads).toHaveLength(10);
    reads.length = 0;
    const centre = ([x, y]: Tile): Point => [(x + 0.5) * 512, (y + 0.5) * 512];
    await terrain.region([centre([3, 1])], 0);
    await terrain.region([centre([0, 0])], 0);
    expect([reads, cache.tiles.size]).toEqual([["tiles/0_0.bin"], 9]);
  });
});
