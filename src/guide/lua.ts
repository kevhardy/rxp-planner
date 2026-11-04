// Finds `RegisterGuide(...)` calls in Lua source and returns their guide text.
//
// RXP's API is `RegisterGuide(groupOrContent, text, defaultFor)`
// (`addon.RegisterGuide` in RXP's GuideLoader.lua): either one string holding the whole
// guide, or a group name followed by the guide text. Arguments must be string
// literals: long brackets of any level (`[[...]]`, `[==[...]==]`) or quoted
// strings. Call forms `f(...)`, `f[[...]]`, and `f"..."` are recognized. The
// scanner skips comments and other strings, so commented-out calls are ignored.

export interface ExtractedGuide {
  /** Guide text. Long-bracket text is the exact source slice. */
  text: string;
  /** Group name when the call passes group and text separately. */
  group?: string;
  /** Third `RegisterGuide` argument. */
  defaultFor?: string;
  /** Offsets of the text's contents in the source (end exclusive). */
  start: number;
  end: number;
  /** 1-based line on which the text starts. */
  line: number;
}

export class LuaExtractError extends Error {
  readonly offset: number;
  readonly line: number;
  constructor(message: string, offset: number, line: number) {
    super(`${message} (line ${line})`);
    this.offset = offset;
    this.line = line;
  }
}

interface StringLiteral {
  value: string;
  start: number;
  end: number;
}

export function extractGuides(source: string): ExtractedGuide[] {
  return scan(source, false).guides;
}

/**
 * Whether `source` calls `RegisterGuide` outside comments and strings, by the
 * rules `extractGuides` uses. It never throws, so it can tell Lua from plain
 * guide text with stray apostrophes: an unfinished quoted string ends at its
 * line break, escapes are skipped without decoding, an unfinished long string
 * or comment runs to the end, and a call counts once its opening `(`, quote,
 * or long bracket appears. `extractGuides` then reports any error in the call.
 */
export function hasRegisterGuideCall(source: string): boolean {
  return scan(source, true).called;
}

function scan(source: string, detect: boolean): { guides: ExtractedGuide[]; called: boolean } {
  const guides: ExtractedGuide[] = [];
  let i = 0;

  const lineAt = (offset: number) => {
    let line = 1;
    for (let k = 0; k < offset; k++) {
      if (source[k] === "\n" || (source[k] === "\r" && source[k + 1] !== "\n")) line++;
    }
    return line;
  };
  const fail = (message: string, offset: number): never => {
    throw new LuaExtractError(message, offset, lineAt(offset));
  };

  const longBracketLevel = (at: number) => {
    if (source[at] !== "[") return -1;
    let k = at + 1;
    while (source[k] === "=") k++;
    return source[k] === "[" ? k - at - 1 : -1;
  };

  const readLongBracket = (at: number, level: number): StringLiteral => {
    let start = at + level + 2;
    // Lua skips a newline that directly follows the opening bracket.
    const nl = /^(\r\n|\n\r|\n|\r)/.exec(source.slice(start, start + 2));
    if (nl) start += nl[0].length;
    const close = `]${"=".repeat(level)}]`;
    const end = source.indexOf(close, start);
    if (end < 0) {
      if (!detect) fail("Unfinished long string", at);
      i = source.length;
      return { value: source.slice(start), start, end: i };
    }
    i = end + close.length;
    return { value: source.slice(start, end), start, end };
  };

  const readQuoted = (at: number): StringLiteral => {
    const quote = source[at];
    let value = "";
    let k = at + 1;
    for (;;) {
      const c = source[k];
      if (c === undefined || c === "\n" || c === "\r") {
        if (!detect) fail("Unfinished string", at);
        break;
      }
      if (c === quote) break;
      if (c !== "\\") {
        value += c;
        k++;
        continue;
      }
      const e = source[k + 1] ?? "";
      if (detect && e !== "\n" && e !== "\r" && e !== "z") {
        k += 2;
        continue;
      }
      const simple: Record<string, string> = {
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        "\\": "\\",
        '"': '"',
        "'": "'",
        "\n": "\n",
        "\r": "\n",
      };
      if (e in simple) {
        value += simple[e];
        k += 2;
        if ((e === "\r" && source[k] === "\n") || (e === "\n" && source[k] === "\r")) k++;
      } else if (e === "z") {
        k += 2;
        while (/\s/.test(source[k] ?? "")) k++;
      } else if (e === "x") {
        value += String.fromCharCode(parseInt(source.slice(k + 2, k + 4), 16));
        k += 4;
      } else if (e === "u") {
        const m = /^u\{([0-9a-fA-F]+)\}/.exec(source.slice(k + 1));
        if (!m) fail("Invalid escape", k);
        value += String.fromCodePoint(parseInt(m![1]!, 16));
        k += 1 + m![0].length;
      } else if (/\d/.test(e)) {
        const digits = /^\d{1,3}/.exec(source.slice(k + 1))![0];
        value += String.fromCharCode(Number(digits));
        k += 1 + digits.length;
      } else {
        fail("Invalid escape", k);
      }
    }
    i = k + 1;
    return { value, start: at + 1, end: k };
  };

  const skipSpace = () => {
    for (;;) {
      while (/\s/.test(source[i] ?? "")) i++;
      if (!source.startsWith("--", i)) return;
      skipComment();
    }
  };

  const skipComment = () => {
    i += 2;
    const level = longBracketLevel(i);
    if (level >= 0) {
      readLongBracket(i, level);
      return;
    }
    while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
  };

  const readString = (): StringLiteral | undefined => {
    const c = source[i];
    if (c === '"' || c === "'") return readQuoted(i);
    const level = c === "[" ? longBracketLevel(i) : -1;
    return level >= 0 ? readLongBracket(i, level) : undefined;
  };

  const readCall = (): StringLiteral[] | undefined => {
    skipSpace();
    const single = readString();
    if (single) return [single];
    if (source[i] !== "(") return undefined;
    i++;
    const args: StringLiteral[] = [];
    for (;;) {
      skipSpace();
      if (source[i] === ")" && args.length === 0) break;
      const arg = readString();
      if (!arg) fail("RegisterGuide arguments must be string literals", i);
      args.push(arg!);
      skipSpace();
      if (source[i] === ",") {
        i++;
        continue;
      }
      if (source[i] !== ")") fail("Expected , or ) in RegisterGuide call", i);
      break;
    }
    i++;
    return args;
  };

  while (i < source.length) {
    const c = source[i]!;
    if (source.startsWith("--", i)) {
      skipComment();
    } else if (c === '"' || c === "'" || (c === "[" && longBracketLevel(i) >= 0)) {
      readString();
    } else if (/[A-Za-z_]/.test(c)) {
      const at = i;
      while (/\w/.test(source[i] ?? "")) i++;
      if (source.slice(at, i) !== "RegisterGuide") continue;
      if (detect) {
        skipSpace();
        const next = source[i];
        if (next === "(" || next === '"' || next === "'" || longBracketLevel(i) >= 0) return { guides, called: true };
        continue;
      }
      const args = readCall();
      if (!args) continue;
      if (args.length === 0 || args.length > 3) fail("RegisterGuide takes 1 to 3 arguments", at);
      const [first, second, third] = args;
      const text = second ?? first!;
      const guide: ExtractedGuide = {
        text: text.value,
        start: text.start,
        end: text.end,
        line: lineAt(text.start),
      };
      if (second) guide.group = first!.value;
      if (third) guide.defaultFor = third.value;
      guides.push(guide);
    } else {
      i++;
    }
  }
  return { guides, called: guides.length > 0 };
}
