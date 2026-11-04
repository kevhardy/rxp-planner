import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { RXP_COLORS } from "../../guide/index.ts";

type Theme = "light" | "dark";
type Rgb = [number, number, number];

const KINDS = ["accept", "turnin", "complete", "goto", "target", "train", "vendor", "command", "use", "equip"];
const RXP = RXP_COLORS.map(({ color }) => color.toLowerCase());
const OBJECTIVES = [1, 2, 3, 4, 5, 6].map((n) => `objective-${n}`);

type Pair = [fg: string, bg: string, min: number, element?: Record<string, string>];

const on = (fgs: string[], bgs: string[], min: number) => fgs.flatMap((fg) => bgs.map((bg): Pair => [fg, bg, min]));

// WCAG AA: 4.5:1 for text and 3:1 for marks and control borders. Kind colors draw marks, and RXP colors draw body text.
const PAIRS: Pair[] = [
  ...on(["text", "muted"], ["topbar", "bg", "surface", "pane-head", "raised", "hover", "selection", "press"], 4.5),
  ["placeholder", "field", 4.5],
  ...on(["text", "muted"], ["map-empty"], 4.5),
  ["text", "field", 4.5],
  ["control-border", "field", 3],
  ["raised-line", "raised", 1.5],
  ...on(["float-edge"], ["raised", "bg", "surface"], 1.3),
  ...on(["pop-ink"], ["topbar", "surface", "pane-head", "selection"], 4.5),
  ["pop-ink", "pressed-wash", 4.5, { ground: "var(--topbar)" }],
  ...on(["pop", "accent"], ["surface", "selection"], 3),
  ...on(["accent"], ["topbar", "pane-head", "raised", "hover"], 3),
  ...["topbar", "pane-head", "surface", "raised", "hover"].flatMap((ground): Pair[] => [
    ["text", "pressed-wash", 4.5, { ground: `var(--${ground})` }],
    ["accent", "pressed-wash", 3, { ground: `var(--${ground})` }],
  ]),
  ["pop-fg", "pop-ink", 4.5],
  ...on(
    KINDS.map((kind) => `kind-${kind}`),
    ["surface", "selection", "press"],
    3,
  ),
  ...on(
    RXP.map((color) => `rxp-${color}`),
    ["surface", "selection", "press"],
    4.5,
  ),
  ...on(["rxp-buy-swatch"], ["surface", "hover", "press"], 3),
  ...on(OBJECTIVES, ["surface", "raised", "selection", "map-terrain"], 3),
  ...OBJECTIVES.map((objective): Pair => [objective, "objective-tint", 3, { objective: `var(--${objective})` }]),
  ...on(["map-enemy", "map-enemy-dead", "map-step-upcoming"], ["map-terrain"], 3),
  ...on(["map-label", "map-label-strong", "map-border"], ["map-backdrop", "map-sea"], 4.5),
  ["map-character", "art-paper", 3],
  ...on(["art-paper"], ["map-step-previous-fill", "map-step-upcoming-fill"], 3),
  ...on(["stack-two", "stack-more"], ["map-interior"], 3),
  ...on(["warn", "danger", "ok"], ["surface", "press"], 4.5),
  ["warn", "warn-tint", 4.5],
  ["danger", "danger-tint", 4.5],
  ...on(["control-border"], ["topbar", "surface", "pane-head", "raised", "hover", "selection", "press"], 3),
  ...on(["warn-border"], ["warn-tint", "surface", "bg", "selection"], 3),
  ...on(["danger-border"], ["danger-tint", "surface", "bg"], 3),
  ...on(["add-done-border"], ["add-done-bg", "surface", "bg"], 3),
  ["primary-fg", "primary-bg", 4.5],
  ["primary-fg", "primary-hover", 4.5],
  ["danger-fg", "danger", 4.5],
  ["danger-fg", "danger-hover", 4.5],
  ["danger-fg", "danger-press", 4.5],
  ["primary-fg", "primary-press", 4.5],
];

const parse = (file: string) => postcss.parse(readFileSync(join(import.meta.dirname, file), "utf8"));
const routingSheet = parse("../routing/routing.css");
const sheets = [parse("../map/map.css"), routingSheet];

function declared(selector: string): Record<string, string> {
  const classes = selector.split(".").slice(1);
  const matched: [weight: number, rule: Rule][] = [];
  for (const sheet of sheets) {
    sheet.walkRules((rule) => {
      const weights = rule.selectors.flatMap((own) => {
        const names = own.split(".").slice(1);
        return /^(?:\.[\w-]+)+$/.test(own) && names.every((name) => classes.includes(name)) ? [names.length] : [];
      });
      if (weights.length > 0) matched.push([Math.max(...weights), rule]);
    });
  }
  matched.sort(([a], [b]) => a - b);
  return Object.fromEntries(
    matched.flatMap(([, rule]) => rule.nodes.flatMap((node) => (node.type === "decl" ? [[node.prop, node.value]] : []))),
  );
}

