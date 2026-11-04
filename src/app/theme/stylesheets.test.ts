import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildFiles, ROOT, sourceFiles, unguardedFiles } from "./testing.ts";

it("finds no styles or scripts that no guard reads", () => {
  expect(unguardedFiles(sourceFiles(), (file) => readFileSync(join(ROOT, file), "utf8"))).toEqual([]);
});

it("flags a stylesheet in each Vite CSS language other than CSS, outside the tool trees", () => {
  const files = buildFiles([
    "src/app/styles.css",
    "packages/theme/x.pcss",
    "a.postcss",
    "b.sss",
    "c.scss",
    "d.sass",
    "e.less",
    "f.styl",
    "g.stylus",
    "scripts/theme/x.scss",
    "packages/oxlint-plugin-rxpplanner/x.less",
  ]);
  expect(unguardedFiles(files, () => "")).toEqual([
    "packages/theme/x.pcss",
    "a.postcss",
    "b.sss",
    "c.scss",
    "d.sass",
    "e.less",
    "f.styl",
    "g.stylus",
  ]);
});

it("flags a stylesheet with @import, in any case and outside a comment", () => {
  const sheets: Record<string, string> = {
    "src/app/script.css": `@import "../../scripts/x.css";`,
    "src/app/text.css": `@import "./palette.txt";`,
    "src/app/upper.css": "@IMPORT url(x.inc);",
    "src/app/comment.css": `/* @import "./palette.txt"; */\n.a { color: var(--text); }`,
    "src/app/plain.css": ".a { color: var(--text); }",
  };
  expect(unguardedFiles(Object.keys(sheets), (file) => sheets[file] ?? "")).toEqual([
    "src/app/script.css",
    "src/app/text.css",
    "src/app/upper.css",
  ]);
});

it("flags a CSS module", () => {
  const sheets: Record<string, string> = {
    "src/app/panel.module.css": `.a { composes: b from "../../scripts/x.pcss"; }`,
    "src/app/panel.css": ".a { color: var(--text); }",
  };
  expect(unguardedFiles(Object.keys(sheets), (file) => sheets[file] ?? "")).toEqual(["src/app/panel.module.css"]);
});

const ENTRY = `<script type="module" src="/src/main.tsx"></script>`;
const page = (head: string) => `<html><head>${head}</head><body><div id="root"></div>${ENTRY}</body></html>`;

it("flags an HTML page with a tag other than the app entry and the tags it needs", () => {
  const pages: Record<string, string> = {
    "range.html": page(`<link media="(width > 1080px)" rel="stylesheet" href="/scripts/theme/audit.css">`),
    "title.html": page(`<link title="Contrast > baseline" rel="stylesheet" href="/scripts/theme/audit.pcss">`),
    "preload.html": page(`<link rel="preload" as="style" href="/scripts/x.css">`),
    "text.html": page(`<link rel="stylesheet" href="/palette.txt">`),
    "icon.html": page(`<link rel="icon" href="/favicon.svg">`),
    "favicon.html": page(`<link rel="icon" type="image/svg+xml" href="/scripts/favicon.svg" />`),
    "style.html": page("<STYLE>.a { color: #fff; }</STYLE>"),
    "inline.html": page(`<script type="module">import "/x.txt.css";</script>`),
    "tool.html": page(`<script type="module" src="/scripts/x.ts"></script>`),
    "twice.html": `${ENTRY}${ENTRY}<link rel="stylesheet" href="/x.css">`,
    "srcdoc.html": page(`<iframe srcdoc="&lt;style&gt;.a { color: #fff; }&lt;/style&gt;"></iframe>`),
    "iframe.html": page("<iframe></iframe>"),
    "object.html": page(`<object data="/scripts/theme/child.html"></object>`),
    "embed.html": page(`<embed src="/scripts/theme/child.html">`),
    "base.html": page(`<base href="/scripts/">`),
    "svg.html": page("<svg><style>.a { color: #fff; }</style></svg>"),
    "style.htm": "<style>.a { color: #fff; }</style>",
  };
  expect(unguardedFiles(Object.keys(pages), (file) => pages[file] ?? "")).toEqual(Object.keys(pages));
});

it("flags an HTML page by each suffix that Vite serves as HTML, in any case and with trailing white space", () => {
  const files = ["child.HTML", "child.HTM", "child.shtml", "child.xhtml", "child.XHT", "child.xht", "child.html "];
  // A `<link>` starts no sniff pattern, so only the suffix makes each file a page.
  expect(unguardedFiles(files, () => `<link rel="stylesheet" href="data:text/css,.a%7Bcolor:%23123456%7D">`)).toEqual(files);
});

