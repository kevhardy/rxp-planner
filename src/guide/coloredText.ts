// Guide text as the colored text field shows and edits it. RXP does not
// parse color spans: before it shows a step, `addon.settings.ReplaceColors`
// replaces each `RXP_NAME_` with an ARGB value from its color table, so
// `|cRXP_ENEMY_Boar|r` shows as `|cFFFF5722Boar|r`. The game then reads `|c`
// as a color start and `|r` as the end of the newest open color, so colors
// nest: in `|cRXP_WARN_Kill |cRXP_ENEMY_Boars|r now|r`, "now" is a warning
// again. A `|r` with no open color changes nothing.
//
// Only the six table names, each closed by a later `|r`, show as colors. All
// other markup keeps its bytes and shows as written: hex and unknown colors,
// a named start that no `|r` closes, a `|r` that closes nothing or closes a
// hex color, textures, escaped pipes, and other `|` escapes. Hex starts and
// their ends still pair with each other, so an edit never gives a hex
// color's `|r` to a named color.

import { textureKey, type TextureKey } from "../../packages/data-contract/guideIcons.ts";
import { MARKUP } from "./markup.ts";

/** RXP's text colors, from `addon.guideTextColors.default` in Themes.lua. */
export const RXP_COLORS = [
  spec(
    "ENEMY",
    "Enemy",
    "A hostile mob to kill. The leveling simulation picks its grind mob from these names, so this can change simulated XP.",
  ),
  spec("FRIENDLY", "Friendly", "A friendly NPC, such as a quest giver, a trainer, or a vendor."),
  spec("LOOT", "Loot", "An item to loot or collect."),
  spec("WARN", "Warning", "A warning or a tip the player must not miss."),
  spec("BUY", "Buy", "An item to buy."),
  spec("PICK", "Object", "An object in the world to click or pick up."),
] as const;

function spec<C extends string>(color: C, name: string, description: string) {
  return { color, name, code: `RXP_${color}_` as const, description };
}

type RxpColorSpec = (typeof RXP_COLORS)[number];
export type RxpColor = RxpColorSpec["color"];

/** Half-open UTF-16 offsets into the RXP source, as `String.slice` takes them. */
export type RxpRange = readonly [start: number, end: number];

/** A texture escape `|T<key><args>|t`. `args` is the exact text after the key, such as `:20`. `key` is `undefined` when the key names no file. */
export interface RxpTexture {
  key: TextureKey | undefined;
  args: string;
}

/** Pieces cover the source in order. A delimiter's or a color's `partner` is the index of the piece it pairs with. */
export type RxpPiece =
  | { kind: "text"; range: RxpRange; color: RxpColor | null }
  | { kind: "delimiter"; range: RxpRange; color: RxpColor; edge: "open" | "close"; partner: number }
  | { kind: "opaque"; range: RxpRange; lexeme: "texture"; texture: RxpTexture }
  | { kind: "opaque"; range: RxpRange; lexeme: "pipe" | "escape" }
  | { kind: "opaque"; range: RxpRange; lexeme: "color" | "reset"; partner: number | null };

export interface ColoredText {
  source: string;
  pieces: readonly RxpPiece[];
}

export type RxpTextEdit =
  | { kind: "replace"; range: RxpRange; text: string }
  /** `null` removes the six named colors and leaves hex colors. */
  | { kind: "color"; range: RxpRange; color: RxpColor | null };

export interface RxpTextChange {
  text: string;
  selection: RxpRange;
}

// A `|` before any other letter is a game escape, such as `|n` or `|H`.
const LEXEME = new RegExp(`${MARKUP.source}|\\|[A-Za-z]`, "g");
const NAMED = new Map<string, RxpColor>(RXP_COLORS.map((s) => [`|c${s.code}`, s.color]));

