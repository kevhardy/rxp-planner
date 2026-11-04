const LUA_SPACE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX = /^([+-]?)0[xX]([\da-fA-F]*)(?:\.([\da-fA-F]*))?(?:[pP]([+-]?\d+))?$/;
const SPECIAL = /^([+-]?)(?:(inf(?:inity)?)|nan(?:\([\da-zA-Z_]*\))?)$/i;

/**
 * Reads a number as Lua 5.1's `tonumber` does, which reads it with C's
 * `strtod` (`luaO_str2d` in lobject.c): decimal with an optional exponent,
 * hexadecimal with `0x` and an optional fraction and binary exponent, `inf`,
 * or `nan`, with Lua whitespace around it. Returns `undefined` for other text.
 */
export function luaNumber(text: string): number | undefined {
  const trimmed = text.replace(LUA_SPACE, "");
  if (DECIMAL.test(trimmed)) return Number(trimmed);
  const hex = HEX.exec(trimmed);
  if (hex && (hex[2] || hex[3])) {
    const [, sign, whole = "", fraction = "", exponent = "0"] = hex;
    const value = scaled(BigInt(`0x${whole}${fraction}`), Number(exponent) - 4 * fraction.length);
    return sign === "-" ? -value : value;
  }
  const special = SPECIAL.exec(trimmed);
  if (!special) return undefined;
  if (!special[2]) return NaN;
  return special[1] === "-" ? -Infinity : Infinity;
}

/**
 * `mantissa * 2 ** exponent` rounded once to the nearest double, as `strtod`
 * rounds it. A value of at least 2 ** 1025 overflows, and one below 2 ** -1076
 * rounds to 0. For a negative exponent, `Number` reads the exact decimal
 * `mantissa * 5 ** -exponent` times `10 ** exponent`.
 */
function scaled(mantissa: bigint, exponent: number): number {
  if (mantissa === 0n) return 0;
  const top = mantissa.toString(2).length + exponent;
  if (top > 1025) return Infinity;
  if (top < -1075) return 0;
  return exponent >= 0 ? Number(mantissa << BigInt(exponent)) : Number(`${mantissa * 5n ** BigInt(-exponent)}e${exponent}`);
}
