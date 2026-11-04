import type { ClassName } from "../data/races.ts";
import type { PartySize } from "./xp.ts";

interface Sourced<T> {
  value: T;
  source: string;
}

/** Riding: the level it is learned at, the speed factor over running, and its cast in seconds. */
export interface Mount {
  level: number;
  speed: number;
  cast: number;
}

export type MobColor = "gray" | "green" | "yellow" | "orange" | "red";

interface TimelineModel {
  runSpeed: Sourced<number>;
  detour: Sourced<number>;
  mount: Sourced<Mount | null>;
  crossMap: Sourced<number>;
  flightSpeed: Sourced<number>;
  flightDetour: Sourced<number>;
  flightOverhead: Sourced<number>;
  deathskip: Sourced<number>;
  hearthCast: Sourced<number>;
  hearthCooldown: Sourced<number>;
  interact: Sourced<Readonly<Record<string, number>>>;
  killSeconds: Sourced<Readonly<Record<MobColor, number>>>;
  eliteFactor: Sourced<number>;
  classSpeed: Sourced<Readonly<Record<ClassName, number>>>;
  rest: Sourced<Readonly<Record<ClassName, number>>>;
  pullReach: Sourced<number>;
  respawn: Sourced<number>;
  killArea: Sourced<number>;
  passReach: Sourced<number>;
  grindReach: Sourced<number>;
  noSpawnWalk: Sourced<number>;
  partyDamage: Sourced<Readonly<Record<PartySize, number>>>;
}

/** Distances are yards, times seconds. A source that starts with "guess" is not measured. */
export const TIMELINE_MODEL: TimelineModel = {
  runSpeed: { value: 7, source: "Classic run speed, 7 yd/s, as the routing artifact uses" },
  detour: { value: 1.2, source: "measured: routed legs of the 1-13 Human chain run 1.21 times the straight line" },
  mount: {
    value: { level: 40, speed: 1.6, cast: 3 },
    source: "Classic riding: level 40, 60% faster, 3 s cast",
  },
  crossMap: { value: 300, source: "guess: a boat, tram, or zeppelin between maps, with the wait" },
  flightSpeed: { value: 32, source: "guess: Classic taxi speed in yd/s" },
  flightDetour: { value: 1.4, source: "guess: taxi paths curve between nodes; straight-line distance times this" },
  flightOverhead: { value: 15, source: "guess: talking to the flight master, takeoff, and landing" },
  deathskip: { value: 30, source: "guess: time to die, release, and resurrect at the Spirit Healer" },
  hearthCast: { value: 10, source: "Hearthstone cast time, 10 s" },
  hearthCooldown: { value: 3600, source: "Classic Hearthstone cooldown, 60 min" },
  interact: {
    value: { accept: 5, turnin: 8, home: 8, fp: 5, train: 4, vendor: 20, gather: 10 },
    source: "guess: seconds per line; gather is per item from an object",
  },
  killSeconds: {
    value: { gray: 5, green: 8, yellow: 12, orange: 18, red: 28 },
    source:
      "yellow: Blizzard's Forever deep dive says a solo player kills an ordinary creature in 10 to 15 s (https://news.blizzard.com/en-us/article/24303313/world-of-warcraft-forever-deep-dive-panel-recap); other colors are guesses scaled from it",
  },
  eliteFactor: { value: 3, source: "guess: an elite takes three times as long" },
  classSpeed: {
    value: {
      WARRIOR: 1,
      PALADIN: 1.1,
      HUNTER: 0.8,
      ROGUE: 0.9,
      PRIEST: 1.1,
      SHAMAN: 1,
      MAGE: 0.85,
      WARLOCK: 0.9,
      DRUID: 1,
    },
    source: "guess: combat time relative to a warrior",
  },
  rest: {
    value: {
      WARRIOR: 0.25,
      PALADIN: 0.15,
      HUNTER: 0.15,
      ROGUE: 0.3,
      PRIEST: 0.25,
      SHAMAN: 0.2,
      MAGE: 0.25,
      WARLOCK: 0.15,
      DRUID: 0.2,
    },
    source: "guess: rest and drink downtime as a fraction of combat time",
  },
  pullReach: {
    value: 10,
    source: "guess: yards short of a spawn where the fight starts; the mob roams around its spawn and comes to meet the pull",
  },
  respawn: { value: 300, source: "design: the expected seconds before a killed mob's spawn has a mob again" },
  killArea: {
    value: 500,
    source: "design: the default radius in yards of a step's kill area, so that a kill walk stays local and does not cross a zone",
  },
  passReach: {
    value: 30,
    source:
      "design: a #completewith step's mobs die as the character passes them only when their spawn is within this many yards of the walked line",
  },
  grindReach: {
    value: 120,
    source: "design: a grind with no named mob kills a mob with at least two spawns within this many yards of where it starts",
  },
  noSpawnWalk: { value: 25, source: "guess: yards walked for each kill of a mob with no spawn on the character's map" },
  partyDamage: {
    value: { 1: 1, 2: 1.8 },
    source: "guess: damage relative to solo; two players lose some to overkill and tagging",
  },
};