export function coloredText(source: string): ColoredText {
  type Lexeme = { range: RxpRange; type: "text" | "open" | "reset" | "texture" | "pipe" | "escape"; partner: number | null };
  const lexemes: Lexeme[] = [];
  const open: number[] = [];
  let at = 0;
  for (const { 0: code, index } of source.matchAll(LEXEME)) {
    if (index > at) lexemes.push({ range: [at, index], type: "text", partner: null });
    at = index + code.length;
    const type = code === "||" ? "pipe" : code === "|r" ? "reset" : code.length === 2 ? "escape" : code[1] === "c" ? "open" : "texture";
    const lexeme: Lexeme = { range: [index, at], type, partner: null };
    if (type === "open") open.push(lexemes.length);
    const opener = type === "reset" ? open.pop() : undefined;
    if (opener !== undefined) {
      lexeme.partner = opener;
      lexemes[opener]!.partner = lexemes.length;
    }
    lexemes.push(lexeme);
  }
  if (source.length > at) lexemes.push({ range: [at, source.length], type: "text", partner: null });

  const colors: (RxpColor | null)[] = [];
  const pieces = lexemes.map(({ range, type, partner }): RxpPiece => {
    if (type === "text") return { kind: "text", range, color: colors.at(-1) ?? null };
    if (type === "open") {
      const color = partner === null ? undefined : NAMED.get(source.slice(...range));
      colors.push(color ?? null);
      return color
        ? { kind: "delimiter", range, color, edge: "open", partner: partner! }
        : { kind: "opaque", range, lexeme: "color", partner };
    }
    if (type === "texture") return { kind: "opaque", range, lexeme: type, texture: texture(source.slice(range[0] + 2, range[1] - 2)) };
    if (type !== "reset") return { kind: "opaque", range, lexeme: type };
    if (partner === null) return { kind: "opaque", range, lexeme: "reset", partner };
    const color = colors.pop();
    return color ? { kind: "delimiter", range, color, edge: "close", partner } : { kind: "opaque", range, lexeme: "reset", partner };
  });
  return { source, pieces };
}

function texture(inside: string): RxpTexture {
  const colon = inside.indexOf(":");
  const raw = colon < 0 ? inside : inside.slice(0, colon);
  return { key: textureKey(raw), args: inside.slice(raw.length) };
}

/**
 * Applies an edit at source offsets. Bytes outside the range stay as they
 * are, except for named color ends and starts next to it that the edit
 * leaves empty or back to back. Inside the range, every opaque piece keeps
 * its bytes and order, except that `replace` deletes the ones whose pair is
 * also inside. A replacement that ends in a lone `|` before markup gets a
 * second `|`, so the user's pipe stays a pipe. An edit that would still join
 * markup into new markup, as after a guide's own lone `|`, changes nothing.
 * Throws a RangeError for a range that splits a piece or a surrogate pair.
 */
export function editColoredText(text: ColoredText, edit: RxpTextEdit): RxpTextChange {
  const [start, end] = edit.range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.source.length) {
    throw new RangeError(`Invalid range ${start}-${end}`);
  }
  if (!isBoundary(text, start) || !isBoundary(text, end)) throw new RangeError(`Range ${start}-${end} splits a piece`);

  const { source, pieces } = text;
  const region = pieces.flatMap((piece, i) => (piece.range[1] > start && piece.range[0] < end ? [i] : []));
  const unchanged = { text: source, selection: edit.range };
  const build = (middle: Token[]) => {
    const part = (from: number, to: number) =>
      pieces.flatMap((piece) => (piece.range[0] < to && piece.range[1] > from ? [tokenOf(source, piece, from, to, false)] : []));
    return serialize(tidy([...part(0, start), ...middle, ...part(end, source.length)]));
  };
  if (edit.kind === "color") {
    const done = region.every((i) => {
      const piece = pieces[i]!;
      return piece.kind !== "text" || piece.color === edit.color;
    });
    if (done) return unchanged;
    const [flat, nested] = [false, true].map((nest) => build(recolor(text, start, end, region, edit.color, nest)));
    if (!flat || !nested) return flat ?? nested ?? unchanged;
    return nested.text.length < flat.text.length ? nested : flat;
  }

  const inside = (i: number) => pieces[i]!.range[0] >= start && pieces[i]!.range[1] <= end;
  const kept = region.flatMap((i) => {
    const piece = pieces[i]!;
    return "partner" in piece && piece.partner !== null && !inside(piece.partner) ? [tokenOf(source, piece, start, end, true)] : [];
  });
  const joins = kept.length > 0 || source[end] === "|";
  const typed = joins && /(?:^|[^|])(?:\|\|)*\|$/.test(edit.text) ? `${edit.text}|` : edit.text;
  const middle: Token[] = [EDGE];
  if (typed) middle.push({ text: typed, role: "other", fresh: true, whole: false });
  middle.push(FROM, TO, ...kept, EDGE);
  return build(middle) ?? unchanged;
}

