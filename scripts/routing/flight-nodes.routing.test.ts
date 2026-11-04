import { expect, it } from "vitest";
import { validateInstalled } from "../dataset/local.ts";

it("places each dataset flight node where the routing transports place its flight master", async () => {
  const { quests, transports } = await validateInstalled();
  const { flightNodes } = quests;
  expect(flightNodes, "the dataset release has no flightNodes table").toBeDefined();
  const stops = new Map(transports?.nodes.map((n) => [n.id, n]));
  // The transports file keeps two decimals.
  const round = (n: number) => Math.round(n * 100) / 100;
  const differ = Object.entries(flightNodes ?? {}).flatMap(([id, { world }]) => {
    const stop = stops.get(`FLIGHT_${id}`);
    const dataset = { instance: world.instance, x: round(world.x), y: round(world.y) };
    const routing = stop?.world;
    return JSON.stringify(dataset) === JSON.stringify(routing) ? [] : [{ id, dataset, routing }];
  });
  expect(differ).toEqual([]);
}, 60_000);
