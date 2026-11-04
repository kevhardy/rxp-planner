import { join } from "node:path";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");

async function broken(css: string, file = "src/app/styles.css"): Promise<string[]> {
  const { results } = await stylelint.lint({ code: css, codeFilename: join(ROOT, file), configFile: join(ROOT, "stylelint.config.js") });
  return results.flatMap(({ warnings }) => warnings.map(({ rule }) => rule));
}

const VALUE = "declaration-property-value-allowed-list";

describe("color", () => {
  it("allows a color mix only in tokens.css", async () => {
    const css = ".a { color: color-mix(in srgb, var(--text) 50%, transparent); }";
    expect([await broken(css), await broken(css, "src/app/theme/tokens.css")]).toEqual([["function-disallowed-list"], []]);
  });

  it.each([
    "RGB(0 0 0)",
    "Hsl(0 0% 0%)",
    "color(srgb 1 0 0)",
    "COLOR(display-p3 1 0 0)",
    "device-cmyk(0 0 0 1)",
    "Oklch(0.5 0.1 20)",
    "LAB(50 0 0)",
  ])("rejects %s in any letter case", async (value) => {
    expect(await broken(`.a { color: ${value}; }`)).toEqual(["function-disallowed-list"]);
  });

  it.each([
    "linear-gradient(90deg, var(--text), var(--surface))",
    "Radial-Gradient(var(--text), var(--surface))",
    "conic-gradient(var(--text) 0 50%, var(--surface) 0)",
    "repeating-linear-gradient(45deg, var(--text) 0 2px, transparent 2px 4px)",
    "-WEBKIT-GRADIENT(linear, left top, right top, from(var(--text)), to(var(--surface)))",
    "-webkit-linear-gradient(var(--text), var(--surface))",
    "-moz-radial-gradient(var(--text), var(--surface))",
    "-o-repeating-linear-gradient(var(--text) 0 2px, var(--surface) 2px 4px)",
  ])("rejects the gradient %s outside tokens.css", async (value) => {
    const css = `.a { background: ${value}; }`;
    expect([await broken(css), await broken(css, "src/app/theme/tokens.css")]).toEqual([["function-disallowed-list"], []]);
  });

  it("allows a data gradient under a disable comment that names its data", async () => {
    const css = `.a {
      /* stylelint-disable-next-line function-disallowed-list -- hatch: estimate */
      background: repeating-linear-gradient(45deg, var(--text) 0 2px, transparent 2px 4px);
    }`;
    expect(await broken(css)).toEqual([]);
  });
});

describe("custom properties", () => {
  it.each([
    "--text",
    "--kind-goto",
    "--space-5",
    "--font-size-huge",
    "--line-height-x",
    "--radius-x",
    "--elevation-3",
    "--motion-x",
    "--art-glow",
    "--ring-x",
    "--ink-bar-x",
  ])("keeps %s for tokens.css", async (name) => {
    const css = `.a { ${name}: var(--muted); }`;
    expect([await broken(css), await broken(css, "src/app/theme/tokens.css")]).toEqual([["property-disallowed-list"], []]);
  });

  it.each(["--kind-new", "--rxp-new", "--objective-9", "--route-new", "--map-cover", "--stack-new", "--warn-indent"])(
    "keeps a new member of a tokens.css family, %s, for tokens.css",
    async (name) => {
      expect(await broken(`.a { ${name}: 0px; }`)).toEqual(["property-disallowed-list"]);
    },
  );

  it("keeps a registered @property of a tokens.css family for tokens.css", async () => {
    const css = '@property --kind-accept { syntax: "<color>"; inherits: false; initial-value: transparent; }';
    expect([await broken(css), await broken(css, "src/app/theme/tokens.css")]).toEqual([["rxpplanner/no-reserved-at-property"], []]);
  });

  it("allows a registered local name", async () => {
    expect(await broken('@property --panel-cover { syntax: "<length>"; inherits: true; initial-value: 0px; }')).toEqual([]);
  });

  it("allows a local name, such as the kind that a mark sets", async () => {
    expect(await broken(".a { --kind: var(--kind-goto); --panel-cover: 0px; }")).toEqual([]);
  });
});

describe("spacing", () => {
  it.each(["10PX", "5%", "3pt", "2vh", "1cqi", "1lh", "0.5rem", "calc(var(--space-2) + 3px)", "var(--muted)"])(
    "rejects %s",
    async (value) => {
      expect(await broken(`.a { padding: ${value}; }`)).toEqual([VALUE]);
    },
  );

  it.each([
    "calc(3 * 1px)",
    "calc(1px * 3)",
    "calc(2 * (var(--space-1) + 1px))",
    "calc(1px + 1px + var(--space-1))",
    "calc(2px + var(--space-1) - 2px)",
    "calc(1px + var(--space-2) + 2px)",
    "calc((var(--control-small) - 18px) / 2)",
  ])("rejects a raw length that calc() scales or repeats, %s", async (value) => {
    expect(await broken(`.a { padding: ${value}; }`)).toEqual([VALUE]);
  });

  it.each([
    "0",
    "auto",
    "var(--space-2) 1.5px",
    "-2px 0",
    "calc(-1 * (var(--space-8) + var(--space-4)))",
    "0 var(--warnings-indent)",
    "calc(1px + var(--warnings-indent))",
    "calc(var(--space-2) - 1px)",
    "calc((var(--control-small) - 1lh) / 2)",
  ])("allows %s", async (value) => {
    expect(await broken(`.a { margin: ${value}; }`)).toEqual([]);
  });
});