/**
 * The source that a cut of `range` removes, for the clipboard. A color start
 * or end whose partner lies outside the range stays behind, as in a
 * deletion, so a paste never ends or opens a color by surprise.
 */
export function copyColoredText(text: ColoredText, [start, end]: RxpRange): string {
  const { source, pieces } = text;
  const inside = (i: number) => pieces[i]!.range[0] >= start && pieces[i]!.range[1] <= end;
  return pieces
    .flatMap((piece) => {
      const [a, b] = piece.range;
      if (b <= start || a >= end || ("partner" in piece && piece.partner !== null && !inside(piece.partner))) return [];
      return [source.slice(Math.max(a, start), Math.min(b, end))];
    })
    .join("");
}

/** The visible unit before or after offset `at`, past hidden delimiters: one code point or one opaque piece. */
export function unitBeside(text: ColoredText, at: number, direction: "backward" | "forward"): RxpRange | null {
  const { source, pieces } = text;
  const order = direction === "backward" ? pieces.toReversed() : pieces;
  for (const piece of order) {
    const [a, b] = piece.range;
    if (direction === "backward" ? a >= at : b <= at) continue;
    if (piece.kind === "delimiter") continue;
    if (piece.kind === "opaque") return piece.range;
    if (direction === "backward") {
      const to = Math.min(b, at);
      return [to - (to - a >= 2 && isPair(source, to - 2) ? 2 : 1), to];
    }
    const from = Math.max(a, at);
    return [from, from + (b - from >= 2 && isPair(source, from) ? 2 : 1)];
  }
  return null;
}

