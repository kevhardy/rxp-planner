import { describe, expect, it, vi } from "vitest";
import { syntheticScope } from "./fixtures/synthetic.ts";
import type { ArtifactManifest, HeightTile, LiquidChunk, Tile } from "./artifact.ts";
import { gridZone, loadZoneBorders, OCEAN, zoneBorders, zoneGrid } from "./zones.ts";

function smallGrid() {
  const manifest: Pick<ArtifactManifest, "scope" | "frame" | "tiles" | "zones"> = {
    scope: syntheticScope(),
    frame: { origin: [30, 30], size: [2, 2], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles: [
      { tile: [0, 0], state: "present" },
      { tile: [1, 0], state: "present" },
      { tile: [0, 1], state: "missing" },
    ],
    zones: [1426, 1432],
  };
  const bytes = new Uint8Array(8 + 2 * 256);
  bytes.set(new TextEncoder().encode("RXRZ"));
  bytes[4] = 1;
  bytes[6] = 2;
  for (let i = 0; i < 256; i++) [bytes[8 + i], bytes[8 + 256 + i]] = [2, i % 16 < 8 ? 1 : 2];
  bytes[8 + 256 + 5 * 16 + 3] = 0;
  return zoneGrid(manifest, bytes);
}

describe("gridZone", () => {
  it("gives the zone of the chunk that holds a native position", () => {
    const grid = smallGrid();
    const at = (x: number, y: number) => gridZone(grid, [x, y]);
    expect([at(511.99, 0), at(512, 0), at(767.99, 511.99), at(768, 0)]).toEqual([1432, 1426, 1426, 1432]);
    expect([at(512 + 96, 160), at(512 + 95.99, 160), at(512 + 96, 192)]).toEqual([0, 1426, 1426]);
    expect([at(100, 600), at(600, 512), at(1024, 0), at(600, -0.01)]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("zoneBorders", () => {
  it("draws no border at a chunk without a zone or at the edge of a present tile, and joins touching edges", () => {
    expect(zoneBorders(smallGrid())).toEqual([
      [
        [512, 0],
        [512, 512],
      ],
      [
        [768, 0],
        [768, 512],
      ],
    ]);
  });

  const coast = () => {
    const bytes = new Uint8Array(8 + 2 * 256);
    bytes.set(new TextEncoder().encode("RXRZ"));
    bytes[4] = 1;
    bytes[6] = 2;
    for (let cy = 0; cy < 16; cy++)
      for (let cx = 0; cx < 32; cx++) bytes[8 + (cx >> 4) * 256 + cy * 16 + (cx % 16)] = cy >= 8 && cx >= 24 ? 0 : cx < 12 ? 1 : 2;
    const grid = zoneGrid(
      {
        scope: syntheticScope(),
        frame: { origin: [30, 30], size: [2, 1], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
        tiles: [
          { tile: [0, 0], state: "present" },
          { tile: [1, 0], state: "present" },
        ],
        zones: [1426, 1432],
      },
      bytes,
    );
    const ocean = (cx: number, cy: number) => cy >= 8 || ((cy === 3 || cy === 4) && cx >= 8 && cx < 16);
    return { grid, ocean };
  };
  const landBorder = [
    [
      [384, 0],
      [384, 352],
    ],
  ];

  it("draws a border across water between the land of both zones, but not across the open sea", () => {
    const { grid, ocean } = coast();
    expect(zoneBorders(grid, ocean)).toEqual(landBorder);
    expect(zoneBorders(grid)).toEqual([
      [
        [384, 0],
        [384, 512],
      ],
    ]);
  });

  it("reads the open sea from the ocean liquid of the tiles near a border", async () => {
    const { grid, ocean } = coast();
    const FULL = (1n << 64n) - 1n;
    const liquid = (cx: number, cy: number, type: number, mask: bigint): LiquidChunk => ({
      chunk: [cx, cy],
      type,
      surface: 0,
      mask,
      hazard: "water",
    });
    const tile = (at: Tile): HeightTile => {
      const liquids: LiquidChunk[] = [];
      for (let cy = 0; cy < 16; cy++)
        for (let cx = 0; cx < 16; cx++) {
          const x = at[0] * 16 + cx;
          if (ocean(x, cy)) liquids.push(liquid(cx, cy, OCEAN, FULL));
          else if (cy === 6 && x >= 8 && x < 16) liquids.push(liquid(cx, cy, 1240, FULL));
          else if (cy === 7 && x >= 8 && x < 16) liquids.push(liquid(cx, cy, OCEAN, (1n << 31n) - 1n));
        }
      return { tile: at, offset: 0, scale: 1, heights: new Uint16Array(129 * 129), holes: new Uint8Array(128 * 128), liquids };
    };
    const read = vi.fn((at: Tile) => Promise.resolve(tile(at)));
    expect(await loadZoneBorders({ ...grid, read })).toEqual(landBorder);
    expect(read.mock.calls).toEqual([[[0, 0]]]);
  });
});
