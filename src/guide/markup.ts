/**
 * Guide text without WoW color codes and texture tags. Guides start colors
 * with a name, such as `|cRXP_WARN_`, or `|cAARRGGBB`, end them with `|r`,
 * and put an item's icon, a file ID or path with optional sizes such as
 * `|T134414:0|t`, before its name, such as `[Hearthstone]`. An icon without
 * a name drops out, since no table maps texture IDs to names. A `|r` outside
 * a color, a typo in some guides, drops out unless a letter or digit follows,
 * as in `left|right`. Other pipes stay, including an escaped `||`.
 */
export function plainText(text: string): string {
  return stripMarkup(text, 0, text.length, { colors: 0 });
}

export const MARKUP = /\|\||\|c(?:RXP_[A-Z]+_|[0-9a-fA-F]{8})|\|r|\|T(?:\d+|[\w.-]*[\\/][\w\\/.-]*)(?::-?\d+(?:\.\d+)?)*\|t/g;

/** `plainText` of `text` from `start` to `end`, counting open colors in `state` across calls. */
export function stripMarkup(text: string, start: number, end: number, state: { colors: number }): string {
  return text.slice(start, end).replace(MARKUP, (code, at: number) => {
    if (code === "||") return code;
    if (code === "|r" && state.colors > 0) state.colors--;
    else if (code === "|r") return /[\p{L}\p{N}]/u.test(text.charAt(start + at + 2)) ? code : "";
    if (code.startsWith("|c")) state.colors++;
    return "";
  });
}
