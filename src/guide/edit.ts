import { parseCondition } from "./condition.ts";
import type {
  BlankLine,
  BodyLine,
  CommandLine,
  CommentLine,
  Condition,
  ConditionLine,
  GuideDocument,
  Line,
  LineBase,
  OtherLine,
  Step,
  StepLine,
  TagLine,
  TextLine,
} from "./model.ts";
import { parseGuide, parseLine } from "./parse.ts";
import { formatLine, lineText, serializeGuide } from "./serialize.ts";

// Pure edit helpers. Each returns a new document or line and leaves its input
// unchanged. Changed lines lose `raw`, so the serializer formats them; all
// other lines keep their source text.
//
// An edited line must mean the same to RXP once written out. The helpers
// format each edited line, parse it again, and throw `GuideEditError` if the
// result differs: for example, text containing `--` (a comment to RXP), an
// empty or padded command argument (RXP drops or trims it), or a line break.

/** Thrown when an edit cannot be written as RXP text with the same meaning. */
export class GuideEditError extends Error {}

/** Addresses a body line: `step: null` means the header. */
export interface LinePos {
  step: number | null;
  index: number;
}

export type Edited<L extends Line> = L extends Line ? Omit<L, "raw" | "unterminated"> : never;

export function edited<L extends Line>(line: L): Edited<L> {
  const { raw: _raw, unterminated: _unterminated, ...rest } = line;
  return rest as Edited<L>;
}

/**
 * Throws `GuideEditError` unless RXP would read the line exactly as modeled:
 * one line whose formatted text parses back to the same model. Unedited
 * lines (with `raw`) are checked only for line breaks.
 */
export function assertRepresentable(line: Line): void {
  const text = line.raw ?? formatLine(line);
  if (/[\r\n]/.test(text)) throw new GuideEditError("A line cannot contain a line break");
  if (line.raw !== undefined) return;
  if (!sameModel(parseLine(text), line)) {
    throw new GuideEditError(`RXP would read ${JSON.stringify(text)} differently`);
  }
}

function checked<L extends Line>(line: L): L {
  assertRepresentable(line);
  return line;
}

type StandaloneLine = ConditionLine | CommentLine | BlankLine;

export type ConditionResult<L extends Line> = L extends StandaloneLine
  ? StandaloneLine
  : Omit<Edited<L>, "condition"> & Pick<LineBase, "condition">;

/**
 * Sets or clears (`undefined` or blank) a line's condition. The tree comes
 * from parsing the condition text, so it always matches what RXP reads. On a
 * condition, comment, or blank line this changes the line's kind as needed.
 */
export function setCondition<L extends Line>(line: L, condition: Condition | string | undefined): ConditionResult<L> {
  const text = typeof condition === "string" ? condition : condition?.text;
  const parsed = text === undefined ? undefined : parseCondition(text);
  const next: Line = edited(line);
  if (next.kind === "condition" || next.kind === "comment" || next.kind === "blank") {
    const { indent, comment } = next;
    let standalone: StandaloneLine;
    if (parsed?.text) {
      standalone = { kind: "condition", indent, condition: parsed };
      if (comment !== undefined) standalone.comment = comment;
    } else if (comment !== undefined) {
      standalone = { kind: "comment", indent, comment };
    } else {
      standalone = { kind: "blank", indent: "" };
    }
    return checked(standalone) as ConditionResult<L>;
  }
  if (parsed?.text) next.condition = parsed;
  else delete next.condition;
  return checked(next) as ConditionResult<L>;
}

export type CommentResult<L extends Line> = L extends CommentLine | BlankLine
  ? CommentLine | BlankLine
  : Omit<Edited<L>, "comment"> & Pick<LineBase, "comment">;

/**
 * Sets or clears (`undefined`) a line's `--` comment. A blank line with a
 * comment becomes a comment line, and a comment line without one a blank line.
 */
export function setComment<L extends Line>(line: L, comment: string | undefined): CommentResult<L> {
  const next: Line = edited(line);
  if (next.kind === "comment" || next.kind === "blank") {
    const standalone: CommentLine | BlankLine =
      comment === undefined ? { kind: "blank", indent: "" } : { kind: "comment", indent: next.indent, comment };
    return checked(standalone) as CommentResult<L>;
  }
  if (comment === undefined) delete next.comment;
  else next.comment = comment;
  return checked(next) as CommentResult<L>;
}

export function setTagValue(line: TagLine, value: string): TagLine {
  return checked({ ...edited(line), value });
}

export function setCommandArgs(line: CommandLine, args: readonly string[]): CommandLine {
  return checked({ ...edited(line), args: [...args] });
}

type HasText = CommandLine | TextLine | OtherLine;

