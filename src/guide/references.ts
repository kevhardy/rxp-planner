import type { EntityType } from "../../packages/data-contract/entities.ts";
import { argSpecAt, COMMANDS, type ArgKind } from "./catalog.ts";
import { luaNumber } from "./luaNumber.ts";

export interface EntityReference {
  readonly type: EntityType;
  readonly id: number;
  readonly label: string;
}

/** Half-open UTF-16 offsets into the original string, as used by textarea. */
export interface EntityReferenceSpan {
  readonly type: EntityType;
  readonly id: number;
  readonly start: number;
  readonly end: number;
}

/** Plain RXP description text, never HTML. Throws for invalid identity or RXP delimiters. */
export function formatEntityReference(reference: EntityReference): string {
  const { type, id, label } = reference;
  if (!isType(type) || !Number.isSafeInteger(id) || id <= 0 || !safeLabel(label)) {
    throw new Error("Invalid entity reference");
  }
  return `${label} (${type} #${id})`;
}

/**
 * Parses one complete reference whose label boundary the caller already knows.
 * Passing prose such as "Use Hearthstone (item #6948)" makes "Use Hearthstone"
 * the label. Use findEntityReferences for prose; it never guesses that boundary.
 * A valid ID need not exist in the snapshot; use lookup to resolve it.
 * `npcName` gives the names of the npc:Name:ID references inside a colored
 * `Name::ID`, which RXP puts in its label.
 */
