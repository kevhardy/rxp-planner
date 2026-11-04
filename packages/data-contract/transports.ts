import type { Faction } from "./shared.ts";
import type { WorldLocation } from "./geometry.ts";
import { faction, fields, finite, list, name, object, oneOf, optional, pair, requireValid, world, type Check } from "./checks.ts";

/** The transports file that the manifest's `transports` field names: the fixed rides between stops. */
export interface TransportsFile {
  version: 1;
  nodes: TransportNodeRecord[];
  links: TransportLinkRecord[];
}

export interface TransportNodeRecord {
  /** Stable stop key, such as "DOCK_MENETHIL". */
  id: string;
  name: string;
  /** In the axes of `QuestPoint.world`. */
  world: WorldLocation;
  /** World yards. The stop snaps to this level, such as an elevator top, and not to the ground over or under it. */
  height?: number;
  /** A place in a flight, where a flight continues without a landing: no ground leg starts or ends there. */
  air?: true;
}

export interface TransportLinkRecord {
  service: string;
  /** `ship`, `zeppelin`, `tram`, `portal`, `access`, `transition`, `druid-flight`, `elevator`, `flight`, or a mode added later. */
  mode: string;
  /** A node `id`. */
  from: string;
  /** A node `id`. */
  to: string;
  requires: RideRequirements;
  seconds: RideSeconds;
  /** The source gives only a placeholder time. */
  placeholder?: true;
  /**
   * The time is a model estimate, such as a flight's length at base speed, not a measurement.
   * `reference`: a flight without a client path, from the straight line and a nearby flight.
   */
  estimate?: true | "reference";
  /** World x and y, in yards, on the instance of `from`, that the ride passes between its stops. */
  path?: [number, number][];
}

/** What a ride asks of the character. A missing field asks nothing. */
export interface RideRequirements {
  faction?: Faction;
  /** A ChrClasses `fileName`, which `UnitClass` returns. */
  class?: string;
  /** A ChrRaces `fileName`, which `UnitRace` returns. */
  race?: string;
}

/** Seconds, from the shortest wait to the longest. */
export interface RideSeconds {
  min: number;
  average: number;
  max: number;
}

const nodeFields = { id: name, name, world, height: optional(finite), air: optional(oneOf(true)) };
const seconds: Check = (v) => {
  if (!fields(v, { min: finite, average: finite, max: finite })) return false;
  const { min, average, max } = v;
  return 0 <= min && min <= average && average <= max;
};
const linkFields = {
  service: name,
  mode: name,
  from: name,
  to: name,
  requires: (v: unknown) => fields(v, { faction: optional(faction), class: optional(name), race: optional(name) }),
  seconds,
  placeholder: optional(oneOf(true)),
  estimate: optional(oneOf(true, "reference")),
  path: optional(list(pair)),
};
const isNode = (v: unknown): v is TransportNodeRecord => fields(v, nodeFields);
const isLink = (v: unknown): v is TransportLinkRecord => fields(v, linkFields);

/** Checks every transports rule that needs no other asset. Unknown keys survive. */
export function decodeTransportsFile(input: unknown): TransportsFile {
  requireValid(object(input), "transports file");
  requireValid(input.version === 1, `transports file version ${String(input.version)}, expected version 1`);
  requireValid(Array.isArray(input.nodes) && Array.isArray(input.links), "transports file");
  const ids = new Set<string>();
  const nodes = input.nodes.map((node: unknown, i): TransportNodeRecord => {
    requireValid(isNode(node), `transport node ${object(node) && typeof node.id === "string" ? node.id : i}`);
    requireValid(!ids.has(node.id), `duplicate transport node ${node.id}`);
    ids.add(node.id);
    return node;
  });
  const links = input.links.map((link: unknown, i): TransportLinkRecord => {
    requireValid(isLink(link), `transport link ${i}`);
    requireValid(ids.has(link.from) && ids.has(link.to), `transport link ${i} stop reference`);
    return link;
  });
  return { ...input, version: 1, nodes, links };
}
