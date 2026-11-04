import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { rideIcon } from "../../src/app/routing/rideIcons.ts";
import { nativeToWorld, worldToNative, type MapPoint, type Point } from "../../src/routing/frame.ts";
import { routeTrip } from "../../src/routing/journey.ts";
import { createPlan, DEFAULT_MAX_SLOPE, DEFAULT_MODES, DEFAULT_SWIM_SPEED, withHeight } from "../../src/routing/plan.ts";
import { routeLeg, snapNode } from "../../src/routing/search.ts";
import { parseStopTable, STOP_TABLE_FILE } from "../../src/routing/stop-table.ts";
import { nativeToCell, nodeRecord, type TerrainRegion } from "../../src/routing/terrain.ts";
import { groundSeconds, placeTransports, usableLinks, type TransportAccess } from "../../src/routing/transport.ts";
import { DATA_DIR, installedMaps, installedTransports } from "../dataset/local.ts";
import { openInstalled } from "./installed.ts";
import { transportsHash } from "./stop-keys.ts";
import { checkStops } from "./transports.ts";

const file = await installedTransports();
const maps = await installedMaps();
const opened = new Map<number, Awaited<ReturnType<typeof openInstalled>>>();

const alliance: TransportAccess = { faction: "Alliance", otherFaction: false, class: "WARRIOR", race: "Human" };
const horde: TransportAccess = { faction: "Horde", otherFaction: false, class: "WARRIOR", race: "Orc" };

const placed = () =>
  placeTransports(
    file,
    [...opened.values()].map((o) => o.artifact.manifest),
  );

function stop(id: string): MapPoint {
  const { map, point, height } = placed()
    .flatMap((link) => [link.from, link.to])
    .find((s) => s.id === id)!;
  return { map, point, ...(height !== undefined && { height }) };
}

async function trip(from: MapPoint, to: MapPoint, access: TransportAccess, flights = true) {
  const links = placed().filter((link) => flights || link.mode !== "flight");
  const world = ({ map, point, height }: MapPoint) => withHeight(nativeToWorld(opened.get(map)!.terrain.frame, point), height ?? null);
  const plan = createPlan(world(from), world(to), "x");
  plan.settings.modes = [{ ...DEFAULT_MODES.find((m) => m.name === "Epic mount")! }];
  const { journeys } = await routeTrip(plan, (map) => ({ terrain: opened.get(map)!.terrain, groundKey: `map ${map}` }), {
    maxSlope: DEFAULT_MAX_SLOPE,
    rides: { links: usableLinks(links, access) },
  });
  const leg = journeys[0]?.legs[0];
  if (leg?.kind !== "transport") return { kind: leg?.kind };
  return {
    kind: leg.kind,
    rides: leg.parts.flatMap((p) => (p.kind === "ride" ? [`${p.link.from.id}>${p.link.to.id}`] : [])),
    ground: leg.parts.flatMap((p) => (p.kind === "ride" ? [] : [groundSeconds(p.result) ?? Infinity])),
  };
}

describe("the installed transports", () => {
  it("are the ground stops that the stop table was made from", () => {
    const table = parseStopTable(JSON.parse(readFileSync(join(DATA_DIR, STOP_TABLE_FILE), "utf8")));
    const hash = transportsHash(
      file,
      table.maps.map((m) => m.map),
    );
    expect(table.transports, "make it again: delete .local-data/stop-keys.json, then run pnpm data:install").toBe(hash);
  });

  it("give every ride mode an icon of its own", () => {
    const modes = new Set(file.links.map((link) => link.mode));
    expect([...modes].filter((mode) => rideIcon(mode) === "route")).toEqual([]);
  });
});