export type TextSet<L extends HasText> = L extends CommandLine
  ? Omit<Edited<L>, "text"> & Pick<CommandLine, "text">
  : Omit<Edited<L>, "text"> & { text: string };

export function setText<L extends HasText>(line: L, text: string | undefined): TextSet<L> {
  const next: HasText = edited(line);
  if (next.kind === "command") {
    if (text) next.text = text;
    else delete next.text;
  } else {
    next.text = text ?? "";
  }
  return checked(next) as TextSet<L>;
}

export function newStep(indent = ""): Step {
  return { line: { kind: "step", indent }, body: [] };
}

export function insertStep(doc: GuideDocument, index: number, step: Step = newStep()): GuideDocument {
  checkStep(step);
  return settle({ ...doc, steps: insertAt(doc.steps, index, step) });
}

export function deleteStep(doc: GuideDocument, index: number): GuideDocument {
  checkIndex(doc.steps, index);
  return settle({ ...doc, steps: doc.steps.filter((_, i) => i !== index) });
}

/** Moves a step so it ends up at index `to`. */
export function moveStep(doc: GuideDocument, from: number, to: number): GuideDocument {
  checkIndex(doc.steps, from);
  const step = doc.steps[from]!;
  const steps = insertAt(
    doc.steps.filter((_, i) => i !== from),
    to,
    step,
  );
  return settle({ ...doc, steps });
}

export function updateStepLine(doc: GuideDocument, step: number, update: (line: StepLine) => StepLine): GuideDocument {
  checkIndex(doc.steps, step);
  const steps = doc.steps.map((s, i) => {
    if (i !== step) return s;
    const line = update(s.line);
    if (line.kind !== "step") throw new GuideEditError("A step must start with a step line");
    assertRepresentable(line);
    return { ...s, line };
  });
  return settle({ ...doc, steps });
}

export function getLines(doc: GuideDocument, step: number | null): readonly BodyLine[] {
  if (step === null) return doc.header;
  checkIndex(doc.steps, step);
  return doc.steps[step]!.body;
}

export function insertLine(doc: GuideDocument, pos: LinePos, line: BodyLine): GuideDocument {
  checkBodyLine(line);
  return withLines(doc, pos.step, insertAt(getLines(doc, pos.step), pos.index, line));
}

export function deleteLine(doc: GuideDocument, pos: LinePos): GuideDocument {
  const lines = getLines(doc, pos.step);
  checkIndex(lines, pos.index);
  return withLines(
    doc,
    pos.step,
    lines.filter((_, i) => i !== pos.index),
  );
}

/**
 * Moves a line, possibly into another step or the header. `to.index` is the
 * line's index in the destination after the move.
 */
export function moveLine(doc: GuideDocument, from: LinePos, to: LinePos): GuideDocument {
  const lines = getLines(doc, from.step);
  const line = lines[from.index];
  if (!line) throw new RangeError(`No line at index ${from.index}`);
  const removed = setLines(
    doc,
    from.step,
    lines.filter((_, i) => i !== from.index),
  );
  return settle(setLines(removed, to.step, insertAt(getLines(removed, to.step), to.index, line)));
}

export function replaceLine(doc: GuideDocument, pos: LinePos, line: BodyLine): GuideDocument {
  checkBodyLine(line);
  const lines = getLines(doc, pos.step);
  checkIndex(lines, pos.index);
  return withLines(
    doc,
    pos.step,
    lines.map((l, i) => (i === pos.index ? line : l)),
  );
}

export function updateLine(doc: GuideDocument, pos: LinePos, update: (line: BodyLine) => BodyLine): GuideDocument {
  const line = getLines(doc, pos.step)[pos.index];
  if (!line) throw new RangeError(`No line at index ${pos.index}`);
  return replaceLine(doc, pos, update(line));
}

/**
 * Sets a header (`step: null`) or step tag. RXP uses the first occurrence of a
 * tag, so this updates the first matching line, or appends a line after the
 * section's last tag. A `null` value removes every line with that tag.
 */
export function setTag(doc: GuideDocument, step: number | null, name: string, value: string | null): GuideDocument {
  const lines = getLines(doc, step);
  const isTag = (l: BodyLine): l is TagLine => l.kind === "tag" && l.name === name;
  if (value === null)
    return withLines(
      doc,
      step,
      lines.filter((l) => !isTag(l)),
    );

  const index = lines.findIndex(isTag);
  if (index >= 0) {
    return updateLine(doc, { step, index }, (l) => checked({ ...setTagValue(l as TagLine, value), assign: false }));
  }
  const lastTag = lines.findLastIndex((l) => l.kind === "tag");
  const indent = step === null ? "" : bodyIndent(doc);
  const line: TagLine = { kind: "tag", indent, name, value, assign: false };
  return insertLine(doc, { step, index: lastTag + 1 }, line);
}

