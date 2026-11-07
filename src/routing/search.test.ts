import type { Point } from "./frame.ts";
import { describe, expect, it } from "vitest";
import { syntheticScope } from "./fixtures/synthetic.ts";
import { CELLS, TILE_PIXELS, type ArtifactManifest, type HeightTile, type Tile } from "./artifact.ts";
import { SWIM, type Building, type FloorPoint } from "./floor.ts";
import { E, N, S, W, blockRing, flat, native, records, whole, withFloor, type CellSpec, type LayerSpec } from "./fixtures/region.ts";
import { pathLength } from "./indoor.ts";
import type { MovementMode } from "./plan.ts";
import { fallLines } from "./result.ts";
import {
  floodLeg,
  keepStopKeys,
  keptReach,
  routeLeg,
  snapNode,
  stopKeys,
  swimStart,
  type ExpandedCells,
  type LegRequest,
  type LegResult,
  type StopKeys,
  type TerrainRoute,
} from "./search.ts";
import { CELL_SPACING, createTerrain, nativeToCell, nodeRecord, type CellPoint, type Terrain, type TerrainRegion } from "./terrain.ts";

const run: MovementMode = { name: "Run", speed: 7, activation: 0 };
const mount: MovementMode = { name: "Mount", speed: 14, activation: 3 };

const cells = (route: LegResult | undefined) =>
  route?.kind === "route" ? route.points.map((p) => nativeToCell({ tile: [0, 0] }, p)) : undefined;
const asRoute = (result: LegResult) => (result.kind === "route" ? result : undefined);

interface Options extends Partial<LegRequest> {
  downhill?: boolean;
}
async function find(region: TerrainRegion, from: CellPoint, to: CellPoint, maxSlope = 35, mode = run, options: Options = {}) {
  const { downhill = false, ...request } = options;
  return routeLeg(
    whole(region),
    native(from),
    native(to),
    { followTerrain: true, downhill },
    {
      maxSlope,
      mode,
      swimming: { enabled: false, speed: 4.7 },
      ...request,
    },
  );
}
const noPath = { kind: "no-path" };

describe("terrain search", () => {
  it("rejects a steep surface even when walking along its contour", async () => {
    const grid = flat(8, 8, 1);
    grid.elevation.forEach((_, i) => (grid.elevation[i] = Math.floor(i / 8)));
    grid.slope.fill(45);
    expect(await find(grid, [1, 1], [4, 1], 35)).toMatchObject({ kind: "no-path", endpoint: "start" });
    grid.slope.fill(34);
    grid.slope[2 * 8 + 2] = 45;
    grid.slope[1 * 8 + 2] = 45;
    // oxlint-disable-next-line oxc/erasing-op -- row 0, written like rows 2 and 1 above
    grid.slope[0 * 8 + 2] = 45;
    expect(await find(grid, [1, 1], [4, 1], 35)).toMatchObject(noPath);
    expect(await find(grid, [1, 1], [4, 1], 46)).toMatchObject({ kind: "route", distance: 3 });
  });

  it("takes a gap around a barrier and reports independently known distance and activation cost", async () => {
    const grid = flat(5, 3);
    grid.blocked[2] = 1;
    grid.blocked[7] = 1;
    const route = asRoute(await find(grid, [0, 1], [4, 1]));
    expect(cells(route)).toEqual([
      [0, 1],
      [2, 2],
      [4, 1],
    ]);
    expect(route?.distance).toBeCloseTo(2 * Math.hypot(14, 7));
    expect(route?.seconds).toBeCloseTo(2 * Math.hypot(2, 1));
    expect(asRoute(await find(grid, [0, 1], [4, 1], 35, mount))?.seconds).toBeCloseTo(Math.hypot(2, 1) + 3);
    grid.blocked[12] = 1;
    expect(await find(grid, [0, 1], [4, 1])).toEqual(noPath);
  });

  const detour = (points: Point[]): LegResult => ({
    kind: "route",
    points,
    heights: [0, 0, 0],
    descents: [],
    descentDrop: 0,
    falls: [],
    swims: [],
    swimDistance: 0,
    swimSeconds: 0,
    swimRemounts: [],
    distance: 31.304951684997054,
    terrainSeconds: 4.472135954999579,
    activation: 0,
    seconds: 4.472135954999578,
  });

  it("takes the detour below a blocked cell when the detours above and below cost the same", async () => {
    const grid = flat(5, 3);
    grid.blocked[1 * 5 + 2] = 1;
    expect(await find(grid, [0, 1], [4, 1])).toEqual(
      detour([
        [2, 6],
        [10, 10],
        [18, 6],
      ]),
    );
    expect(await find(grid, [4, 1], [0, 1])).toEqual(
      detour([
        [18, 6],
        [10, 10],
        [2, 6],
      ]),
    );
  });

  it("takes the detour right of a blocked cell when the detours left and right cost the same", async () => {
    const grid = flat(3, 5);
    grid.blocked[2 * 3 + 1] = 1;
    expect(await find(grid, [1, 0], [1, 4])).toEqual(
      detour([
        [6, 2],
        [10, 10],
        [6, 18],
      ]),
    );
  });

  it("does not cut corners, snap blocked endpoints, or cross a height discontinuity", async () => {
    const grid = flat(2, 2);
    grid.blocked[1] = 1;
    grid.blocked[2] = 1;
    expect(await find(grid, [0, 0], [1, 1])).toEqual(noPath);
    expect(await find(grid, [-1, 0], [0, 0])).toEqual({ kind: "no-terrain", endpoint: "start" });
    expect(await find(grid, [1, 0], [0, 0])).toEqual({ kind: "no-path", endpoint: "start" });
    grid.blocked.fill(0);
    grid.elevation[3] = 100;
    expect(await find(grid, [0, 0], [1, 1])).toEqual(noPath);
    grid.elevation[1] = 100;
    grid.elevation[2] = 100;
    grid.elevation[3] = 0;
    expect(await find(grid, [0, 0], [1, 1])).toEqual(noPath);
    expect(await find(grid, [0, 0], [0, 0], 35, { ...run, activation: 3 })).toMatchObject({ kind: "route", seconds: 0 });
  });
});

describe("steep stops", () => {
  const ledge = (height: number, spacing = CELL_SPACING) => {
    const grid = flat(4, 1, spacing);
    grid.elevation[3] = height;
    grid.slope[3] = 60;
    return grid;
  };

  it("snaps a stop on steep ground to the walkable cell beside it, and marks the stop", async () => {
    const end = asRoute(await find(ledge(3), [0, 0], [3, 0]));
    expect([cells(end), end?.heights, end?.stops]).toEqual([
      [
        [0, 0],
        [2, 0],
      ],
      [0, 0],
      [{ class: "ground" }, { class: "ground", steep: true }],
    ]);
    expect(asRoute(await find(ledge(3), [3, 0], [0, 0]))?.stops).toEqual([{ class: "ground", steep: true }, { class: "ground" }]);
  });

  it("does not snap a stop on steep ground to a cell more than 5 yd away or 3 yd above or below it", async () => {
    expect(await find(ledge(3, 7), [0, 0], [3, 0])).toEqual({ kind: "no-path", endpoint: "end" });
    expect(await find(ledge(3.5), [0, 0], [3, 0])).toEqual({ kind: "no-path", endpoint: "end" });
    expect(await find(ledge(-3.5), [3, 0], [0, 0])).toEqual({ kind: "no-path", endpoint: "start" });
  });
});