describe("transport stops on the installed artifacts", () => {
  beforeAll(async () => {
    for (const map of maps) opened.set(map, await openInstalled(map));
  }, 60_000);

  it("puts every stop on a walkable, dry cell", async () => {
    const rows = await checkStops(file);
    expect(rows.filter((row) => row.land !== "walkable")).toEqual([]);
    expect(rows).toHaveLength(file.nodes.filter((n) => !n.air).length);
  }, 120_000);

  it("snaps each stop with a height to a layer within 2 yd of it", async () => {
    const far: string[] = [];
    const inside: string[] = [];
    for (const node of file.nodes.filter((n) => n.height !== undefined)) {
      const map = node.world.instance;
      const { artifact, terrain } = opened.get(map)!;
      const point = worldToNative(artifact.manifest, node.world)!.map(Math.round) as Point;
      const level = layerHeight(await terrain.region([point], 0), point, node.height!);
      if (Number.isNaN(level) && (await meetsBuilding(map, point, node.height!))) inside.push(node.id);
      else if (!(Math.abs(level - node.height!) <= 2)) far.push(`${node.id} ${level.toFixed(1)} vs ${node.height}`);
    }
    expect(far).toEqual([]);
    expect(inside).toEqual(["FLIGHT_22"]);
  });

  it.each([
    ["Booty Bay to Ratchet", "FLIGHT_19", "FLIGHT_80", "DOCK_BOOTYBAY>DOCK_RATCHET"],
    ["Ratchet to Booty Bay", "FLIGHT_80", "FLIGHT_19", "DOCK_RATCHET>DOCK_BOOTYBAY"],
  ])("takes the boat from %s and walks less than 45 s at each end", async (_, from, to, ride) => {
    const leg = await trip(stop(from), stop(to), horde);
    expect(leg.rides).toEqual([ride]);
    for (const seconds of leg.ground ?? []) expect(seconds).toBeLessThan(45);
  });

  it("takes the tram from the Ironforge flight master to Stormwind", async () => {
    const leg = await trip(stop("FLIGHT_6"), stop("FLIGHT_2"), alliance);
    expect(leg.rides).toEqual(["TRAM_IRONFORGE>TRAM_STORMWIND"]);
    expect(leg.ground?.[0]).toBeLessThan(55);
  }, 180_000);

  it("leaves Darnassus by the portal and the Rut'theran boat, or flies from Rut'theran", async () => {
    const [darnassus, auberdine] = [stop("PORTAL_DARNASSUS_RUTTHERAN"), stop("FLIGHT_26")];
    const portal = "PORTAL_DARNASSUS_RUTTHERAN>PORTAL_RUTTHERAN_DARNASSUS";
    expect((await trip(darnassus, auberdine, alliance, false)).rides).toEqual([portal, "DOCK_RUTTHERAN>DOCK_AUBERDINE_RUTTHERAN"]);
    expect((await trip(darnassus, auberdine, alliance)).rides).toEqual([
      portal,
      "FLIGHT_27>FLIGHT_27:air",
      "FLIGHT_27:air>FLIGHT_26:air",
      "FLIGHT_26:air>FLIGHT_26",
    ]);
  }, 240_000);

  it.each([
    ["Thunder Bluff", "elevator-thunder-bluff-west-1:bottom", "FLIGHT_22", /^elevator-thunder-bluff-.*:bottom>.*:top$/],
    ["Freewind Post", "elevator-freewind-post-1:bottom", "FLIGHT_30", /^elevator-freewind-post-.*:bottom>.*:top$/],
    ["the Great Lift", "elevator-great-lift-1:bottom", "elevator-great-lift-2:top", /^elevator-great-lift-.*:bottom>.*:top$/],
  ])(
    "rides an elevator up at %s",
    async (_, from, to, ride) => {
      const leg = await trip(stop(from), stop(to), horde);
      expect(leg.rides).toHaveLength(1);
      expect(leg.rides?.[0]).toMatch(ride);
    },
    120_000,
  );
});

function layerHeight(region: TerrainRegion, point: Point, height: number) {
  const [x, y] = nativeToCell(region, point);
  const cell = y * region.width + x;
  if (!region.floor?.head[cell]) return region.elevation[cell] ?? Number.NaN;
  const node = snapNode(region, point, DEFAULT_MAX_SLOPE, false, height);
  if (node < 0) return Number.NaN;
  const { floor } = region;
  if (!floor || (node < region.width * region.height && !floor.head[node])) return region.elevation[node] ?? Number.NaN;
  return floor.height[nodeRecord(region, floor, node)] ?? Number.NaN;
}

async function meetsBuilding(map: number, point: Point, height: number) {
  const request = { maxSlope: DEFAULT_MAX_SLOPE, swimming: { enabled: false, speed: DEFAULT_SWIM_SPEED }, mode: DEFAULT_MODES[0]! };
  const leg = await routeLeg(
    opened.get(map)!.terrain,
    point,
    point,
    { followTerrain: true, downhill: false },
    {
      ...request,
      heights: { from: height, to: height },
    },
  );
  return leg.kind === "route" && leg.stops?.[0]?.class === "target";
}
