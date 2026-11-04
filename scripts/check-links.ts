import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const fences = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;
const blank = (text: string) => text.replace(/[^\n]/g, " ");

// CommonMark's indented code: a run of lines indented 4 or more spaces that
// starts after a blank line outside a list. Such a line right after a
// paragraph line continues the paragraph, and one in a list item is its content.
function blankIndentedCode(text: string): string {
  let afterBlank = true;
  let inCode = false;
  let inList = false;
  return text
    .split("\n")
    .map((line) => {
      const indent = line.replace(/\t/g, "    ").search(/\S/);
      if (indent < 0) {
        afterBlank = true;
        return line;
      }
      inCode = indent >= 4 && (inCode || (afterBlank && !inList));
      if (!inCode && /^ {0,3}([-*+]|\d{1,9}[.)])( |$)/.test(line)) inList = true;
      else if (indent < 2 && (afterBlank || /^#{1,6}( |$)/.test(line))) inList = false;
      afterBlank = false;
      return inCode ? blank(line) : line;
    })
    .join("\n");
}

// GitHub's heading IDs, with a -N suffix on each repeat.
function headingIds(text: string): Set<string> {
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  for (const [, heading = ""] of text.replace(fences, blank).matchAll(/^ {0,3}#{1,6} +(.+?)(?: +#+)? *$/gm)) {
    const slug = heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
      .replace(/ /g, "-");
    const repeat = counts.get(slug) ?? 0;
    counts.set(slug, repeat + 1);
    ids.add(repeat ? `${slug}-${repeat}` : slug);
  }
  return ids;
}

function* relativeLinks(root: string, file: string) {
  const text = blankIndentedCode(readFileSync(join(root, file), "utf8").replace(fences, blank)).replace(/(`+)[^\n]*?\1/g, blank);
  for (const match of text.matchAll(/\]\(([^)\s]+)(?: +"[^"]*")?\)|^ {0,3}\[[^\]\n]+\]: *<?([^\s>]+)>?/gm)) {
    const target = (match[1] ?? match[2])!;
    if (/^[a-z][\w+.-]*:|^\/\//i.test(target)) continue;
    const [path = "", fragment] = target.split("#");
    const linked = path ? relative(root, join(root, dirname(file), decodeURIComponent(path))) : file;
    yield { target, linked, fragment, line: text.slice(0, match.index).split("\n").length };
  }
}

export function brokenLinks(root: string, files: readonly string[]): string[] {
  const ids = new Map<string, Set<string>>();
  const idsOf = (file: string) => ids.get(file) ?? ids.set(file, headingIds(readFileSync(join(root, file), "utf8"))).get(file)!;
  const broken: string[] = [];
  for (const file of files) {
    for (const { target, linked, fragment, line } of relativeLinks(root, file)) {
      const ok =
        existsSync(join(root, linked)) && (!fragment || !linked.endsWith(".md") || idsOf(linked).has(decodeURIComponent(fragment)));
      if (!ok) broken.push(`${file}:${line}: ${target}`);
    }
  }
  return broken;
}

const INDEX = "docs/README.md";

export function unindexedDocs(root: string, files: readonly string[]): string[] {
  const indexed = new Set(existsSync(join(root, INDEX)) ? [...relativeLinks(root, INDEX)].map((link) => link.linked) : []);
  return files.filter((file) => file.startsWith("docs/") && file.endsWith(".md") && file !== INDEX && !indexed.has(file));
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const files = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const broken = brokenLinks(root, files);
  const unindexed = unindexedDocs(root, files);
  for (const line of broken) console.error(`Broken link: ${line}`);
  for (const file of unindexed) console.error(`Missing from ${INDEX}: ${file}`);
  if (broken.length || unindexed.length) process.exitCode = 1;
}
