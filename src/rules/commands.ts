import { argumentEntities, questArgument, type CommandName } from "../guide/index.ts";
import {
  cooldownHolds,
  inLogHolds,
  maxLevelHolds,
  questCompleteHolds,
  readXpGate,
  turnedInHolds,
  xpHolds,
  zoneSkipHolds,
  zoneSkipReversed,
  type Gate,
} from "./gates.ts";
import type { InteractAction } from "./character.ts";
import { moneyText } from "./money.ts";
import type { Args, CommandRow, Say } from "./row/table.ts";

/**
 * How RXP runs a point line: as `.goto` or as `.waypoint`, whose arrow leads
 * there (`updateArrowData` in map.lua follows only `element.arrow`); as
 * `.ingamewaypoint`, whose game waypoint leads there; or as a pin, which
 * nothing leads to.
 */
export type PointRun = "goto" | "waypoint" | "ingamewaypoint" | "pin";

export interface CommandRule {
  row: CommandRow;
  /**
   * A command that starts with a zone and a point, which RXP reads in the
   * command's handler in functions.lua, such as `addon.functions["goto"]` or
   * `addon.functions.waypoint`. `quest`: RXP drops the line unless its radius,
   * quest ID, and objective are numbers (`addon.functions.questgoto` and
   * `addon.functions.questwaypoint`).
   */
  point?: { run: PointRun; quest?: true };
  /** Draws a path of points, each read as `.goto` reads one. */
  path?: true;
  /**
   * A runtime check: when it fails, the preview and the simulation skip the
   * step. RXP checks it on the active step at runtime, so it still loads the
   * step and indexes its label (`addon:LoadGuide` in GuideWindow.lua).
   */
  gate?: Gate;
  /**
   * What the line does to the simulated character; `runCommand` in simulate.ts
   * switches on it. A point line acts as its `point.run` instead.
   */
  effect?: "accept" | "complete" | "collect" | "turnin" | "abandon" | "xp" | "deathskip" | "hearth";
  /** The interaction that the simulation records after the line's effect. */
  interact?: InteractAction;
  /**
   * How the line counts when the simulation checks whether RXP completes the
   * step on arrival (`completeOnArrival` in simulate.ts): by its own check,
   * or `none` when it never holds the step open. A point line counts as its
   * `point.run`, or as `arrival` when RXP drops it. Without `arrival`, the
   * simulation cannot tell, so the step does not complete on arrival.
   */
  arrival?: "accept" | "turnin" | "complete" | "collect" | "abandon" | "xp" | "fp" | "none";
  /**
   * What the line reads when it skips its step unless the live quest log
   * (`log`) or the bags (`bags`) are in some state (the quest-state handlers
   * and `addon.functions.itemcount` in functions.lua). The simulation knows
   * the log but not the bags.
   */
  live?: "log" | "bags";
}

const isNumber = (s: string | undefined) => s !== undefined && /^-?\d/.test(s);

const titleCase = (s: string | undefined) => (s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : "?");

const questId = (name: CommandName, a: Args, i = 0) => {
  const id = questArgument(name, a.raw, i);
  return id !== undefined && id > 0 ? id : undefined;
};

const quest = (name: CommandName, a: Args, s: Say, i = 0) => {
  const id = questId(name, a, i);
  return id === undefined ? `Quest #${a.str(i) ?? "?"}` : s.quest(id);
};

const quests = (name: CommandName, a: Args, s: Say, joiner: "or" | "and" = "or") =>
  a.raw.length === 0 ? s.quest(undefined) : a.raw.map((_, i) => quest(name, a, s, i)).join(` ${joiner} `);

const SLOTS: Readonly<Record<number, string>> = {
  1: "head",
  2: "neck",
  3: "shoulder",
  4: "shirt",
  5: "chest",
  6: "waist",
  7: "legs",
  8: "feet",
  9: "wrist",
  10: "hands",
  11: "first ring",
  12: "second ring",
  13: "first trinket",
  14: "second trinket",
  15: "back",
  16: "main-hand",
  17: "off-hand",
  18: "ranged",
  19: "tabard",
};

const slot = (a: Args, i: number) => SLOTS[a.id(i) ?? 0] ?? `slot ${a.str(i) ?? "?"}`;

function statName(stat: string | undefined): string {
  if (stat === "ITEM_MOD_DAMAGE_PER_SECOND_SHORT") return "DPS";
  if (stat === "LEVEL") return "item level";
  return (stat ?? "?")
    .replace(/^ITEM_MOD_|_SHORT$/g, "")
    .replaceAll("_", " ")
    .toLowerCase();
}

