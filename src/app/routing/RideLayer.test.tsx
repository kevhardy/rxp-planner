// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { decodeTransportsFile } from "../../../packages/data-contract/transports.ts";
import ridesJson from "./fixtures/rides.json" with { type: "json" };
import type { Faction } from "../../rules/profile.ts";
import type { TransportLink, TransportStop } from "../../routing/transport.ts";
import { RidePopover } from "./RideLayer.tsx";
import { rideMarks } from "./rideStops.ts";

const file = decodeTransportsFile(ridesJson);
const stops = new Map(
  file.nodes.map((n): [string, TransportStop] => [
    n.id,
    { id: n.id, name: n.name, map: n.world.instance, point: [0, 0], ...(n.air && { air: n.air }) },
  ]),
);
const links: TransportLink[] = file.links.map(({ from, to, path: _path, ...link }) => ({
  ...link,
  from: stops.get(from)!,
  to: stops.get(to)!,
}));

const popover = (faction: Faction, otherFaction: boolean, stop: string) => {
  const mark = rideMarks(links, faction, otherFaction).find((m) => m.stop.id === stop)!;
  const { container } = render(
    <RidePopover mark={mark} character={{ race: "Orc", class: "WARRIOR" }} onClose={() => {}} returnFocus={() => {}} />,
  );
  const card = within(container).getByRole("region");
  return {
    facts: [...card.querySelectorAll("dl > div")].map((row) => `${row.firstChild!.textContent}: ${row.lastChild!.textContent}`),
    flights: within(card)
      .getAllByRole("listitem")
      .map((step) => step.children[1]!.firstChild!.textContent),
    notes: [...card.querySelectorAll("p.muted:not(.ride-note)")].map((p) => p.textContent),
  };
};

describe("ride popover", () => {
  const RATCHET = "FLIGHT_80";

  it("says who can take every flight from a neutral flight master when they share a faction", () => {
    expect(popover("Horde", false, RATCHET)).toEqual({
      facts: ["Who can ride: Horde only"],
      flights: ["Fly to Crossroads"],
      notes: [],
    });
  });

  it("names the faction of each flight when a flight master's flights differ", () => {
    expect(popover("Horde", true, RATCHET)).toEqual({
      facts: ["Who can ride: Varies by flight"],
      flights: ["Fly to Crossroads (Horde only)", "Fly to Talrendis Point (Alliance only)", "Fly to Theramore (Alliance only)"],
      notes: [],
    });
    expect(popover("Horde", true, "FLIGHT_3242").flights).toEqual([
      "Fly to Everlook (Horde only)",
      "Fly to Everlook (Alliance only)",
      "Fly to Summit of Eternity (Both factions)",
    ]);
  });
});
