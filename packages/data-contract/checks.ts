export type Check = (value: unknown) => boolean;
type Checked<C> = C extends ((value: unknown) => value is infer T) ? T : unknown;
type Fields<S extends Record<string, Check>> = {
  [K in keyof S & string as undefined extends Checked<S[K]> ? never : K]: Checked<S[K]>;
} & { [K in keyof S & string as undefined extends Checked<S[K]> ? K : never]?: Checked<S[K]> };
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown): v is string => typeof v === "string";
export const name = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v);
export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const integer = (v: unknown): v is number => Number.isSafeInteger(v);
export const natural = (v: unknown): v is number => integer(v) && v >= 0;
export const positive = (v: unknown): v is number => integer(v) && v > 0;
export const boolean = (v: unknown): v is boolean => typeof v === "boolean";
export const list =
  <C extends Check>(check: C) =>
  (v: unknown): v is Checked<C>[] =>
    Array.isArray(v) && v.every(check);
export const optional =
  <C extends Check>(check: C) =>
  (v: unknown): v is Checked<C> | undefined =>
    v === undefined || check(v);
export const nullable =
  <C extends Check>(check: C) =>
  (v: unknown): v is Checked<C> | null =>
    v === null || check(v);
export const oneOf =
  <const V extends readonly unknown[]>(...values: V) =>
  (v: unknown): v is V[number] =>
    values.includes(v);
export const fields = <T, S extends Record<string, Check>>(v: T, shape: S): v is T & Fields<S> =>
  object(v) && Object.entries(shape).every(([key, check]) => check(v[key]));
export const idDictionary =
  <C extends Check>(check: C) =>
  (v: unknown): v is Record<string, Checked<C>> =>
    object(v) && Object.entries(v).every(([key, value]) => positive(Number(key)) && String(Number(key)) === key && check(value));
export function requireValid(valid: unknown, where: string): asserts valid {
  if (!valid) throw new Error(`Invalid ${where}`);
}
export const unique = (values: readonly unknown[]): boolean => new Set(values).size === values.length;
export const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(finite);
export const world = (w: unknown) => fields(w, { instance: natural, x: finite, y: finite });
export const faction = oneOf("Alliance", "Horde");
/** Portable relative paths: no URL syntax, encodings, dot segments, aliases, or device names. */
export const datasetPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 240 &&
  value
    .split("/")
    .every(
      (part) =>
        /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) && !/[.]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    );
