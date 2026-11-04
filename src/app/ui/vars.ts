import tokens from "../theme/tokens.css?raw";
import { reservedProperty } from "../theme/reservedProperty.ts";

/** Custom properties that a primitive's own class reads. */
export type Vars = Record<`--${string}`, string | number | undefined>;

const reserved = import.meta.env.DEV ? reservedProperty(tokens) : undefined;
const isOwnProperty = (name: string): name is `--${string}` => name.startsWith("--") && !reserved?.test(name);

/**
 * A spread props object passes any key past the type and the `no-inline-style` rule. The token check runs only in
 * tests and dev builds, so the production bundle has no copy of tokens.css.
 */
export function varsStyle(vars: Vars | undefined): Vars | undefined {
  if (!vars) return undefined;
  const style: Vars = {};
  for (const [name, value] of Object.entries(vars)) {
    if (isOwnProperty(name)) style[name] = value;
    else if (import.meta.env.DEV) throw new Error(`\`vars\` sets only the element's own custom properties, so it cannot set \`${name}\`.`);
  }
  return style;
}
