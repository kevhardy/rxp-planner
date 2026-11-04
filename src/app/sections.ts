import {
  deleteLine,
  deleteStep,
  GuideEditError,
  insertLine,
  insertStep,
  lineText,
  parseGuide,
  type GuideDocument,
} from "../guide/index.ts";

/** Header lines, or a step's line and body lines, joined by LF. */
export function sectionText(doc: GuideDocument, step: number | null): string {
  const lines = step === null ? doc.header : [doc.steps[step]!.line, ...doc.steps[step]!.body];
  return lines.map(lineText).join("\n");
}

/** Line range of a section in the guide text: [start, end). */
export function sectionRange(doc: GuideDocument, step: number | null): [number, number] {
  let start = doc.header.length;
  if (step === null) return [0, start];
  for (let i = 0; i < step; i++) start += 1 + doc.steps[i]!.body.length;
  return [start, start + 1 + doc.steps[step]!.body.length];
}

/**
 * Replaces a section with parsed text. Step text must start with a `step`
 * line and may hold several steps; header text may hold none. The text holds
 * one line per LF, as `sectionText` writes it, so a trailing LF is a blank
 * line. Unchanged text changes nothing, and lines whose text is unchanged keep
 * it exactly.
 */
export function replaceSection(doc: GuideDocument, step: number | null, text: string): GuideDocument {
  text = text.replace(/\r\n?/g, "\n");
  if (text === sectionText(doc, step)) return doc;
  // Every line gets a line ending, so `--` always reads as a comment, as it
  // does everywhere but the end of a guide. Empty header text has no lines.
  const parsed = parseGuide(step === null && text === "" ? "" : `${text}\n`);
  if (step === null) {
    if (parsed.steps.length > 0) throw new GuideEditError("The header cannot hold a step line; add steps in the step list.");
    let next = doc;
    for (let i = doc.header.length - 1; i >= 0; i--) next = deleteLine(next, { step: null, index: i });
    parsed.header.forEach((line, i) => (next = insertLine(next, { step: null, index: i }, line)));
    return next;
  }
  if (parsed.header.length > 0 || parsed.steps.length === 0) {
    throw new GuideEditError("Step text must start with a step line.");
  }
  let next = deleteStep(doc, step);
  parsed.steps.forEach((s, i) => (next = insertStep(next, step + i, s)));
  return next;
}
