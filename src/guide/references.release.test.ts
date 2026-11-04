import { describe, expect, it } from "vitest";
import { ENTITY_TYPES } from "../data/entities.ts";
import { releaseNames } from "../data/releaseInputs.ts";
import { formatEntityReference, parseEntityReference } from "./references.ts";

describe("plain entity references", () => {
  it("formats and parses every finished entity name", () => {
    const names = releaseNames();
    for (const type of ENTITY_TYPES)
      for (const [id, label] of names.entities[type]) {
        const ref = { type, id, label };
        expect(parseEntityReference(formatEntityReference(ref))).toEqual(ref);
      }
  });
});
