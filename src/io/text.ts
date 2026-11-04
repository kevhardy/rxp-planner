import { parseLine, TAGS, type Line } from "../guide/index.ts";

export interface TextGuide {
  text: string;
  /** 1-based line on which the guide starts. */
  line: number;
}

interface Chunk {
  linesWithEndings: string[];
  lines: Line[];
  /** 1-based line of `linesWithEndings[0]` in the input. */
  firstLine: number;
}

const isHeaderLine = (line: Line) =>
  line.kind === "tag"
    ? TAGS.get(line.name)?.scope !== "step"
    : line.kind === "condition" || line.kind === "comment" || line.kind === "blank";
const isBlankOrComment = (line: Line) => line.kind === "blank" || line.kind === "comment";
const isHeaderTag = (line: Line) => line.kind === "tag" && TAGS.get(line.name)?.scope === "header";
const isName = (line: Line) => line.kind === "tag" && line.name === "name";

/** Plain text has no separator between guides, except NUL. Apart from NULs and chunks that hold only whitespace, the guide texts join back into the input. */
export function splitGuideText(input: string): TextGuide[] {
  const guides: TextGuide[] = [];
  let firstLine = 1;
  for (const text of input.split("\0")) {
    const linesWithEndings = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
    const chunk = { linesWithEndings, lines: linesWithEndings.map((line) => parseLine(line.replace(/[\r\n]+$/, ""))), firstLine };
    const starts = guideStarts(chunk);
    starts.forEach((start, k) => {
      const guide = linesWithEndings.slice(start, starts[k + 1]).join("");
      if (guide.trim()) guides.push({ text: guide, line: firstLine + start });
    });
    firstLine += linesWithEndings.filter((line) => /[\r\n]$/.test(line)).length;
  }
  return guides;
}

function guideStarts(chunk: Chunk): number[] {
  const starts = [0];
  let nameSeen = false;
  let bodyAfterName = false;
  chunk.lines.forEach((line, index) => {
    if (isName(line)) {
      if (bodyAfterName) starts.push(headerStart(chunk, index));
      nameSeen = true;
      bodyAfterName = false;
    } else if (nameSeen && !isHeaderLine(line)) {
      bodyAfterName = true;
    }
  });
  return starts;
}

const mayBelongToEitherGuide = (line: Line) => line.kind === "tag" || line.kind === "condition";

/** `nameAt` is a `#name` line with a body line above it, which stops the walk up. */
function headerStart({ linesWithEndings, lines, firstLine }: Chunk, nameAt: number): number {
  let start = nameAt;
  while (isHeaderLine(lines[start - 1]!)) start--;
  let firstHeaderTag = start;
  while (!isHeaderTag(lines[firstHeaderTag]!)) firstHeaderTag++;
  const blank = lines.slice(start, firstHeaderTag).findIndex((l) => l.kind === "blank");
  const shared = lines.slice(start, blank < 0 ? firstHeaderTag : start + blank).findIndex(mayBelongToEitherGuide);
  if (shared >= 0) {
    if (blank < 0) {
      const at = start + shared;
      throw new Error(
        `Line ${firstLine + at} (${linesWithEndings[at]!.trim()}) can belong to the guide above it or to the next guide. Add a blank line where the guide above ends, or import the Lua file.`,
      );
    }
    start += blank;
  }
  while (start < nameAt && isBlankOrComment(lines[start]!)) start++;
  return start;
}
