import stylelint from "stylelint";
import { RESERVED_PROPERTY } from "./packages/oxlint-plugin-rxpplanner/src/tokens.ts";

const token = (family) => String.raw`var\(--${family}-[a-z0-9-]+\)`;
const family = String.raw`var\(--font-(?:sans|mono)\)`;
const either = (...values) => `(?:${values.join("|")})`;

const hairline = String.raw`-?(?:1|1\.5|2)px`;
const spaceVar = String.raw`var\(--space-[0-9]+\)`;
const columnVar = String.raw`var\(--(?:warnings-indent|warnings-place-width|legend-label-start|ruler-band)\)`;
const number = String.raw`[0-9]+(?:\.[0-9]+)?(?![\w.%])`;
const calcBody = String.raw`${either(spaceVar, columnVar, number, String.raw`[\s()+*/-]`)}+`;
const centeredLine = String.raw`calc\(\(var\(--control-[a-z]+\) - 1lh\) / 2\)`;
const space = either(
  "0",
  "auto",
  hairline,
  spaceVar,
  columnVar,
  String.raw`calc\((?:${hairline}\s[+-]\s${calcBody}|${calcBody}(?:\s[+-]\s${hairline})?)\)`,
  centeredLine,
);

const effect = String.raw`var\(--${either("elevation-[12]", "ink-bar-[a-z-]+", "ring-[a-z-]+", "art-[a-z-]+")}\)`;

const reservedMessage = (name) => `${name} is a token name or prefix, which only tokens.css declares`;

// property-disallowed-list sees only declarations. A registered property with
// `inherits: false` would stop a token from reaching an element's descendants.
const reservedProperty = "rxpplanner/no-reserved-at-property";
const noReservedAtProperty = stylelint.createPlugin(reservedProperty, (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkAtRules(/^property$/i, (rule) => {
    const name = rule.params.trim();
    if (RESERVED_PROPERTY.test(name))
      stylelint.utils.report({ ruleName: reservedProperty, result, node: rule, message: reservedMessage(name) });
  });
});

const disabledTokens = "rxpplanner/disabled-tokens-when-disabled";
const DISABLED_TOKEN = /--disabled-(?:bg|fg)(?![\w-])/;
const DISABLED_STATE = /:disabled|\[aria-disabled="true"\]/;
/** @param {string} selector */
function subject(selector) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  let last = selector.slice(start);
  for (let at; (at = last.search(/:(?:not|has)\(/)) >= 0;) {
    let end = last.indexOf("(", at);
    for (let d = 0; end < last.length; end++) {
      if (last[end] === "(") d++;
      else if (last[end] === ")" && --d === 0) break;
    }
    last = last.slice(0, at) + last.slice(end + 1);
  }
  return last;
}
const disabledTokensWhenDisabled = stylelint.createPlugin(disabledTokens, (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkDecls((decl) => {
    if (!DISABLED_TOKEN.test(decl.value) || decl.parent?.type !== "rule") return;
    if (decl.parent.selectors.every((selector) => DISABLED_STATE.test(subject(selector)))) return;
    stylelint.utils.report({
      ruleName: disabledTokens,
      result,
      node: decl,
      message: `${decl.prop} uses a disabled token on a control that may be enabled. Add :disabled or [aria-disabled="true"] to the selector.`,
    });
  });
});

const primitiveClasses = "rxpplanner/primitive-classes-only";
const primitiveClassesOnly = stylelint.createPlugin(primitiveClasses, (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      const other = [...selector.replace(/\[[^\]]*\]/g, "").matchAll(/([.#])(-?[\w-]+)/g)].find(
        ([, kind, name]) => kind === "#" || !name.startsWith("ui-"),
      );
      if (!other) continue;
      stylelint.utils.report({
        ruleName: primitiveClasses,
        result,
        node: rule,
        message: `${other[0]} is not a primitive's class. A caller's rule goes in the caller's stylesheet.`,
      });
    }
  });
});

const notSolid = String.raw`/\b(?:dotted|dashed)\b/`;

const motionValue = `/^${either(
  String.raw`var\(--motion-(?:state|move|loop)\)`,
  String.raw`(?:cubic-bezier|steps|linear)\([^()]*\)`,
  String.raw`-?[A-Za-z_][\w-]*(?![\w(-])`,
  String.raw`[0-9]*\.?[0-9]+(?![\w.%(-])`,
  String.raw`[\s,]`,
)}+$/`;

/** @type {import("stylelint").Config} */
export default {
  reportDescriptionlessDisables: true,
  plugins: [noReservedAtProperty, disabledTokensWhenDisabled, primitiveClassesOnly],
  rules: {
    [reservedProperty]: true,
    [disabledTokens]: true,
    "declaration-no-important": true,
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|(?:-(?:webkit|moz|o)-)?(?:repeating-)?(?:linear|radial|conic)-gradient|-webkit-gradient)$/i,
    ],
    "property-disallowed-list": [[RESERVED_PROPERTY], { message: reservedMessage }],
    "declaration-property-value-allowed-list": {
      "font-family": [`/^${either(family, "inherit")}$/`],
      "font-size": [`/^${either(token("font-size"), "inherit")}$/`],
      "line-height": [`/^${either(token("line-height"), "inherit")}$/`],
      "font-weight": [`/^${either(token("font-weight"), "inherit")}$/`],
      // The shorthand resets font-variant-numeric, which turns off the body's tabular figures.
      font: ["inherit"],
      "letter-spacing": ["normal", "0"],
      "/radius$/": [`/^${either(`(?:${either("0", token("radius"))}(?: |$)){1,4}`, "inherit")}$/`],
      "/^(?:box-shadow|text-shadow|filter)$/": [`/^(?:none|${effect}(?:, ${effect})*)$/`],
      "/^(?:padding|margin|gap|row-gap|column-gap)/": [`/^${space}(?: ${space})*$/`],
      "/^(?:-[a-z]+-)?(?:transition|animation)/i": [motionValue],
      // Reduced motion does not reach a smooth scroll.
      "/^scroll-behavior$/i": ["auto"],
    },
    "declaration-property-value-disallowed-list": [
      {
        "/^(?:text-decoration|border-bottom|border-block(?:-end)?)(?:-style)?$/": [notSolid],
        "/^--/": [notSolid],
      },
      { message: "Use a solid line, not a dotted or dashed one. A dashed line marks an estimate, and a dotted one reads close to it." },
    ],
  },
  overrides: [
    {
      files: ["src/app/ui/ui.css"],
      rules: { "declaration-no-important": null, [primitiveClasses]: true },
    },
    {
      files: ["src/app/theme/tokens.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
        "property-disallowed-list": null,
        [reservedProperty]: null,
      },
    },
  ],
};
