import type { Condition, ConditionExpr } from "./model.ts";

const LUA_SPACE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
const WORD_CHAR = /^[A-Za-z0-9]$/;
const PRIVATE_USE = /[\uE000-\uF8FF]/g;

interface Group {
  expr: ConditionExpr;
  source: string;
}

type Piece = string | Group;

const isWord = (piece: Piece | undefined): boolean => piece !== undefined && (typeof piece !== "string" || WORD_CHAR.test(piece));

export function parseCondition(text: string): Condition {
  const trimmed = text.replace(LUA_SPACE, "");
  return { text: trimmed, expr: parseExpr(trimmed) };
}

/**
 * Reads expression text into a tree, as RXP reads it. Every input has a
 * result. Characters other than letters, digits, `/`, `!`, and a group's
 * parentheses separate tokens. A private-use character counts as a space, so
 * a group of only such characters is empty.
 */
function parseExpr(text: string): ConditionExpr {
  const alternatives: ConditionExpr[] = [];
  let current: Piece[] = [];
  for (const piece of [...pieces(text.replace(PRIVATE_USE, " ")), "/"]) {
    if (piece !== "/") {
      current.push(piece);
    } else {
      // RXP skips an empty alternative, but one that holds only spaces is true.
      if (current.length > 0) alternatives.push(conjunction(current));
      current = [];
    }
  }
  const [first, ...rest] = alternatives;
  return first && rest.length === 0 ? first : { type: "or", items: alternatives };
}

function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < text.length; i++) {
    const negated = text[i] === "!" && text[i + 1] === "(";
    const open = negated ? i + 1 : i;
    const close = text[open] === "(" ? text.indexOf(")", open) : -1;
    if (close < 0) {
      out.push(text.charAt(i));
      continue;
    }
    const inner = parseExpr(text.slice(open + 1, close).replace(LUA_SPACE, ""));
    out.push({ expr: negated ? { type: "not", item: inner } : inner, source: text.slice(i, close + 1) });
    i = close;
  }
  return out;
}

function conjunction(alternative: Piece[]): ConditionExpr {
  const items: ConditionExpr[] = [];
  for (let start = 0; start < alternative.length; start++) {
    if (!isWord(alternative[start])) continue;
    let end = start;
    while (isWord(alternative[end])) end++;
    const operand = word(alternative.slice(start, end));
    items.push(alternative[start - 1] === "!" ? { type: "not", item: operand } : operand);
    start = end;
  }
  const [first, ...rest] = items;
  return first && rest.length === 0 ? first : { type: "and", items };
}

function word(run: Piece[]): ConditionExpr {
  if (run.every((piece) => typeof piece === "string")) return { type: "token", value: run.join("") };
  const [first] = run;
  if (run.length === 1 && typeof first === "object") return first.expr;
  // RXP turns a group joined to other text into a token that never matches.
  return { type: "invalid", text: run.map((piece) => (typeof piece === "string" ? piece : piece.source)).join("") };
}

export interface ConditionLiteral {
  token: string;
  not: boolean;
}

/**
 * Reads an expression as alternatives (`/`) of tokens that must all hold,
 * such as `Human Warrior/Dwarf !Hunter`. Returns null for other shapes, such
 * as groups or a blank alternative.
 */
export function conditionRows(expr: ConditionExpr): ConditionLiteral[][] | null {
  const rows: ConditionLiteral[][] = [];
  for (const alt of expr.type === "or" ? expr.items : [expr]) {
    const row: ConditionLiteral[] = [];
    for (const item of alt.type === "and" ? alt.items : [alt]) {
      if (item.type === "token") row.push({ token: item.value, not: false });
      else if (item.type === "not" && item.item.type === "token") row.push({ token: item.item.value, not: true });
      else return null;
    }
    if (row.length === 0) return null;
    rows.push(row);
  }
  return rows;
}

/** Writes rows as condition text. It drops an emptied row, because RXP reads a blank alternative as true. */
export function conditionRowsText(rows: ConditionLiteral[][]): string {
  return rows.flatMap((row) => (row.length > 0 ? [row.map((l) => (l.not ? "!" : "") + l.token).join(" ")] : [])).join("/");
}
