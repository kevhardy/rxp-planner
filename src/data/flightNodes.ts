import type { FlightNodeRecord } from "../../packages/data-contract/model.ts";
import type { Faction } from "../../packages/data-contract/shared.ts";
import { within, yards, type WorldLocation } from "./maps.ts";

export interface FlightNode {
  id: number;
  faction?: Faction;
  name: string;
  at: WorldLocation;
}

export interface FlightMatch {
  node?: FlightNode;
  nodes: readonly FlightNode[];
}

/**
 * RXP's names for the nodes whose client name differs (`DB/forever/flightData.lua`).
 * Guides give these names, so a node matches by either name.
 */
const RXP_NAMES: Readonly<Record<number, string>> = { 49: "Nighthaven, Moonglade", 69: "Nighthaven, Moonglade" };

export const FLIGHT_MASTER_REACH_YARDS = 60;

export class FlightNodes {
  readonly #nodes: readonly FlightNode[];
  readonly #byId: ReadonlyMap<number, FlightNode>;

  constructor(records: Readonly<Record<string, FlightNodeRecord>> = {}) {
    this.#nodes = Object.entries(records)
      .map(([id, { name, faction, world }]): FlightNode => ({ id: Number(id), ...(faction && { faction }), name, at: world }))
      .sort((a, b) => a.id - b.id);
    this.#byId = new Map(this.#nodes.map((node) => [node.id, node]));
  }

  node(id: number): FlightNode {
    const node = this.#byId.get(id);
    if (!node) throw new Error(`The dataset has no flight node ${id}.`);
    return node;
  }

  /**
   * The faction's flight master that a `.fp` or `.fly` name gives. RXP finds
   * the name as text in a full name, ignoring case (`addon.functions.fp` and
   * `addon.functions.fly` in functions.lua). Guides also give zone names that no
   * full name holds, such as "Redridge Mountains" for "Lakeshire, Redridge";
   * such a name starts with the town or the zone of a full name. A node with
   * an RXP name matches by that name too.
   */
  named(name: string, faction: Faction): FlightMatch {
    const text = name.trim().toUpperCase();
    const nodes = this.#nodes.filter((node) => !node.faction || node.faction === faction);
    const names = (node: FlightNode) => [node.name, RXP_NAMES[node.id]].flatMap((n) => (n ? [n.toUpperCase()] : []));
    const full = text ? nodes.filter((node) => names(node).some((n) => n.includes(text))) : [];
    const found = full.length
      ? full
      : nodes.filter((node) => text && names(node).some((n) => n.split(", ").some((part) => text.startsWith(part))));
    return { nodes: found, ...(found.length === 1 && { node: found[0] }) };
  }

  at(at: WorldLocation, faction: Faction): FlightNode | undefined {
    return this.#nodes
      .filter((node) => (!node.faction || node.faction === faction) && within(node.at, at, FLIGHT_MASTER_REACH_YARDS))
      .reduce<FlightNode | undefined>((best, node) => (!best || yards(node.at, at) < yards(best.at, at) ? node : best), undefined);
  }
}
