// Catalog of the RXP commands and tags used by Classic Forever guides.
//
// Built from the bundled Forever guides and the decoded guide package.
// Argument lists follow the parse-time signatures of `addon.functions` in
// RXP's functions.lua: RXP calls each handler with the `>>` text
// first, then the split arguments listed here. Forms, line titles,
// autocomplete, and unknown-command warnings read this catalog; commands
// outside it may still exist in RXP.

export type ArgKind = "questId" | "npcId" | "itemId" | "spellId" | "zone" | "x" | "y" | "radius" | "number" | "text" | "flags";

export interface ArgSpec {
  name: string;
  kind: ArgKind;
  optional?: boolean;
  advanced?: true;
  note?: string;
}

type CommandCategory = "quest" | "location" | "npc" | "item" | "spell" | "travel" | "character" | "step";

export interface CommandSpec {
  name: string;
  title: string;
  category: CommandCategory;
  description: string;
  args: readonly ArgSpec[];
  repeat?: readonly ArgSpec[];
  /** RXP has no handler for this command, so the addon reports an error. */
  noHandler?: true;
  /**
   * How RXP splits the argument text, from `addon.separators` in functions.lua.
   * Without it, arguments split on commas. Semicolons let NPC names hold
   * commas; `whole` takes the text as one argument.
   */
  separator?: "semicolon" | "whole";
}

type TagScope = "header" | "step" | "both";

type TagValueKind = "flag" | "text" | "number" | "label" | "condition" | "zone";

export interface TagSpec {
  name: string;
  title: string;
  scope: TagScope;
  value: TagValueKind;
  description: string;
  /** Misspelled tag that RXP stores but never reads. */
  misspellingOf?: string;
}

const questId: ArgSpec = { name: "questId", kind: "questId" };
const npc: ArgSpec = {
  name: "npc",
  kind: "npcId",
  note: "NPC ID, name, or `Name::id`; `+` before the first marks a parent objective",
};
const itemId: ArgSpec = { name: "itemId", kind: "itemId" };
const spellId: ArgSpec = { name: "spellId", kind: "spellId" };
const flags: ArgSpec = { name: "flags", kind: "flags", optional: true, advanced: true };
const opt = (arg: ArgSpec): ArgSpec => ({ ...arg, optional: true });
// Arguments that RXP only tests for presence, so any value, even `0`, turns them on.
const toggle = (name: string, note = ""): ArgSpec => ({
  name,
  kind: "flags",
  optional: true,
  advanced: true,
  note: `Any value, including 0, turns this on${note}`,
});

const coords: ArgSpec[] = [
  { name: "zone", kind: "zone", note: "Zone name, UI map ID, or `mapId/instance` for world coordinates" },
  { name: "x", kind: "x" },
  { name: "y", kind: "y" },
];
const radius: ArgSpec = {
  name: "radius",
  kind: "radius",
  optional: true,
  note: "0 removes the arrow radius; a negative value makes it dynamic",
};
const objective: ArgSpec = { name: "objective", kind: "number" };
const objectiveMax: ArgSpec = {
  name: "max",
  kind: "number",
  optional: true,
  note: "RXP skips the waypoint once the objective count reaches this; 0 or less never skips",
};
const skippableQuest: ArgSpec = { ...questId, note: "A negative ID skips the step when the quest is not in the log" };