function legStroke(scope: string, part: string): string | undefined {
  let stroke: string | undefined;
  routingSheet.walkRules((rule) => {
    if (rule.selectors.some((own) => own.includes(`${scope} `) && own.endsWith(` ${part}`)))
      rule.walkDecls("stroke", (decl) => void (stroke = decl.value));
  });
  return stroke;
}

function written(selector: string, from = sheets): Record<string, string> {
  const own: Record<string, string> = {};
  for (const sheet of from)
    sheet.walkRules((rule) => {
      if (rule.selectors.includes(selector)) rule.walkDecls((decl) => void (own[decl.prop] = decl.value));
    });
  return own;
}

const PINS: [pin: string, inside?: string][] = [
  ...[
    ".pin.pin-goto",
    ".pin.pin-waypoint",
    ".pin.pin-previous",
    ".pin.pin-upcoming",
    ".pin.pin-route-start",
    ".pin.pin-route-stop",
    ".pin.pin-route-end",
  ].map((pin): [string, string] => [pin, ".map-body"]),
  ...[".route-pin.pin-route-start", ".route-pin.pin-route-stop", ".route-pin.pin-route-end"].map((pin): [string] => [pin]),
];

function readTokens(): Record<Theme | "element", Map<string, string>> {
  const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
  const themes = { light: new Map<string, string>(), dark: new Map<string, string>(), element: new Map<string, string>() };
  postcss.parse(css).each((node) => {
    if (node.type !== "rule") return;
    const theme = { ":root": themes.light, ':root[data-theme="dark"]': themes.dark }[node.selector] ?? themes.element;
    node.walkDecls(/^--/, (decl) => void theme.set(decl.prop, decl.value));
  });
  return themes;
}

const tokens = readTokens();