/**
 * RXP's text for a goal: an amount into a level or a standing (`+1740`), an
 * amount short of it (`-200`), a fraction of it (`.5`), or no offset.
 */
function grindText(target: string, offset: string | undefined, unit = ""): string {
  const n = Number(offset);
  if (!n) return `Grind to ${target}`;
  if (n < 0) return `Grind until you are ${-n} ${unit}away from ${target}`;
  if (n >= 1) return `Grind until you are ${n} ${unit}into ${target}`;
  return `Grind until you are ${Math.round(n * 100)}% into ${target}`;
}

const goal = (text: string | undefined) => /^\s*<?\s*([a-z]+|\d+)([+.-]\d*)?/i.exec(text ?? "") ?? [];

function xpText(a: Args, s: Say): string {
  const gate = readXpGate(a.raw);
  if (!gate) return "Grind to level ?";
  const { level, extra, comparison } = gate;
  const target =
    extra < 0
      ? `${-extra} xp short of level ${level}`
      : extra >= 1
        ? `${extra} xp into level ${level}`
        : extra > 0
          ? `${Number((extra * 100).toPrecision(15))}% into level ${level}`
          : `level ${level}`;
  if (gate.kind === "complete") {
    if (comparison === "below") return `Complete below ${target}`;
    if (extra > 0 && extra < 1) return `Grind until you are ${target}`;
    return grindText(`level ${level}`, String(extra), "xp ");
  }
  const prefix = skipOrJump(gate.label, s);
  if (comparison === "below") return `${prefix} below ${target}`;
  return extra === 0 ? `${prefix} at level ${level}+` : `${prefix} at or above ${target}`;
}

const STANDINGS = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];

function skipOrJump(ref: string | undefined, s: Say): string {
  return ref ? `Jump to ${s.step(ref)}` : "Skip";
}

/** `.cooldown` reads N under 2 s as 2 s; `m` means minutes. */
function cooldownText(a: Args, s: Say): string {
  const type = a.str(0)?.toLowerCase();
  const what =
    type === "item"
      ? s.item(a.id(1))
      : type === "spell"
        ? s.spell(a.id(1))
        : type === "inventory"
          ? `the ${slot(a, 1)} item`
          : type === "pet"
            ? `pet action ${a.str(1) ?? "?"}`
            : `action slot ${a.str(1) ?? "?"}`;
  const [, less, amount = "0", minutes] = /^\s*(<)?\s*>?\s*(\d*\.?\d*)\s*(m)?/.exec(a.str(2) ?? "") ?? [];
  const seconds = Math.max(2, Number(amount) * (minutes ? 60 : 1));
  const left = minutes ? `${seconds / 60} min` : `${seconds} s`;
  return `Skip while ${what} has ${less ? "less" : "more"} than ${left} left`;
}

function itemcountText(a: Args, s: Say): string {
  const ids = (a.str(0) ?? "").match(/\d+/g)?.map(Number) ?? [];
  const [, op = "", eq, n = "1"] = /^\s*([<>]?)(=?)\s*(\d+)/.exec(a.str(1) ?? "") ?? [];
  const items = s.items(ids);
  const bank = a.str(2) ? " (bank counts)" : "";
  const count =
    op === "<" ? (eq ? `${n} or fewer` : `fewer than ${n}`) : op === ">" ? (eq ? `${n}+` : `more than ${n}`) : n === "1" ? "" : `${n}+`;
  return `While you have ${count ? `${count} ` : ""}${items}${bank}`;
}

/** `.aura` checks the aura's time left with N, its stacks with N+ or N-, and reverses with `<`, `-`, or a negative ID. */
function auraText(a: Args, s: Say): string {
  const [, less, n, stack] = /^\s*(<)?\s*(\d+)([+-])?/.exec(a.str(1) ?? "") ?? [];
  const unit = a.str(2) ?? "player";
  const spell = s.spell(a.id(0));
  const found =
    n === undefined
      ? `${spell} is on ${unit === "player" ? "you" : `your ${unit}`}`
      : stack
        ? `${spell} has ${n}+ stacks`
        : `${spell} has more than ${n} s left`;
  const reverse = (less !== undefined || stack === "-") !== (a.str(0)?.startsWith("-") ?? false);
  return `Skip ${reverse ? "unless" : "while"} ${found}`;
}