describe("downhill exception", () => {
  it("crosses steep ground only downhill, with no change to default routing", async () => {
    const grid = flat(5, 1);
    grid.elevation.set([60, 50, 30, 10, 0]);
    grid.slope.set([0, 70, 70, 70, 0]);
    expect(await find(grid, [0, 0], [4, 0])).toEqual(noPath);
    const route = asRoute(await find(grid, [0, 0], [4, 0], 35, run, { downhill: true }));
    expect(route).toMatchObject({ descents: [0, 1, 2, 3], descentDrop: 60 });
    expect(route?.seconds).toBeCloseTo((2 * Math.hypot(7, 10) + 2 * Math.hypot(7, 20)) / 7);
    expect(await find(grid, [4, 0], [0, 0], 35, run, { downhill: true })).toEqual(noPath);
    grid.elevation[2] = 55;
    expect(await find(grid, [0, 0], [4, 0], 35, run, { downhill: true })).toEqual(noPath);
    grid.elevation[2] = 50;
    expect(await find(grid, [0, 0], [4, 0], 35, run, { downhill: true })).toEqual(noPath);
  });

  it("keeps holes, hazards, missing heights, and unsafe landing cells blocked", async () => {
    const grid = flat(3, 1);
    grid.elevation.set([50, 25, 0]);
    grid.slope[1] = 70;
    for (const blocked of [1, 2]) {
      grid.blocked[1] = blocked;
      expect(await find(grid, [0, 0], [2, 0], 35, run, { downhill: true })).toEqual(noPath);
    }
    grid.blocked[1] = 0;
    grid.elevation[1] = Number.NaN;
    expect(await find(grid, [0, 0], [2, 0], 35, run, { downhill: true })).toEqual(noPath);
    grid.elevation[1] = 25;
    grid.slope[2] = 70;
    expect(await find(grid, [0, 0], [2, 0], 35, run, { downhill: true })).toMatchObject({ kind: "no-path", endpoint: "end" });
  });

  it("does not use a diagonal to cut through an uphill or blocked corner", async () => {
    const grid = flat(2, 2);
    grid.elevation.set([50, 75, 75, 0]);
    grid.slope.set([0, 70, 70, 0]);
    expect(await find(grid, [0, 0], [1, 1], 35, run, { downhill: true })).toEqual(noPath);
    grid.elevation.set([50, 25, 25, 0]);
    const route = await find(grid, [0, 0], [1, 1], 35, run, { downhill: true });
    expect(cells(route)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(route).toMatchObject({ descents: [0], descentDrop: 50 });
    grid.blocked[1] = 1;
    grid.blocked[2] = 1;
    expect(await find(grid, [0, 0], [1, 1], 35, run, { downhill: true })).toEqual(noPath);
  });
});

describe("surface swimming", () => {
  const swimming = { enabled: true, speed: 3.5 };
  const channel = () => {
    const grid = flat(7, 1);
    grid.water.set([Number.NaN, Number.NaN, 0, 0, 0]);
    grid.elevation.set([0, 0, -30, -80, -10, 0, 0]);
    grid.slope.set([0, 0, 80, 80, 80, 0, 0]);
    return grid;
  };

  it("uses the water surface and charges the land activation after leaving water", async () => {
    const grid = channel();
    expect(await find(grid, [0, 0], [6, 0], 35, mount, { swimming })).toMatchObject({
      distance: 14,
      terrainSeconds: 1,
      swimDistance: 28,
      swimSeconds: 8,
      activation: 3,
      swimRemounts: [{ point: 5, seconds: 3 }],
      seconds: 15,
    });
    expect(await find(grid, [2, 0], [5, 0], 35, mount, { swimming })).toMatchObject({ seconds: 6, activation: 0, swimRemounts: [] });
    expect(await find(grid, [2, 0], [5, 0], 35, mount, { swimming, continues: true })).toMatchObject({ seconds: 9 });
    expect(await find(grid, [2, 0], [2, 0], 35, mount, { swimming })).toMatchObject({ seconds: 0 });
  });

  it("selects faster dry detours instead of the shorter swim", async () => {
    const grid = flat(7, 3);
    for (let x = 1; x < 6; x++) grid.water[7 + x] = 0;
    const slow = await find(grid, [0, 1], [6, 1], 35, run, { swimming: { enabled: true, speed: 0.5 } });
    expect(slow).toMatchObject({ swimDistance: 0 });
    const fast = asRoute(await find(grid, [0, 1], [6, 1], 35, run, { swimming: { enabled: true, speed: 14 } }));
    expect(fast?.seconds).toBe(3);
    expect(fast?.swims).toHaveLength(6);
  });

  it("preserves holes, obstacles, cliff shores, and diagonal safety", async () => {
    const grid = channel();
    expect(await find(grid, [0, 0], [6, 0])).toEqual(noPath);
    for (const blocked of [1, 2]) {
      grid.blocked[3] = blocked;
      expect(await find(grid, [0, 0], [6, 0], 35, run, { swimming })).toEqual(noPath);
    }
    grid.blocked[3] = 0;
    grid.elevation[5] = 50;
    expect(await find(grid, [2, 0], [6, 0], 35, run, { swimming, downhill: true })).toEqual(noPath);
    grid.elevation[5] = 0;
    grid.slope[5] = 70;
    expect(await find(grid, [2, 0], [6, 0], 35, run, { swimming })).toEqual(noPath);
    const corner = flat(2, 2);
    corner.water.fill(0);
    corner.blocked[1] = 1;
    corner.blocked[2] = 1;
    expect(await find(corner, [0, 0], [1, 1], 35, run, { swimming })).toEqual(noPath);
  });
});

describe("swim start", () => {
  const swims = (grid: TerrainRegion, from: CellPoint, enabled = true) =>
    swimStart(whole(grid), native(from), { downhill: false }, { maxSlope: 35, mode: run, swimming: { enabled, speed: 4.7 } });
  const wet = (cell: number) => {
    const grid = flat(3, 3);
    grid.water[cell] = 0;
    return grid;
  };

  it("swims first from water or beside it, only with swimming on", async () => {
    expect(await swims(flat(3, 3), [1, 1])).toBe(false);
    expect(await swims(wet(4), [1, 1])).toBe(true);
    expect(await swims(wet(5), [1, 1])).toBe(true);
    expect(await swims(wet(5), [1, 1], false)).toBe(false);
  });

  it("answers yes when it cannot tell: a side cell not loaded, an unusable start, or no terrain", async () => {
    expect(await swims(flat(3, 3), [0, 1])).toBe(true);
    const blocked = flat(3, 3);
    blocked.blocked[4] = 1;
    expect(await swims(blocked, [1, 1])).toBe(true);
    expect(await swims(flat(3, 3), [5, 5])).toBe(true);
  });

  it("swims first from a building stop through a door with no stored path", async () => {
    const hall: Building = {
      placement: 7,
      box: [0, 0, 511, 511],
      ground: 0,
      floors: [0],
      doors: [{ tile: [0, 0], cell: 1 * CELLS + 2, layer: 0, point: [160, 96, 0] }],
      targets: [],
      paths: [],
    };
    const town = (water: boolean) => {
      const grid = flat(6, 3, CELL_SPACING);
      if (water) grid.water[1 * 6 + 1] = 0;
      return withFloor(grid, { [1 * 6 + 4]: { building: true, layers: [{ height: 20 }] } }, [records([0, 0], { buildings: [hall] })]);
    };
    expect(await swims(town(true), [4, 1])).toBe(true);
    expect(await swims(town(false), [4, 1])).toBe(false);
  });
});

describe("floor search", () => {
  const stairs = () => {
    const cells: Record<number, CellSpec> = {};
    for (let x = 0; x <= 8; x++) {
      const along = (x > 0 ? W : 0) | (x < 8 ? E : 0);
      cells[x] = { layers: [{ height: 31.5 * (1 - x / 8), walk: along | (x === 8 ? S : 0), ...(x === 0 && { drop: S, drops: [31.5] }) }] };
      cells[9 + x] = { layers: [{ height: 0, walk: along | (x === 8 ? N : 0) }] };
    }
    return withFloor(flat(9, 2), cells);
  };
  const stairLength = 8 * Math.hypot(7, 31.5 / 8) + 7 + 56;

  it("takes a damaging drop only when damaging falls are on, and reports the fall", async () => {
    const off = asRoute(await find(stairs(), [0, 0], [0, 1], 35, run, { downhill: true, damagingFalls: false }));
    expect(off?.distance).toBeCloseTo(stairLength);
    expect(off?.falls).toEqual([]);
    const on = await find(stairs(), [0, 0], [0, 1], 35, run, { downhill: true });
    expect(cells(on)).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(on).toMatchObject({ falls: [{ point: 0, height: 31.5 }], descents: [] });
    expect(asRoute(on)?.seconds).toBeCloseTo(Math.hypot(7, 31.5) / 7);
    expect(asRoute(await find(stairs(), [0, 0], [0, 1], 35, run, { downhill: false }))?.distance).toBeCloseTo(stairLength);
  });

  it("filters drops by their stored height, rounded up to 0.5 yd", async () => {
    const ledge = (height: number) => withFloor(flat(1, 2), { 0: { layers: [{ height, drop: S, drops: [height] }] } });
    const fall = (height: number, options: Options) => find(ledge(height), [0, 0], [0, 1], 35, run, { downhill: true, ...options });
    expect(await fall(13, { damagingFalls: false })).toMatchObject({ falls: [{ height: 13 }] });
    expect(await fall(13.5, { damagingFalls: false })).toEqual(noPath);
    expect(await fall(13.125, { damagingFalls: false })).toEqual(noPath);
    expect(await fall(69, {})).toMatchObject({ falls: [{ height: 69 }] });
    expect(await fall(69.5, {})).toEqual(noPath);
    expect(await fall(69.5, { fatalFalls: true })).toMatchObject({ falls: [{ height: 69.5 }] });
    expect(await fall(13, { downhill: false })).toEqual(noPath);
  });

  it("drops into a swim node and swims to the shore", async () => {
    const swimming = { enabled: true, speed: 3.5 };
    const harbor = () => {
      const grid = flat(5, 1);
      grid.water[2] = 0;
      grid.elevation[2] = -5;
      return withFloor(grid, {
        0: { layers: [{ height: 10, drop: E, masks: [SWIM], drops: [0] }] },
        1: { surface: 0 },
        3: { layers: [{ height: 0.5, walk: E, water: true }], surface: 0 },
      });
    };
    expect(await find(harbor(), [0, 0], [4, 0], 35, mount, { downhill: true, swimming })).toEqual({
      kind: "route",
      points: [
        [2, 2],
        [6, 2],
        [10, 2],
        [14, 2],
        [14, 2],
        [18, 2],
      ],
      heights: [10, 0, 0, 0, 0.5, 0],
      descents: [],
      descentDrop: 0,
      falls: [{ point: 0, height: 10 }],
      swims: [1, 2, 3],
      swimDistance: 14.5,
      swimSeconds: 4.142857142857143,
      swimRemounts: [{ point: 4, seconds: 3 }],
      distance: 19.224390039542804,
      terrainSeconds: 1.3731707171102003,
      activation: 3,
      seconds: 11.516027859967343,
    });
    expect(await find(harbor(), [0, 0], [4, 0], 35, mount, { downhill: false, swimming })).toEqual(noPath);
  });

  it("takes a diagonal only when both of its side orders link", async () => {
    const square = (bottom: number) =>
      withFloor(flat(2, 2), {
        0: { layers: [{ height: 0, walk: E | S }] },
        1: { layers: [{ height: 0, walk: W | S }] },
        2: { layers: [{ height: 0, walk: N | (bottom & E) }] },
        3: { layers: [{ height: 0, walk: N | (bottom & W) }] },
      });
    expect(cells(await find(square(E | W), [0, 0], [1, 1]))).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(cells(await find(square(0), [0, 0], [1, 1]))).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it("enters a floor layer from terrain only on the walk bit back, with no rise rule", async () => {
    const step = (walk: number) => withFloor(flat(2, 1), { 1: { layers: [{ height: 20, walk }] } });
    expect(await find(step(0), [0, 0], [1, 0])).toEqual(noPath);
    expect(await find(step(0), [1, 0], [0, 0])).toEqual(noPath);
    expect(await find(step(W), [0, 0], [1, 0])).toMatchObject({ kind: "route" });
    expect(await find(step(W), [1, 0], [0, 0])).toMatchObject({ kind: "route" });
  });

  it("crosses a lava or slime layer only when the setting allows it", async () => {
    const lava = withFloor(flat(3, 1), {
      0: { layers: [{ height: 0, walk: E }] },
      1: { layers: [{ height: 0, walk: W | E, water: true, hazard: true }], surface: 0.5, hazard: true },
      2: { layers: [{ height: 0, walk: W }] },
    });
    expect(await find(lava, [0, 0], [2, 0])).toEqual(noPath);
    expect(await find(lava, [0, 0], [2, 0], 35, run, { hazards: true })).toMatchObject({ kind: "route", distance: 14 });
  });

  it("counts each floor layer and swim node in place of the terrain node of its cell", async () => {
    const region = () => withFloor(flat(CELLS, CELLS), { 0: { layers: [{ height: 0 }, { height: 5 }], surface: 1 }, 1: {} });
    const budget = (cellBudget: number) => find(region(), [5, 5], [6, 5], 35, run, { cellBudget });
    expect(await budget(CELLS * CELLS)).toEqual({ kind: "limit", cells: CELLS * CELLS + 1 });
    expect(await budget(CELLS * CELLS + 1)).toMatchObject({ kind: "route" });
  });

  it("notes missing coverage beside a floor layer only through a link that it can use", async () => {
    const beside = (layer: Omit<LayerSpec, "height">) => {
      const grid = flat(3, 1);
      grid.blocked[0] = 1;
      grid.elevation[0] = Number.NaN;
      grid.coverage = ([x, y]) => (y !== 0 || x < 0 || x > 2 ? undefined : x === 0 ? "missing-coverage" : "present");
      return withFloor(grid, { 1: { layers: [{ height: 40, ...layer }] } });
    };
    const route = (layer: Omit<LayerSpec, "height">, options: Options = {}) => find(beside(layer), [1, 0], [2, 0], 35, run, options);
    expect(await route({})).toEqual(noPath);
    expect(await route({ walk: W })).toMatchObject({ kind: "missing-coverage" });
    expect(await route({ drop: W, drops: [31.5] }, { downhill: true, damagingFalls: false })).toEqual(noPath);
    expect(await route({ drop: W, drops: [31.5] }, { downhill: true })).toMatchObject({ kind: "missing-coverage" });
  });

  it("notes a missing diagonal cell when both side layers step on into it", async () => {
    const corner = (west: number, north: number) => {
      const grid = flat(3, 3);
      grid.blocked[1] = 1;
      grid.elevation[1] = Number.NaN;
      grid.coverage = ([x, y]) => (x < 0 || x > 2 || y < 0 || y > 2 ? undefined : x === 1 && y === 0 ? "missing-coverage" : "present");
      return withFloor(grid, {
        2: { layers: [{ height: 100, walk: S | west }] },
        4: { layers: [{ height: 100, walk: E | north }] },
        5: { layers: [{ height: 0, walk: W | N | S }] },
      });
    };
    expect(await find(corner(W, N), [2, 1], [0, 0])).toMatchObject({ kind: "missing-coverage" });
    expect(await find(corner(0, N), [2, 1], [0, 0])).toMatchObject({ kind: "route", distance: 35 });
  });

  it("keeps a proof that a stop in a cell without a node reaches itself when its side cells have no node either", async () => {
    const grid = blockRing(flat(9, 7), [4, 3], 2);
    const room: CellPoint[] = [
      [4, 3],
      [3, 3],
      [5, 3],
      [4, 2],
      [4, 4],
    ];
    const terrain = whole(withFloor(grid, Object.fromEntries(room.map(([x, y]) => [y * 9 + x, {}]))));
    const stop = native([4, 3]),
      outside = native([0, 3]);
    expect(await routeLeg(terrain, stop, outside, leg, settings)).toEqual(noPath);
    expect(await routeLeg(terrain, outside, stop, leg, settings)).toEqual({ kind: "no-path", endpoint: "end" });
    expect(await routeLeg(terrain, stop, stop, leg, settings)).toMatchObject({ kind: "route", distance: 0 });
    const out = await keptReach(terrain, stop, "from", leg, settings);
    const into = await keptReach(terrain, stop, "to", leg, settings);
    for (const test of [out, into]) {
      expect(await test?.(stop)).toBe(true);
      expect(await test?.(outside)).toBe(false);
    }
  });

  it("closes a pocket that two drops reach when their stored heights pass the fall limit, but their height differences do not", async () => {
    const pocket = (second: number) => {
      const grid = flat(9, 5);
      grid.blocked.fill(1, 1 * 9 + 2, 1 * 9 + 6);
      grid.blocked.fill(1, 3 * 9 + 2, 3 * 9 + 6);
      grid.blocked[2 * 9 + 5] = 1;
      return withFloor(grid, {
        [2 * 9 + 2]: { layers: [{ height: 8, walk: W, drop: E, drops: [5] }] },
        [2 * 9 + 3]: { layers: [{ height: 3, drop: E, drops: [second] }] },
      });
    };
    const fall = (second: number) =>
      routeLeg(
        whole(pocket(second)),
        native([1, 2]),
        native([4, 2]),
        { followTerrain: true, downhill: true },
        { ...settings, damagingFalls: false },
      );
    expect(await fall(9)).toEqual({ kind: "no-path", endpoint: "end" });
    expect(await fall(8)).toEqual({
      kind: "route",
      points: [
        [6, 10],
        [10, 10],
        [14, 10],
        [18, 10],
      ],
      heights: [0, 8, 3, 0],
      descents: [],
      descentDrop: 0,
      falls: [{ point: 1, height: 8 }],
      swims: [],
      swimDistance: 0,
      swimSeconds: 0,
      swimRemounts: [],
      distance: 26.848244185641185,
      terrainSeconds: 3.835463455091598,
      activation: 0,
      seconds: 3.8354634550915976,
    });
  });
});

interface GroundTile {
  offset?: number;
  hole?: (col: number, row: number) => boolean;
}
function tiled(size: Tile, tile: (t: Tile) => GroundTile | "missing" | undefined): Terrain {
  const tiles: ArtifactManifest["tiles"] = [];
  for (let y = 0; y < size[1]; y++)
    for (let x = 0; x < size[0]; x++) {
      const t = tile([x, y]);
      if (t) tiles.push({ tile: [x, y], state: t === "missing" ? "missing" : "present" });
    }
  const manifest: ArtifactManifest = {
    schema: "restedxp-routing-artifact",
    version: 4,
    id: "synthetic",
    scope: syntheticScope(),
    frame: { origin: [0, 0], size, tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles,
    zones: [],
    assets: [],
  };
  return createTerrain({
    manifest,
    read: async (path) => {
      throw new Error(`${path}: not in the artifact`);
    },
    tile: async (at): Promise<HeightTile> => {
      const t = tile(at);
      if (!t || t === "missing") throw new Error("not present");
      return {
        tile: at,
        offset: t.offset ?? 0,
        scale: 1,
        heights: new Uint16Array(129 * 129),
        holes: Uint8Array.from({ length: CELLS * CELLS }, (_, i) => Number(t.hole?.(i % CELLS, Math.floor(i / CELLS)) ?? false)),
        liquids: [],
      };
    },
  });
}
const centre = ([x, y]: Tile): Point => [x * TILE_PIXELS + 256, y * TILE_PIXELS + 256];
const leg = { followTerrain: true, downhill: false };
const settings: LegRequest = { maxSlope: 35, swimming: { enabled: false, speed: 4.7 }, mode: run };
describe("unusable endpoint proofs", () => {
  it.each(["from", "to"] as const)("keeps a proof for an unusable %s stop", async (side) => {
    const grid = flat(3, 1);
    grid.slope[1] = 70;
    const terrain = whole(grid);
    const bad = native([1, 0]),
      other = native([0, 0]);
    const result = await routeLeg(terrain, side === "from" ? bad : other, side === "to" ? bad : other, leg, settings);
    expect(result).toEqual({ kind: "no-path", endpoint: side === "from" ? "start" : "end" });
    const proof = await keptReach(terrain, bad, side, leg, settings);
    expect(await proof?.(other)).toBe(false);
    expect(await keptReach(terrain, bad, side, leg, { ...settings, maxSlope: 80 })).toBeUndefined();
  });

  it("does not keep an endpoint rejection from a region with failed coverage", async () => {
    const grid = flat(3, 1);
    grid.slope[1] = 70;
    grid.failed.push({ tile: [1, 0], reason: "unavailable" });
    const terrain = whole(grid);
    expect(await routeLeg(terrain, native([0, 0]), native([1, 0]), leg, settings)).toEqual({ kind: "no-path", endpoint: "end" });
    grid.failed.length = 0;
    grid.slope[1] = 0;
    expect(await keptReach(terrain, native([1, 0]), "to", leg, settings)).toBeUndefined();
    expect(await routeLeg(terrain, native([0, 0]), native([1, 0]), leg, settings)).toMatchObject({ kind: "route" });
  });

  it("preserves a pair path between targets whose building has no usable doors", async () => {
    const a: FloorPoint = [96, 32, 0],
      b: FloorPoint = [224, 32, 0];
    const building: Building = {
      placement: 1,
      box: [64, 0, 256, 64],
      ground: 0,
      floors: [0],
      doors: [],
      targets: [
        { point: [a[0], a[1]], floor: 0, kind: 0 },
        { point: [b[0], b[1]], floor: 0, kind: 0 },
      ],
      paths: [[a, b]],
    };
    const terrain = whole(withFloor(flat(5, 1), {}, [records([0, 0], { buildings: [building] })]));
    const inside = native([1, 0]),
      peer = native([3, 0]),
      outside = native([0, 0]);
    expect(await routeLeg(terrain, inside, outside, leg, settings)).toEqual({ kind: "no-path", endpoint: "start" });
    expect(await routeLeg(terrain, outside, inside, leg, settings)).toEqual({ kind: "no-path", endpoint: "end" });
    for (const side of ["from", "to"] as const) {
      const proof = await keptReach(terrain, inside, side, leg, settings);
      expect(await proof?.(outside)).toBe(false);
      expect(await proof?.(peer)).toBe(true);
    }
    expect(await routeLeg(terrain, inside, peer, leg, settings)).toMatchObject({ kind: "route", paths: [{ kind: "pair" }] });
  });

  it("does not reject a building target that shares a rejected ground end's node keys", async () => {
    const grid = flat(7, 1);
    grid.elevation.set([20, 10, 0, 0, 0, 0, 0]);
    grid.slope[1] = 70;
    const building: Building = {
      placement: 1,
      box: [256, 0, 320, 64],
      ground: 0,
      floors: [80],
      doors: [{ tile: [0, 0], cell: 1, layer: 0, point: [96, 32, 80] }],
      targets: [{ point: [288, 32], floor: 0, kind: 0 }],
      paths: [
        [
          [96, 32, 80],
          [288, 32, 80],
        ],
      ],
    };
    const terrain = whole(
      withFloor(grid, { 1: { building: true, layers: [{ height: 10, descent: true }] } }, [records([0, 0], { buildings: [building] })]),
    );
    const down = { ...leg, downhill: true };
    const outside = native([0, 0]),
      bad = native([1, 0]),
      target = native([4, 0]);
    expect((await stopKeys(terrain, bad, undefined, down, settings))?.to).toEqual(
      (await stopKeys(terrain, target, undefined, down, settings))?.to,
    );
    expect(await routeLeg(terrain, outside, bad, down, settings)).toEqual({ kind: "no-path", endpoint: "end" });
    const proof = await keptReach(terrain, target, "to", down, settings);
    expect((await proof?.(outside)) ?? true).toBe(true);
    expect(await routeLeg(terrain, outside, target, down, settings)).toMatchObject({ kind: "route" });
  });
});
describe("stop keys", () => {
  const leg = { downhill: false };
  const request = { maxSlope: 35, swimming: { enabled: false } };
  const stop = native([0, 0]);
  const seeded: StopKeys = { from: [1], to: [2] };
  const failedTile: TerrainRegion = { ...flat(1, 1), failed: [{ tile: [0, 0], reason: "offline" }] };

  it.each([
    ["rejects", () => Promise.reject(new Error("offline"))],
    ["has a failed tile", async () => failedTile],
  ])("reads the region again after a read that %s, but keeps keys seeded during that read", async (_, failing) => {
    let reads = 0;
    const terrain: Terrain = { ...whole(flat(1, 1)), region: () => (reads++, failing()) };
    const find = () => stopKeys(terrain, stop, undefined, leg, request).catch(() => undefined);
    await find();
    const pending = find();
    keepStopKeys(terrain, stop, undefined, leg, request, seeded);
    await pending;
    expect(await find()).toBe(seeded);
    expect(reads).toBe(2);
  });
});
const lowest = (route: TerrainRoute | undefined) => Math.max(...(route?.points.map((p) => p[1]) ?? []));
const highest = (route: TerrainRoute | undefined) => Math.min(...(route?.points.map((p) => p[1]) ?? []));

const face = (heights: number[]) => {
  const grid = flat(heights.length + 1, 1);
  grid.elevation.set([...heights, heights.at(-1) ?? 0]);
  const cells: Record<number, CellSpec> = {};
  for (const [x, height] of heights.entries()) {
    const inner = x > 0 && x < heights.length - 1;
    if (inner) grid.slope[x] = 60;
    cells[x] = { layers: [inner ? { height, descent: true } : { height, walk: x ? E : 0 }] };
  }
  return withFloor(grid, cells);
};
const down = (heights: number[], options: Options = {}) =>
  find(face(heights), [0, 0], [heights.length, 0], 35, run, { downhill: true, ...options });

describe("descent layers", () => {
  it("keeps cardinal terrain hops when their diagonal descent would contact a buried floor", async () => {
    const grid = flat(2, 2);
    grid.elevation.set([24, 8.5, 8.5, 0]);
    const region = withFloor(grid, { 3: { layers: [{ height: 8, walk: W | N, buried: true }] } });
    const route = asRoute(await find(region, [0, 0], [1, 1], 35, run, { downhill: true, heights: { from: 24, to: 8 } }));
    expect(route?.kind).toBe("route");
    const path = cells(route);
    expect(path).toHaveLength(3);
    expect(path?.some(([x, y]) => (x === 1 && y === 0) || (x === 0 && y === 1))).toBe(true);
    expect(route?.descents).toEqual([0]);
  });

  it.each(["entry", "exit"])("keeps the cardinal path around a buried diagonal descent %s", async (side) => {
    const entry = side === "entry";
    const region = (buried: boolean) => {
      const grid = flat(4, 3);
      grid.slope[entry ? 10 : 5] = 60;
      return withFloor(grid, {
        ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, {}])),
        4: { layers: [{ height: 32, walk: E }] },
        5: { layers: [{ height: entry ? 32 : 24, walk: entry ? E | S : 0, descent: !entry, buried: entry && buried }] },
        6: { layers: [{ height: entry ? 31.5 : 8.5, walk: entry ? 0 : S }] },
        9: { layers: [{ height: entry ? 31.5 : 8.5, walk: entry ? 0 : E }] },
        10: { layers: [{ height: entry ? 16 : 8, walk: entry ? 0 : E, descent: entry, buried: !entry && buried }] },
        11: { layers: [{ height: 8 }] },
      });
    };
    const options = { downhill: true, heights: { from: 32, to: 8 } };
    const exposed = asRoute(await find(region(false), [0, 1], [3, 2], 35, run, options));
    expect(cells(exposed)).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
      [3, 2],
    ]);
    const route = asRoute(await find(region(true), [0, 1], [3, 2], 35, run, options));
    expect(route?.kind).toBe("route");
    const path = cells(route);
    expect.soft(path?.some(([x, y]) => (x === 2 && y === 1) || (x === 1 && y === 2))).toBe(true);
    const edges = route?.descents.map((i) => [path?.[i], path?.[i + 1]]);
    expect.soft(edges).not.toContainEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it.each(["entry", "exit"])("refuses a buried floor layer at a descent %s while keeping exposed contacts", async (side) => {
    const region = (buried: boolean) => {
      const grid = flat(5, 1);
      grid.slope.set([0, 60, 60, 0, 0]);
      return withFloor(grid, {
        0: { layers: [{ height: 24, buried: buried && side === "entry" }] },
        1: { layers: [{ height: 16, descent: true }] },
        2: { layers: [{ height: 8, descent: true }] },
        3: { layers: [{ height: 0, walk: E, buried: buried && side === "exit" }] },
      });
    };
    const options = { downhill: true, heights: { from: 24, to: 0 } };
    expect(await find(region(false), [0, 0], [4, 0], 35, run, options)).toMatchObject({
      kind: "route",
      descents: [0, 1, 2],
      descentDrop: 24,
    });
    expect(await find(region(true), [0, 0], [4, 0], 35, run, options)).toMatchObject(noPath);
  });

  it("goes down descent layers only with downhill shortcuts, and never climbs them or walks them on the level", async () => {
    const heights = [24, 16, 8, 0];
    expect(await down(heights, { downhill: false })).toEqual(noPath);
    const route = await down(heights);
    expect(cells(route)).toEqual([0, 1, 2, 3, 4].map((x) => [x, 0]));
    expect(route).toMatchObject({ descents: [0, 1, 2], descentDrop: 24, falls: [{ point: 0, height: 24 }] });
    expect(await find(face(heights), [4, 0], [0, 0], 35, run, { downhill: true })).toEqual(noPath);
    const hump = flat(3, 1);
    hump.elevation.set([0, 8, 0]);
    hump.slope[1] = 60;
    const linked = withFloor(hump, {
      0: { layers: [{ height: 0, walk: E }] },
      1: { layers: [{ height: 8, descent: true }] },
      2: { layers: [{ height: 0 }] },
    });
    expect(await find(linked, [0, 0], [2, 0], 35, run, { downhill: true })).toEqual(noPath);
    expect(await down([24, 16, 16, 0])).toEqual(noPath);
    expect(await find(face(heights), [0, 0], [4, 0], 80, run, { downhill: true })).toEqual(noPath);
    expect(await find(face(heights), [0, 0], [4, 0], 80, run, { downhill: false })).toEqual(noPath);
  });

  it("steps from a terrain cell onto a descent layer, and off it onto a terrain cell", async () => {
    const grid = flat(4, 1);
    grid.elevation.set([24, 16, 8, 0]);
    grid.slope.set([0, 60, 60, 0]);
    const region = withFloor(grid, { 1: { layers: [{ height: 16, descent: true }] }, 2: { layers: [{ height: 8, descent: true }] } });
    expect(await find(region, [0, 0], [3, 0], 35, run, { downhill: true })).toMatchObject({ descents: [0, 1, 2], descentDrop: 24 });
    expect(await find(region, [3, 0], [0, 0], 35, run, { downhill: true })).toEqual(noPath);
  });

  it("never snaps a stop near a face onto a descent layer", async () => {
    const layers = (spacing: number) => {
      const region = withFloor(flat(3, 1, spacing), {
        0: { layers: [{ height: 10 }] },
        1: { layers: [{ height: 5, descent: true }] },
        2: { layers: [{ height: 0 }] },
      });
      region.elevation.set([10, 5, 0]);
      return region;
    };
    expect(snapNode(layers(CELL_SPACING), native([1, 0]), 35, false)).toBe(2);
    expect(snapNode(layers(7), native([1, 0]), 35, false)).toBe(-1);
    expect(cells(await find(layers(7), [0, 0], [1, 0]))).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it.each([false, true])("snaps a stop with a height to that layer, including under a roof (%s)", (buried) => {
    const region = withFloor(flat(1, 1, CELL_SPACING), {
      0: { layers: [{ height: 0, buried }, { height: 30, buried }, { height: 60 }] },
    });
    region.elevation[0] = buried ? 60 : 0;
    const level = (node: number) => region.floor!.height[nodeRecord(region, region.floor!, node)];
    expect(level(snapNode(region, native([0, 0]), 35, false))).toBe(0);
    expect(level(snapNode(region, native([0, 0]), 35, false, 60.2))).toBe(60);
  });
});

describe("descent falls", () => {
  it("makes one fall of each run of descent steps, and gates it with the fall settings", async () => {
    const grid = flat(6, 1);
    grid.elevation.set([100, 75, 50, 50, 25, 0]);
    grid.slope.set([0, 80, 0, 0, 80, 0]);
    const route = asRoute(await find(grid, [0, 0], [5, 0], 35, run, { downhill: true }));
    expect(route).toMatchObject({ descents: [0, 1, 3, 4], descentDrop: 100 });
    expect(route?.falls).toEqual([
      { point: 0, height: 50 },
      { point: 3, height: 50 },
    ]);
    const line = { height: "50.0 yd", damage: "~66% HP", fatal: false };
    expect(route && fallLines(route)).toEqual([line, line]);
    expect(await find(grid, [0, 0], [5, 0], 35, run, { downhill: true, damagingFalls: false })).toEqual(noPath);
    expect(await down([24, 16, 8, 0], { damagingFalls: false })).toEqual(noPath);
    expect(await down([100, 50, 0])).toEqual(noPath);
    const fatal = asRoute(await down([100, 50, 0], { fatalFalls: true }));
    expect(fatal?.falls).toEqual([{ point: 0, height: 100 }]);
    expect(fatal && fallLines(fatal)).toEqual([{ height: "100.0 yd", damage: "Fatal", fatal: true }]);
  });

  it("keeps a costlier arrival with a shorter run when the cheaper one cannot go on", async () => {
    const grid = flat(3, 2);
    grid.elevation.set([20, 10, 2, 16, 13, 0]);
    grid.blocked[5] = 1;
    const off = await find(grid, [0, 0], [2, 0], 35, run, { downhill: true, damagingFalls: false });
    expect(cells(off)).toEqual([
      [0, 0],
      [1, 1],
      [1, 0],
      [2, 0],
    ]);
    expect(off).toMatchObject({
      falls: [
        { point: 0, height: 7 },
        { point: 2, height: 8 },
      ],
    });
    const on = await find(grid, [0, 0], [2, 0], 35, run, { downhill: true });
    expect(cells(on)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(on).toMatchObject({ falls: [{ point: 0, height: 18 }] });
  });

  it("makes one fall of a floor drop next to a run of descent steps", async () => {
    const grid = flat(3, 2);
    grid.elevation.set([16, 12, 8, 0, 0, 0]);
    grid.slope[1] = 60;
    grid.blocked[3] = grid.blocked[4] = 1;
    const region = withFloor(grid, {
      0: { layers: [{ height: 16 }] },
      1: { layers: [{ height: 12, descent: true }] },
      2: { layers: [{ height: 8, drop: S, drops: [8] }] },
    });
    const on = await find(region, [0, 0], [2, 1], 35, run, { downhill: true });
    expect(cells(on)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ]);
    expect(on).toMatchObject({ descents: [0, 1], falls: [{ point: 0, height: 16 }] });
    expect(await find(region, [0, 0], [2, 1], 35, run, { downhill: true, damagingFalls: false })).toEqual(noPath);
  });

  it("takes the costlier route around a run that a node opened again makes too long", async () => {
    const grid = flat(7, 4);
    grid.blocked.fill(1);
    const open = [
      [2, 2, 8],
      [0, 2, 16],
      [4, 0, 8],
      [3, 0, 16],
      [5, 0, 0],
    ] as const;
    for (const [x, y, z] of open) {
      grid.blocked[y * 7 + x] = 0;
      grid.elevation[y * 7 + x] = z;
    }
    const unit = pathLength([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const u = Math.sqrt(14 ** 2 - 8 ** 2);
    const p: FloorPoint[] = [
      [0, 0, 64],
      [u / unit, 0, 128],
      [26 / unit, 0, 64],
      [(u + 1) / unit, 0, 128],
    ];
    const building: Building = {
      placement: 1,
      box: [0, 0, 0, 0],
      ground: 0,
      floors: [64, 128],
      doors: open.slice(0, 4).map(([x, y], i) => ({ tile: [0, 0], cell: y * CELLS + x, layer: 0, point: p[i] ?? [0, 0, 0] })),
      targets: [],
      paths: [[p[0]!, p[1]!], [p[0]!, p[2]!], [], [], [p[1]!, p[3]!], []],
    };
    const region = whole(withFloor(grid, {}, [records([0, 0], { buildings: [building] })]));
    const result = await routeLeg(
      region,
      native([2, 2]),
      native([5, 0]),
      { ...leg, downhill: true },
      { ...settings, damagingFalls: false },
    );
    expect(result).toMatchObject({ paths: [{ kind: "doors" }], falls: [{ height: 8 }] });
    expect(cells(result)?.slice(-2)).toEqual([
      [4, 0],
      [5, 0],
    ]);
  });

  it("allows a run under DAMAGE_FALL without damaging falls, and gives it no fall text", async () => {
    const route = asRoute(await down([12, 6, 0], { damagingFalls: false }));
    expect(route).toMatchObject({ descents: [0, 1], descentDrop: 12, falls: [{ point: 0, height: 12 }] });
    expect(route && fallLines(route)).toEqual([]);
  });
});

describe("tiled terrain", () => {
  it("crosses a seam between tiles, and steps down a cliff on a seam only downhill", async () => {
    const level = tiled([2, 1], () => ({}));
    const across = await routeLeg(level, centre([0, 0]), centre([1, 0]), leg, settings);
    expect(asRoute(across)?.distance).toBeCloseTo(128 * CELL_SPACING);
    const cliff = tiled([2, 1], ([x]) => ({ offset: x ? -100 : 0 }));
    expect(await routeLeg(cliff, centre([0, 0]), centre([1, 0]), leg, settings)).toEqual(noPath);
    expect(await routeLeg(cliff, centre([0, 0]), centre([1, 0]), { ...leg, downhill: true }, settings)).toEqual(noPath);
    const down = await routeLeg(cliff, centre([0, 0]), centre([1, 0]), { ...leg, downhill: true }, { ...settings, fatalFalls: true });
    expect(down).toMatchObject({ kind: "route", descentDrop: 100, falls: [{ height: 100 }] });
    expect(asRoute(down)?.descents).toHaveLength(1);
    expect(await routeLeg(cliff, centre([1, 0]), centre([0, 0]), { ...leg, downhill: true }, { ...settings, fatalFalls: true })).toEqual(
      noPath,
    );
  });

  it("reports missing coverage where the search could only continue through it, apart from no path", async () => {
    const gap = (state: "missing" | undefined) => tiled([3, 1], ([x]) => (x === 1 ? state : {}));
    const missing = await routeLeg(gap("missing"), centre([0, 0]), centre([2, 0]), leg, settings);
    expect(missing).toMatchObject({ kind: "missing-coverage", tiles: [{ tile: [1, 0] }] });
    expect(missing.kind === "missing-coverage" && missing.tiles[0]?.at[0]).toBe(TILE_PIXELS + 2);
    expect(await routeLeg(gap(undefined), centre([0, 0]), centre([2, 0]), leg, settings)).toEqual(noPath);
    expect(await routeLeg(gap("missing"), centre([1, 0]), centre([2, 0]), leg, settings)).toMatchObject({ kind: "missing-coverage" });
    expect(await routeLeg(gap(undefined), centre([0, 0]), centre([1, 0]), leg, settings)).toEqual({ kind: "no-terrain", endpoint: "end" });
  });

  it("keeps a detour past missing coverage provisional, because the missing tile could be cheaper", async () => {
    const detour = await routeLeg(
      tiled([3, 2], ([x, y]) => (x === 1 && y === 0 ? "missing" : {})),
      centre([0, 0]),
      centre([2, 0]),
      leg,
      settings,
    );
    const complete = asRoute(
      await routeLeg(
        tiled([3, 2], () => ({})),
        centre([0, 0]),
        centre([2, 0]),
        leg,
        settings,
      ),
    );
    expect(detour).toEqual({
      kind: "missing-coverage",
      tiles: [{ tile: [1, 0], at: [514, 254] }],
      route: {
        kind: "route",
        points: [
          [258, 258],
          [510, 514],
          [1026, 514],
          [1282, 258],
        ],
        heights: [0, 0, 0, 0],
        descents: [],
        descentDrop: 0,
        falls: [],
        swims: [],
        swimDistance: 0,
        swimSeconds: 0,
        swimRemounts: [],
        distance: 1288.812554351608,
        terrainSeconds: 184.11607919308685,
        activation: 0,
        seconds: 184.1160791930877,
      },
    });
    const provisional = detour.kind === "missing-coverage" ? detour.route?.seconds : undefined;
    expect(provisional).toBeGreaterThan((complete?.seconds ?? Infinity) + 10);
  });

  it("gives no path from an enclosed area without loading the whole frame", async () => {
    const ring = (col: number, row: number) => Math.max(Math.abs(col - 64), Math.abs(row - 64)) === 10;
    const terrain = tiled([6, 6], ([x, y]) => (x === 1 && y === 1 ? { hole: ring } : {}));
    const loaded: number[] = [];
    const counting: Terrain = {
      ...terrain,
      region: async (points, margin) => {
        const region = await terrain.region(points, margin);
        loaded.push(region.width * region.height);
        return region;
      },
    };
    expect(await routeLeg(counting, centre([1, 1]), centre([2, 1]), leg, settings)).toEqual(noPath);
    expect(loaded).toEqual([4 * 3 * CELLS * CELLS]);
    loaded.length = 0;
    expect(await routeLeg(counting, centre([2, 1]), centre([1, 1]), leg, settings)).toEqual({ kind: "no-path", endpoint: "end" });
    expect(loaded).toEqual([4 * 3 * CELLS * CELLS]);
  });

  it("answers a later leg from or to an enclosed area from the proof of an earlier leg", async () => {
    const ring = (col: number, row: number) => Math.max(Math.abs(col - 64), Math.abs(row - 64)) === 10;
    const terrain = tiled([6, 6], ([x, y]) => (x === 1 && y === 1 ? { hole: ring } : {}));
    const inside = centre([1, 1]),
      near: Point = [inside[0] + 8, inside[1]];
    const searched: ExpandedCells = new Map();
    const leg2 = async (from: Point, to: Point, request = settings) => {
      const result = await routeLeg(terrain, from, to, leg, request, searched);
      return { result, cells: [...searched.values()].reduce((sum, cells) => sum + cells.reduce((a, b) => a + b, 0), 0) };
    };
    const first = await leg2(inside, centre([2, 1]));
    expect(first.result).toEqual(noPath);
    expect(first.cells).toBeGreaterThan(0);
    expect(await leg2(inside, centre([3, 2]))).toEqual({ result: noPath, cells: 0 });
    expect(await leg2(inside, near)).toMatchObject({ result: { kind: "route" } });
    const end = { kind: "no-path", endpoint: "end" };
    const back = await leg2(centre([2, 1]), inside);
    expect(back.result).toEqual(end);
    expect(back.cells).toBeGreaterThan(0);
    expect(await leg2(centre([3, 2]), inside)).toEqual({ result: end, cells: 0 });
    expect(await leg2(near, inside)).toMatchObject({ result: { kind: "route" } });
    expect((await leg2(inside, centre([3, 2]), { ...settings, maxSlope: 40 })).cells).toBeGreaterThan(0);
    const out = await keptReach(terrain, inside, "from", leg, { ...settings, mode: { name: "Fast", speed: 30, activation: 0 } });
    const into = await keptReach(terrain, inside, "to", leg, settings);
    for (const test of [out, into]) {
      expect(await test?.(centre([4, 4]))).toBe(false);
      expect(await test?.(near)).toBe(true);
    }
    expect(await keptReach(terrain, centre([4, 4]), "from", leg, settings)).toBeUndefined();
    expect(await keptReach(terrain, inside, "from", leg, { ...settings, maxSlope: 30 })).toBeUndefined();
  });

  it("gives no path to or from a basin that only a fall the settings refuse reaches, without loading the whole frame", async () => {
    const basin = (depth: number) => {
      const terrain = tiled([6, 6], ([x, y]) => ({ offset: x === 1 && y === 1 ? -depth : 0 }));
      const loaded: number[] = [];
      const counting: Terrain = {
        ...terrain,
        region: async (points, margin) => {
          const region = await terrain.region(points, margin);
          loaded.push(region.width * region.height);
          return region;
        },
      };
      return { counting, loaded };
    };
    const downhill = { ...leg, downhill: true };
    const off = { ...settings, damagingFalls: false };
    const deep = basin(20);
    expect(await routeLeg(deep.counting, centre([2, 1]), centre([1, 1]), downhill, off)).toEqual({ kind: "no-path", endpoint: "end" });
    expect(await routeLeg(deep.counting, centre([1, 1]), centre([2, 1]), downhill, off)).toEqual(noPath);
    expect(deep.loaded).toEqual([4 * 3 * CELLS * CELLS, 4 * 3 * CELLS * CELLS]);
    expect(await routeLeg(deep.counting, centre([2, 1]), centre([1, 1]), downhill, settings)).toMatchObject({
      kind: "route",
      falls: [{ height: 20 }],
    });
    const shallow = basin(10);
    expect(await routeLeg(shallow.counting, centre([2, 1]), centre([1, 1]), downhill, off)).toMatchObject({
      kind: "route",
      falls: [{ height: 10 }],
    });
  });

  const wall = (open: (row: number) => boolean) =>
    tiled([3, 5], ([x, y]) => (x === 1 ? { hole: (col, row) => col === 64 && !open(y * CELLS + row) } : {}));

  it("enlarges the region when the route leaves it, up to the cell budget", async () => {
    const terrain = wall((row) => row >= 4 * CELLS);
    const route = asRoute(await routeLeg(terrain, centre([0, 0]), centre([2, 0]), leg, settings));
    expect(lowest(route)).toBeGreaterThan(4 * TILE_PIXELS);
    expect(await routeLeg(terrain, centre([0, 0]), centre([2, 0]), leg, { ...settings, cellBudget: 3 * 4 * CELLS * CELLS })).toEqual({
      kind: "limit",
      cells: 3 * 5 * CELLS * CELLS,
    });
  });

  it("leaves the region for a cheaper route than the one inside it, or keeps that route provisional at the budget", async () => {
    const terrain = wall((row) => row === 100 || row === 3 * CELLS + 120);
    const from: Point = [256, 2 * TILE_PIXELS + 100],
      to: Point = [256 + 1024, 2 * TILE_PIXELS + 100];
    const route = asRoute(await routeLeg(terrain, from, to, leg, settings));
    expect(highest(route)).toBeLessThan(TILE_PIXELS);
    const limited = await routeLeg(terrain, from, to, leg, { ...settings, cellBudget: 9 * CELLS * CELLS });
    expect(limited).toMatchObject({ kind: "limit", cells: 15 * CELLS * CELLS, route: { kind: "route" } });
    const provisional = limited.kind === "limit" ? limited.route : undefined;
    expect(highest(provisional)).toBeGreaterThan(TILE_PIXELS);
    expect(provisional?.seconds).toBeGreaterThan((route?.seconds ?? Infinity) + 10);
  });

  it("keeps the cells that each region of a growing search expanded", async () => {
    const terrain = wall((row) => row === 100 || row === 3 * CELLS + 120);
    const from: Point = [256, 2 * TILE_PIXELS + 100],
      to: Point = [256 + 1024, 2 * TILE_PIXELS + 100];
    const expanded: ExpandedCells = new Map();
    const route = asRoute(await routeLeg(terrain, from, to, leg, settings, expanded));
    expect(highest(route)).toBeLessThan(TILE_PIXELS);
    expect([...(expanded.get("1,3") ?? [])].slice(120 * CELLS + 63, 120 * CELLS + 66)).toEqual([1, 1, 1]);
  });
});

describe("straight legs", () => {
  it("estimate horizontal distance without terrain", async () => {
    const terrain = tiled([1, 1], () => undefined);
    const result = await routeLeg(terrain, [0, 0], [300, 400], { followTerrain: false, downhill: true }, { ...settings, mode: mount });
    expect(result).toMatchObject({
      kind: "straight",
      points: [
        [0, 0],
        [300, 400],
      ],
      activation: 3,
    });
    expect(result.kind === "straight" && result.distance).toBeCloseTo((500 * 1600) / 3 / 512);
  });
});

describe("search layers", () => {
  const marked = (cells: ExpandedCells): CellPoint[] => {
    const tile = cells.get("0,0") ?? new Uint8Array();
    return [...tile.keys()].flatMap((i) => (tile[i] ? [[i % CELLS, Math.floor(i / CELLS)]] : []));
  };
  const grid = () => {
    const region = flat(5, 2);
    region.blocked[3] = region.blocked[8] = 1;
    region.slope[1] = 50;
    return region;
  };
  const request = (maxSlope: number): LegRequest => ({ maxSlope, mode: run, swimming: { enabled: false, speed: 4.7 } });

  it("floods each cell that the search can reach from the start, with the search's step rules", async () => {
    const flood = (maxSlope: number) => floodLeg(whole(grid()), native([0, 0]), { downhill: false }, request(maxSlope));
    expect(marked(await flood(35))).toEqual([
      [0, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(marked(await flood(50))).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect((await floodLeg(whole(grid()), native([1, 0]), { downhill: false }, request(35))).size).toBe(0);
  });

  it("gives the cells that a leg's search expanded, without its end", async () => {
    const expanded: ExpandedCells = new Map([["9,9", new Uint8Array()]]);
    const result = await routeLeg(
      whole(grid()),
      native([0, 0]),
      native([2, 0]),
      { followTerrain: true, downhill: false },
      request(35),
      expanded,
    );
    expect(cells(result)).toEqual([
      [0, 0],
      [0, 1],
      [2, 1],
      [2, 0],
    ]);
    expect([...expanded.keys()]).toEqual(["0,0"]);
    expect(marked(expanded)).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });
});