// One case for each pattern in the sniff table, as Chromium matches it: a prefix with no end byte. `<body` and `<br` also
// match the shorter `<b`. Chromium skips a leading `\v` too, which HTML white space leaves out.
it.each([
  ["!DOCTYPE HTML", "src/app/child.data", "\v\n<!doctype html5>"],
  ["HTML", "src/app/child", "<html\t>"],
  ["HEAD", "src/app/child.lua", "<header>"],
  ["SCRIPT", "src/app/child.fragment", "<scripts>"],
  ["IFRAME", "src/app/child.fragment", "<iframes>"],
  ["H1", "src/app/child.fragment", "<h1/>"],
  ["DIV", "src/app/child.fragment", "<div\n class=x>"],
  ["FONT", "src/app/child.fragment", "<fonts>"],
  ["TABLE", "src/app/child.fragment", "<tables>"],
  ["A", "src/app/child.fragment", "<article>"],
  ["STYLE", "src/app/child.fragment", "<styles>"],
  ["TITLE", "src/app/child.fragment", "<titles>"],
  ["B", "src/app/child.fragment", "<button>"],
  ["BODY", "src/app/child.fragment", "<bodyx>"],
  ["BR", "src/app/child.fragment", "<brx>"],
  ["P", "src/app/child.fragment", "<pre>"],
  ["!--", "src/app/child.fragment", "<!---->"],
])("flags a file of any name whose text starts with the sniff pattern <%s", (_, file, start) => {
  expect(unguardedFiles([file], () => `${start}<style>.a { color: #123456; }</style>`)).toEqual([file]);
});

it("passes a file whose text does not start like an HTML page", () => {
  const files: Record<string, string> = {
    LICENSE: "MIT License\n\nCopyright (c) the authors\n",
    "docs/notes.md": "# Title\n\nSome <b>bold</b> text.\n",
  };
  expect(unguardedFiles(Object.keys(files), (file) => files[file] ?? "")).toEqual([]);
});

it("flags an HTML page with an attribute or a meta name that it does not need, in any case and spacing", () => {
  const pages: Record<string, string> = {
    "load.html": page("").replace("<body>", `<body onload="x()">`),
    "click.html": page(`<div/ONCLICK = "x()"></div>`),
    "style-attribute.html": page(`<div style="color: #123456"></div>`),
    "body-style.html": page("").replace("<body>", `<body STYLE = "color: #123456">`),
    "body-text.html": page("").replace("<body>", `<body text="#123456">`),
    "body-bgcolor.html": page("").replace("<body>", `<body bgcolor="#123456">`),
    "body-link.html": page("").replace("<body>", `<body link="#123456">`),
    "div-align.html": page(`<div align="center"></div>`),
    "refresh.html": page(`<meta http-equiv="refresh" content="0">`),
    "theme-color.html": page(`<meta name="theme-color" content="#123456">`),
  };
  expect(unguardedFiles(Object.keys(pages), (file) => pages[file] ?? "")).toEqual(Object.keys(pages));
});

it("flags an HTML page with a viewport value other than index.html's, or with an attribute next to that value", () => {
  const pages: Record<string, string> = {
    "other-viewport.html": page(`<meta name="viewport" content="width=device-width, initial-scale=2.0">`),
    "style-before-viewport.html": page("").replace("<body>", `<body style="color:#123456"content="width=device-width, initial-scale=1.0">`),
    "style-after-viewport.html": page("").replace("<body>", `<body content="width=device-width, initial-scale=1.0"style="color:#123456">`),
  };
  expect(unguardedFiles(Object.keys(pages), (file) => pages[file] ?? "")).toEqual(Object.keys(pages));
});

it("flags an HTML page with a Vite env placeholder", () => {
  const pages: Record<string, string> = {
    "env-attribute.html": page("<div %VITE_ATTR%></div>"),
    "env-title.html": page("<title>%VITE_TITLE%</title>"),
    "env-text.html": page("").replace("<body>", "<body>%MODE%"),
    "env-dotted.html": page("<div %VITE_A.B%></div>"),
  };
  expect(unguardedFiles(Object.keys(pages), (file) => pages[file] ?? "")).toEqual(Object.keys(pages));
});

it("passes an HTML page that holds only the app entry and the tags and attributes it needs", () => {
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  const pages: Record<string, string> = {
    "index.html": index,
    "entry.html": ENTRY,
    "description.html": index.replace("</head>", `<meta name="description" content="Plan a route online"></head>`),
  };
  expect(unguardedFiles(Object.keys(pages), (file) => pages[file] ?? "")).toEqual([]);
});
