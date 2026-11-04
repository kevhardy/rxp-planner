import type { Faction } from "../../rules/profile.ts";
import type { RideRequirements } from "../../../packages/data-contract/transports.ts";
import type { TransportLink, TransportStop } from "../../routing/transport.ts";

const MARKED_MODES: Readonly<Record<string, string>> = {
  ship: "Ship",
  zeppelin: "Zeppelin",
  tram: "Deeprun Tram",
  portal: "Portal",
  transition: "Portal",
  flight: "Flight master",
};

interface RideConnection {
  link: TransportLink;
  ground: TransportStop;
  rideRequires: RideRequirements;
}

export interface RideMark {
  stop: TransportStop;
  mode: string;
  rides: RideConnection[];
  sharedRequires: RideRequirements | null;
  foreignFaction: Faction | null;
  label: string;
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function whoRides(r: RideRequirements): string {
  const parts = [r.faction, r.race, r.class && `${r.class[0]}${r.class.slice(1).toLowerCase()}`].filter((p) => !!p);
  return parts.length ? `${list(parts as string[])} only` : "Both factions";
}

export function rideMarks(links: readonly TransportLink[], faction: Faction, otherFaction: boolean): RideMark[] {
  const shown = (r: RideRequirements) => !r.faction || r.faction === faction || otherFaction;
  const marks = new Map<string, { stop: TransportStop; mode: string; rides: RideConnection[] }>();
  const add = (stop: TransportStop, mode: string, ride: RideConnection) => {
    const found = marks.get(stop.id) ?? { stop, mode, rides: [] };
    found.rides.push(ride);
    marks.set(stop.id, found);
  };
  const groundByAirStop = new Map<string, TransportStop>();
  for (const link of links) if (link.mode === "flight" && link.from.air && !link.to.air) groundByAirStop.set(link.from.id, link.to);
  const takeOffs = new Map<string, TransportLink>();
  for (const link of links) if (link.mode === "flight" && !link.from.air && link.to.air) takeOffs.set(link.to.id, link);

  for (const link of links) {
    if (!Object.hasOwn(MARKED_MODES, link.mode) || !shown(link.requires)) continue;
    if (link.mode !== "flight") {
      add(link.from, link.mode, { link, ground: link.to, rideRequires: link.requires });
      continue;
    }
    const takeOff = link.from.air && link.to.air && takeOffs.get(link.from.id);
    const ground = groundByAirStop.get(link.to.id);
    if (!takeOff || !ground || !shown(takeOff.requires)) continue;
    add(takeOff.from, "flight", { link, ground, rideRequires: { ...takeOff.requires, ...link.requires } });
  }
  const theirs: Faction = faction === "Alliance" ? "Horde" : "Alliance";
  return [...marks.values()]
    .map((m) => {
      const [first, ...rest] = m.rides.map((r) => r.rideRequires);
      const made = {
        ...m,
        sharedRequires: first && rest.every((r) => sameRequirements(r, first)) ? first : null,
        foreignFaction: m.rides.every((r) => r.rideRequires.faction === theirs) ? theirs : null,
      };
      return { ...made, label: markLabel(made) };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "en") || a.stop.id.localeCompare(b.stop.id));
}

const sameRequirements = (a: RideRequirements, b: RideRequirements) => a.faction === b.faction && a.race === b.race && a.class === b.class;

function markLabel({ stop, mode, foreignFaction, rides }: Omit<RideMark, "label">): string {
  const where =
    mode === "flight"
      ? `${stop.name}, ${rides.length} ${rides.length === 1 ? "flight" : "flights"}`
      : `${stop.name} to ${list([...new Set(rides.map((r) => r.ground.name))])}`;
  return `${MARKED_MODES[mode]}: ${where}${foreignFaction ? `, ${foreignFaction} ride` : ""}`;
}

export const markTitle = ({ stop, mode }: Pick<RideMark, "stop" | "mode">) => `${MARKED_MODES[mode]}: ${stop.name}`;
