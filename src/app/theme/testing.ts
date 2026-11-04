import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "../../..");

const TOOLS = ["scripts/", "packages/oxlint-plugin-rxpplanner/"];

/** `paths` and the result are relative to the repo root. */
export function buildFiles(paths: readonly string[]): string[] {
  return paths.filter((path) => !TOOLS.some((tree) => path.startsWith(tree)));
}

/**
 * Relative to the repo root. A new file counts before `git add`, and a deleted
 * file drops out before the deletion is staged.
 */
export function sourceFiles(): string[] {
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  return buildFiles(paths.split("\0").filter((path) => path && existsSync(join(ROOT, path))));
}

// From `CSS_LANGS_RE` in Vite's `constants.ts`, which compares a suffix by case.
const PREPROCESSED = /\.(?:less|sass|scss|styl|stylus|pcss|postcss|sss)$/;
// HTML has no end of forms that put styles, code, or a raw color in a page, such as `<style>`, event handlers,
// `bgcolor` on `body`, or the `meta` name `theme-color`. So a page holds only what `index.html` and a description use.
const ENTRY = `<script type="module" src="/src/main.tsx"></script>`;
const PAGE_TAGS = new Set(["html", "head", "meta", "title", "body", "div"]);
const PAGE_ATTRIBUTES = new Set(["lang", "charset", "name", "content", "id"]);
const META_NAMES = new Set(["viewport", "color-scheme", "description"]);
// The viewport value of `index.html`. The attribute checks skip its first copy, because they would read each `=` in it
// as an attribute's. A looser match could span the end of a tag and hide an attribute.
const VIEWPORT = `content="width=device-width, initial-scale=1.0"`;
// The favicon tag of `index.html`. The checks skip only this exact text, so any other `<link>` still counts.
const FAVICON = `<link rel="icon" type="image/svg+xml" href="/src/app/favicon.svg" />`;
// The suffixes that Vite's MIME table, `mrmime`, types as HTML. Its `lookup` trims a name and ignores a suffix's case.
const PAGE_SUFFIX = /\.(?:html?|shtml|xht|xhtml)$/i;
// The HTML patterns of the WHATWG MIME Sniffing standard. Vite gives most suffixes no type, and Chromium renders a file
// with no type as a page if its text starts with one. Chromium matches each pattern as a prefix, so `B` also covers
// `BODY` and `BR`. `\s` also skips a BOM and white space past Chromium's 512 bytes, which only flags more.
const SNIFFED_PAGE = /^\s*<(?:!DOCTYPE HTML|HTML|HEAD|SCRIPT|IFRAME|H1|DIV|FONT|TABLE|A|STYLE|TITLE|B|P|!--)/i;

function holdsUnlistedHtml(page: string): boolean {
  const rest = page.replace(ENTRY, "").replace(FAVICON, "");
  const attributes = rest.replace(VIEWPORT, "");
  return (
    // Vite's `htmlEnvHook` replaces each match of `/%(\S+?)%/g` with an env value after this check reads the page.
    /%\S+?%/.test(rest) ||
    [...attributes.matchAll(/([^\s"'<>/=]+)\s*=/g)].some(([, name = ""]) => !PAGE_ATTRIBUTES.has(name)) ||
    [...attributes.matchAll(/\bname\s*=\s*(["']?)([^\s"'>]*)\1/g)].some(([, , value = ""]) => !META_NAMES.has(value)) ||
    [...rest.matchAll(/<\/?([a-z][^\s/>]*)/gi)].some(([, name = ""]) => !PAGE_TAGS.has(name))
  );
}

function unguardedPage(file: string, text: string): boolean {
  return (PAGE_SUFFIX.test(file.trim()) || SNIFFED_PAGE.test(text)) && holdsUnlistedHtml(text);
}

/** Stylelint reads no CSS language but CSS, and `@import` or a CSS module loads a file that no guard may read. */
export function unguardedFiles(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(
    (file) =>
      PREPROCESSED.test(file) ||
      // Vite's `cssModuleRE` in `plugins/css.ts` makes each `.module.css` file a CSS module.
      file.endsWith(".module.css") ||
      // CSS matches an at-rule name in any case.
      (file.endsWith(".css") && /@import/i.test(read(file).replace(/\/\*[\s\S]*?\*\//g, ""))) ||
      unguardedPage(file, read(file)),
  );
}
