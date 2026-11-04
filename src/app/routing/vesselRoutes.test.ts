import { describe, expect, it } from "vitest";
import type { WorldMapRoute } from "../../data/index.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import type { NativeFrame, Point } from "../../routing/frame.ts";
import type { TransportLink, TransportStop } from "../../routing/transport.ts";
import { ATLAS, lineView, projection, ridePoints, round } from "./lines.ts";
import { vesselPaths } from "./vesselRoutes.ts";

const frame = { tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 } as const;
const easternKingdoms: NativeFrame = { scope: { map: 0 }, frame: { ...frame, origin: [23, 20], size: [23, 42] } };
const kalimdorNearCanvas: NativeFrame = { scope: { map: 1 }, frame: { ...frame, origin: [0, 0], size: [64, 64] } };
const frames = [easternKingdoms, kalimdorNearCanvas];

const stop = (id: string, point: Point, map = 1): TransportStop => ({ id, name: id, map, point });
const link = (service: string, from: TransportStop, to: TransportStop, mode = "ship"): TransportLink => ({
  service,
  mode,
  from,
  to,
  requires: {},
  seconds: { min: 1, average: 1, max: 1 },
});
const route = (points: [number, number][], oneWay?: true): WorldMapRoute => ({
  path: 1,
  vessel: "ship",
  color: 0,
  points,
  ...(oneWay && { oneWay }),
});
const withRoutes = (routes: WorldMapRoute[]) => ({ ...worldMap, routes });

const ratchet = stop("ratchet", [20062, 17349]);
const bootyBay = stop("bootyBay", [4058, 19851], 0);
const toBootyBay = link("booty", ratchet, bootyBay);
const toRatchet = link("booty", bootyBay, ratchet);

describe("vessel routes", () => {
  it("draws a ship along a two-way route in either direction, also for a copy of the link", () => {
    const atlas = vesselPaths(worldMap, frames, [toBootyBay, toRatchet]);
    expect(ridePoints([structuredClone(toBootyBay)], atlas)).toEqual({
      points: [ratchet.point, [20072, 17349.4], [28330, 23250], [36816.4, 28042.6], bootyBay.point],
      maps: [1, ATLAS, ATLAS, ATLAS, 0],
    });
    expect(ridePoints([toRatchet], atlas)).toEqual({
      points: [bootyBay.point, [36816.4, 28042.6], [28330, 23250], [20072, 17349.4], ratchet.point],
      maps: [0, ATLAS, ATLAS, ATLAS, 1],
    });
  });

  it("places each route point on the stage, also in the gap where no map shows it", () => {
    const view = lineView(ridePoints([toBootyBay], vesselPaths(worldMap, frames, [toBootyBay])), projection(worldMap, frames));
    expect(view.map((p) => [round(p.x), round(p.y)])).toEqual([
      [32.6529, 45.7902],
      [32.6805, 45.7913],
      [55.3972, 61.3651],
      [78.7423, 74.0145],
      [78.7687, 74.0155],
    ]);
  });

  it("chains the one-way routes of a loop in travel order, never against a route, and draws straight without the dock that a chain needs", () => {
    const [x, y, z] = [stop("x", [10010, 10000]), stop("y", [12010, 10000]), stop("z", [11010, 12000])];
    const map = withRoutes([
      route(
        [
          [10000, 10000],
          [11000, 9000],
          [12000, 10000],
        ],
        true,
      ),
      route(
        [
          [12000, 10000],
          [12500, 11000],
          [11000, 12000],
        ],
        true,
      ),
      route(
        [
          [11000, 12000],
          [9500, 11000],
          [10000, 10000],
        ],
        true,
      ),
    ]);
    const all = [x, y, z].flatMap((a) => [x, y, z].flatMap((b) => (b === a ? [] : [link("loop", a, b)])));
    const atlas = vesselPaths(map, frames, all);
    expect(ridePoints([link("loop", x, z)], atlas).points).toEqual([
      x.point,
      [10000, 10000],
      [11000, 9000],
      [12000, 10000],
      [12500, 11000],
      [11000, 12000],
      z.point,
    ]);
    expect(ridePoints([link("loop", y, x)], atlas).points).toEqual([
      y.point,
      [12000, 10000],
      [12500, 11000],
      [11000, 12000],
      [9500, 11000],
      [10000, 10000],
      x.point,
    ]);
    const withoutZ = vesselPaths(map, frames, [link("loop", x, y), link("loop", y, x)]);
    expect(ridePoints([link("loop", x, y)], withoutZ).points).toEqual([x.point, [10000, 10000], [11000, 9000], [12000, 10000], y.point]);
    expect(ridePoints([link("loop", y, x)], withoutZ)).toEqual({ points: [y.point, x.point], maps: [1, 1] });
  });

  it("draws a ship straight when its docks are near no route end", () => {
    const [far, farther] = [stop("far", [15000, 5000]), stop("farther", [16000, 5000])];
    const atlas = vesselPaths(worldMap, frames, [toBootyBay, link("other", far, farther)]);
    expect(ridePoints([link("other", far, farther)], atlas)).toEqual({ points: [far.point, farther.point], maps: [1, 1] });
    expect(ridePoints([toBootyBay], atlas).maps).toEqual([1, ATLAS, ATLAS, ATLAS, 0]);
  });

  it("draws a ship straight when two routes carry the same trip", () => {
    const second = route([
      [20072, 17349.4],
      [28000, 26000],
      [36816.4, 28042.6],
    ]);
    const atlas = vesselPaths(withRoutes([...worldMap.routes, second]), frames, [toBootyBay]);
    expect(ridePoints([toBootyBay], atlas)).toEqual({ points: [ratchet.point, bootyBay.point], maps: [1, 0] });
    expect(ridePoints([toBootyBay], vesselPaths(withRoutes([second]), frames, [toBootyBay])).points).toEqual([
      ratchet.point,
      [20072, 17349.4],
      [28000, 26000],
      [36816.4, 28042.6],
      bootyBay.point,
    ]);
  });
});