function color(theme: Theme, name: string, element: Record<string, string> = {}): Rgb {
  const value = element[name] ?? tokens[theme].get(`--${name}`) ?? tokens.light.get(`--${name}`) ?? tokens.element.get(`--${name}`);
  if (value === undefined) throw new Error(`No token --${name}`);
  const alias = /^var\(--([\w-]+)\)$/.exec(value);
  if (alias) return color(theme, alias[1]!, element);
  // color-mix in srgb mixes the encoded channels, not linear light. A mix with transparent is a wash, which
  // the element's `ground` shows through.
  const mix = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, (?:var\(--([\w-]+)\)|transparent)\)$/.exec(value);
  if (mix) {
    const [a, b, share] = [color(theme, mix[1]!, element), color(theme, mix[3] ?? "ground", element), Number(mix[2]) / 100];
    return [0, 1, 2].map((i) => Math.round(a[i]! * share + b[i]! * (1 - share))) as Rgb;
  }
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value)?.[1];
  if (hex === undefined) throw new Error(`--${name} is not an opaque color: ${value}`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function linear(rgb: Rgb): Rgb {
  return rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
}

/** WCAG 2 relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = linear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function distance(a: Rgb, b: Rgb): number {
  const oklab = (rgb: Rgb) => {
    const [r, g, bl] = linear(rgb);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

const token = (value = "") => /^var\(--([\w-]+)\)$/.exec(value)?.[1] ?? value;

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function paints(theme: Theme, value: string): Rgb[] {
  return [...value.matchAll(/var\(--([\w-]+)\)/g)].flatMap(([, name]) => {
    const own = tokens[theme].get(`--${name}`) ?? tokens.light.get(`--${name}`) ?? "";
    return /^(?:#|var\(|color-mix\()/.test(own) ? [color(theme, name!)] : paints(theme, own);
  });
}

const DARKEST = luminance([36, 21, 29]);
const GROUNDS = Array.from({ length: 1001 }, (_, i) => DARKEST + ((1 - DARKEST) * i) / 1000);

function onTerrain(colors: Rgb[]): number {
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.min(...GROUNDS.map((ground) => Math.max(...colors.map((c) => ratio(luminance(c), ground)))));
}

describe.each<Theme>(["light", "dark"])("the %s theme", (theme) => {
  it.each(PAIRS)("puts --%s on --%s at %s:1 or more", (fg, bg, min, element) => {
    expect(contrast(color(theme, fg, element), color(theme, bg, element))).toBeGreaterThanOrEqual(min);
  });

  it("outlines a missing guide icon in --control-border", () => {
    const border = tokens[theme].get("--control-border")!.replace("#", "%23");
    expect(tokens[theme].get("--guide-icon-outline")).toContain(`stroke='${border}'`);
  });

  it.each(PINS)("puts the numeral of %s on its fill at 3:1 or more", (pin, inside) => {
    const own = declared(pin);
    const element = Object.fromEntries(
      Object.entries({ ...(inside && declared(inside)), ...own }).flatMap(([prop, value]) =>
        prop.startsWith("--") ? [[prop.slice(2), value]] : [],
      ),
    );
    expect(contrast(color(theme, token(own.color), element), color(theme, token(own.background), element))).toBeGreaterThanOrEqual(3);
  });

  it.each(["surface", "selection"])("draws the level ring's track at 3:1 or more on --%s", (bg) => {
    let stroke: string | undefined;
    styles.walkRules(".sim-ring .track", (rule) => rule.walkDecls("stroke", (decl) => void (stroke = decl.value)));
    expect(contrast(color(theme, token(stroke)), color(theme, bg))).toBeGreaterThanOrEqual(3);
  });

  it("puts the selected step's number at 4.5:1 or more on its badge", () => {
    const own = written(".step-row.selected .step-no", [styles]);
    expect(contrast(color(theme, token(own.color)), color(theme, token(own.background)))).toBeGreaterThanOrEqual(4.5);
  });

  it("puts the level badge's text at 4.5:1 or more on its fill", () => {
    const own = written(".level-mark", [styles]);
    expect(contrast(color(theme, token(own.color)), color(theme, token(own.background)))).toBeGreaterThanOrEqual(4.5);
  });

  it("puts the warnings count at 4.5:1 or more on the top bar", () => {
    const [count, bar] = [written(".warnings-total.warn", [styles]).color, written(".topbar", [styles]).background];
    expect(contrast(color(theme, token(count)), color(theme, token(bar)))).toBeGreaterThanOrEqual(4.5);
  });

  it("colors the warnings count in the Warnings panel like the one in the top bar", () => {
    expect(written(".count.warn", [styles]).color).toBe(written(".warnings-total.warn", [styles]).color);
  });

  it("draws the chosen leg's halo or its ink edge at 3:1 or more on any terrain", () => {
    const parts = [".leg-halo", ".leg-edge"].map((part) => color(theme, token(legStroke(".leg-chosen", part))));
    expect(onTerrain(parts)).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ".pin.selected",
    ".pin.pin-route-start.selected",
    ".pin.pin-route-stop.selected",
    ".pin.pin-route-end.selected",
    '.map-overlay .ride-mark[aria-pressed="true"]',
  ])("draws the look of %s with a color at 3:1 or more on any terrain", (selector) => {
    const own = written(selector);
    expect(onTerrain(paints(theme, `${own["box-shadow"] ?? ""} ${own.outline ?? ""}`))).toBeGreaterThanOrEqual(3);
  });

  it("draws the editor handle's focus ring with a color at 3:1 or more on any terrain", () => {
    const own = { ...written(":focus-visible", [styles]), ...written(".gutter-dock:focus-visible", [styles]) };
    const ring = written(".gutter-dock:focus-visible::before", [styles]);
    expect(onTerrain(paints(theme, `${own.outline ?? ""} ${ring.border ?? ""} ${ring.filter ?? ""}`))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the chosen leg's halo apart from the focused leg's halo", () => {
    const [chosen, focused] = [".leg-chosen", ".route-leg:focus-visible"].map((scope) =>
      color(theme, token(legStroke(scope, ".leg-halo"))),
    );
    expect(distance(chosen!, focused!)).toBeGreaterThanOrEqual(0.08);
  });

  // The ring sits inside a selected row, so in the bar's color its top and bottom edges read as more selection.
  it("keeps the focus ring apart from the selection bar", () => {
    const [ring, bar] = ["--focus-ring", "--ink-bar-start"].map((name) => paints(theme, tokens.light.get(name)!)[0]!);
    expect(distance(ring!, bar!)).toBeGreaterThanOrEqual(0.08);
  });

  // CSS Color 4 takes an OKLab distance of 0.02 as just noticeable, and four times that keeps two marks apart.
  it.each(
    OBJECTIVES.flatMap((objective, i) =>
      [...OBJECTIVES.slice(i + 1), ...KINDS.map((kind) => `kind-${kind}`), "map-character"].map((other) => [objective, other]),
    ),
  )("keeps --%s apart from --%s", (objective, other) => {
    expect(distance(color(theme, objective), color(theme, other))).toBeGreaterThanOrEqual(0.08);
  });

  const WARM = ["accept", "vendor", "complete"];
  it.each(
    WARM.flatMap((warm, i) =>
      KINDS.flatMap((kind) => (kind === warm || WARM.slice(0, i).includes(kind) ? [] : [[`kind-${warm}`, `kind-${kind}`]])),
    ),
  )("keeps --%s apart from --%s", (warm, other) => {
    expect(distance(color(theme, warm), color(theme, other))).toBeGreaterThanOrEqual(0.08);
  });

  it.each(RXP.flatMap((name, i) => RXP.slice(i + 1).map((other) => [`rxp-${name}`, `rxp-${other}`])))(
    "keeps --%s apart from --%s",
    (rxp, other) => {
      expect(distance(color(theme, rxp), color(theme, other))).toBeGreaterThanOrEqual(0.08);
    },
  );
});

const styles = postcss.parse(readFileSync(join(import.meta.dirname, "../styles.css"), "utf8"));

// The components set only data-color, and jsdom applies no CSS, so these
// rules are the only place that turns the token into a visible color.
it("paints the colored text and the swatch with the RXP token", () => {
  const painted: Record<string, string> = {};
  styles.walkRules(/^\.rxp-(?:colored|swatch-color)$/, (rule) =>
    rule.walkDecls(/^(?:color|background(?:-color)?)$/, (decl) => void (painted[`${rule.selector} ${decl.prop}`] = decl.value)),
  );
  expect(painted).toEqual({ ".rxp-swatch-color background": "var(--rxp)", ".rxp-colored color": "var(--rxp)" });
});

it("maps each RXP text color to its token in the colored text and the swatch, with a brighter Buy swatch", () => {
  const mapped: Record<string, string> = {};
  styles.walkRules(/\[data-color=/, (rule) => rule.walkDecls("--rxp", (decl) => void (mapped[rule.selector] = decl.value)));
  expect(mapped).toEqual({
    ...Object.fromEntries(
      RXP_COLORS.map(({ color }) => [`:is(.rxp-colored, .rxp-swatch-color)[data-color="${color}"]`, `var(--rxp-${color.toLowerCase()})`]),
    ),
    '.rxp-swatch-color[data-color="BUY"]': "var(--rxp-buy-swatch)",
  });
});

describe("the map's pins", () => {
  const level = (selector: string) => Number(written(selector)["z-index"] ?? 0);

  it.each([".pin-start", ".pin-end", ".pin-both", ".pin-objective"])("draws %s over the selected pin and under a moving pin", (pin) => {
    expect(level(pin)).toBeGreaterThanOrEqual(level(".pin.selected"));
    expect(level(".pin.moving")).toBeGreaterThan(level(pin));
  });
});

describe("a route card's rows", () => {
  const insetRings = [".route-legs button:focus-visible", ".route-step-list button:focus-visible"];
  const px = (value: string) => {
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    return parseFloat(alias ? tokens.light.get(alias[1]!)! : value);
  };

  it.each([".route-step", ".route-leg-show"])(
    "keeps the end padding of %s wider than its focus ring's inset, so the ring clears the row's time",
    (row) => {
      const [first = "0", end = first] = (declared(row).padding ?? "0").split(" ");
      for (const ring of insetRings) expect(px(end)).toBeGreaterThan(-px(written(ring, [routingSheet])["outline-offset"]!));
    },
  );

  it.each(insetRings)("gives %s no scroll margin", (ring) => {
    expect(written(ring, [routingSheet])["scroll-margin"]).toBe("0");
  });
});

describe("contrast", () => {
  it("gives black on white 21:1 and a color on itself 1:1", () => {
    expect([contrast([0, 0, 0], [255, 255, 255]), contrast([31, 29, 26], [31, 29, 26])]).toEqual([21, 1]);
  });

  it("matches the WCAG ratio of a known pair", () => {
    // #767676 is the lightest gray that reaches 4.5:1 on white, at 4.54:1.
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
});

describe("distance", () => {
  it("puts black 1 from white and pure red at its OKLab place from black", () => {
    // Pure red is oklab(0.628 0.225 0.126) in CSS Color 4.
    expect([distance([0, 0, 0], [255, 255, 255]), distance([0, 0, 0], [255, 0, 0])]).toEqual([
      expect.closeTo(1, 3),
      expect.closeTo(Math.hypot(0.628, 0.225, 0.126), 3),
    ]);
  });
});

// An inset shadow paints the box outside a hole. Where the hole's edge meets the box's edge at a fractional
// position, a browser can antialias the two edges apart and leave a hairline in the bar's color.
it.each([...tokens.light, ...tokens.element].filter(([name]) => name.startsWith("--ink-bar-")))(
  "pushes the hole of %s past the box's other edges",
  (_, value) => {
    const [, x, y, blur, spread] = /^inset (-?\d+)(?:px)? (-?\d+)(?:px)? (\d+)(?:px)? (-?\d+)px var/.exec(value) ?? [];
    expect({ blur, spread }).toEqual({ blur: "0", spread: "-1" });
    expect(Math.abs(Number(x)) + Math.abs(Number(y))).toBeGreaterThan(1);
  },
);
