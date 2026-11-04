import { describe, expect, it } from "vitest";
import { FlightNodes } from "../data/index.ts";
import { releaseFile } from "../data/releaseInputs.ts";
import { parseGuide } from "../guide/index.ts";
import { createProfile } from "./profile.ts";
import { simulateRoute, type SimData } from "./simulate.ts";
import { testRules } from "./testing.ts";

const data: SimData = {
  quest: () => undefined,
  npc: () => undefined,
  item: () => undefined,
  rules: testRules,
  entityByName: () => undefined,
  locateGoto: () => undefined,
  flights: new FlightNodes(releaseFile().flightNodes),
  uiMapNamed: () => undefined,
};

const guide = (name: string, text: string, header = "") => parseGuide(`#group G\n#name ${name}\n${header}${text}\n`);

describe("state= on arrival", () => {
  const state = (json: string) => `-- @sim state=${json}`;

  it.each([
    { race: "Human", id: 49, starting: 2 },
    { race: "Tauren", id: 69, starting: 22 },
  ] as const)("loads RXP's Nighthaven as $race flight path $id", ({ race, id, starting }) => {
    const text = `step\n${state(`{"flightPaths": {"Nighthaven": true}}`)}\n.fly Nighthaven`;
    const profile = createProfile({ race, class: "WARRIOR", level: 1 });
    const { guides, warnings } = simulateRoute([guide("A", text)], 0, profile, data);
    expect(warnings).toEqual([]);
    expect(guides[0]!.steps[0]!.before.flightPaths).toEqual(new Set([starting, id]));
  });
});
