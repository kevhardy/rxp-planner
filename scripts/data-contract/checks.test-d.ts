import { expectTypeOf } from "vitest";
import { faction, fields, finite, idDictionary, list, nullable, optional, positive, text } from "../../packages/data-contract/checks.ts";

declare const value: unknown;
declare const row: { id?: unknown; byFaction?: string };

if (fields(value, { label: text, ids: list(positive), note: optional(text), rank: nullable(positive), names: idDictionary(text) })) {
  expectTypeOf(value.label).toEqualTypeOf<string>();
  expectTypeOf(value.ids).toEqualTypeOf<number[]>();
  expectTypeOf(value.note).toEqualTypeOf<string | undefined>();
  expectTypeOf(value.rank).toEqualTypeOf<number | null>();
  expectTypeOf(value.names).toEqualTypeOf<Record<string, string>>();
  expectTypeOf({ label: "A", ids: [1], rank: null, names: {} }).toExtend<typeof value>();
}

if (faction(value)) expectTypeOf(value).toEqualTypeOf<"Alliance" | "Horde">();

if (fields(value, { width: (v: unknown) => finite(v) && v > 0 })) expectTypeOf(value.width).toBeUnknown();

if (fields(row, { id: positive })) {
  expectTypeOf(row.id).toEqualTypeOf<number>();
  expectTypeOf(row.byFaction).toEqualTypeOf<string | undefined>();
}

declare const label: unique symbol;
if (fields(value, { [label]: text })) expectTypeOf(value).not.toHaveProperty(label);