const BLASTED_LANDS: readonly (readonly [count: number, id: number, name: string])[] = [
  [14, 8396, "Vulture Gizzard"],
  [11, 8394, "Basilisk Brain"],
  [6, 8393, "Scorpok Pincer"],
  [6, 8392, "Blasted Boar Lung"],
  [5, 8391, "Snickerfang Jowl"],
];

const COMMAND_RULES: { readonly [N in CommandName]: CommandRule } = {
  accept: {
    row: {
      role: "do",
      mark: "accept",
      label: (a, s) => `Accept ${quest("accept", a, s)}`,
    },
    effect: "accept",
    interact: "accept",
    arrival: "accept",
  },
  acceptmultiple: { row: { role: "do", mark: "accept", label: (a, s) => `Accept ${quests("acceptmultiple", a, s)}` } },
  daily: { row: { role: "do", mark: "daily", label: (a, s) => `Accept daily ${quests("daily", a, s)}` } },
  complete: {
    row: {
      role: "do",
      mark: (a, s) => {
        const { type } = s.objective(questId("complete", a), a.id(1));
        return type === "item" ? "collect" : type === "monster" ? "kill" : "complete";
      },
      label: (a, s) => `${quest("complete", a, s)} · ${s.objective(questId("complete", a), a.id(1)).label}`,
    },
    effect: "complete",
    arrival: "complete",
  },
  turnin: {
    row: { role: "do", mark: "turnin", label: (a, s) => `Turn in ${quest("turnin", a, s)}` },
    effect: "turnin",
    interact: "turnin",
    arrival: "turnin",
  },
  dailyturnin: { row: { role: "do", mark: "dailyturnin", label: (a, s) => `Turn in daily ${quests("dailyturnin", a, s)}` } },
  abandon: {
    row: { role: "do", mark: "abandon", label: (a, s) => `Abandon ${quests("abandon", a, s, "and")}` },
    effect: "abandon",
    arrival: "abandon",
  },
  isOnQuest: {
    row: { role: "check", phrase: (a, s) => `While ${quests("isOnQuest", a, s)} is in your log` },
    gate: inLogHolds(false),
    arrival: "none",
    live: "log",
  },
  isNotOnQuest: {
    row: { role: "check", phrase: (a, s) => `While ${quests("isNotOnQuest", a, s)} is not in your log` },
    gate: inLogHolds(true),
    arrival: "none",
    live: "log",
  },
  isQuestNotComplete: {
    row: { role: "check", phrase: (a, s) => `While ${quest("isQuestNotComplete", a, s)} is not ready to turn in` },
    gate: questCompleteHolds(true),
    arrival: "none",
    live: "log",
  },
  vehicle: { row: { role: "do", mark: "vehicle", label: (a, s) => (a.id(0) ? `Enter ${s.npc(a.id(0))}` : "Enter the vehicle") } },
  isQuestComplete: {
    row: { role: "check", phrase: (a, s) => `While ${quest("isQuestComplete", a, s)} is ready to turn in` },
    gate: questCompleteHolds(false),
    arrival: "none",
    live: "log",
  },
  isQuestTurnedIn: {
    row: { role: "check", phrase: (a, s) => `After ${quests("isQuestTurnedIn", a, s)} is turned in` },
    gate: turnedInHolds(false),
    arrival: "none",
    live: "log",
  },
  isQuestAvailable: {
    row: { role: "check", phrase: (a, s) => `While ${quests("isQuestAvailable", a, s)} is not turned in` },
    gate: turnedInHolds(true),
    arrival: "none",
    live: "log",
  },

  // `CurrentStepFrame.UpdateText` in GuideWindow.lua draws a line's text with the icon that `addon.icons` in
  // functions.lua gives its command. `.goto`, `.groundgoto`, and `.flygoto` have one. The other point and path
  // commands have none.
  goto: { row: { role: "where", where: "goto", textAs: "do" }, point: { run: "goto" } },
  // `addon.functions.groundgoto` and `addon.functions.flygoto` call `addon.functions["goto"]`.
  groundgoto: { row: { role: "where", where: "goto", textAs: "do" }, point: { run: "goto" } },
  flygoto: { row: { role: "where", where: "goto", textAs: "do" }, point: { run: "goto" } },
  // `addon.functions.questgoto` calls `addon.functions["goto"]` with an optional flag.
  questgoto: { row: { role: "where", where: "goto", textAs: "note" }, point: { run: "goto", quest: true }, arrival: "none" },
  // `addon.functions.waypoint` keeps its text as `element.title`, which `addon.DrawArrow` in map.lua shows on the
  // arrow, so the guide window has no text for it.
  waypoint: { row: { role: "where", where: "waypoint", textAs: "arrow" }, point: { run: "waypoint" } },
  // `addon.functions.questwaypoint` builds its element with `addon.functions.waypoint`.
  questwaypoint: { row: { role: "where", where: "waypoint", textAs: "arrow" }, point: { run: "waypoint", quest: true }, arrival: "none" },
  // `addon.functions.ingamewaypoint` sets no `element.arrow`, but it sets and tracks the game's own waypoint
  // (`C_Map.SetUserWaypoint` and `C_SuperTrack.SetSuperTrackedUserWaypoint`).
  ingamewaypoint: { row: { role: "where", where: "waypoint", textAs: "note" }, point: { run: "ingamewaypoint" } },
  // `addon.functions.pin` sets no `element.arrow`; `addon.functions.treasure` and `addon.functions.rare` build their element with it.
  pin: { row: { role: "where", where: "goto", textAs: "note" }, point: { run: "pin" } },
  treasure: { row: { role: "where", where: "goto", textAs: "note" }, point: { run: "pin" } },
  rare: { row: { role: "where", where: "goto", textAs: "note" }, point: { run: "pin" } },
  // `addon.functions.line` and `addon.functions.loop` in functions.lua make a textOnly element, which never holds its
  // step open (`addon.UpdateStepCompletion` in GuideWindow.lua).
  line: { row: { role: "where", where: "map", textAs: "note" }, path: true, arrival: "none" },
  loop: { row: { role: "where", where: "map", textAs: "note" }, path: true, arrival: "none" },
  zone: { row: { role: "do", mark: "goto", label: (a, s) => `Enter ${s.map(a.str(0))}` } },
  zoneskip: {
    row: {
      role: "check",
      phrase: (a, s) => {
        const zones = (a.str(0) ?? "?").split(/[+/]/).map((z) => s.map(z));
        return `Skip ${zoneSkipReversed(a.str(1)) ? "outside" : "in"} ${zones.join(" or ")}`;
      },
    },
    gate: zoneSkipHolds,
  },
  subzone: { row: { role: "do", mark: "goto", label: (a, s) => `Enter ${s.area(a.str(0))}` } },
  subzoneskip: { row: { role: "check", phrase: (a, s) => `Skip ${zoneSkipReversed(a.str(1)) ? "outside" : "in"} ${s.area(a.str(0))}` } },

  target: { row: { role: "where", where: "target", textAs: "note" }, arrival: "none" },
  mob: { row: { role: "where", where: "mob", textAs: "note" }, arrival: "none" },
  unitscan: { row: { role: "where", where: "target", textAs: "note" }, arrival: "none" },
  vendor: {
    row: { role: "do", mark: "vendor", label: (a, s) => (a.id(0) ? `Vendor at ${s.npc(a.id(0))}` : "Vendor") },
    interact: "vendor",
  },
  trainer: { row: { role: "do", mark: "trainer", label: (a, s) => (a.id(0) ? `Visit ${s.npc(a.id(0))}` : "Visit a trainer") } },
  tame: { row: { role: "do", mark: "tame", label: (a, s) => `Tame ${s.npc(a.id(0))}` } },
  stable: { row: { role: "do", mark: "stable", label: () => "Stable your pet" } },
  skipgossip: { row: { role: "setting", phrase: () => "Pick gossip", hint: "Picks gossip options while the step is active" } },
  skipgossipid: {
    row: {
      role: "setting",
      phrase: (a) => `Pick gossip ${a.ids().join(", ")}`,
      hint: "Picks these gossip options while the step is active",
    },
  },
  gossipoption: { row: { role: "do", mark: "gossip", label: (a) => `Pick gossip option ${a.str(0) ?? "?"}` } },
  emote: {
    row: {
      role: "do",
      mark: "emote",
      label: (a, s) => `/${(a.str(0) ?? "?").toLowerCase()}${a.id(1) ? ` at ${s.npc(a.id(1))}` : ""}`,
    },
  },

  collect: {
    row: { role: "do", mark: "collect", label: (a, s) => `Collect ${s.item(a.id(0))} ×${a.str(1) ?? "1"}` },
    effect: "collect",
    arrival: "collect",
  },
  itemcount: { row: { role: "check", phrase: itemcountText }, live: "bags" },
  use: {
    row: {
      role: "do",
      mark: "use",
      label: (a, s) => `Use ${s.items(a.raw.flatMap((_, i) => argumentEntities("use", a.raw, i).map((entity) => entity.id)))}`,
    },
  },
  buy: { row: { role: "do", mark: "buy", label: (a, s) => `Buy ${s.item(a.id(0))} ×${a.str(1) ?? "1"}` } },
  useitem: { row: { role: "do", mark: "use", label: (a, s) => `Use ${s.item(a.id(0))}` } },
  equip: {
    row: {
      role: "do",
      mark: "equip",
      label: (a, s) => (a.id(1) ? `Equip ${s.item(a.id(1))}` : `Equip an item in the ${slot(a, 0)} slot`),
      // A negative slot reverses the check.
      bare: (a, s) => {
        const reverse = a.str(0)?.startsWith("-");
        if (!a.id(1)) return reverse ? `Skip while the ${slot(a, 0)} slot is empty` : `Skip once the ${slot(a, 0)} slot has an item`;
        return reverse ? `Skip while ${s.item(a.id(1))} is not equipped` : `Skip once ${s.item(a.id(1))} is equipped`;
      },
    },
  },
  destroy: { row: { role: "do", mark: "destroy", label: (a, s) => `Destroy ${s.item(a.id(0))}` } },
  itemStat: {
    row: {
      role: "check",
      phrase: (a) => {
        const [, op, value = "?"] = /^\s*([<>]?)\s*(.*)$/.exec(a.str(2) ?? "") ?? [];
        return `While ${slot(a, 0)} ${statName(a.str(1))} is ${op === "<" ? "below " : op === ">" ? "above " : ""}${value}`;
      },
    },
  },
  addquestitem: {
    row: {
      role: "setting",
      phrase: (a, s) => `Count ${s.item(a.id(0))}`,
      hint: "Counts the item toward the quest",
    },
  },
  bankdeposit: { row: { role: "do", mark: "bank", label: (a, s) => `Deposit ${s.items(a.ids())} in the bank` } },
  bankwithdraw: { row: { role: "do", mark: "bank", label: (a, s) => `Take ${s.items(a.ids())} from the bank` } },
  // Item 4371 and quest 174 are fixed in RXP: one tube is needed until quest 174 is turned in.
  bronzetube: {
    row: {
      role: "check",
      phrase: (a, s) => `${a.str(0) ? "Skip while" : "While"} you still need ${s.item(4371)} for ${s.quest(174)}`,
    },
  },

  cast: { row: { role: "do", mark: "cast", label: (a, s) => `Cast ${s.spell(a.id(0))}` } },
  usespell: { row: { role: "do", mark: "cast", label: (a, s) => `Cast ${s.spell(argumentEntities("usespell", a.raw, 0)[0]?.id)}` } },
  train: { row: { role: "do", mark: "train", label: (a, s) => `Train ${s.spell(a.id(0))}` }, interact: "train" },
  aura: {
    row: {
      role: "either",
      pick: (_, hasText) => (hasText ? "do" : "check"),
      do: { role: "do", mark: "cast", label: (a, s) => `Get ${s.spell(a.id(0))}` },
      check: { role: "check", phrase: auraText },
    },
  },
  engrave: {
    row: {
      role: "do",
      mark: "engrave",
      label: (a, s) => (a.id(1) ? `Engrave ${s.spell(a.id(1))}` : `Engrave the ${slot(a, 0)} slot`),
    },
  },
  cooldown: { row: { role: "check", phrase: cooldownText }, gate: cooldownHolds },

  fly: { row: { role: "do", mark: "fly", label: (a) => (a.str(0) ? `Fly to ${a.str(0)}` : "Fly") }, interact: "fly" },
  fp: {
    row: { role: "do", mark: "fp", label: (a) => (a.str(0) ? `Get the ${a.str(0)} flight path` : "Get the flight path") },
    interact: "fp",
    arrival: "fp",
  },
  hs: { row: { role: "do", mark: "hs", label: (a) => (a.str(0) ? `Hearth to ${a.str(0)}` : "Use Hearthstone") }, effect: "hearth" },
  home: { row: { role: "do", mark: "home", label: (a, s) => `Set your Hearthstone to ${s.area(a.str(0))}` }, interact: "home" },
  // An odd flag reverses the check.
  bindlocation: {
    row: {
      role: "check",
      phrase: (a, s) =>
        Number(a.str(1) ?? 0) % 2 === 1
          ? `Skip while your hearth is not at ${s.area(a.str(0))}`
          : `Skip once your hearth is at ${s.area(a.str(0))}`,
    },
  },
  deathskip: { row: { role: "do", mark: "deathskip", label: () => "Die and respawn at the spirit healer" }, effect: "deathskip" },
  blastedLands: {
    row: {
      role: "do",
      mark: "collect",
      label: (_, s) => `Collect ${BLASTED_LANDS.map(([n, id, name]) => `${n} ${s.item(id, name)}`).join(", ")}`,
    },
  },

  xp: {
    row: {
      role: "either",
      pick: (a) => (readXpGate(a.raw)?.kind === "skip" ? "check" : "do"),
      do: { role: "do", mark: "xp", label: xpText },
      check: { role: "check", phrase: xpText },
    },
    gate: xpHolds,
    effect: "xp",
    arrival: "xp",
  },
  xpto60: { row: { role: "do", mark: "xp", label: () => "Grind to level 60" } },
  maxlevel: {
    row: { role: "check", phrase: (a, s) => `${skipOrJump(a.str(1), s)} above level ${a.str(0) ?? "?"}` },
    gate: maxLevelHolds,
    arrival: "none",
  },
  money: {
    row: {
      role: "check",
      phrase: (a) => {
        const gold = Number(/\d+\.?\d*/.exec(a.str(0) ?? "")?.[0] ?? 0);
        const money = moneyText(Math.round(gold * 10_000));
        return a.str(0)?.startsWith(">") ? `Skip with ${money} or more` : `Skip with less than ${money}`;
      },
    },
  },
  reputation: {
    row: {
      role: "either",
      pick: (a) => (a.str(3) ? "check" : "do"),
      do: {
        role: "do",
        mark: "reputation",
        label: (a, s) => {
          const [, to, offset] = goal(a.str(1));
          return grindText(`${standing(to)} with ${s.faction(a.id(0))}`, a.str(2) ?? offset);
        },
      },
      // `<` reverses the check.
      check: {
        role: "check",
        phrase: (a, s) =>
          `Skip ${a.str(1)?.startsWith("<") ? "until" : "once"} you are ${standing(goal(a.str(1))[1])} with ${s.faction(a.id(0))}`,
      },
    },
  },
  skill: {
    row: {
      role: "either",
      pick: (a) => (isNumber(a.str(2)) ? "check" : "do"),
      do: { role: "do", mark: "skill", label: (a) => `Raise ${titleCase(a.str(0))} to ${a.str(1) ?? "?"}` },
      // `<` reverses the check.
      check: {
        role: "check",
        phrase: (a) => {
          const level = (a.str(1) ?? "?").replace(/^</, "");
          return a.str(1)?.startsWith("<")
            ? `While ${titleCase(a.str(0))} is ${level} or above`
            : `While ${titleCase(a.str(0))} is below ${level}`;
        },
      },
    },
  },

  dungeon: {
    row: {
      role: "check",
      phrase: (a) => (a.str(0)?.startsWith("!") ? `Skip with dungeon ${a.str(0)!.slice(1)} on` : `Only with dungeon ${a.str(0) ?? "?"} on`),
    },
  },
  enabledungeon: { row: { role: "setting", phrase: (a) => `Turn on dungeon ${a.str(0) ?? "?"}` } },
  group: { row: { role: "check", phrase: (a) => (a.id(0) ? `Group quest for ${a.id(0)}+ players` : "Group quest") } },
  solo: { row: { role: "check", phrase: () => "Solo quest" } },
  disablecheckbox: { row: { role: "setting", phrase: () => "Hide checkbox", hint: "No checkbox on the line above" } },
  showwhiledead: { row: { role: "check", phrase: () => "While dead" } },
  link: { row: { role: "setting", phrase: () => "Link", hint: "Shows a link to copy" } },
  clicknext: { row: { role: "do", mark: "next", label: () => "Open the next guide" } },
  macro: { row: { role: "setting", phrase: (a) => `Macro ${a.str(0) ?? ""}`.trim() } },
  timer: { row: { role: "setting", phrase: (a) => `Timer ${a.str(0) ?? "?"} s` } },
};

/** The command's rule, or `undefined` for a command outside the catalog. */
export const commandRule = (name: string): CommandRule | undefined =>
  Object.hasOwn(COMMAND_RULES, name) ? COMMAND_RULES[name as CommandName] : undefined;

function standing(token: string | undefined): string {
  const n = Number(token);
  return Number.isInteger(n) && STANDINGS[n - 1] ? STANDINGS[n - 1]! : titleCase(token);
}