function isPair(source: string, at: number) {
  const high = source.charCodeAt(at);
  const low = source.charCodeAt(at + 1);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

function isBoundary(text: ColoredText, at: number) {
  const piece = text.pieces.find(({ range: [a, b] }) => a < at && at < b);
  return !piece || (piece.kind === "text" && !isPair(text.source, at - 1));
}

type Role = "open" | "reset" | "other";
type TextToken = { text: string; role: Role; color?: RxpColor; fresh: boolean; whole: boolean };
type Token = TextToken | { marker: "edge" | "from" | "to" };

const EDGE: Token = { marker: "edge" };
const FROM: Token = { marker: "from" };
const TO: Token = { marker: "to" };

function tokenOf(source: string, piece: RxpPiece, from: number, to: number, fresh: boolean): Token {
  const text = source.slice(Math.max(piece.range[0], from), Math.min(piece.range[1], to));
  const role = roleOf(piece);
  const whole = piece.kind !== "text";
  return piece.kind === "delimiter" && piece.edge === "open"
    ? { text, role, color: piece.color, fresh, whole }
    : { text, role, fresh, whole };
}

function roleOf(piece: RxpPiece): Role {
  if (piece.kind === "delimiter") return piece.edge === "open" ? "open" : "reset";
  if (piece.kind === "opaque" && piece.lexeme === "color") return "open";
  return piece.kind === "opaque" && piece.lexeme === "reset" && piece.partner !== null ? "reset" : "other";
}

const opener = (color: RxpColor): Token => ({ text: `|cRXP_${color}_`, role: "open", color, fresh: true, whole: true });
const RESET: Token = { text: "|r", role: "reset", fresh: true, whole: true };

function recolor(text: ColoredText, start: number, end: number, region: number[], color: RxpColor | null, nest: boolean): Token[] {
  const { source, pieces } = text;
  const stack: (RxpColor | null)[] = [];
  const step = (piece: RxpPiece) => {
    const role = roleOf(piece);
    if (role === "open") stack.push(piece.kind === "delimiter" ? piece.color : null);
    else if (role === "reset") stack.pop();
  };
  const named = () => stack.slice(stack.lastIndexOf(null) + 1) as RxpColor[];
  for (const piece of pieces) if (piece.range[1] <= start) step(piece);

  let content: Token[] = [];
  let from = named();
  let marked = false;
  const tokens: Token[] = [];
  const segment = () => {
    const to = named();
    const closeFirst = color === null || !nest;
    const kept = closeFirst ? 0 : sharedPrefix(from, to);
    const wrap = content.length > 0 && color !== null && (closeFirst || from.at(-1) !== color);
    if (closeFirst) tokens.push(...from.map(() => RESET));
    if (wrap) tokens.push(opener(color));
    if (content.length > 0) {
      if (marked) tokens.splice(tokens.lastIndexOf(TO), 1);
      else tokens.push(FROM);
      tokens.push(...content, TO);
      marked = true;
    }
    if (wrap) tokens.push(RESET);
    if (!closeFirst) tokens.push(...from.slice(kept).map(() => RESET));
    tokens.push(...to.slice(kept).map(opener));
    content = [];
  };
  tokens.push(EDGE);
  for (const i of region) {
    const piece = pieces[i]!;
    if (piece.kind === "delimiter") {
      step(piece);
    } else if (piece.kind === "opaque" && (piece.lexeme === "color" || piece.lexeme === "reset")) {
      segment();
      tokens.push(tokenOf(source, piece, start, end, true));
      step(piece);
      from = named();
    } else {
      content.push(tokenOf(source, piece, start, end, true));
    }
  }
  segment();
  if (!marked) tokens.push(FROM, TO);
  tokens.push(EDGE);
  return tokens;
}

function sharedPrefix(a: readonly RxpColor[], b: readonly RxpColor[]) {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n++;
  return n;
}

function tidy(tokens: Token[]): Token[] {
  for (;;) {
    const open: (RxpColor | undefined)[] = [];
    let prev: { index: number; token: TextToken; closed: RxpColor | undefined } | null = null;
    let across = false;
    let pair: [number, number] | null = null;
    for (const [i, token] of tokens.entries()) {
      if ("marker" in token) {
        across = true;
        continue;
      }
      if (prev && (prev.token.fresh || token.fresh || across)) {
        const empty = prev.token.role === "open" && prev.token.color && token.role === "reset";
        const rejoin = prev.closed && token.role === "open" && token.color === prev.closed;
        if (empty || rejoin) {
          pair = [prev.index, i];
          break;
        }
      }
      let closed: RxpColor | undefined;
      if (token.role === "open") open.push(token.color);
      else if (token.role === "reset") closed = open.pop();
      prev = { index: i, token, closed };
      across = false;
    }
    if (!pair) return tokens;
    const [a, b] = pair;
    tokens = tokens.filter((_, j) => j !== a && j !== b);
  }
}

function serialize(tokens: Token[]): RxpTextChange | null {
  let text = "";
  let from = 0;
  let to = 0;
  const wholes: number[] = [];
  for (const token of tokens) {
    if (!("marker" in token)) {
      if (token.whole) wholes.push(text.length, text.length + token.text.length);
      text += token.text;
    } else if (token.marker === "from") from = text.length;
    else if (token.marker === "to") to = text.length;
  }
  const lexed = new Set(coloredText(text).pieces.flatMap((p) => (p.kind === "text" ? [] : [`${p.range[0]}-${p.range[1]}`])));
  for (let i = 0; i < wholes.length; i += 2) if (!lexed.has(`${wholes[i]}-${wholes[i + 1]}`)) return null;
  return { text, selection: [from, to] };
}
