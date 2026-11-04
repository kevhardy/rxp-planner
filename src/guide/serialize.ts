import type { BodyLine, Eol, GuideDocument, Line, Step, StepLine } from "./model.ts";
import { joinArgs, parseLine } from "./parse.ts";

/**
 * Serializes a document. Unedited lines keep their source text; edited lines
 * use `formatLine`.
 */
export function serializeGuide(doc: GuideDocument, eol: Eol = doc.eol): string {
  const lines: string[] = doc.header.map(lineText);
  for (const step of doc.steps) {
    lines.push(lineText(step.line), ...step.body.map(lineText));
  }
  const text = lines.join(eol);
  return doc.finalNewline ? text + eol : text;
}

export function lineText(line: Line): string {
  return line.raw ?? formatLine(line);
}

/**
 * The line as it reads when a line ending follows it. Only an `unterminated`
 * line reads differently: its `--` text becomes a comment.
 */
export function readAsTerminated<L extends Line>(line: L): L extends StepLine ? StepLine : BodyLine {
  return (line.unterminated ? parseLine(lineText(line)) : line) as L extends StepLine ? StepLine : BodyLine;
}

/** A step's source text: its step line, then its body lines, joined with `\n`. */
export function stepText(step: Step): string {
  return [step.line, ...step.body].map(lineText).join("\n");
}

/** Formats a line in canonical RXP style, ignoring `raw`. */
export function formatLine(line: Line): string {
  let code: string;
  switch (line.kind) {
    case "blank":
      return line.indent;
    case "step":
      code = "step";
      break;
    case "tag":
      code = `#${line.name}`;
      if (line.assign) code += ` =${line.value}`;
      else if (line.value !== "") code += ` ${line.value}`;
      break;
    case "command":
      code = `.${line.name}`;
      if (line.args.length > 0) code += ` ${joinArgs(line.name, line.args)}`;
      if (line.text) code += ` >> ${line.text}`;
      break;
    case "text":
      code = line.marker === ">>" && line.prefix ? `${line.prefix} >>${line.text}` : line.marker + line.text;
      break;
    case "condition":
    case "comment":
      code = "";
      break;
    case "other":
      code = line.text;
      break;
  }
  if (line.condition) code += `${code ? " " : ""}<< ${line.condition.text}`;
  if (line.comment !== undefined) code += `${code ? " " : ""}--${line.comment}`;
  return line.indent + code;
}
