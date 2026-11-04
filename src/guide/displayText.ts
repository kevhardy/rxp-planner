import type { EntityType } from "../../packages/data-contract/entities.ts";
import { coloredText, type RxpColor, type RxpPiece, type RxpTexture } from "./coloredText.ts";
import { stripMarkup } from "./markup.ts";
import { findEntityReferences, parseEntityReference, type EntityId } from "./references.ts";
import { writtenKey } from "./textures.ts";

export interface TexturePart {
  texture: RxpTexture;
  written: string;
}

export interface ColorRun {
  text: string;
  color: RxpColor;
}

export type EntityPart = EntityId & { text: string; color?: RxpColor };

export interface MonoPart {
  mono: string;
}

export type TextPart = string | ColorRun | EntityPart | TexturePart | MonoPart;

/**
 * Guide text as `plainText` shows it, with each texture as its own part.
 * With `name`, the references `findEntityReferences` finds are parts too. A
 * plain `(item #6948)` marker takes in the text before it when that ends with
 * the entity's `name` and a space. An NPC form, such as `npc:Name:123` or
 * `|cRXP_FRIENDLY_Name::123|r`, shows the NPC's `name`, else the name written
 * in it, as RXP's ReplaceNpcIds in functions.lua does. A colored `Name::ID`
 * shows in place of the `npc:Name:ID` references inside it. Without `name`,
 * references stay text as written. With `colors`, text in a named color is a
 * `ColorRun` and a reference keeps the color it starts in, as the colored
 * text field shows them.
 */
export function guideText(
  text: string,
  name?: (type: EntityType, id: number) => string | undefined,
  options: { colors?: boolean } = {},
): TextPart[] {
  const pieces = coloredText(text).pieces;
  const textures = pieces.flatMap((piece) => (piece.kind === "opaque" && piece.lexeme === "texture" ? [piece] : []));
  const spans = options.colors ? colorSpans(pieces) : [];
  const colorAt = (at: number) => spans.find((span) => span.end > at && span.text)?.color ?? null;
  const parts: TextPart[] = [];
  const state = { colors: 0 };
  const push = (plain: string, color: RxpColor | null) => {
    if (!plain) return;
    const last = parts.at(-1);
    if (color === null && typeof last === "string") parts[parts.length - 1] = last + plain;
    else if (color !== null && isColorRun(last) && last.color === color) parts[parts.length - 1] = { text: last.text + plain, color };
    else parts.push(color === null ? plain : { text: plain, color });
  };
  const add = (from: number, to: number) => {
    if (!options.colors) return push(stripMarkup(text, from, to, state), null);
    for (const span of spans) {
      if (span.end <= from || span.start >= to) continue;
      push(stripMarkup(text, Math.max(from, span.start), Math.min(to, span.end), state), span.color);
    }
  };
  const shown = (start: number, end: number) => {
    let at = start;
    for (const piece of textures) {
      const [from, to] = piece.range;
      if (from < start || to > end) continue;
      add(at, from);
      parts.push({ texture: piece.texture, written: writtenKey(text, piece) });
      at = to;
    }
    add(at, end);
  };
  let at = 0;
  for (const { type, id, start, end } of name ? findEntityReferences(text) : []) {
    if (start < at) continue;
    shown(at, start);
    let label = text.slice(start, end);
    if (label.startsWith("(")) {
      const known = name!(type, id);
      const before = parts.at(-1);
      if (known && typeof before === "string" && before.endsWith(`${known} `)) {
        const rest = before.slice(0, -known.length - 1);
        if (rest) parts[parts.length - 1] = rest;
        else parts.pop();
        label = `${known} ${label}`;
      }
    } else label = name!(type, id) ?? parseEntityReference(label, (npc) => name!("npc", npc))?.label ?? label;
    const color = options.colors ? colorAt(start) : null;
    parts.push(color ? { type, id, text: label, color } : { type, id, text: label });
    at = end;
  }
  shown(at, text.length);
  return parts;
}

function colorSpans(pieces: readonly RxpPiece[]) {
  const open: (RxpColor | null)[] = [];
  return pieces.map((piece) => {
    if (piece.kind === "delimiter" && piece.edge === "open") open.push(piece.color);
    else if (piece.kind === "opaque" && piece.lexeme === "color") open.push(null);
    const span = { start: piece.range[0], end: piece.range[1], text: piece.kind === "text", color: open.at(-1) ?? null };
    if (
      (piece.kind === "delimiter" && piece.edge === "close") ||
      (piece.kind === "opaque" && piece.lexeme === "reset" && piece.partner !== null)
    )
      open.pop();
    return span;
  });
}

export const isTexture = (part: TextPart): part is TexturePart => typeof part !== "string" && "texture" in part;

export const isColorRun = (part: TextPart | undefined): part is ColorRun =>
  typeof part === "object" && "color" in part && !("type" in part);

export const isMono = (part: TextPart): part is MonoPart => typeof part === "object" && "mono" in part;

export function guideTextPlain(parts: readonly TextPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : isTexture(part) ? "" : isMono(part) ? part.mono : part.text)).join("");
}

/**
 * The size at which the game draws a texture with arguments `args`, such as
 * `:20`, in pixels, where 0 means the height of the text. The first number is
 * the height; a positive second number is the width, else the width is the
 * height. Gives `undefined` for the crop arguments after the offsets, which
 * show only part of the file.
 */
export function textureSize(args: string): { width: number; height: number } | undefined {
  const numbers = args.split(":").slice(1).map(Number);
  if (numbers.length > 4) return undefined;
  const height = Math.max(numbers[0] ?? 0, 0);
  const width = (numbers[1] ?? 0) > 0 ? numbers[1]! : height;
  return { width, height };
}
