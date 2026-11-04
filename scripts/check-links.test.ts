import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { brokenLinks, unindexedDocs } from "./check-links.ts";

it("reports inline and reference links to missing files and headings, and skips code and external URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "check-links-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "logo.png"), "");
    writeFileSync(join(root, "docs/b.md"), "# B\n\n## `pnpm check` (CI)\n\n## Notes\n\n## Notes\n");
    writeFileSync(
      join(root, "README.md"),
      [
        "# Top",
        '[ok](docs/b.md#pnpm-check-ci) [ok](docs/b.md#notes-1 "title") [ok](#top) ![ok](logo.png)',
        "[web](https://example.com/missing) `[code](missing.md)`",
        "```md",
        "[fence](missing.md)",
        "```",
        "[file](docs/missing.md) [heading](docs/b.md#notes-2) [here](#nowhere)",
        "[Good reference][good] [Review reference][verify-target]",
        "[good]: docs/b.md#b",
        "[verify-target]: missing-reference.md",
      ].join("\n"),
    );
    expect(brokenLinks(root, ["README.md", "docs/b.md"])).toEqual([
      "README.md:7: docs/missing.md",
      "README.md:7: docs/b.md#notes-2",
      "README.md:7: #nowhere",
      "README.md:10: missing-reference.md",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("skips indented code, but checks indented list content and lazy paragraph lines", () => {
  const root = mkdtempSync(join(tmpdir(), "check-links-"));
  try {
    writeFileSync(
      join(root, "code.md"),
      [
        "# Code",
        "",
        "    [Example syntax](code-example.md)",
        "",
        "    [Second code line](missing-code.md)",
        "",
        "- An item",
        "",
        "    [listed](missing-list.md)",
        "",
        "A paragraph line",
        "    [lazy](missing-lazy.md)",
      ].join("\n"),
    );
    expect(brokenLinks(root, ["code.md"])).toEqual(["code.md:9: missing-list.md", "code.md:12: missing-lazy.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("reports each page under docs/ that the docs index does not link", () => {
  const root = mkdtempSync(join(tmpdir(), "check-links-"));
  try {
    mkdirSync(join(root, "docs/reference"), { recursive: true });
    writeFileSync(join(root, "docs/README.md"), "# Docs\n\n| Doc |\n| --- |\n| [A](reference/a.md#a) |\n\n`[code](reference/b.md)`\n");
    for (const page of ["a", "b"]) writeFileSync(join(root, `docs/reference/${page}.md`), `# ${page}\n`);
    writeFileSync(join(root, "README.md"), "[B](docs/reference/b.md)\n");
    const files = ["README.md", "docs/README.md", "docs/reference/a.md", "docs/reference/b.md"];
    expect(unindexedDocs(root, files)).toEqual(["docs/reference/b.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
