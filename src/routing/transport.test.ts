import type { MapPoint } from "./frame.ts";
import { describe, expect, it } from "vitest";
import type { RideRequirements } from "../../packages/data-contract/transports.ts";
import { TILE_PIXELS, TILE_WORLD_UNITS } from "./artifact.ts";
import {
  groundSeconds,
  legRides,
  routeTransport,
  usableLinks,
  type GroundBound,
  type GroundLeg,
  type TransportAccess,
  type TransportLeg,
  type TransportLink,
  type TransportStop,
} from "./transport.ts";

const stop = (id: string, x: number, y: number, air = false): TransportStop => ({
  id,
  name: id,
  map: 0,
  point: [x, y],
  ...(air && { air: true as const }),
});
const ride = (service: string, mode: string, from: TransportStop, to: TransportStop, average: number, requires: RideRequirements = {}) =>
  ({ service, mode, from, to, requires, seconds: { min: average, average, max: average } }) satisfies TransportLink;
const at = (x: number, y: number): MapPoint => ({ map: 0, point: [x, y] });

const warrior: TransportAccess = { faction: "Alliance", otherFaction: false, class: "WARRIOR", race: "Human" };
const services = (links: readonly TransportLink[]) => links.map((l) => l.service);
const rides = (leg: TransportLeg | undefined) => leg?.parts.flatMap((p) => (p.kind === "ride" ? [p.link.service] : []));

const DETOUR = 1.6;
function stubGround(speed: number) {
  const calls: string[] = [];
  const ground: GroundLeg = async (from, to) => {
    calls.push(`${from.point}>${to.point}`);
    const distance = Math.hypot(from.point[0] - to.point[0], from.point[1] - to.point[1]) * (TILE_WORLD_UNITS / TILE_PIXELS);
    return { result: { kind: "straight", points: [from.point, to.point], distance, activation: 0, seconds: (DETOUR * distance) / speed } };
  };
  return { ground, calls };
}

describe("usableLinks", () => {
  it("keeps unknown ride modes without inheriting ride settings", () => {
    const links = ["toString", "constructor", "__proto__", "ship"].map((mode) => ride(mode, mode, stop("A", 0, 0), stop("B", 50, 0), 10));
    expect(services(legRides({ links }, { otherFaction: false, flightPaths: false, shipPaths: false }))).toEqual([
      "toString",
      "constructor",
      "__proto__",
    ]);
    expect(services(legRides({ links }, { otherFaction: false, flightPaths: false, shipPaths: true }))).toEqual([
      "toString",
      "constructor",
      "__proto__",
      "ship",
    ]);
  });

  const boat = ride("boat", "ship", stop("A", 0, 0), stop("B", 50, 0), 10);

  it("gives a ride that a class asks for only to that class", () => {
    const druidFlight = ride("druid flight", "druid-flight", stop("C", 0, 10), stop("D", 50, 10), 10, { class: "DRUID" });
    expect(services(usableLinks([boat, druidFlight], warrior))).toEqual(["boat"]);
    expect(services(usableLinks([boat, druidFlight], { ...warrior, class: "DRUID" }))).toEqual(["boat", "druid flight"]);
  });

  it("gives a ride that a race asks for only to that race", () => {
    const portal = ride("portal", "portal", stop("C", 0, 10), stop("D", 50, 10), 2, { race: "NightElf" });
    expect(services(usableLinks([boat, portal], warrior))).toEqual(["boat"]);
    expect(services(usableLinks([boat, portal], { ...warrior, race: "NightElf" }))).toEqual(["boat", "portal"]);
  });
});

