import { describe, expect, it } from "vitest";
import { FLIGHT_MASTER_REACH, FlightNodes } from "./flightNodes.ts";
import { genericFile } from "./genericFixture.ts";

describe("flight nodes", () => {
  const flights = new FlightNodes(genericFile().flightNodes);
  const node = (id: number) => flights.node(id);

  it.each([
    { name: "Theramore", faction: "Alliance", id: 32 },
    { name: "theramore, dustwallow marsh", faction: "Alliance", id: 32 },
    { name: "Theramore Isle", faction: "Alliance", id: 32 },
    { name: "Crossroads", faction: "Horde", id: 25 },
    { name: "Ratchet", faction: "Horde", id: 80 },
    { name: "Ratchet", faction: "Alliance", id: 80 },
  ] as const)("gives $faction node $id for $name", ({ name, faction, id }) => {
    expect(flights.named(name, faction)).toEqual({ node: node(id), nodes: [node(id)] });
  });

  it("gives every candidate of an ambiguous name, and none for a name that matches no node", () => {
    expect(flights.named("The Barrens", "Horde")).toEqual({ nodes: [node(25), node(80)] });
    expect(flights.named("The Crossroads", "Horde")).toEqual({ nodes: [] });
    expect(flights.named("Crossroads", "Alliance")).toEqual({ nodes: [] });
    expect(flights.named("", "Alliance")).toEqual({ nodes: [] });
  });

  it("finds the faction's flight master within reach", () => {
    const theramore = node(32).at;
    expect(theramore).toEqual({ instance: 1, x: -4516.58, y: -3825.37 });
    expect(flights.at({ ...theramore, x: theramore.x + 40 }, "Alliance")).toBe(node(32));
    expect(flights.at({ ...theramore, x: theramore.x + 80 }, "Alliance")).toBeUndefined();
    expect(flights.at(theramore, "Horde")).toBeUndefined();
    expect(flights.at({ ...theramore, instance: 0 }, "Alliance")).toBeUndefined();
  });

  const record = (x: number) => ({ name: `Node ${x}`, world: { instance: 0, x, y: 0 } });
  const origin = { instance: 0, x: 0, y: 0 };

  it("gives the nearest flight master in reach, the lower ID on a tie", () => {
    expect(new FlightNodes({ 1: record(20), 2: record(-10), 3: record(10) }).at(origin, "Horde")?.id).toBe(2);
  });

  it("reaches a flight master at exactly FLIGHT_MASTER_REACH", () => {
    expect(new FlightNodes({ 1: record(FLIGHT_MASTER_REACH) }).at(origin, "Horde")?.id).toBe(1);
  });

  it("throws for a node that the dataset lacks", () => {
    expect(() => new FlightNodes().node(32)).toThrow("The dataset has no flight node 32.");
  });
});
