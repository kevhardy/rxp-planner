import { COMMANDS } from "./catalog.ts";
import { parseCondition } from "./condition.ts";
import type { BodyLine, Eol, GuideDocument, Line, LineBase, Step } from "./model.ts";

// Parsing follows RXP's GuideLoader.lua. `addon.ParseGuide` strips `--` comments,
// splits lines, trims them, and starts a step at any line whose first four
// characters are `step`. Its local `parseLine` then removes the first `<<` and
// everything after it as the condition, reads `#tag value`, removes the first
// `>>` and everything after it as display text, and reads `.command args`.

export function parseGuide(text: string): GuideDocument {
  const eol: Eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = /(\r\n|\r|\n)$/.test(text);
  const body = finalNewline ? text.replace(/(\r\n|\r|\n)$/, "") : text;
  const doc: GuideDocument = { header: [], steps: [], eol, finalNewline };
  if (text === "") return doc;

  const raws = body.split(/\r\n|\r|\n/);
  let step: Step | undefined;
  raws.forEach((raw, i) => {
    const line = parseLine(raw, { unterminated: !finalNewline && i === raws.length - 1 });
    if (line.kind === "step") {
      step = { line, body: [] };
      doc.steps.push(step);
    } else {
      (step ? step.body : doc.header).push(line);
    }
  });
  return doc;
}

export interface ParseLineOptions {
  /**
   * The line ends the text with no line ending. RXP's comment patterns
   * (in `addon.ParseGuide`, GuideLoader.lua) need a following line ending, so `--` stays.
   */
  unterminated?: boolean;
}

export function parseLine(raw: string, options: ParseLineOptions = {}): Line {
  const indent = /^\s*/.exec(raw)![0];
  let code = raw.slice(indent.length);
  const base: LineBase = { raw, indent };

  const commentAt = code.indexOf("--");
  if (commentAt >= 0 && options.unterminated) {
    base.unterminated = true;
  } else if (commentAt >= 0) {
    base.comment = code.slice(commentAt + 2);
    code = code.slice(0, commentAt);
  }
  code = code.trimEnd();

  const conditionAt = code.indexOf("<<");
  if (conditionAt >= 0 && code.slice(conditionAt + 2).trim() !== "") {
    base.condition = parseCondition(code.slice(conditionAt + 2));
    code = code.slice(0, conditionAt).trimEnd();
  }

  return classify(code, base);
}

function classify(code: string, base: LineBase): Line {
  if (code === "") {
    if (base.condition) {
      return { ...base, kind: "condition", condition: base.condition };
    }
    if (base.comment !== undefined) {
      return { ...base, kind: "comment", comment: base.comment };
    }
    return { ...base, kind: "blank" };
  }

  if (code.startsWith("step")) return { ...base, kind: "step" };

  const tag = /^#(\S+)\s*(=?)\s*(.*)$/s.exec(code);
  if (tag) {
    return {
      ...base,
      kind: "tag",
      name: tag[1]!,
      assign: tag[2] === "=",
      value: tag[3]!,
    };
  }

  // RXP takes the text after the first `>>` before looking at the rest, and
  // ignores empty `>>` text.
  const textAt = code.indexOf(">>");
  const before = textAt >= 0 ? code.slice(0, textAt).trimEnd() : code;
  const text = textAt >= 0 ? code.slice(textAt + 2).trimStart() : "";

  const command = /^\.(\S+)\s*(.*)$/s.exec(before);
  if (command) {
    const name = command[1]!;
    const line: BodyLine = {
      ...base,
      kind: "command",
      name,
      args: splitArgs(name, command[2]!),
    };
    if (text) line.text = text;
    return line;
  }

  // Any other text before `>>` is ignored and the `>>` text shown alone.
  if (text || (textAt >= 0 && before === "")) {
    const line: BodyLine = { ...base, kind: "text", marker: ">>", text };
    if (before) line.prefix = before;
    return line;
  }

  if (before[0] === "+" || before[0] === "*") {
    return { ...base, kind: "text", marker: before[0], text: before.slice(1) };
  }

  return { ...base, kind: "other", text: code };
}

const separatorFor = (command: string) => COMMANDS.get(command)?.separator ?? "comma";

/**
 * Splits a command's argument text as RXP does, on the command's catalog
 * separator. A comma or semicolon split drops empty arguments; a `whole`
 * command takes the text as one argument.
 */
export function splitArgs(command: string, argText: string): string[] {
  switch (separatorFor(command)) {
    case "whole": {
      const arg = argText.trimEnd();
      return arg === "" ? [] : [arg];
    }
    case "semicolon":
      return argText
        .replace(/\s*;\s*/g, ";")
        .split(";")
        .filter(Boolean);
    case "comma":
      return argText
        .replace(/\s*,\s*/g, ",")
        .split(",")
        .filter(Boolean);
  }
}

export function joinArgs(command: string, args: readonly string[]): string {
  return args.join(separatorFor(command) === "semicolon" ? ";" : ",");
}