describe("routeTransport", () => {
  it("stays in the air past a flight point where the flight does not land", async () => {
    const [north, south] = [stop("NORTH", 0, 0), stop("SOUTH", 0, 400)];
    const [northAir, passAir, southAir] = [
      stop("NORTH:air", 0, 0, true),
      stop("PASS:air", 200, 200, true),
      stop("SOUTH:air", 0, 400, true),
    ];
    const links = [
      ride("take off", "flight", north, northAir, 0),
      ride("first hop", "flight", northAir, passAir, 10),
      ride("second hop", "flight", passAir, southAir, 10),
      ride("land", "flight", southAir, south, 0),
    ];
    const leg = await routeTransport(at(0, 5), at(205, 200), links, 7, stubGround(7).ground);
    expect(rides(leg)).toEqual(["take off", "first hop", "second hop", "land"]);
  });

  it("finds the same way with fewer ground legs when a ground bound is tighter than the straight line", async () => {
    const links = [
      ride("near boat", "ship", stop("NEAR_A", 40, 0), stop("NEAR_B", 460, 0), 20),
      ride("far boat", "ship", stop("FAR_A", 0, 50), stop("FAR_B", 500, 50), 20),
    ];
    const plain = stubGround(7);
    const bounded = stubGround(7);
    const exactBound: GroundBound = async (a, b) => {
      const { result } = await stubGround(7).ground(a, b, { first: false, last: false });
      return groundSeconds(result);
    };
    const expected = await routeTransport(at(0, 0), at(500, 0), links, 7, plain.ground);
    const leg = await routeTransport(at(0, 0), at(500, 0), links, 7, bounded.ground, Infinity, undefined, exactBound);
    expect(rides(expected)).toEqual(["near boat"]);
    expect(rides(leg)).toEqual(["near boat"]);
    expect(leg!.seconds).toBeCloseTo(expected!.seconds, 9);
    expect([bounded.calls.length, plain.calls.length]).toEqual([3, 4]);
  });

  it.each([undefined, 0, 5, Infinity])("refines candidate edges once with a bound of %s", async (lower) => {
    const links = [
      ride("primary", "ship", stop("A", 1, 0), stop("B", 2, 0), 10),
      ride("fallback", "ship", stop("C", 3, 0), stop("D", 4, 0), 20),
      ride("expensive", "ship", stop("E", 6, 0), stop("F", 7, 0), 1000),
    ];
    const bounds: string[] = [];
    const searches: string[] = [];
    const leg = await routeTransport(
      at(0, 0),
      at(5, 0),
      links,
      7,
      async (from, to) => {
        searches.push(`${from.point}>${to.point}`);
        return { result: { kind: "straight", points: [from.point, to.point], distance: 1, activation: 0, seconds: 5 } };
      },
      Infinity,
      undefined,
      async (from, to) => {
        bounds.push(`${from.point}>${to.point}`);
        return to.point[0] === 1 ? lower : undefined;
      },
    );
    expect(rides(leg)).toEqual([lower === Infinity ? "fallback" : "primary"]);
    expect(leg!.seconds).toBe(lower === Infinity ? 30 : 20);
    expect(bounds.filter((key) => key === "0,0>1,0")).toHaveLength(1);
    expect(new Set(bounds).size).toBe(bounds.length);
    expect(new Set(searches).size).toBe(searches.length);
    expect(bounds).not.toContain("0,0>6,0");
    if (lower === Infinity) expect(searches).not.toContain("0,0>1,0");
  });

  it.each([
    { pixels: 1, baseSeconds: 0 },
    { pixels: 100, baseSeconds: 32 },
  ])("matches exhaustive legal paths with directed ground costs at $pixels pixels per segment", async ({ pixels, baseSeconds }) => {
    const [a, b, c, d, air] = [
      stop("A", pixels, 0),
      stop("B", 2 * pixels, 0),
      stop("C", 3 * pixels, 0),
      stop("D", 4 * pixels, 0),
      stop("air", 5 * pixels, 0, true),
    ];
    const all = [
      ride("ship", "ship", a, b, 3),
      ride("takeoff", "flight", b, air, 0),
      ride("landing", "flight", air, d, 2),
      ride("return", "ship", d, a, 0),
      ride("restricted", "ship", c, d, 0, { faction: "Horde" }),
    ];
    const start = stop("start", 0, 0),
      end = stop("end", 6 * pixels, 0);
    for (let mask = 0; mask < 32; mask++) {
      const present = all.filter((_, i) => mask & (1 << i));
      const allowed = present.filter((r) => r.service !== "restricted");
      const cost = (from: MapPoint, to: MapPoint) => {
        const [a, b] = [from.point[0] / pixels, to.point[0] / pixels];
        let seconds = 0;
        for (let x = Math.min(a, b); x < Math.max(a, b); x++) {
          if (x === 2 && mask & 4) return Infinity;
          seconds += baseSeconds + (a < b ? (x + mask) % 3 : 2 + ((x + mask) % 3));
        }
        return seconds;
      };
      const departures = [...new Map(allowed.map((r) => [r.from.id, r.from])).values()];
      const arrivals = new Set(allowed.map((r) => r.to.id));
      const visit = (here: TransportStop, walked: boolean, seen: Set<string>): number => {
        if (here.id === end.id) return 0;
        const key = `${here.id}/${walked}`;
        if (seen.has(key)) return Infinity;
        const next = new Set([...seen, key]);
        const choices = allowed.flatMap((r) => (r.from.id === here.id ? [r.seconds.average + visit(r.to, false, next)] : []));
        if (!walked && !here.air && (here.id === start.id || arrivals.has(here.id)))
          for (const to of [...departures, ...(here.id === start.id ? [] : [end])])
            if (!to.air && to.id !== here.id) choices.push(cost(here, to) + visit(to, true, next));
        return Math.min(Infinity, ...choices);
      };
      const minimum = visit(start, false, new Set());
      for (const direct of [cost(start, end), minimum, 0]) {
        for (const refinement of ["unknown", "zero", "half", "exact"] as const) {
          const result = await routeTransport(
            start,
            end,
            usableLinks(present, warrior),
            7,
            async (from, to) => {
              const seconds = cost(from, to);
              return {
                result: Number.isFinite(seconds)
                  ? { kind: "straight", points: [from.point, to.point], distance: seconds * 7, activation: 0, seconds }
                  : { kind: "no-path" },
              };
            },
            direct,
            undefined,
            async (from, to) =>
              refinement === "unknown" ? undefined : refinement === "zero" ? 0 : cost(from, to) / (refinement === "half" ? 2 : 1),
          );
          expect(result?.seconds, `mask ${mask}, ${refinement}, direct ${direct}`).toBe(minimum < direct ? minimum : undefined);
          if (!result) continue;
          let here: MapPoint = start;
          let sum = 0;
          let walked = false;
          for (const part of result.parts) {
            if (part.kind === "ride") {
              expect(allowed).toContain(part.link);
              expect([part.link.from.map, part.link.from.point]).toEqual([here.map, here.point]);
              here = part.link.to;
              sum += part.link.seconds.average;
              walked = false;
            } else {
              expect(walked).toBe(false);
              expect([part.map, part.from]).toEqual([here.map, here.point]);
              expect(part.from).not.toEqual(air.point);
              expect(part.to).not.toEqual(air.point);
              expect(part.result.kind).toBe("straight");
              sum += cost(here, { map: part.map, point: part.to });
              here = { map: part.map, point: part.to };
              walked = true;
            }
          }
          expect(here).toMatchObject({ map: end.map, point: end.point });
          expect(sum).toBe(minimum);
        }
      }
    }
  });

  it.each(["bound", "search"])("propagates a required ground %s failure", async (where) => {
    const failure = new Error("Required terrain read failed");
    const links = [ride("only", "ship", stop("A", 1, 0), stop("B", 2, 0), 1)];
    await expect(
      routeTransport(
        at(0, 0),
        at(3, 0),
        links,
        7,
        async () => {
          throw failure;
        },
        Infinity,
        undefined,
        async () => {
          if (where === "bound") throw failure;
          return 0;
        },
      ),
    ).rejects.toBe(failure);
  });
});
