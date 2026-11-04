import type { EntityType } from "./entities.ts";
import type { GameVersion } from "./shared.ts";

export interface GuideReference {
  edition: GameVersion;
  type: EntityType;
  id: number;
}

export interface GuideReferenceExport {
  version: 1;
  references: GuideReference[];
}

export function parseGuideReferenceExport(value: unknown): GuideReferenceExport {
  if (!record(value) || !keys(value, ["version", "references"]) || value.version !== 1 || !Array.isArray(value.references)) {
    throw new Error("Invalid guide-reference export: expected version 1 and references");
  }
  const references = value.references.map((ref: unknown): GuideReference => {
    if (
      !record(ref) ||
      !keys(ref, ["edition", "type", "id"]) ||
      (ref.edition !== "era" && ref.edition !== "sod" && ref.edition !== "forever") ||
      (ref.type !== "item" && ref.type !== "npc" && ref.type !== "object" && ref.type !== "quest" && ref.type !== "spell") ||
      typeof ref.id !== "number" ||
      !Number.isSafeInteger(ref.id) ||
      ref.id <= 0
    ) {
      throw new Error("Invalid guide reference: expected edition, entity type, and positive safe integer ID");
    }
    return { edition: ref.edition, type: ref.type, id: ref.id };
  });
  return { version: 1, references };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