describe("letter spacing", () => {
  it("allows only normal and 0", async () => {
    const results = await Promise.all(["normal", "0", "0.04em"].map((value) => broken(`.a { letter-spacing: ${value}; }`)));
    expect(results).toEqual([[], [], [VALUE]]);
  });
});

describe("shadows and filters", () => {
  it.each([
    ["box-shadow", "0 0 4px var(--text)"],
    ["box-shadow", "var(--map-step)"],
    ["text-shadow", "0 0 2px var(--art-ink)"],
    ["filter", "blur(2px)"],
  ])("rejects %s: %s", async (prop, value) => {
    expect(await broken(`.a { ${prop}: ${value}; }`)).toEqual([VALUE]);
  });

  it.each([
    ["box-shadow", "var(--elevation-1)"],
    ["box-shadow", "var(--ink-bar-start), var(--ring-warn)"],
    ["text-shadow", "var(--art-label-halo)"],
    ["filter", "none"],
  ])("allows %s: %s", async (prop, value) => {
    expect(await broken(`.a { ${prop}: ${value}; }`)).toEqual([]);
  });
});

describe("lines", () => {
  it.each([
    "text-decoration: underline dotted var(--line)",
    "border-bottom-style: dashed",
    "border-block: 1px dashed var(--line)",
    "border-block-end: 1px dotted var(--muted)",
    "border-block-style: dotted",
    "border-block-end-style: dashed",
    "--underline-style: dotted",
  ])("rejects a dotted or dashed line, %s", async (declaration) => {
    expect(await broken(`.a { ${declaration}; }`)).toEqual(["declaration-property-value-disallowed-list"]);
  });

  it("allows a solid line, also in a custom property", async () => {
    expect(await broken(".a { --underline: 1px solid var(--line); border-block-end: var(--underline); }")).toEqual([]);
  });
});

describe("disables", () => {
  it("needs a reason on each disable comment", async () => {
    const css = (reason: string) => `/* stylelint-disable-next-line color-no-hex${reason} */\n.a { color: #fff; }`;
    expect([await broken(css("")), await broken(css(" -- the reason"))]).toEqual([["--report-descriptionless-disables"], []]);
  });
});

describe("motion", () => {
  it.each([
    "transition: opacity 1S",
    "transition: opacity 90mS",
    "transition: opacity var(--motion-state) 50ms",
    "-webkit-animation-duration: 1s",
    "TRANSITION: opacity 1s",
    "Animation-Delay: 1s",
    "transition-duration: var(--slow)",
    "animation: var(--animation)",
    "transition-duration: calc(var(--motion-move) * 10)",
  ])("rejects %s", async (declaration) => {
    expect(await broken(`.a { ${declaration}; }`)).toEqual([VALUE]);
  });

  it.each([
    "transition: background-color var(--motion-state), color var(--motion-state)",
    "transition: opacity var(--motion-move) cubic-bezier(0.2, 0, 0, 1) 0",
    "animation: appear var(--motion-move) ease-out both",
    "animation: spin var(--motion-loop) steps(8, end) infinite",
    "-webkit-animation-iteration-count: 2",
    "transition: none",
    "scroll-behavior: auto",
    "overscroll-behavior: contain",
  ])("allows %s", async (declaration) => {
    expect(await broken(`.a { ${declaration}; }`)).toEqual([]);
  });

  it.each(["scroll-behavior: smooth", "SCROLL-BEHAVIOR: smooth", "scroll-behavior: var(--scroll)"])("rejects %s", async (declaration) => {
    expect(await broken(`.a { ${declaration}; }`)).toEqual([VALUE]);
  });

  it.each(["scroll-behavior: smooth", "transition: opacity 200ms"])("rejects %s on :root in tokens.css", async (declaration) => {
    expect(await broken(`:root { --motion-state: 120ms; ${declaration}; }`, "src/app/theme/tokens.css")).toEqual([VALUE]);
  });
});

describe("button ownership", () => {
  it("allows !important only in ui.css, which owns each primitive's states", async () => {
    const css = ".ui-a:hover { background: var(--selection) !important; }";
    expect([await broken(css), await broken(css, "src/app/preview/chain.css"), await broken(css, "src/app/ui/ui.css")]).toEqual([
      ["declaration-no-important"],
      ["declaration-no-important"],
      [],
    ]);
  });

  it.each([
    ".chain-start-settings.ui-button:hover { background: var(--danger) !important; }",
    ".chain-card > .ui-item { background: var(--danger) !important; }",
    "#export.ui-button { background: var(--danger) !important; }",
  ])("rejects a caller's rule in ui.css: %s", async (css) => {
    expect(await broken(css, "src/app/ui/ui.css")).toEqual(["rxpplanner/primitive-classes-only"]);
  });

  it.each([
    ".a { background: var(--disabled-bg); }",
    ".a:has(> .b:disabled) > .c { color: var(--disabled-fg); }",
    ".a:disabled, .b { color: var(--disabled-fg); }",
    ".a:not(:disabled) { background: var(--disabled-bg); }",
    ".a { color: var(--disabled-fg, var(--muted)); }",
  ])("rejects the disabled tokens on a control that may be enabled: %s", async (css) => {
    expect(await broken(css)).toEqual(["rxpplanner/disabled-tokens-when-disabled"]);
  });

  it.each([
    ".a:disabled { background: var(--disabled-bg); }",
    '.a[aria-disabled="true"]:hover { color: var(--disabled-fg); }',
    ':is(.a, .b):is(:disabled, [aria-disabled="true"]) { color: var(--disabled-fg); }',
  ])("allows the disabled tokens on a disabled control: %s", async (css) => {
    expect(await broken(css)).toEqual([]);
  });
});
