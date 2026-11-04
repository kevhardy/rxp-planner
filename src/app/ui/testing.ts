import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { ROOT } from "../theme/testing.ts";

// jsdom's getComputedStyle drops any value that holds var(), so tests read the cascade here.
// A later sheet wins a tie in specificity.
const SHEETS = [
  "src/app/theme/tokens.css",
  "src/app/ui/ui.css",
  "src/app/styles.css",
  "src/app/quests/questInfo.css",
  "src/app/quests/addStep.css",
  "src/app/preview/state.css",
  "src/app/routing/CoordinateReadout.css",
  "src/app/routing/routing.css",
  "src/app/map/map.css",
  "src/app/quests/quests.css",
  "src/app/playback/playback.css",
  "src/app/preview/chain.css",
  "src/app/preview/warnings.css",
];

/** As in a browser, a state on an element also holds on its ancestors, except `focus-visible`. */
export type State = "hover" | "active" | "focus-visible";

const STATES: Record<State, { attribute: string; ancestors: boolean }> = {
  hover: { attribute: "data-cascade-hover", ancestors: true },
  active: { attribute: "data-cascade-active", ancestors: true },
  "focus-visible": { attribute: "data-cascade-focus-visible", ancestors: false },
};

const SETTERS: Record<string, string[]> = {
  background: ["background", "background-color"],
  "border-color": ["border", "border-color"],
  inset: ["inset"],
};

interface Declaration {
  selectors: string[];
  property: string;
  value: string;
  important: boolean;
  order: number;
  from: string;
}

function parse(css: string, sheet: string): Declaration[] {
  const found: Declaration[] = [];
  postcss.parse(css).walkDecls((decl) => {
    const rule = decl.parent;
    if (rule?.type !== "rule" || (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))) return;
    found.push({
      selectors: rule.selectors,
      property: decl.prop,
      value: decl.value,
      // postcss leaves it undefined, not false, on a normal declaration.
      important: decl.important === true,
      order: 0,
      from: `${sheet}:${decl.source?.start?.line}`,
    });
  });
  return found;
}

const declarations = SHEETS.flatMap((sheet) => parse(readFileSync(join(ROOT, sheet), "utf8"), sheet)).map((d, order) => ({ ...d, order }));

function closingParen(selector: string, open: number): number {
  let depth = 0;
  for (let i = open; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    else if (selector[i] === ")" && --depth === 0) return i;
  }
  return selector.length;
}

function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, list.slice(start)];
}

type Specificity = [number, number, number];

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const compare = (a: Specificity, b: Specificity): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const most = (list: string): Specificity =>
  splitList(list)
    .map(specificity)
    .reduce((a, b) => (compare(a, b) >= 0 ? a : b));

/** Selectors Level 4 specificity: `:is`, `:not`, and `:has` count their most specific argument, and `:where` counts nothing. */
function specificity(selector: string): Specificity {
  let total: Specificity = [0, 0, 0];
  const ident = /^-?[\w-]+/;
  for (let i = 0; i < selector.length;) {
    const ch = selector[i]!;
    const rest = selector.slice(i + 1);
    if (ch === "#" || ch === ".") {
      total = add(total, ch === "#" ? [1, 0, 0] : [0, 1, 0]);
      i += 1 + (ident.exec(rest)?.[0].length ?? 0);
    } else if (ch === "[") {
      total = add(total, [0, 1, 0]);
      i = selector.indexOf("]", i) + 1;
    } else if (ch === ":" && selector[i + 1] === ":") {
      total = add(total, [0, 0, 1]);
      i += 2 + (ident.exec(selector.slice(i + 2))?.[0].length ?? 0);
    } else if (ch === ":") {
      const name = ident.exec(rest)?.[0] ?? "";
      i += 1 + name.length;
      if (selector[i] === "(") {
        const end = closingParen(selector, i);
        const args = selector.slice(i + 1, end);
        if (["is", "not", "has"].includes(name)) total = add(total, most(args));
        else if (name !== "where") total = add(total, [0, 1, 0]);
        i = end + 1;
      } else total = add(total, ["before", "after"].includes(name) ? [0, 0, 1] : [0, 1, 0]);
    } else if (/[a-z]/i.test(ch)) {
      total = add(total, [0, 0, 1]);
      i += ident.exec(selector.slice(i))?.[0].length ?? 1;
    } else i++;
  }
  return total;
}

const PSEUDO_ELEMENT = /::?(before|after)$/;

function matching(el: Element, selector: string, pseudo: "after" | "before" | undefined): boolean {
  const ends = PSEUDO_ELEMENT.exec(selector);
  if ((ends?.[1] as typeof pseudo) !== pseudo || (!pseudo && selector.includes("::"))) return false;
  const own = pseudo ? selector.slice(0, ends!.index) : selector;
  const rewritten = own
    .replaceAll(":hover", `[${STATES.hover.attribute}]`)
    .replaceAll(":active", `[${STATES.active.attribute}]`)
    .replaceAll(":focus-visible", `[${STATES["focus-visible"].attribute}]`)
    .replaceAll(":focus-within", `:has([${STATES["focus-visible"].attribute}])`);
  return el.matches(rewritten || "*");
}

export interface Look {
  states?: readonly State[];
  pseudo?: "after" | "before";
  /** CSS that loads after every stylesheet of the app, as a caller's rule would. */
  caller?: string;
}

/**
 * The winning declaration of `property` on `el`, or on its `::after` or `::before`, while it is in `states`. A rule
 * inside @media, @container, or @supports counts as if its condition holds.
 */
export function cascade(
  el: Element,
  property: string,
  { states = [], pseudo, caller }: Look = {},
): { value: string; from: string } | undefined {
  const marked: Array<[Element, string]> = [];
  for (const state of states) {
    const { attribute, ancestors } = STATES[state];
    for (let at: Element | null = el; at && (at === el || ancestors); at = at.parentElement) {
      at.setAttribute(attribute, "");
      marked.push([at, attribute]);
    }
  }
  try {
    const setters = SETTERS[property] ?? [property];
    let best: { d: Declaration; spec: Specificity } | undefined;
    const extra = caller ? parse(caller, "caller").map((d, i) => ({ ...d, order: declarations.length + i })) : [];
    for (const d of [...declarations, ...extra]) {
      if (!setters.includes(d.property)) continue;
      const hits = d.selectors.filter((s) => matching(el, s, pseudo));
      if (hits.length === 0) continue;
      const spec = hits.map(specificity).reduce((a, b) => (compare(a, b) >= 0 ? a : b));
      if (!best || (Number(d.important) - Number(best.d.important) || compare(spec, best.spec) || d.order - best.d.order) > 0) {
        best = { d, spec };
      }
    }
    return best && { value: best.d.value, from: best.d.from };
  } finally {
    for (const [at, attribute] of marked) at.removeAttribute(attribute);
  }
}