export function parseEntityReference(text: string, npcName?: (id: number) => string | undefined): EntityReference | undefined {
  if (/[\x00-\x1f\x7f\u2028\u2029]/.test(text)) return undefined;
  const explicit = /^(.*?) \((item|quest|npc|spell|object) #([1-9]\d*)\)$/.exec(text);
  if (explicit) return reference(explicit[2]!, explicit[3]!, explicit[1]!);
  // RXP's `addon.ReplaceNpcIds` in functions.lua accepts hex colors; `addon.DrawArrow` in map.lua
  // converts every RXP_[A-Z]+_ color, including unknown colors, to hex.
  const colored = /^\|c(?:RXP_[A-Z]+_|[0-9a-fA-F]{8})([^|]+)\|r$/.exec(text);
  const content = colored?.[1] ?? text;
  // ReplaceNpcIds uses the first colon followed by digits; names may contain colons.
  const npc = /^npc:(.*?):(\d+)(.*)$/.exec(content);
  if (npc?.[3] === "") return legacyNpc(npc[2]!, npc[1]!);
  if (!colored) return undefined;
  // ReplaceNpcIds resolves `npc:Name:ID` first, then reads colored `Name::ID` from the resulting text.
  const shown = content.replace(/npc:(.*?):(\d+)/g, (_, written: string, id: string) => npcName?.(Number(id)) ?? written);
  const double = /^([^:]+)::([1-9]\d*)$/.exec(shown);
  return double ? legacyNpc(double[2]!, double[1]!) : undefined;
}

/** RXP shows a legacy NPC name as written, with its edge spaces. */
function legacyNpc(digits: string, label: string): EntityReference | undefined {
  const parsed = reference("npc", digits, label.trim());
  return parsed && { ...parsed, label };
}

/**
 * Finds explicit markers in prose. Plain references span only `(type #ID)`;
 * legacy NPC references span their full `npc:...:ID` or colored `Name::ID`.
 * A colored `Name::ID` span comes before the `npc:...:ID` spans inside it.
 * To include a plain label, UI may extend left only when the preceding text
 * equals the resolved entity name. No names, color names, or textures imply IDs.
 */
export function findEntityReferences(text: string): EntityReferenceSpan[] {
  const spans: EntityReferenceSpan[] = [];
  const tokens =
    /\|\||\|T[^|]*\|t|\|c(?:RXP_[A-Z]+_|[0-9a-fA-F]{8})[^|]*\|r|\([A-Za-z]+ #[^()\r\n]*\)|npc:[^|\r\n]*?:[+-]?\d[\p{L}\p{N}_.:+-]*/gu;
  for (const match of text.matchAll(tokens)) {
    const token = match[0].startsWith("npc:") ? match[0].replace(/\.+$/, "") : match[0];
    const marker = /^\((item|quest|npc|spell|object) #([1-9]\d*)\)$/.exec(token);
    const parsed = marker ? reference(marker[1]!, marker[2]!, "marker") : parseEntityReference(token);
    if (parsed) spans.push({ type: parsed.type, id: parsed.id, start: match.index, end: match.index + token.length });
    if (token.startsWith("|c")) {
      const prefix = /^\|c(?:RXP_[A-Z]+_|[0-9a-fA-F]{8})/.exec(token)![0].length;
      const content = token.slice(prefix, -2);
      for (const span of findEntityReferences(content)) {
        if (parsed && span.end - span.start === content.length) continue;
        spans.push({ ...span, start: match.index + prefix + span.start, end: match.index + prefix + span.end });
      }
    }
  }
  return spans;
}

export interface EntityId {
  readonly type: EntityType;
  readonly id: number;
}

const ID_TYPES: Partial<Record<ArgKind, EntityType>> = { questId: "quest", npcId: "npc", itemId: "item", spellId: "spell" };

/**
 * Whether the command lists units: RXP splits these on semicolons and reads
 * each through `CheckNpcIds` in functions.lua, which reads `Name::id`.
 */
const isUnitList = (command: string) => COMMANDS.get(command)?.separator === "semicolon";

/**
 * The entities that argument `index` of a command names, following the
 * catalog and RXP's handlers in functions.lua. Signs, `+` parent
 * markers, `:p` suffixes, and `Name::id` are argument syntax, not part of
 * the ID; names, `0`, and gossip option indexes name no entity. Read only;
 * the arguments stay as written.
 */
export function argumentEntities(command: string, args: readonly string[], index: number): EntityId[] {
  const type = argumentType(command, args, index);
  const value = args[index]?.trim() ?? "";
  if (!type) return [];
  if (command === "cooldown") return ids(type, value, /^(\d+)$/);
  switch (type) {
    case "quest": {
      const id = questArgument(command, args, index);
      return id !== undefined && id > 0 && Number.isSafeInteger(id) ? [{ type, id }] : [];
    }
    case "npc": {
      // Unit lists read `Name::id`; the other handlers read a number with `tonumber`.
      const found = ids(type, value, isUnitList(command) ? /^\+?(?:.+::)?(\d+)$/ : /^\+?(\d+)$/);
      // Alone, a value up to 9 is a gossip option index.
      return command === "skipgossip" && args.length === 1 && found[0] && found[0].id <= 9 ? [] : found;
    }
    case "item":
      // Every digit run is an item ID.
      if (command === "collect" || command === "itemcount") return ids(type, value, /\d+/g);
      return ids(type, value, command === "use" ? /^(\d+)(?::\S*)?$/ : /^(\d+)$/);
    default:
      // Negative checks that the aura is absent.
      return ids(type, value, command === "aura" ? /^-?(\d+)$/ : command === "usespell" ? /^(\d+)(?::\S*)?$/ : /^(\d+)$/);
  }
}

/**
 * The quest ID in argument `index` of a command, read with `tonumber` as RXP's
 * handlers in functions.lua read it. `addon.functions.turnin` and
 * `addon.functions.complete` take the absolute value of a negative first
 * argument, and skip the line while that quest is not in the log. Every other
 * handler keeps the sign, so a negative ID names no quest. Undefined for an
 * argument that is not a whole number other than 0.
 */
export function questArgument(command: string, args: readonly string[], index: number): number | undefined {
  const n = luaNumber(args[index] ?? "");
  if (n === undefined || !Number.isInteger(n) || n === 0) return undefined;
  return index === 0 && (command === "turnin" || command === "complete") ? Math.abs(n) : n;
}

export function argumentType(command: string, args: readonly string[], index: number): EntityType | undefined {
  // `.cooldown type,id,…`: the type names what the ID is.
  if (command === "cooldown") {
    const type = args[0]?.trim();
    return index === 1 && (type === "item" || type === "spell") ? type : undefined;
  }
  const spec = COMMANDS.get(command);
  const kind = spec && argSpecAt(spec, index)?.kind;
  return kind && ID_TYPES[kind];
}

export function hasEntityArguments(command: string): boolean {
  const spec = COMMANDS.get(command);
  return command === "cooldown" || (!!spec && [...spec.args, ...(spec.repeat ?? [])].some((arg) => ID_TYPES[arg.kind]));
}

/** Where an argument holds its entity's ID: `value.slice(start, end)`. */
export interface IdSlot {
  readonly type: EntityType;
  readonly start: number;
  readonly end: number;
}

/**
 * The part of argument `index` that holds its entity's ID, or the name or ID
 * a search is looking for, inside the syntax that `argumentEntities` reads:
 * a sign, `+`, `Name::`, or a `:p` suffix. Replacing that part with an ID
 * keeps the syntax; `Name::id` keeps its name. In `.collect` and
 * `.itemcount`, which read every digit run, it is the `/`-separated part at
 * `caret`, and there is none when that part holds several IDs. There is none
 * for arguments that name no entity, or for a lone `.skipgossip` option index.
 */
export function argumentIdSlot(
  command: string,
  args: readonly string[],
  index: number,
  caret = args[index]?.length ?? 0,
): IdSlot | undefined {
  const type = argumentType(command, args, index);
  const value = args[index] ?? "";
  if (!type || (command === "skipgossip" && args.length === 1 && /^\+?0*\d$/.test(value.trim()))) return undefined;
  if (type === "item" && (command === "collect" || command === "itemcount")) {
    const start = caret > 0 ? value.lastIndexOf("/", caret - 1) + 1 : 0;
    const next = value.indexOf("/", caret);
    const end = next < 0 ? value.length : next;
    return (value.slice(start, end).match(/\d+/g) ?? []).length <= 1 ? { type, start, end } : undefined;
  }
  const signed = (type === "quest" && (command === "complete" || command === "turnin")) || (type === "spell" && command === "aura");
  const prefix = signed ? /^\s*-?/ : type === "npc" ? (isUnitList(command) ? /^\s*\+?(?:.+::)?/ : /^\s*\+?/) : /^\s*/;
  const start = prefix.exec(value)![0].length;
  const suffix = command === "use" || command === "usespell" ? value.indexOf(":", start) : -1;
  return { type, start, end: suffix < 0 ? value.length : suffix };
}

export function commandEntities(command: string, args: readonly string[]): (EntityId & { arg: number })[] {
  return args.flatMap((_, arg) => argumentEntities(command, args, arg).map((entity) => ({ ...entity, arg })));
}

function ids(type: EntityType, value: string, pattern: RegExp): EntityId[] {
  const digits = pattern.global ? (value.match(pattern) ?? []) : [pattern.exec(value)?.[1]].filter((d) => d !== undefined);
  return digits
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .map((id) => ({ type, id }));
}

/** Replaces a UTF-16 selection (as used by textarea), returning the new caret. */
export function insertEntityReference(text: string, start: number, end: number, value: EntityReference): { text: string; caret: number } {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw new RangeError("Invalid reference selection");
  }
  const inserted = formatEntityReference(value);
  return { text: text.slice(0, start) + inserted + text.slice(end), caret: start + inserted.length };
}

function reference(type: string, digits: string, label: string): EntityReference | undefined {
  const id = Number(digits);
  return isType(type) && /^[1-9]\d*$/.test(digits) && Number.isSafeInteger(id) && safeLabel(label) ? { type, id, label } : undefined;
}

function isType(type: string): type is EntityType {
  return type === "item" || type === "quest" || type === "npc" || type === "spell" || type === "object";
}

function safeLabel(label: string): boolean {
  // Angle brackets are plain text. Only actual RXP/notation delimiters and
  // controls are rejected; callers must render strings as text, never HTML.
  return !!label && label === label.trim() && !/[\x00-\x1f\x7f\u2028\u2029|]/.test(label) && !/--|<<|>>|\(\w+ #/.test(label);
}
