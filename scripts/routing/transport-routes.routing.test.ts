import { describe, expect, it } from "vitest";
import { TILE_PIXELS, TILE_WORLD_UNITS } from "../../src/routing/artifact.ts";
import type { NativeFrame, MapPoint, Point } from "../../src/routing/frame.ts";
import { DEFAULT_LEG } from "../../src/routing/plan.ts";
import { groundLabel, rideLabel, rideTime, summarizeLeg } from "../../src/routing/result.ts";
import {
  groundSeconds,
  legRides,
  placeTransports,
  routeTransport,
  transportSteps,
  tripRides,
  usableLinks,
  type GroundBound,
  type GroundLeg,
  type TransportAccess,
  type TransportLeg,
} from "../../src/routing/transport.ts";
import { installedTransports } from "../dataset/local.ts";

const frame = (map: number, origin: [number, number]): NativeFrame => ({
  scope: { map },
  frame: { origin, size: [64, 64], tilePixels: TILE_PIXELS, cellsPerTile: 128, tileWorldUnits: TILE_WORLD_UNITS },
});
const file = await installedTransports();
const all = placeTransports(file, [frame(0, [23, 20]), frame(1, [0, 0])]);
const links = all.filter((l) => l.mode !== "flight");
const placed = (id: string) => all.flatMap((l) => [l.from, l.to]).find((s) => s.id === id)!;
const stop = (id: string): MapPoint => ({ map: placed(id).map, point: placed(id).point });
const link = (from: string, to: string) => links.find((l) => l.from.id === from && l.to.id === to)!;

const alliance: TransportAccess = { faction: "Alliance", otherFaction: false, class: "WARRIOR", race: "Human" };
const horde: TransportAccess = { faction: "Horde", otherFaction: false, class: "WARRIOR", race: "Orc" };

const ISLANDS: Record<string, string> = {
  DOCK_RUTTHERAN: "teldrassil",
  PORTAL_RUTTHERAN_DARNASSUS: "teldrassil",
  TAXI_27: "teldrassil",
  PORTAL_DARNASSUS_RUTTHERAN: "darnassus",
};
const DETOUR = 1.6;
const YARDS_PER_PIXEL = TILE_WORLD_UNITS / TILE_PIXELS;
const near = (p: Point, [dx, dy]: Point): Point => [p[0] + dx, p[1] + dy];

function stubGround(speed: number, places: Record<string, string> = {}) {
  const land = new Map<string, string>();
  for (const l of all) for (const s of [l.from, l.to]) land.set(`${s.map}:${s.point}`, ISLANDS[s.id] ?? `map ${s.map}`);
  for (const [key, island] of Object.entries(places)) land.set(key, island);
  const calls: string[] = [];
  const ground: GroundLeg = async (from, to) => {
    calls.push(`${from.point}>${to.point}`);
    if (land.get(`${from.map}:${from.point}`) !== land.get(`${to.map}:${to.point}`)) return { result: { kind: "no-path" } };
    const distance = Math.hypot(from.point[0] - to.point[0], from.point[1] - to.point[1]) * YARDS_PER_PIXEL;
    return { result: { kind: "straight", points: [from.point, to.point], distance, activation: 0, seconds: (DETOUR * distance) / speed } };
  };
  return { ground, calls };
}

const walks = (leg: TransportLeg) => leg.parts.reduce((sum, p) => sum + (p.kind === "ground" ? groundSeconds(p.result)! : 0), 0);
const rideAverages = (leg: TransportLeg) => leg.parts.reduce((sum, p) => sum + (p.kind === "ride" ? p.link.seconds.average : 0), 0);
const walk = expect.stringMatching(/^walk /);

const steps = (leg: TransportLeg | undefined) =>
  leg?.parts.map((p) =>
    p.kind === "ride"
      ? `${p.link.service}: ${p.link.from.id} > ${p.link.to.id}`
      : `walk ${(p.result as { seconds: number }).seconds.toFixed(1)} s`,
  );