/**
 * Returns `value` if RXP reads it back unchanged as the value of `#tag`, and
 * throws `GuideEditError` if not, for example when it holds `--`.
 */
export function checkTagValue(tag: string, value: string): string {
  setTag(parseGuide(`#${tag} x\n`), null, tag, value);
  return value;
}

/** New guide text in the format of the bundled guides. Throws `GuideEditError` for names RXP would misread. */
export function newGuideText(group: string, name: string): string {
  const template = parseGuide("#group x\n#name x\nstep\n");
  return serializeGuide(setTag(setTag(template, null, "group", group), null, "name", name));
}

export function bodyIndent(doc: GuideDocument): string {
  const counts = new Map<string, number>();
  for (const step of doc.steps) {
    for (const line of step.body) {
      if (line.kind !== "blank") counts.set(line.indent, (counts.get(line.indent) ?? 0) + 1);
    }
  }
  let best = "";
  let bestCount = 0;
  for (const [indent, count] of counts) {
    if (count > bestCount) [best, bestCount] = [indent, count];
  }
  return best;
}

function withLines(doc: GuideDocument, step: number | null, lines: BodyLine[]): GuideDocument {
  return settle(setLines(doc, step, lines));
}

function setLines(doc: GuideDocument, step: number | null, lines: BodyLine[]): GuideDocument {
  if (step === null) return { ...doc, header: lines };
  return { ...doc, steps: doc.steps.map((s, i) => (i === step ? { ...s, body: lines } : s)) };
}

/**
 * Restores the document invariant after an edit: every line means what RXP
 * reads from the serialized text. Only the last line of a text with no final
 * line ending may keep its `--` text (`unterminated`), so the check goes by
 * position, not by line object:
 *
 * - The text needs a final line ending when its last line would read
 *   differently without one: `--` there would stop being a comment, and an
 *   empty last line would vanish. A text with no lines has none.
 * - Every other unterminated line, such as a moved or copied former last
 *   line, is reparsed to what RXP reads from it there.
 */
function settle(doc: GuideDocument): GuideDocument {
  const lastStep = doc.steps.at(-1);
  const last = lastStep ? (lastStep.body.at(-1) ?? lastStep.line) : doc.header.at(-1);
  const finalNewline = last !== undefined && (doc.finalNewline || !readsAsFinal(last));

  const fix = <L extends Line>(line: L, isLast: boolean): L =>
    line.unterminated && (finalNewline || !isLast) ? (parseLine(lineText(line)) as L) : line;
  const fixAll = <L extends Line>(lines: L[], ends: boolean): L[] => {
    const fixed = lines.map((line, i) => fix(line, ends && i === lines.length - 1));
    return fixed.every((line, i) => line === lines[i]) ? lines : fixed;
  };

  const header = fixAll(doc.header, doc.steps.length === 0);
  const fixedSteps = doc.steps.map((s, i) => {
    const ends = i === doc.steps.length - 1;
    const line = fix(s.line, ends && s.body.length === 0);
    const body = fixAll(s.body, ends);
    return line === s.line && body === s.body ? s : { line, body };
  });
  const steps = fixedSteps.every((s, i) => s === doc.steps[i]) ? doc.steps : fixedSteps;
  if (finalNewline === doc.finalNewline && header === doc.header && steps === doc.steps) return doc;
  return { ...doc, finalNewline, header, steps };
}

function readsAsFinal(line: Line): boolean {
  const text = lineText(line);
  if (text === "") return false;
  const { raw: _raw, ...model } = line;
  const { raw: _reread, ...reread } = parseLine(text, { unterminated: true });
  return equal(reread, model);
}

function checkBodyLine(line: BodyLine): void {
  if ((line as Line).kind === "step") {
    throw new GuideEditError("Use the step helpers to add a step line");
  }
  assertRepresentable(line);
}

function checkStep(step: Step): void {
  if (step.line.kind !== "step") throw new GuideEditError("A step must start with a step line");
  assertRepresentable(step.line);
  step.body.forEach(checkBodyLine);
}

function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  if (index < 0 || index > items.length) throw new RangeError(`Index ${index} out of range`);
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function checkIndex(items: readonly unknown[], index: number): void {
  if (index < 0 || index >= items.length) throw new RangeError(`Index ${index} out of range`);
}

function sameModel(a: Line, b: Line): boolean {
  return equal(edited(a), edited(b));
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ea = Object.entries(a).filter(([, v]) => v !== undefined);
  const eb = new Map(Object.entries(b).filter(([, v]) => v !== undefined));
  return ea.length === eb.size && ea.every(([k, v]) => equal(v, eb.get(k)));
}
