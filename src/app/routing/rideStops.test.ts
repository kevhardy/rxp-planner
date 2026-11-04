import { describe, expect, it } from "vitest";
import { decodeTransportsFile } from "../../../packages/data-contract/transports.ts";
import ridesJson from "./fixtures/rides.json" with { type: "json" };
import type { TransportLink, TransportStop } from "../../routing/transport.ts";
import { markTitle, rideMarks, whoRides } from "./rideStops.ts";

const file = decodeTransportsFile(ridesJson);
const unplacedStops = new Map(
  file.nodes.map((n): [string, TransportStop] => [
    n.id,
    { id: n.id, name: n.name, map: n.world.instance, point: [0, 0], ...(n.air && { air: n.air }) },
  ]),
);
const links: TransportLink[] = file.links.map(({ from, to, path: _path, ...link }) => ({
  ...link,
  from: unplacedStops.get(from)!,
  to: unplacedStops.get(to)!,
}));
const byId = (marks: ReturnType<typeof rideMarks>, id: string) => marks.find((m) => m.stop.id === id);
const destinations = (marks: ReturnType<typeof rideMarks>, id: string) => byId(marks, id)?.rides.map((r) => r.ground.name);

describe("ride marks", () => {
  const alliance = rideMarks(links, "Alliance", false);

  it("marks the stops of ships, zeppelins, the tram, portals, transitions, and flight masters, not elevators, entrances, or druid flights", () => {
    const modes = new Set(rideMarks(links, "Alliance", true).map((m) => m.mode));
    expect(modes).toEqual(new Set(["ship", "zeppelin", "tram", "portal", "transition", "flight"]));
    expect(alliance.some((m) => m.stop.air)).toBe(false);
  });

  it("names each stop by its mode, its place, and where its rides go", () => {
    const labels = alliance.map((m) => m.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Ship: Menethil Harbor to Auberdine and Southshore Harbor",
        "Ship: Southshore Harbor to Menethil Harbor",
        "Deeprun Tram: Ironforge to Stormwind City",
        "Portal: Rut'theran Village to Darnassus",
        "Portal: Wizard's Sanctum to Dalaran",
        "Flight master: Ironforge, 7 flights",
      ]),
    );
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
    expect(markTitle(byId(alliance, "FLIGHT_6")!)).toBe("Flight master: Ironforge");
  });

  it("gives a flight master its direct flights, each to the next flight point's ground stop", () => {
    const ironforge = byId(alliance, "FLIGHT_6")!;
    expect(ironforge.rides.map((r) => r.ground.name)).toContain("Thelsamar");
    expect(
      ironforge.rides.every((r) => r.link.from.air && r.link.to.air && !r.ground.air && r.ground.id === r.link.to.id.replace(":air", "")),
    ).toBe(true);
  });

  it("shows the character's faction and neutral rides; the other faction's only with the option, marked as theirs", () => {
    expect(byId(alliance, "ZEPPELIN_GROMGOL_TIRISFAL")).toBeUndefined();
    expect(byId(alliance, "DOCK_BOOTYBAY")?.foreignFaction).toBe(null);
    const ratchet = alliance.find((m) => m.mode === "flight" && m.stop.name === "Ratchet")!;
    expect(destinations(alliance, ratchet.stop.id)).toEqual(["Theramore", "Talrendis Point"]);
    const both = rideMarks(links, "Alliance", true);
    const zeppelin = byId(both, "ZEPPELIN_GROMGOL_TIRISFAL")!;
    expect(zeppelin).toMatchObject({ foreignFaction: "Horde", label: "Zeppelin: Grom'gol to Tirisfal Glades, Horde ride" });
    expect(destinations(both, ratchet.stop.id)).toEqual(["Theramore", "Crossroads", "Talrendis Point"]);
    expect(byId(rideMarks(links, "Horde", false), "TRAM_IRONFORGE")).toBeUndefined();
  });

  it("gives each flight the faction of its take-off and its own, and the stop the faction its flights share", () => {
    const horde = (otherFaction: boolean) => byId(rideMarks(links, "Horde", otherFaction), "FLIGHT_80")!;
    expect(horde(false)).toMatchObject({
      sharedRequires: { faction: "Horde" },
      foreignFaction: null,
      label: "Flight master: Ratchet, 1 flight",
    });
    expect(horde(true).rides.map((r) => [r.ground.name, r.rideRequires])).toEqual([
      ["Theramore", { faction: "Alliance" }],
      ["Crossroads", { faction: "Horde" }],
      ["Talrendis Point", { faction: "Alliance" }],
    ]);
    expect(horde(true)).toMatchObject({ sharedRequires: null, foreignFaction: null, label: "Flight master: Ratchet, 3 flights" });
    expect(byId(alliance, "FLIGHT_6")!.rides[0]!.rideRequires).toEqual({ faction: "Alliance" });
  });

  it("marks a neutral flight master as the other faction's when all its flights are theirs", () => {
    const stop = (id: string, name: string, air?: true): TransportStop => ({ id, name, map: 1, point: [0, 0], ...(air && { air }) });
    const seconds = { min: 60, average: 60, max: 60 };
    const flight = (from: TransportStop, to: TransportStop, requires: TransportLink["requires"]): TransportLink => ({
      service: "flight",
      mode: "flight",
      from,
      to,
      requires,
      seconds,
    });
    const [ratchet, ratchetAir] = [stop("FLIGHT_80", "Ratchet"), stop("FLIGHT_80:air", "Ratchet", true)];
    const [theramore, theramoreAir] = [stop("FLIGHT_32", "Theramore"), stop("FLIGHT_32:air", "Theramore", true)];
    const allianceOnly = { faction: "Alliance" } as const;
    const neutral = [
      flight(ratchet, ratchetAir, {}),
      flight(ratchetAir, theramoreAir, allianceOnly),
      flight(theramoreAir, theramore, allianceOnly),
    ];
    expect(rideMarks(neutral, "Horde", false)).toEqual([]);
    expect(rideMarks(neutral, "Horde", true)).toMatchObject([
      { sharedRequires: { faction: "Alliance" }, foreignFaction: "Alliance", label: "Flight master: Ratchet, 1 flight, Alliance ride" },
    ]);
  });

  it("names who can take a ride", () => {
    expect(whoRides({})).toBe("Both factions");
    expect(whoRides({ faction: "Horde" })).toBe("Horde only");
    expect(whoRides({ faction: "Alliance", race: "Skyborne" })).toBe("Alliance and Skyborne only");
    expect(whoRides({ faction: "Alliance", class: "DRUID" })).toBe("Alliance and Druid only");
  });
});