const commandList = [
  {
    name: "accept",
    title: "Accept quest",
    category: "quest",
    description: "Accept a quest.",
    args: [
      questId,
      { ...flags, note: "0x1 disables auto-accept; 0x2 completes the step unless `requiredTurnIn` is turned in" },
      { name: "requiredTurnIn", kind: "questId", optional: true, advanced: true, note: "Read with flag 0x2" },
    ],
  },
  {
    name: "acceptmultiple",
    title: "Accept one of several quests",
    category: "quest",
    description: "Accept any of several quests.",
    args: [],
    repeat: [questId],
  },
  // `.daily` is `addon.functions.daily` in RXP's functions.lua; `.acceptmultiple` runs the same handler.
  {
    name: "daily",
    title: "Accept daily quest",
    category: "quest",
    description: "Accept any of several daily quests; RXP's skip-dailies option skips the line.",
    args: [],
    repeat: [questId],
  },
  {
    name: "complete",
    title: "Quest objective",
    category: "quest",
    description: "Track a quest objective.",
    args: [
      skippableQuest,
      objective,
      { name: "max", kind: "number", optional: true, advanced: true, note: "0 or less is ignored" },
      { ...flags, note: "0x1 shows text only" },
    ],
  },
  {
    name: "turnin",
    title: "Turn in quest",
    category: "quest",
    description: "Turn in a quest.",
    args: [skippableQuest, { name: "reward", kind: "number", optional: true }, { ...flags, note: "0x1 disables auto turn-in" }],
  },
  {
    name: "dailyturnin",
    title: "Turn in daily quest",
    category: "quest",
    description: "Turn in any of several daily quests.",
    args: [],
    repeat: [questId],
  },
  { name: "abandon", title: "Abandon quest", category: "quest", description: "Abandon a quest.", args: [], repeat: [questId] },
  {
    name: "isOnQuest",
    title: "While quest in log",
    category: "quest",
    description: "Show the step only while a quest is in the log.",
    args: [],
    repeat: [questId],
  },
  {
    name: "isNotOnQuest",
    title: "While quest not in log",
    category: "quest",
    description: "Show the step only while a quest is not in the log.",
    args: [],
    repeat: [questId],
  },
  {
    name: "isQuestNotComplete",
    title: "While quest not complete",
    category: "quest",
    description: "Show the step while a quest’s objectives are not done.",
    args: [questId, { name: "mode", kind: "text", optional: true }],
  },
  {
    name: "vehicle",
    title: "Enter vehicle",
    category: "travel",
    description: "Enter a vehicle, optionally matching its NPC ID.",
    args: [{ name: "npcId", kind: "npcId", optional: true }],
  },
  {
    name: "isQuestComplete",
    title: "When quest complete",
    category: "quest",
    description: "Show the step only when a quest's objectives are done.",
    args: [questId, { name: "mode", kind: "text", optional: true, advanced: true, note: "`account` has no effect" }, toggle("reverse")],
  },
  {
    name: "isQuestTurnedIn",
    title: "After quest turned in",
    category: "quest",
    description: "Show the step only after a quest is turned in.",
    args: [],
    repeat: [{ ...questId, note: "`account` checks account-wide" }],
  },
  {
    name: "isQuestAvailable",
    title: "Until quest turned in",
    category: "quest",
    description: "Show the step only while a quest is not yet turned in.",
    args: [],
    repeat: [{ ...questId, note: "`account` checks account-wide" }],
  },

  {
    name: "goto",
    title: "Go to",
    category: "location",
    description: "Set a map waypoint.",
    args: [...coords, radius, toggle("optional", "; the waypoint becomes optional")],
  },
  {
    name: "groundgoto",
    title: "Go to by ground",
    category: "location",
    description: "Set a map waypoint that RXP skips while the character can fly.",
    args: [...coords, radius, toggle("optional", "; the waypoint becomes optional")],
  },
  // `addon.functions.flygoto` in RXP's functions.lua calls `DetectFlying` with
  // `mode` false, which never changes `skip`, so the line runs as `.goto`.
  {
    name: "flygoto",
    title: "Fly to",
    category: "location",
    description: "Set a map waypoint, the same as `.goto`.",
    args: [...coords, radius, toggle("optional", "; the waypoint becomes optional")],
  },
  // `addon.functions.questgoto` passes `.goto` an `optional` of "0" and puts
  // its own last argument where `.goto` reads nothing.
  {
    name: "questgoto",
    title: "Go to for objective",
    category: "location",
    description: "Set an optional map waypoint that RXP skips once a quest objective reaches its count.",
    args: [
      ...coords,
      {
        name: "radius",
        kind: "radius",
        note: "0 makes the waypoint low priority; a positive value hides the map pin; a negative value makes it dynamic",
      },
      questId,
      objective,
      objectiveMax,
    ],
  },
  {
    name: "waypoint",
    title: "Arrow waypoint",
    category: "location",
    description: "Set an arrow-only waypoint.",
    args: [
      ...coords,
      radius,
      {
        name: "lowPriorityOrCallback",
        kind: "text",
        optional: true,
        advanced: true,
        note: "Any number makes the waypoint low priority; a name is a callback function that receives the radius argument",
      },
    ],
    repeat: [{ name: "event", kind: "text", note: "Events for the callback" }],
  },
  {
    name: "questwaypoint",
    title: "Arrow waypoint for objective",
    category: "location",
    description: "Set an arrow-only waypoint that RXP skips once a quest objective reaches its count.",
    args: [
      ...coords,
      { name: "radius", kind: "radius", note: "0 makes the waypoint low priority; a negative value makes it dynamic" },
      questId,
      objective,
      objectiveMax,
      toggle("lowPriority", "; the waypoint becomes low priority, and a value that is not a number also removes the radius"),
    ],
  },
  // `addon.functions.ingamewaypoint` reads a fourth argument but never uses it.
  {
    name: "ingamewaypoint",
    title: "Game waypoint",
    category: "location",
    description: "Set the game's own map waypoint while the step is active.",
    args: coords,
  },
  {
    name: "pin",
    title: "Map pin",
    category: "location",
    description: "Put a pin on the map, with no arrow.",
    args: [...coords, { name: "tooltip", kind: "text", optional: true, note: "Text that the pin shows on hover" }],
  },
  {
    name: "treasure",
    title: "Treasure",
    category: "location",
    description: "Pin a treasure on the map while RXP's show-treasures option is on.",
    args: [...coords, { ...questId, optional: true, note: "RXP drops the line once this quest is turned in" }],
  },
  {
    name: "rare",
    title: "Rare NPC",
    category: "location",
    description: "Pin a rare NPC on the map while RXP's show-rares option is on.",
    args: [...coords, { name: "npc", kind: "npcId", note: "NPC name or ID" }],
  },
  {
    name: "line",
    title: "Map line",
    category: "location",
    description: "Draw a line on the map.",
    args: [
      { ...coords[0]!, note: "Zone name, UI map ID, or `mapId/instance` for world coordinates; `+` before a map ID adds a center point" },
    ],
    repeat: [
      { name: "x", kind: "x" },
      { name: "y", kind: "y" },
    ],
  },
  {
    name: "loop",
    title: "Map loop",
    category: "location",
    description: "Draw a closed path on the map; the arrow cycles through its points.",
    args: [
      {
        name: "range",
        kind: "radius",
        note: "Arrival radius; `+` before it adds a center point, `*` hides the lines, `@` points the arrow at the nearest point",
      },
      { name: "zone", kind: "zone", note: "Zone name or UI map ID; no `mapId/instance` form" },
    ],
    repeat: [
      { name: "x", kind: "x" },
      { name: "y", kind: "y" },
    ],
  },
  {
    name: "zone",
    title: "Enter zone",
    category: "location",
    description: "Complete on entering a zone; needs `>>` text.",
    args: [{ name: "zone", kind: "zone" }],
  },
  {
    name: "zoneskip",
    title: "Skip in zone",
    category: "location",
    description: "Skip the step in a zone.",
    args: [
      { name: "zones", kind: "zone", note: "Zone names or map IDs joined by `+` or `/`; no `mapId/instance` form" },
      { ...flags, note: "0x1 reverses" },
    ],
  },
  {
    name: "subzone",
    title: "Enter subzone",
    category: "location",
    description: "Complete on entering a subzone; needs `>>` text.",
    args: [
      { name: "areaId", kind: "number" },
      { ...flags, note: "0x1 reverses; 0x2 matches only where no map exists" },
    ],
  },
  {
    name: "subzoneskip",
    title: "Skip in subzone",
    category: "location",
    description: "Skip the step in a subzone.",
    args: [
      { name: "areaId", kind: "number" },
      { ...flags, note: "0x1 reverses; 0x2 matches only where no map exists" },
    ],
  },

  {
    name: "target",
    title: "Target NPC",
    category: "npc",
    description: "Add NPCs to the target macro.",
    args: [],
    repeat: [npc],
    separator: "semicolon",
  },
  { name: "mob", title: "Kill", category: "npc", description: "Mark mobs to kill.", args: [], repeat: [npc], separator: "semicolon" },
  {
    name: "unitscan",
    title: "Scan for NPC",
    category: "npc",
    description: "Scan for NPCs nearby.",
    args: [],
    repeat: [npc],
    separator: "semicolon",
  },
  {
    name: "vendor",
    title: "Vendor",
    category: "npc",
    description: "Visit a vendor.",
    args: [{ name: "npcId", kind: "npcId", optional: true }],
  },
  {
    name: "trainer",
    title: "Trainer",
    category: "npc",
    description: "Visit a class trainer.",
    args: [{ name: "npcId", kind: "npcId", optional: true }],
  },
  { name: "tame", title: "Tame pet", category: "npc", description: "Tame a creature.", args: [{ name: "npcId", kind: "npcId" }] },
  {
    name: "stable",
    title: "Stable pet",
    category: "npc",
    description: "Stable a pet.",
    args: [{ name: "npcId", kind: "npcId", optional: true }],
  },
  {
    name: "skipgossip",
    title: "Skip gossip",
    category: "npc",
    description: "Skip NPC gossip automatically.",
    args: [{ name: "npcId", kind: "npcId", optional: true, note: "0 means any NPC; alone, a value up to 9 is an option index" }],
    repeat: [{ name: "option", kind: "number", note: "Chosen in turn" }],
  },
  {
    name: "skipgossipid",
    title: "Gossip by ID",
    category: "npc",
    description: "Choose gossip options by ID.",
    args: [],
    repeat: [{ name: "gossipId", kind: "number", note: "`+` before the first marks a parent objective" }],
  },
  {
    name: "gossipoption",
    title: "Gossip option",
    category: "npc",
    description: "Choose a gossip option.",
    args: [{ name: "gossipId", kind: "number" }],
  },
  {
    name: "emote",
    title: "Emote",
    category: "npc",
    description: "Perform an emote at an NPC.",
    args: [
      { name: "emote", kind: "text" },
      { name: "npcId", kind: "npcId", optional: true, note: "Omit to emote at any target" },
      { name: "callback", kind: "text", optional: true, advanced: true },
    ],
    repeat: [{ name: "event", kind: "text", note: "Events for the callback" }],
  },

  {
    name: "collect",
    title: "Collect items",
    category: "item",
    description: "Collect items.",
    args: [
      { ...itemId, note: "Every digit run counts, so `123/456` adds both items" },
      { name: "count", kind: "number", optional: true, note: "Defaults to 1" },
      opt(questId),
      { name: "objectiveFlags", kind: "flags", optional: true, advanced: true, note: "Bit N-1 tracks objective N" },
      {
        ...flags,
        note: "0x1 text only, 0x2 subtract, 0x4 check objectives, 0x8 include bank, 0x10 ignore turn-in, 0x20 profession, 0x40 ignore when none; negative: subtract per profession",
      },
      {
        name: "profession",
        kind: "text",
        optional: true,
        advanced: true,
        note: "With 0x20 or negative flags: profession, or `item`; with 0x2: multiplier; with 0x40: ignore bank",
      },
      { name: "multiplier", kind: "number", optional: true, advanced: true, note: "With 0x20" },
      {
        name: "skillStart",
        kind: "number",
        optional: true,
        advanced: true,
        note: "With 0x20: starting skill, or an item ID when `profession` is `item`",
      },
      { name: "minimum", kind: "number", optional: true, advanced: true, note: "With 0x20: total minimum" },
    ],
  },
  {
    name: "itemcount",
    title: "Check item count",
    category: "item",
    description: "Check an item count.",
    args: [
      { ...itemId, note: "Several IDs may be joined by a non-comma separator" },
      { name: "count", kind: "text", note: "Number with optional `<`, `>`, `<=`, or `>=`" },
      toggle("includeBank"),
    ],
  },
  {
    name: "use",
    title: "Use item",
    category: "item",
    description: "Use an item.",
    args: [],
    repeat: [{ ...itemId, note: "`:p` after the ID shows it even when not in bags" }],
  },
  {
    name: "buy",
    title: "Buy items",
    category: "item",
    description: "Buy items from a vendor while the step is active; the step does not wait for it.",
    args: [
      itemId,
      { name: "count", kind: "number", optional: true, note: "Defaults to 1; RXP buys only what the bags lack" },
      {
        ...questId,
        optional: true,
        advanced: true,
        note: "Stops buying once the quest is complete or turned in, or its `objective` is done",
      },
      { name: "objective", kind: "number", optional: true, advanced: true },
    ],
  },
  {
    name: "useitem",
    title: "Use item (no handler)",
    category: "item",
    description: "Use an item. RXP has no handler for it.",
    args: [itemId],
    noHandler: true,
  },
  {
    name: "equip",
    title: "Equip item",
    category: "item",
    description: "Equip an item.",
    args: [{ name: "slot", kind: "number", note: "Negative checks that the item is not equipped" }, opt(itemId)],
  },
  { name: "destroy", title: "Destroy item", category: "item", description: "Destroy an item.", args: [itemId] },
  {
    name: "itemStat",
    title: "Check item stat",
    category: "item",
    description: "Compare an equipped item's stat.",
    args: [
      { name: "slot", kind: "number" },
      { name: "stat", kind: "text", note: "`ITEM_MOD_*` key, `QUALITY`, or `LEVEL`" },
      { name: "value", kind: "text", note: "Number with optional `<` or `>`" },
    ],
  },
  { name: "addquestitem", title: "Link item to quest", category: "item", description: "Link an item to a quest.", args: [itemId, questId] },
  {
    name: "bankdeposit",
    title: "Bank deposit",
    category: "item",
    description: "Deposit items in the bank.",
    args: [],
    repeat: [{ ...itemId, note: "Item ID or name" }],
  },
  {
    name: "bankwithdraw",
    title: "Bank withdrawal",
    category: "item",
    description: "Withdraw items from the bank.",
    args: [],
    repeat: [{ ...itemId, note: "Item ID or name" }],
  },
  {
    name: "bronzetube",
    title: "Check Bronze Tube",
    category: "item",
    description: "Check for the Mechanical Bronze Tube.",
    args: [toggle("reverse")],
  },

  {
    name: "cast",
    title: "Cast spell",
    category: "spell",
    description: "Cast a spell.",
    args: [],
    repeat: [{ ...spellId, note: "A name in the first position is the unit to watch instead" }],
  },
  {
    name: "usespell",
    title: "Use spell",
    category: "spell",
    description: "Use a learned spell.",
    args: [],
    repeat: [{ ...spellId, note: "`:p` after the ID shows it even when not known" }],
  },
  {
    name: "train",
    title: "Train spell",
    category: "spell",
    description: "Train a spell.",
    args: [spellId, { ...flags, note: "0x1 text only; 0x2 reverses" }],
  },
  {
    name: "aura",
    title: "Check aura",
    category: "spell",
    description: "Check a buff or debuff.",
    args: [
      { ...spellId, note: "Negative checks that the aura is absent" },
      {
        name: "check",
        kind: "text",
        optional: true,
        note: "`N`: over N seconds left; `<N`: under; `N+`: at least N stacks; `N-`: fewer than N stacks",
      },
      { name: "unit", kind: "text", optional: true, note: "Defaults to `player`" },
    ],
  },
  {
    name: "engrave",
    title: "Engrave rune",
    category: "spell",
    description: "Engrave a rune.",
    args: [{ name: "slot", kind: "number", note: "Negative reverses" }, opt(spellId)],
  },
  {
    name: "cooldown",
    title: "Check cooldown",
    category: "spell",
    description: "Check a cooldown.",
    args: [
      { name: "type", kind: "text", note: "`spell`, `item`, `action`, `pet`, or `inventory`" },
      { name: "id", kind: "number" },
      { name: "remaining", kind: "text", note: "Time with optional `<` or `>` and `m` or `s`" },
      toggle("updateOnce"),
    ],
  },

  {
    name: "fly",
    title: "Fly",
    category: "travel",
    description: "Fly to a flight point.",
    args: [{ name: "destination", kind: "text", optional: true, note: "Required without `>>` text" }],
  },
  {
    name: "fp",
    title: "Get flight path",
    category: "travel",
    description: "Get a flight point.",
    args: [
      { name: "location", kind: "text" },
      { ...flags, note: "0x1 text only; 0x2 ignore on click" },
    ],
  },
  {
    name: "hs",
    title: "Hearthstone",
    category: "travel",
    description: "Use the Hearthstone; needs `>>` text.",
    args: [{ name: "location", kind: "text", optional: true, advanced: true, note: "Unused by RXP" }],
  },
  {
    name: "home",
    title: "Check hearth location",
    category: "travel",
    description: "Check the hearth location.",
    args: [{ name: "areaId", kind: "number", optional: true, note: "RXP ignores names" }],
  },
  {
    name: "bindlocation",
    title: "Set hearth location",
    category: "travel",
    description: "Set the hearth location.",
    args: [
      { name: "areaId", kind: "number" },
      { ...flags, note: "0x1 reverses" },
    ],
  },
  {
    name: "deathskip",
    title: "Death skip",
    category: "travel",
    description: "Die, then come back to life at the spirit healer.",
    args: [],
  },
  {
    name: "blastedLands",
    title: "Check Blasted Lands shortcut",
    category: "travel",
    description: "Check the Blasted Lands shortcut.",
    args: [],
  },

  {
    name: "xp",
    title: "Reach XP",
    category: "character",
    description: "Grind to an XP threshold, or with `skipStep`, skip the step once it is reached.",
    args: [
      {
        name: "level",
        kind: "text",
        note: "`8` is level 8; `8+1200` is 1200 XP into it; `8.5` is half of it; `8-300` is 300 XP short of it. `<` reverses the check; `>` has no effect",
      },
      {
        name: "skipStep",
        kind: "number",
        optional: true,
        note: "Any number skips the step once the threshold is reached; a negative number skips it until then",
      },
      { name: "ref", kind: "text", optional: true, note: "With `skipStep`, the label to jump to instead; ignored when the guide lacks it" },
    ],
  },
  { name: "xpto60", title: "XP to level 60", category: "character", description: "Show XP left to level 60.", args: [] },
  {
    name: "maxlevel",
    title: "Max level",
    category: "character",
    description: "Skip the step, or jump to a label, above a level.",
    args: [
      {
        name: "level",
        kind: "text",
        note: "The step runs at this level and below; RXP ignores `+xp`, `.fraction`, or `-remaining` after it",
      },
      { name: "ref", kind: "text", optional: true, note: "Label to jump to instead; ignored when the guide lacks it" },
    ],
  },
  {
    name: "money",
    title: "Check gold",
    category: "character",
    description: "Check gold.",
    args: [
      { name: "gold", kind: "text", note: "`<` or `>` then gold" },
      { name: "useNetWorth", kind: "flags", optional: true, advanced: true, note: "Only `1` turns this on" },
    ],
  },
  {
    name: "reputation",
    title: "Check reputation",
    category: "character",
    description: "Check faction standing.",
    args: [
      { name: "factionId", kind: "number" },
      { name: "standing", kind: "text", note: "Name or number, with optional `<`" },
      { name: "value", kind: "text", optional: true, note: "Number with optional `<`" },
      toggle("skipStep"),
    ],
  },
  {
    name: "skill",
    title: "Check skill",
    category: "character",
    description: "Check profession skill.",
    args: [
      { name: "skill", kind: "text" },
      { name: "level", kind: "text", note: "Number with optional `<`" },
      { name: "skipStep", kind: "number", optional: true },
      toggle("useMaxValue"),
    ],
  },

  {
    name: "dungeon",
    title: "Dungeon",
    category: "step",
    description: "Mark the step for a dungeon; `!` skips it when the dungeon is chosen.",
    args: [{ name: "instance", kind: "text" }],
  },
  {
    name: "enabledungeon",
    title: "Enable dungeon",
    category: "step",
    description:
      "Turn a dungeon on for every guide in this guide's group, over RXP's settings and `#disabledungeons`; `!` turns it off. Optional `>>` text.",
    args: [{ name: "instance", kind: "text" }],
  },
  {
    name: "group",
    title: "Group quest",
    category: "step",
    description: "Mark a group quest.",
    args: [{ name: "players", kind: "number", optional: true }],
  },
  { name: "solo", title: "Solo quest", category: "step", description: "Mark a quest to solo.", args: [] },
  { name: "disablecheckbox", title: "Hide checkbox", category: "step", description: "Hide the previous objective's checkbox.", args: [] },
  {
    name: "showwhiledead",
    title: "Show while dead",
    category: "step",
    description: "Completes the step when the character is alive, so it shows only while dead. Route previews keep the step.",
    args: [],
  },
  {
    name: "link",
    title: "Link",
    category: "step",
    description: "Show a link; needs `>>` text.",
    args: [{ name: "url", kind: "text" }],
    separator: "whole",
  },
  {
    name: "clicknext",
    title: "Next guide",
    category: "step",
    description: "Open the next guide on click; needs `>>` text.",
    args: [{ name: "guide", kind: "text" }],
    separator: "whole",
  },
  {
    name: "macro",
    title: "Macro",
    category: "step",
    description: "Create a macro; the `>>` text is its body.",
    args: [
      { name: "name", kind: "text" },
      { name: "icon", kind: "number", optional: true },
    ],
  },
  {
    name: "timer",
    title: "Timer",
    category: "step",
    description: "Show a timer.",
    args: [
      { name: "seconds", kind: "number" },
      { name: "label", kind: "text" },
      { name: "callback", kind: "text", optional: true, advanced: true },
    ],
    repeat: [{ name: "event", kind: "text", note: "Stored but not used by RXP" }],
  },
] as const satisfies readonly CommandSpec[];