describe("the transport file", () => {
  it("joins every ride to two stops, with the times of its record", () => {
    expect(links).toHaveLength(56);
    expect(all.length - links.length).toBe(288 + 2 * 66);
    const ship = link("DOCK_STORMWIND", "DOCK_AUBERDINE_STORMWIND");
    expect(ship.service).toBe("ship-stormwind-auberdine");
    const record = file.links.find((l) => l.from === "DOCK_STORMWIND" && l.to === "DOCK_AUBERDINE_STORMWIND")!;
    expect(ship.seconds).toEqual(record.seconds);
  });

  it("gives each character the rides of its faction, class, and race, and neutral rides to all", () => {
    const services = (access: TransportAccess) =>
      [...new Set(usableLinks(links, access).flatMap((l) => (l.mode === "elevator" ? [] : [l.service])))].sort();
    const elevators = (access: TransportAccess) => usableLinks(links, access).filter((l) => l.mode === "elevator").length;
    expect([elevators(alliance), elevators(horde)]).toEqual([22, 22]);
    expect(services(horde)).toEqual([
      "access-stormwind-wizards-sanctum",
      "ship-bootybay-ratchet",
      "ship-steamwheedle-powderfuse",
      "transition-ruttheran-darnassus",
      "zeppelin-orgrimmar-gromgol",
      "zeppelin-orgrimmar-undercity",
      "zeppelin-undercity-gromgol",
    ]);
    expect(services(alliance)).not.toContain("zeppelin-orgrimmar-undercity");
    expect(services(alliance)).not.toContain("druid-moonglade-ruttheran");
    expect(services({ ...alliance, class: "DRUID", race: "NightElf" })).toContain("druid-moonglade-ruttheran");
    expect(services({ ...alliance, otherFaction: true })).toContain("zeppelin-orgrimmar-undercity");
    expect(services({ ...alliance, otherFaction: true })).not.toContain("druid-moonglade-thunderbluff");
  });
});

