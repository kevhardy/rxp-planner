// Document model for RestedXP guide text.
//
// The model follows the RXP loader (`addon.ParseGuide` in GuideLoader.lua): lines
// before the first `step` line form the header; each `step` line starts a step
// whose body runs until the next `step` line. Every parsed line keeps its
// source text in `raw`. The serializer emits `raw` verbatim and joins the
// lines with the document's one `eol`, so an unedited line keeps its text.
// Edit helpers drop `raw` from the lines they change, and the serializer
// formats those lines canonically.

export type Eol = "\n" | "\r\n";

export interface GuideDocument {
  header: BodyLine[];
  steps: Step[];
  eol: Eol;
  finalNewline: boolean;
}

export interface Step {
  line: StepLine;
  body: BodyLine[];
}

export interface LineBase {
  /** Source text; present only while the line is unedited. */
  raw?: string;
  indent: string;
  condition?: Condition;
  /** Text after the first `--`, which RXP strips as a comment. */
  comment?: string;
  /**
   * Set on a final line that has no line ending and contains `--`. RXP strips
   * comments only when a line ending follows, so such a line keeps its `--`
   * text and has no `comment`.
   */
  unterminated?: true;
}

export interface StepLine extends LineBase {
  kind: "step";
}

/** `#name value`, or `#name =function`. A blank value is a presence flag. */
export interface TagLine extends LineBase {
  kind: "tag";
  name: string;
  value: string;
  /** `#name =value` form: RXP resolves the value through `addon.functions`. */
  assign: boolean;
}

export interface CommandLine extends LineBase {
  kind: "command";
  name: string;
  /** Arguments as RXP splits them; see `splitArgs`. */
  args: string[];
  text?: string;
}

/**
 * `+text` (manual objective), `*text` (text without tooltip), or `>>text`
 * (text-only element).
 */
export interface TextLine extends LineBase {
  kind: "text";
  marker: TextMarker;
  text: string;
  /**
   * For `>>` lines, non-command text before `>>`, such as `+a` in
   * `+a >> b`. RXP ignores it and shows only the text after `>>`.
   */
  prefix?: string;
}

export type TextMarker = "+" | "*" | ">>";

/** A line holding only `<< condition`. In the header it gates the guide. */
export interface ConditionLine extends LineBase {
  kind: "condition";
  condition: Condition;
}

export interface CommentLine extends LineBase {
  kind: "comment";
  comment: string;
}

export interface BlankLine extends LineBase {
  kind: "blank";
}

/** Bare text without `>>`, which RXP ignores. */
export interface OtherLine extends LineBase {
  kind: "other";
  text: string;
}

export type BodyLine = TagLine | CommandLine | TextLine | ConditionLine | CommentLine | BlankLine | OtherLine;

export type Line = StepLine | BodyLine;

export interface Condition {
  /** Expression text after `<<`, trimmed. The serializer writes this text. */
  text: string;
  expr: ConditionExpr;
}

/**
 * A condition tree with the meaning RXP gives the text; see `condition.ts`.
 * `/` separates `or` alternatives; tokens side by side form an `and`; `!`
 * negates a token or a parenthesized group. An empty `and` is always true and
 * an empty `or` is always false. A token is an alphanumeric run such as
 * `Alliance`, `Mage`, `20`, or `skip`; its meaning is left to the evaluator.
 * An `invalid` node is a group joined to other token text, such as
 * `Mage(Human)`; RXP builds a token from it that never matches.
 */
export type ConditionExpr =
  | { type: "or"; items: ConditionExpr[] }
  | { type: "and"; items: ConditionExpr[] }
  | { type: "not"; item: ConditionExpr }
  | { type: "token"; value: string }
  | { type: "invalid"; text: string };