const tagList = [
  { name: "name", title: "Guide name", scope: "header", value: "text", description: "Guide name; required." },
  { name: "group", title: "Guide group", scope: "header", value: "text", description: "Guide group; required." },
  { name: "subgroup", title: "Subgroup", scope: "header", value: "text", description: "Menu subgroup." },
  { name: "displayname", title: "Display name", scope: "header", value: "text", description: "Name shown instead of `#name`." },
  { name: "next", title: "Next guide", scope: "header", value: "text", description: "Next guide name." },
  {
    name: "defaultfor",
    title: "Default for",
    scope: "header",
    value: "condition",
    description: "Characters that get this guide by default.",
  },
  { name: "version", title: "Version", scope: "header", value: "number", description: "Guide revision." },
  { name: "forever", title: "Forever guide", scope: "header", value: "flag", description: "Forever guide." },
  { name: "classic", title: "Classic guide", scope: "header", value: "flag", description: "Classic guide." },
  { name: "tbc", title: "TBC guide", scope: "header", value: "flag", description: "TBC guide." },
  { name: "internal", title: "Internal guide", scope: "header", value: "flag", description: "Internal guide." },
  { name: "somname", title: "Season of Mastery name", scope: "header", value: "text", description: "Season of Mastery display name." },
  {
    name: "disabledungeons",
    title: "Disable dungeons",
    scope: "header",
    value: "flag",
    description: "Hide the guide's dungeon steps, whatever RXP's settings choose. `.enabledungeon` in the group still turns a dungeon on.",
  },

  {
    name: "season",
    title: "Seasons",
    scope: "both",
    value: "text",
    description: "Comma-separated seasons: 0 Era, 1 Season of Mastery, 2 Season of Discovery.",
  },
  {
    name: "xprate",
    title: "XP rate range",
    scope: "both",
    value: "text",
    description: "Shown only for an XP rate of <N, >N, N, or N-M.",
  },
  {
    name: "era/som",
    title: "Era or early Season of Mastery",
    scope: "both",
    value: "flag",
    description: "Era or Season of Mastery before phase 3.",
  },
  {
    name: "maxlevel",
    title: "Max level",
    scope: "both",
    value: "number",
    description: "Skip above this level; RXP skips by level by default.",
  },
  {
    name: "beta",
    title: "Beta",
    scope: "both",
    value: "flag",
    description: "Hidden unless RXP's beta features setting is on. It is off by default.",
  },

  {
    name: "label",
    title: "Label",
    scope: "step",
    value: "label",
    description: "Step name for #requires, #completewith, and .xp skips.",
  },
  {
    name: "completewith",
    title: "Complete with",
    scope: "step",
    value: "label",
    description: "Completes with the named step, or 'next'. Also makes this step sticky.",
  },
  {
    name: "requires",
    title: "Requires",
    scope: "step",
    value: "label",
    description: "Activates after the labelled step is done. A sticky step without #completewith then completes with this one.",
  },
  {
    name: "optional",
    title: "Optional",
    scope: "step",
    value: "flag",
    description: "The guide never waits on this step. A step with no actions is optional anyway.",
  },
  {
    name: "sticky",
    title: "Sticky",
    scope: "step",
    value: "flag",
    description: "Stays active beside later steps until its objectives are done.",
  },
  {
    name: "loop",
    title: "Loop waypoints",
    scope: "step",
    value: "flag",
    description: "Restarts the waypoints after the arrow reaches them all.",
  },
  { name: "hidewindow", title: "Hide in window", scope: "step", value: "flag", description: "Hide the step in the guide window." },
  {
    name: "ignorecorpse",
    title: "Ignore corpse",
    scope: "step",
    value: "flag",
    description: "While the character is a ghost, the arrow keeps this step's waypoint instead of pointing to the corpse.",
  },
  {
    name: "level",
    title: "Minimum level",
    scope: "step",
    value: "number",
    description: "Activates at this level or higher.",
  },
  {
    name: "phase",
    title: "Phase",
    scope: "step",
    value: "text",
    description: "Content phase: N or later, or the range N-M.",
  },
  { name: "era", title: "Not in Season of Mastery", scope: "step", value: "flag", description: "Hidden in Season of Mastery." },
  {
    name: "som",
    title: "Season of Mastery only",
    scope: "step",
    value: "flag",
    description: "Shown only in Season of Mastery (season 1).",
  },
  {
    name: "hardcore",
    title: "Hardcore only",
    scope: "step",
    value: "flag",
    description: "Hidden on Forever, where RXP keeps hardcore mode off.",
  },
  {
    name: "softcore",
    title: "Softcore only",
    scope: "step",
    value: "flag",
    description: "Shown on Forever, where RXP keeps hardcore mode off.",
  },
  { name: "hardcoreserver", title: "Hardcore realms only", scope: "step", value: "flag", description: "Show only on hardcore realms." },
  { name: "softcoreserver", title: "Not on hardcore realms", scope: "step", value: "flag", description: "Hide on hardcore realms." },
  {
    name: "ssf",
    title: "Solo self-found only",
    scope: "step",
    value: "flag",
    description: "Shown only when RXP's solo self-found option is on.",
  },
  {
    name: "ah",
    title: "Auction house",
    scope: "step",
    value: "flag",
    description: "Hidden when solo self-found is on.",
  },
  { name: "map", title: "Map", scope: "step", value: "zone", description: "Map to show." },
  { name: "icon", title: "Icon", scope: "step", value: "text", description: "Step icon texture." },
  { name: "title", title: "Step title", scope: "step", value: "text", description: "Step title." },
  { name: "arrowtext", title: "Arrow text", scope: "step", value: "text", description: "Waypoint arrow label." },
  { name: "stop", title: "Stop marker", scope: "step", value: "flag", description: "Stop marker." },
  { name: "qremove", title: "Quest removal hint", scope: "step", value: "text", description: "Quest removal hint; RXP does not read it." },
  {
    name: "completwith",
    title: "Complete with (misspelled)",
    scope: "step",
    value: "label",
    description: "Misspelled `#completewith`; RXP ignores it.",
    misspellingOf: "completewith",
  },
  {
    name: "sofcore",
    title: "Softcore only (misspelled)",
    scope: "step",
    value: "flag",
    description: "Misspelled `#softcore`; RXP ignores it.",
    misspellingOf: "softcore",
  },
] as const satisfies readonly TagSpec[];

export type CommandName = (typeof commandList)[number]["name"];

export type TagName = (typeof tagList)[number]["name"];

export const COMMANDS: ReadonlyMap<string, CommandSpec> = new Map(commandList.map((c) => [c.name, c]));

export const TAGS: ReadonlyMap<string, TagSpec> = new Map(tagList.map((t) => [t.name, t]));

export function tagAllowedIn(tag: TagSpec, section: "header" | "step"): boolean {
  return tag.scope === "both" || tag.scope === section;
}

export function argSpecAt(command: CommandSpec, index: number): ArgSpec | undefined {
  if (index < command.args.length) return command.args[index];
  const repeat = command.repeat;
  if (!repeat || repeat.length === 0) return undefined;
  return repeat[(index - command.args.length) % repeat.length];
}
