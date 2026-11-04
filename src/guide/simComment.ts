import type { Line } from "./model.ts";
import { readAsTerminated } from "./serialize.ts";

export function simStart(comment: string | undefined): number | undefined {
  const match = comment?.match(/(^|\s)@sim(?=\s|$)/);
  return match ? match.index! + match[1]!.length : undefined;
}

/** A line's `@sim` directive as the guide writes it, such as `@sim kills=14`; undefined when it has none. */
export function simComment(line: Line): string | undefined {
  const { comment } = readAsTerminated(line);
  const start = simStart(comment);
  return start === undefined ? undefined : comment!.slice(start).trimEnd();
}
