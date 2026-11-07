export function fail(path: string, problem: string): never {
  throw new Error(`${path}: ${problem}`);
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function fields(value: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!isObject(value)) fail(path, "expected an object");
  for (const key of required) if (!(key in value)) fail(`${path}.${key}`, "missing");
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, "unknown field");
  return value;
}

export function list(value: unknown, path: string, max = 10_000): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected a list");
  if (value.length > max) fail(path, `expected at most ${max} entries`);
  return value;
}

export function count(value: unknown, path: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) fail(path, `expected an integer of at least ${min}`);
  return value;
}