describe("routeTransport", () => {
  it("routes Stormwind to Darnassus by the ship to Auberdine, the ferry to Rut'theran, and the portal", async () => {
    const from = stop("TRAM_STORMWIND");
    const to = { map: 1, point: near(stop("PORTAL_DARNASSUS_RUTTHERAN").point, [30, 0]) };
    const { ground, calls } = stubGround(7, { [`1:${to.point}`]: "darnassus" });
    const leg = await routeTransport(from, to, usableLinks(links, alliance), 7, ground);
    expect(steps(leg)).toEqual([
      walk,
      "ship-stormwind-auberdine: DOCK_STORMWIND > DOCK_AUBERDINE_STORMWIND",
      walk,
      "ship-auberdine-ruttheran: DOCK_AUBERDINE_RUTTHERAN > DOCK_RUTTHERAN",
      walk,
      "transition-ruttheran-darnassus: PORTAL_RUTTHERAN_DARNASSUS > PORTAL_DARNASSUS_RUTTHERAN",
      "walk 7.1 s",
    ]);
    expect(leg!.seconds).toBeCloseTo(walks(leg!) + rideAverages(leg!), 6);
    expect(calls).toHaveLength(8);
    const summary = summarizeLeg(leg!);
    expect(summary.label).toBe("Ship to Auberdine, then Ship to Rut'theran Village Harbor, then Portal to Darnassus");
    expect(summary.measure?.basis).toBe("estimate");
  });

  it("finds the same way with fewer ground legs when a ground bound is tighter than the straight line", async () => {
    const from = stop("TRAM_STORMWIND");
    const to = { map: 1, point: near(stop("PORTAL_DARNASSUS_RUTTHERAN").point, [30, 0]) };
    const places = { [`1:${to.point}`]: "darnassus" };
    const plain = stubGround(7, places);
    const bounded = stubGround(7, places);
    const exactStubBound: GroundBound = async (a, b) => {
      const { result } = await stubGround(7, places).ground(a, b, { first: false, last: false });
      return groundSeconds(result) ?? Infinity;
    };
    const expected = await routeTransport(from, to, usableLinks(links, alliance), 7, plain.ground);
    const leg = await routeTransport(from, to, usableLinks(links, alliance), 7, bounded.ground, Infinity, undefined, exactStubBound);
    expect(steps(leg)).toEqual(steps(expected));
    expect(leg!.seconds).toBeCloseTo(expected!.seconds, 9);
    expect(bounded.calls.length).toBeLessThan(plain.calls.length);
  });

  it("takes a Horde zeppelin for an Alliance character only with the other faction's rides", async () => {
    const from = stop("ZEPPELIN_TIRISFAL_ORGRIMMAR");
    const to = stop("ZEPPELIN_ORGRIMMAR_TIRISFAL");
    const services = async (access: TransportAccess) => {
      const leg = await routeTransport(from, to, usableLinks(links, access), 7, stubGround(7).ground);
      return leg?.parts.flatMap((p) => (p.kind === "ride" ? [p.link.service] : []));
    };
    expect(await services(alliance)).toEqual(["ship-southshore-loop"]);
    expect(await services({ ...alliance, otherFaction: true })).toEqual(["zeppelin-orgrimmar-undercity"]);
    expect(await services(horde)).toEqual(["zeppelin-orgrimmar-undercity"]);
  });

  it("opens the Alliance tram to a Horde character only on a leg with the other faction's rides", async () => {
    expect(links.filter((l) => l.mode === "tram").map((l) => l.requires)).toEqual([{ faction: "Alliance" }, { faction: "Alliance" }]);
    const from = stop("TRAM_STORMWIND");
    const to = stop("TRAM_IRONFORGE");
    const rides = tripRides(links, { faction: "Horde", class: "WARRIOR", race: "Orc" });
    const services = async (otherFaction: boolean) => {
      const { ground } = stubGround(7);
      const direct = ((await ground(from, to, { first: true, last: true })).result as { seconds: number }).seconds;
      const leg = await routeTransport(from, to, legRides(rides, { ...DEFAULT_LEG, otherFaction }), 7, ground, direct);
      return leg?.parts.flatMap((p) => (p.kind === "ride" ? [p.link.service] : []));
    };
    expect(await services(false)).toBeUndefined();
    expect(await services(true)).toEqual(["tram-stormwind-ironforge"]);
  });

  it("opens a neutral boat to both factions", async () => {
    const from = stop("DOCK_BOOTYBAY");
    const to = stop("DOCK_RATCHET");
    for (const access of [alliance, horde]) {
      const leg = await routeTransport(from, to, usableLinks(links, access), 7, stubGround(7).ground);
      expect(steps(leg)).toEqual(["walk 0.0 s", "ship-bootybay-ratchet: DOCK_BOOTYBAY > DOCK_RATCHET", "walk 0.0 s"]);
      expect(leg!.seconds).toBe(link("DOCK_BOOTYBAY", "DOCK_RATCHET").seconds.average);
    }
  });

  it("keeps the ground route when a fast mode beats the ride", async () => {
    const from = stop("DOCK_MENETHIL");
    const to = stop("DOCK_SOUTHSHORE");
    const at = async (speed: number) => {
      const { ground } = stubGround(speed);
      const direct = (await ground(from, to, { first: true, last: true })).result as { seconds: number };
      return {
        direct: direct.seconds,
        leg: await routeTransport(from, to, usableLinks(links, alliance), speed, ground, direct.seconds),
      };
    };
    const run = await at(7);
    const ship = run.leg!.seconds;
    expect(ship).toBe(rideAverages(run.leg!));
    expect(ship).toBeLessThan(run.direct);
    const epic = await at(14);
    expect(epic.direct).toBeLessThan(ship);
    expect(epic.leg).toBeUndefined();
  });

  it("routes a placeholder ride at its source cost, and shows its time as TBD", async () => {
    const leg = await routeTransport(
      stop("DOCK_FEATHERMOON"),
      stop("DOCK_FORGOTTENCOAST"),
      usableLinks(links, alliance),
      7,
      stubGround(7).ground,
    );
    const ride = leg!.parts.find((p) => p.kind === "ride")!;
    expect(ride.kind === "ride" && ride.link.placeholder).toBe(true);
    expect(leg!.seconds).toBe(link("DOCK_FEATHERMOON", "DOCK_FORGOTTENCOAST").seconds.average);
    expect(ride.kind === "ride" && [rideLabel([ride.link]), rideTime([ride.link])]).toEqual([
      "Ship to Forgotten Coast Harbor",
      { cost: "TBD" },
    ]);
    expect(summarizeLeg(leg!).provenance).toBe(
      "Terrain and rides, each ride at its average wait; a ride time is TBD, so the leg counts its placeholder",
    );
  });

  it("lifts a stop to its own level, and counts an elevator at its average time", async () => {
    const top = stop("elevator-thunder-bluff-west-1:top");
    const { height } = placed("elevator-thunder-bluff-west-1:top");
    expect(height).toBeDefined();
    const [from, to] = [
      { map: 1, point: near(stop("elevator-thunder-bluff-west-1:bottom").point, [20, 0]) },
      { map: 1, point: near(top.point, [-20, 0]) },
    ];
    const mesa = Object.fromEntries([to.point, top.point, stop("elevator-thunder-bluff-west-2:top").point].map((p) => [`1:${p}`, "mesa"]));
    const { ground } = stubGround(7, { ...mesa, [`1:${from.point}`]: "map 1" });
    const heights: (number | undefined)[] = [];
    const leg = await routeTransport(from, to, usableLinks(links, horde), 7, (start, end, ends) => {
      heights.push(start.height, end.height);
      return ground(start, end, ends);
    });
    expect(steps(leg)).toEqual([
      "walk 4.8 s",
      "elevator-thunder-bluff-west-1: elevator-thunder-bluff-west-1:bottom > elevator-thunder-bluff-west-1:top",
      "walk 4.8 s",
    ]);
    const lift = link("elevator-thunder-bluff-west-1:bottom", "elevator-thunder-bluff-west-1:top");
    const part = leg!.parts[1]!;
    expect(part.kind === "ride" && rideLabel([part.link])).toBe("Elevator to Thunder Bluff (top)");
    expect(leg!.seconds - walks(leg!)).toBeCloseTo(lift.seconds.average, 6);
    expect(heights).toContain(height);
    expect(summarizeLeg(leg!).provenance).toBe("Terrain and rides, each ride at its average wait");
  });

  it("finds no way between maps without a ride that joins them", async () => {
    const route = (rides: typeof links) =>
      routeTransport(stop("DOCK_STORMWIND"), stop("ZEPPELIN_ORGRIMMAR_TIRISFAL"), rides, 7, stubGround(7).ground);
    const joined = await route(usableLinks(links, horde));
    expect(joined?.parts.flatMap((p) => (p.kind === "ride" ? [p.link.service] : []))).toEqual(["zeppelin-orgrimmar-gromgol"]);
    expect(await route(usableLinks(links, horde).filter((l) => l.mode !== "zeppelin" && l.mode !== "ship"))).toBeUndefined();
  });
});

