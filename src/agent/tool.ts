import type { EntityIndex, GameData, WorldLocation } from "../data/index.ts";
import type { AddonFile } from "../io/index.ts";
import type { FloorHint } from "../routing/floorHint.ts";
import type { GuideRecord } from "../guide/index.ts";

export interface Travel {
  seconds: number;
  yards: number;
}

/**
 * What tools read. Hosts load it once; tools never change it. Tools run in Node and in the browser, so `src/agent/` imports
 * no Node module. A host fills the optional members that need Node.
 */
export interface AgentContext {
  game: GameData;
  entities: EntityIndex;
  /** Built-in guides, in RXP load order. */
  guides: readonly GuideRecord[];
  /** A ground route at run speed; undefined when the host has no route between the points. */
  travel?: (from: WorldLocation, to: WorldLocation) => Promise<Travel | undefined>;
  /** The floors at a point; undefined when the host has no routing for its map. */
  floorHint?: (at: WorldLocation) => Promise<FloorHint | undefined>;
  /** Stores addon files and returns where they went; absent when the host cannot save. */
  save?: (files: readonly AddonFile[]) => Promise<string[]>;
}

export type JsonSchema =
  | { type: "string"; description?: string; enum?: readonly string[]; minLength?: number; maxLength?: number; default?: string }
  | { type: "integer" | "number"; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: "boolean"; description?: string; default?: boolean }
  | { type: "array"; description?: string; items: JsonSchema; maxItems?: number }
  | ObjectSchema;

export interface ObjectSchema {
  type: "object";
  description?: string;
  properties: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties: false;
}

export interface Tool<Input = never> {
  name: string;
  description: string;
  inputSchema: ObjectSchema;
  /** Gets input that matches the schema, with defaults filled in. Throws `ToolError` for a request it cannot serve. */
  run(input: Input, ctx: AgentContext): unknown;
}

/** A request the tool understood but cannot serve; the message tells the model what to change. */
export class ToolError extends Error {}

export type ToolResult = { ok: true; value: unknown } | { ok: false; error: string };

export async function callTool(tools: ReadonlyMap<string, Tool>, name: string, input: unknown, ctx: AgentContext): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}. Tools: ${[...tools.keys()].join(", ")}.` };
  const errors: string[] = [];
  const value = checkAndFill(tool.inputSchema, input ?? {}, "input", errors);
  if (errors.length) return { ok: false, error: `Invalid input: ${errors.join("; ")}.` };
  try {
    return { ok: true, value: await tool.run(value as never, ctx) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    throw error;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function checkAndFill(schema: JsonSchema, value: unknown, path: string, errors: string[]): unknown {
  const fail = (problem: string) => {
    errors.push(`${path} ${problem}`);
    return value;
  };
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return fail("must be a string");
      if (schema.enum && !schema.enum.includes(value)) return fail(`must be one of ${schema.enum.join(", ")}`);
      if (schema.minLength !== undefined && value.length < schema.minLength)
        return fail(`must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return fail(`must be at most ${schema.maxLength} characters`);
      return value;
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("must be a number");
      if (schema.type === "integer" && !Number.isInteger(value)) return fail("must be a whole number");
      const { minimum = -Infinity, maximum = Infinity } = schema;
      if (value < minimum || value > maximum) return fail(`must be from ${minimum} to ${maximum}`);
      return value;
    }
    case "boolean":
      return typeof value === "boolean" ? value : fail("must be true or false");
    case "array":
      if (!Array.isArray(value)) return fail("must be a list");
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return fail(`must have at most ${schema.maxItems} items`);
      return value.map((item, i) => checkAndFill(schema.items, item, `${path}[${i}]`, errors));
    case "object": {
      if (!isRecord(value)) return fail("must be an object");
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value))
        if (!Object.hasOwn(schema.properties, key))
          errors.push(`${path} has unknown field ${key}; fields: ${Object.keys(schema.properties).join(", ")}`);
      for (const [key, property] of Object.entries(schema.properties)) {
        if (value[key] !== undefined) out[key] = checkAndFill(property, value[key], `${path}.${key}`, errors);
        else if ("default" in property && property.default !== undefined) out[key] = property.default;
        else if (schema.required?.includes(key)) errors.push(`${path} needs ${key}`);
      }
      return out;
    }
  }
}
