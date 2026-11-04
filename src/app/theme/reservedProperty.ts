/** `css` is the text of `tokens.css`. */
export function reservedProperty(css: string): RegExp {
  const tokens = [...css.matchAll(/^\s*--([\w-]+):/gm)].flatMap(([, name]) => (name ? [name] : []));
  const families = [...new Set(tokens.flatMap((name) => (name.includes("-") ? [name.slice(0, name.indexOf("-"))] : [])))];
  return new RegExp(`^--(?:(?:${families.join("|")})-|(?:${tokens.join("|")})$)`);
}
