import { describe, expect, it } from "vitest";
import { releaseFile } from "./releaseInputs.ts";
import { FlightNodes } from "./flightNodes.ts";

describe("flight node names that the release changed", () => {
  const flights = new FlightNodes(releaseFile().flightNodes);

  it.each([
    { name: "Nighthaven", faction: "Alliance", id: 49 },
    { name: "Nighthaven, Moonglade", faction: "Alliance", id: 49 },
    { name: "Moonglade", faction: "Alliance", id: 49 },
    { name: "Nighthaven", faction: "Horde", id: 69 },
    { name: "Nighthaven, Moonglade", faction: "Horde", id: 69 },
    { name: "Moonglade", faction: "Horde", id: 69 },
    { name: "Summit of Eternity", faction: "Alliance", id: 559 },
    { name: "Summit of Eternity", faction: "Horde", id: 559 },
    { name: "Rog'mar", faction: "Horde", id: 3203 },
    { name: "Tainted Foothills", faction: "Alliance", id: 3242 },
    { name: "Tainted Foothills", faction: "Horde", id: 3242 },
    { name: "Powderfuse Port", faction: "Horde", id: 3274 },
    { name: "Farholde Keep", faction: "Alliance", id: 3276 },
  ] as const)("gives $faction node $id for $name", ({ name, faction, id }) => {
    expect(flights.named(name, faction).nodes.map((node) => node.id)).toEqual([id]);
  });
});
