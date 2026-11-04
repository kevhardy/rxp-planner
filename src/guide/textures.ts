import { textureKey, type TextureKey } from "../../packages/data-contract/guideIcons.ts";
import { coloredText, editColoredText, type ColoredText, type RxpPiece, type RxpRange, type RxpTextChange } from "./coloredText.ts";
import type { GuideDocument, Line } from "./model.ts";
import { parseLine } from "./parse.ts";

export interface GuideTextures {
  /** Sorted and unique. */
  keys: TextureKey[];
  /** Keys that name no file, as the guide writes them, sorted and unique. */
  invalidKeys: string[];
  uses: Map<TextureKey, { escapes: number; macros: number }>;
}

/**
 * The textures that a guide shows: the texture escapes in its text lines,
 * its command `>>` text, and its tag values, and the numeric icon argument of
 * each `.macro`, which RXP passes to the game as a FileDataID. Comments are
 * not shown, so their escapes do not count.
 */
export function guideTextures(document: GuideDocument): GuideTextures {
  const uses = new Map<TextureKey, { escapes: number; macros: number }>();
  const invalid = new Set<string>();
  const count = (key: TextureKey | undefined, raw: string, kind: "escapes" | "macros") => {
    if (key === undefined) return void invalid.add(raw);
    const counts = uses.get(key) ?? { escapes: 0, macros: 0 };
    counts[kind]++;
    uses.set(key, counts);
  };
  for (const line of bodyLines(document)) {
    const text = shownText(line);
    if (text !== undefined) {
      for (const piece of coloredText(text).pieces) {
        if (piece.kind === "opaque" && piece.lexeme === "texture") count(piece.texture.key, writtenKey(text, piece), "escapes");
      }
    }
    const icon = line.kind === "command" && line.name === "macro" ? line.args[1] : undefined;
    if (icon !== undefined && isMacroIconId(icon)) count(textureKey(icon), icon, "macros");
  }
  return { keys: [...uses.keys()].sort(), invalidKeys: [...invalid].sort(), uses };
}

export const isMacroIconId = (arg: string) => /^\d+$/.test(arg);

const bodyLines = (document: GuideDocument) => [...document.header, ...document.steps.flatMap((step) => step.body)];

const shownText = (line: Line) =>
  line.kind === "text" ? line.text : line.kind === "tag" ? line.value : line.kind === "command" ? line.text : undefined;

export function shownTexts(guide: GuideDocument | string): string[] {
  const lines =
    typeof guide !== "string"
      ? bodyLines(guide)
      : guide
          .split(/\r\n|\r|\n/)
          .flatMap((raw, i, raws) => (raw.includes("|T") ? [parseLine(raw, { unterminated: i === raws.length - 1 })] : []));
  return lines.flatMap((line) => shownText(line) ?? []);
}

/**
 * For each texture key, the item names that `texts` write in brackets right
 * after its escape, such as `Hearthstone` in `|T134414:0|t[Hearthstone]`.
 * Hidden color delimiters may come between them. Each name is trimmed and
 * kept once, in first-seen order.
 */
export function textureNames(texts: Iterable<string>): Map<TextureKey, string[]> {
  const names = new Map<TextureKey, Set<string>>();
  for (const text of texts) {
    const { pieces } = coloredText(text);
    pieces.forEach((piece, i) => {
      if (piece.kind !== "opaque" || piece.lexeme !== "texture" || piece.texture.key === undefined) return;
      let shown = "";
      for (const next of pieces.slice(i + 1)) {
        if (next.kind === "delimiter") continue;
        if (next.kind !== "text") break;
        shown += text.slice(...next.range);
        if (!shown.startsWith("[") || shown.includes("]")) break;
      }
      const name = /^\[([^\]]*)\]/.exec(shown)?.[1]!.trim();
      if (name) names.set(piece.texture.key, (names.get(piece.texture.key) ?? new Set()).add(name));
    });
  }
  return new Map([...names].map(([key, set]) => [key, [...set]]));
}

export type TexturePiece = Extract<RxpPiece, { lexeme: "texture" }>;

export const writtenKey = (source: string, { range, texture }: Pick<TexturePiece, "range" | "texture">) =>
  source.slice(range[0] + 2, range[1] - 2 - texture.args.length);

/** The texture that `range` selects whole, or that ends at the caret `range`. */
export function textureAt(text: ColoredText, [start, end]: RxpRange): TexturePiece | undefined {
  return text.pieces.find(
    (piece): piece is TexturePiece =>
      piece.kind === "opaque" && piece.lexeme === "texture" && piece.range[1] === end && (start === end || piece.range[0] === start),
  );
}

/**
 * Writes the icon with FileDataID `id`. In place of texture `at`, only the
 * key changes and the arguments stay byte for byte. At range `at`, it writes
 * `|T<id>:0|t`, which follows the text height.
 */
export function writeTexture(text: ColoredText, at: RxpRange | TexturePiece, id: number): RxpTextChange {
  return "texture" in at
    ? editColoredText(text, { kind: "replace", range: at.range, text: `|T${id}${at.texture.args}|t` })
    : editColoredText(text, { kind: "replace", range: at, text: `|T${id}:0|t` });
}