describe("flight paths", () => {
  const services = (leg: TransportLeg | undefined) => leg?.parts.flatMap((p) => (p.kind === "ride" ? [p.link.service] : []));
  const fly = (from: string, to: string, access: TransportAccess, rides = usableLinks(all, access)) =>
    routeTransport(stop(from), stop(to), rides, 7, stubGround(7).ground);

  it("flies Stormwind to Ironforge, and reads as one flight step at its estimate", async () => {
    const leg = await fly("FLIGHT_2", "FLIGHT_6", alliance);
    expect(steps(leg)).toEqual([
      "walk 0.0 s",
      "FLIGHT_2: FLIGHT_2 > FLIGHT_2:air",
      "FLIGHT_PATH_13: FLIGHT_2:air > FLIGHT_6:air",
      "FLIGHT_6: FLIGHT_6:air > FLIGHT_6",
      "walk 0.0 s",
    ]);
    expect(leg!.seconds).toBeCloseTo(257.83, 6);
    const flight = transportSteps(leg!.parts)[1]!;
    expect(flight.kind === "ride" && [rideLabel(flight.links), rideTime(flight.links)]).toEqual([
      "Fly to Ironforge",
      { cost: "4 min 18 s", note: "Estimate from the flight length" },
    ]);
    expect(groundLabel("Run", flight.kind === "ride" ? flight.links[0] : undefined, "")).toBe("Run to the flight master");
    expect(summarizeLeg(leg!).label).toBe("Fly to Ironforge");
  });

  it("takes off once on a flight that passes other flight points", async () => {
    const leg = await fly("FLIGHT_2", "FLIGHT_74", alliance);
    expect(services(leg)).toEqual(["FLIGHT_2", "FLIGHT_PATH_427", "FLIGHT_PATH_410", "FLIGHT_74"]);
    const rides = leg!.parts.flatMap((p) => (p.kind === "ride" ? [p.link] : []));
    expect(rides.filter((l) => l.to.air && !l.from.air)).toHaveLength(1);
    expect(rides.filter((l) => l.from.air && l.to.air).length).toBeGreaterThan(1);
    expect(leg!.seconds).toBeCloseTo(walks(leg!) + rideAverages(leg!), 6);
    expect(transportSteps(leg!.parts).map((s) => s.kind)).toEqual(["ground", "ride", "ground"]);
  });

  it("flies from a Horde flight point only for a Horde character, or with the other faction's rides", async () => {
    const orgrimmar = ["FLIGHT_23", "FLIGHT_PATH_47", "FLIGHT_25"];
    expect(services(await fly("FLIGHT_23", "FLIGHT_25", horde))).toEqual(orgrimmar);
    expect(services(await fly("FLIGHT_23", "FLIGHT_25", { ...alliance, otherFaction: true }))).toEqual(orgrimmar);
    expect(services(await fly("FLIGHT_23", "FLIGHT_25", alliance))).toEqual(["FLIGHT_64", "FLIGHT_PATH_465", "FLIGHT_80"]);
  });

  it("flies the estimated Horde flight from Powderfuse Port to Rog'mar, and no Alliance flight from there", async () => {
    const leg = await fly("FLIGHT_3274", "FLIGHT_3203", horde);
    expect(services(leg)).toEqual(["FLIGHT_3274", "FLIGHT_PATH_3274-3203", "FLIGHT_3203"]);
    const flight = transportSteps(leg!.parts)[1]!;
    expect(flight.kind === "ride" && [rideLabel(flight.links), rideTime(flight.links)]).toEqual([
      "Fly to Rog'mar",
      { cost: "43 s", note: "Estimate from the straight line and a nearby flight" },
    ]);
    const undercity = transportSteps((await fly("FLIGHT_3274", "FLIGHT_11", horde))!.parts)[1]!;
    expect(undercity.kind === "ride" && rideTime(undercity.links).note).toBe(
      "Estimate from the flight length, and for one hop from the straight line and a nearby flight",
    );
    const alliances = services(await fly("FLIGHT_3274", "FLIGHT_3203", alliance)) ?? [];
    expect(alliances.filter((s) => s.includes("3274"))).toEqual([]);
    expect(services(await fly("FLIGHT_3274", "FLIGHT_3203", { ...alliance, otherFaction: true }))).toContain("FLIGHT_PATH_3274-3203");
  });

  it("opens a flight between two neutral flight points to both factions", async () => {
    for (const access of [alliance, horde])
      expect(services(await fly("FLIGHT_559", "FLIGHT_3242", access))).toEqual(["FLIGHT_559", "FLIGHT_PATH_11524", "FLIGHT_3242"]);
  });
});
