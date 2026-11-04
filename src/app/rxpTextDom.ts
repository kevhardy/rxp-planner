import type { GuideIconCatalog } from "../data/guideIcons.ts";
import { writtenKey, type ColoredText, type RxpPiece, type RxpRange } from "../guide/index.ts";
import { textureIcon } from "./guideIcon.ts";

const CHIP_LABELS: Record<Extract<RxpPiece, { kind: "opaque" }>["lexeme"], string | null> = {
  texture: "icon",
  color: "color",
  reset: "end",
  pipe: "|",
  escape: null,
};

export function renderRxpText(root: HTMLElement, text: ColoredText, catalog: GuideIconCatalog): void {
  const nodes = text.pieces.flatMap((piece): Node[] => {
    if (piece.kind === "delimiter") return [];
    const source = text.source.slice(...piece.range);
    const span = document.createElement("span");
    span.dataset.from = String(piece.range[0]);
    span.dataset.to = String(piece.range[1]);
    if (piece.kind === "text") {
      span.textContent = source;
      if (piece.color) {
        span.className = "rxp-colored";
        span.dataset.color = piece.color;
      }
    } else {
      span.className = "rxp-chip";
      span.contentEditable = "false";
      span.title = source;
      const shown = piece.lexeme === "texture" && textureIcon(catalog, piece.texture, writtenKey(text.source, piece));
      if (shown && shown.look.drawn) {
        span.classList.add("rxp-icon-chip");
        span.setAttribute("role", "img");
        span.setAttribute("aria-label", shown.name);
        const icon = span.appendChild(document.createElement("span"));
        icon.className = shown.look.className;
        for (const [name, value] of Object.entries(shown.look.vars)) icon.style.setProperty(name, value);
      } else span.textContent = CHIP_LABELS[piece.lexeme] ?? source;
    }
    return [span];
  });
  // A caret cannot sit after a trailing chip without a node after it.
  if (text.pieces.at(-1)?.kind === "opaque") nodes.push(document.createElement("br"));
  root.replaceChildren(...nodes);
}

const pieceSpan = (node: Node | null | undefined): HTMLElement | null =>
  node instanceof HTMLElement && node.dataset.from !== undefined ? node : null;

const bounds = (span: HTMLElement): RxpRange => [Number(span.dataset.from), Number(span.dataset.to)];

function sourceOffset(root: HTMLElement, node: Node, offset: number): number {
  if (node === root) {
    const before = [...root.childNodes].slice(0, offset).flatMap((n) => pieceSpan(n) ?? []);
    return before.length > 0 ? bounds(before.at(-1)!)[1] : 0;
  }
  let child = node;
  while (child.parentNode && child.parentNode !== root) child = child.parentNode;
  const span = pieceSpan(child);
  if (!span || span.parentNode !== root) return 0;
  const [from, to] = bounds(span);
  if (span.classList.contains("rxp-chip")) {
    let first = offset === 0;
    for (let n = node; first && n !== span; n = n.parentNode!) first = n.parentNode!.firstChild === n;
    return first ? from : to;
  }
  return node === span ? (offset === 0 ? from : to) : from + offset;
}

/** A DOM range, such as one from `getTargetRanges`, at source offsets; null when it is outside `root`. */
export function sourceRange(root: HTMLElement, range: AbstractRange): RxpRange | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = sourceOffset(root, range.startContainer, range.startOffset);
  const b = sourceOffset(root, range.endContainer, range.endOffset);
  return [Math.min(a, b), Math.max(a, b)];
}

export function readRxpSelection(root: HTMLElement): RxpRange | null {
  const selection = root.ownerDocument.getSelection();
  return selection && selection.rangeCount > 0 ? sourceRange(root, selection.getRangeAt(0)) : null;
}

/**
 * Selects source range `range` in `root`. An offset inside a text piece, or
 * at its edge, goes into that piece's text, so a caret after a colored word
 * types in its color. Other offsets go between the pieces.
 */
export function restoreRxpSelection(root: HTMLElement, range: RxpRange): void {
  const spans = [...root.childNodes].flatMap((n) => pieceSpan(n) ?? []);
  const point = (at: number): [Node, number] => {
    const text = spans.find((s) => !s.classList.contains("rxp-chip") && bounds(s)[0] <= at && at <= bounds(s)[1]);
    if (text) return [text.firstChild!, at - bounds(text)[0]];
    const next = spans.findIndex((s) => bounds(s)[0] >= at);
    return [root, next === -1 ? spans.length : next];
  };
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  selection.setBaseAndExtent(...point(range[0]), ...point(range[1]));
}
