import { validateEntityDataFile } from "../../packages/data-contract/validation.ts";
import type { ChangeNote } from "../../packages/data-contract/shared.ts";
import { describe, expect, it } from "vitest";
import { EntityIndex, ENTITY_TYPES, type EntityDataFile } from "./entities.ts";

function fixture(): EntityDataFile {
  const entities = {} as EntityDataFile["entities"];
  for (const type of ENTITY_TYPES)
    entities[type] = [
      [1, "Twin"],
      [3, "Twin"],
      [2, "Alpha 3"],
      [4, "TWIN"],
      [5, "Alphabet"],
    ];
  return { version: 2, entities };
}

describe("EntityIndex", () => {
  it.each(ENTITY_TYPES)("looks up and searches %s with stable bounds and duplicate IDs", (type) => {
    const index = new EntityIndex(fixture());
    expect(index.lookup(type, 3)).toEqual({ type, id: 3, name: "Twin" });
    expect(index.lookup(type, -1)).toBeUndefined();
    expect(index.lookup(type, 999)).toBeUndefined();
    expect(index.search(type, " 3 ").map((e) => e.id)).toEqual([3, 2]);
    expect(index.search(type, "3", 1).map((e) => e.id)).toEqual([3]);
    expect(index.search(type, "tWiN").map((e) => e.id)).toEqual([1, 3, 4]);
    expect(index.search(type, "alpha", 1).map((e) => e.id)).toEqual([2]);
    expect(index.search(type, " ")).toEqual([]);
    for (const limit of [0, -1, 1.5, 101, Infinity, NaN]) {
      expect(() => index.search(type, "Twin", limit)).toThrow(RangeError);
    }
  });

  it("orders exact names before prefixes and substrings, with stable name/ID ties", () => {
    const file = fixture();
    file.entities.spell = [
      [8, "Copy of Frostbolt"],
      [4, "Frostbolt Extra"],
      [3, "Frostbolt", "Rank 2"],
      [1, "Frostbolt", "Rank 1"],
      [9, "A Frostbolt"],
    ];
    const index = new EntityIndex(file);
    expect(index.search("spell", "frostbolt").map((e) => e.id)).toEqual([1, 3, 4, 9, 8]);
    expect(index.search("spell", "FROSTBOLT", 3).map((e) => e.id)).toEqual([1, 3, 4]);
    expect(index.search("spell", "3", 1)[0]?.subtext).toBe("Rank 2");
    for (const subtext of ["", " padded ", 2, "Rank\n1"]) {
      const invalid = fixture();
      (invalid.entities as Record<string, unknown>).spell = [[1, "Spell", subtext]];
      expect(() => validateEntityDataFile(invalid)).toThrow("Invalid or duplicate spell record");
    }
  });

  it("finds one NPC or item by its exact name, across both kinds", () => {
    const file = fixture();
    file.entities.npc = [
      [10, "Kobold Vermin"],
      [11, "Mottled Boar"],
      [12, "Mottled Boar"],
      [13, "Tusk"],
    ];
    file.entities.item = [
      [20, "Linen Cloth"],
      [21, "tusk"],
    ];
    const index = new EntityIndex(file);
    expect(index.entityByName("  kobold VERMIN ")).toEqual({ kind: "npc", id: 10 });
    expect(index.entityByName("Linen Cloth")).toEqual({ kind: "item", id: 20 });
    expect(index.entityByName("Mottled Boar")).toEqual({ kind: "ambiguous", npcIds: [11, 12] });
    expect(index.entityByName("Tusk")).toEqual({ kind: "ambiguous", npcIds: [13] });
    for (const name of ["Kobold", "Alphabet", "Kobold  Vermin", "Linen Cloths"]) expect(index.entityByName(name)).toBeUndefined();
  });

  it("attaches change notes and field sources to looked-up entities, with pins from the bundle's sets", () => {
    const sourceA = { source: "source-a", pins: { archive: "sha256:aa" } } as const;
    const sourceC = { source: "source-c", pins: { build: "1.60.1.70009" } } as const;
    const changes: ChangeNote = { status: "updated", labels: ["name_changed"], lines: ["Renamed", "Moved"], notShown: ["Moved"] };
    const file: EntityDataFile = {
      ...fixture(),
      sources: [sourceA, sourceC],
      details: {
        npc: {
          3: {
            changes,
            provenance: {
              fields: { name: { source: "source-c" }, changes: { source: "source-a" } },
              evidence: { "source-a": ["capture npc=3"] },
            },
          },
        },
        spell: { 5: { provenance: { fields: { subtext: { source: "source-c" } } } } },
      },
    };
    const index = new EntityIndex(JSON.parse(JSON.stringify(file)));
    const npc = index.search("npc", "twin", 2)[1]!;
    expect(npc).toEqual({ type: "npc", id: 3, name: "Twin", changes, provenance: file.details!.npc![3]!.provenance });
    expect(Object.isFrozen(npc)).toBe(true);
    expect(index.fieldOrigin(npc, "changes")).toEqual({ ...sourceA, evidence: ["capture npc=3"] });
    expect(index.fieldOrigin(npc, "name")).toEqual(sourceC);
    const spell = index.lookup("spell", 5)!;
    expect(spell.subtext).toBeUndefined();
    expect(index.fieldOrigin(spell, "subtext")).toEqual(sourceC);
    expect(index.lookup("item", 3)).toEqual({ type: "item", id: 3, name: "Twin" });
    expect(index.sources).toEqual([sourceA, sourceC]);

    for (const [details, message] of [
      [{ npc: { 9: { changes } } }, "Details for unknown npc 9"],
      [{ npc: { "03": { changes } } }, "Details for unknown npc 03"],
      [{ spell: { 1: { changes } } }, "Invalid details for spell 1"],
      [{ npc: { 1: {} } }, "Invalid details for npc 1"],
      [{ npc: { 1: { name: "Other" } } }, "Invalid details for npc 1"],
      [{ zone: {} }, "Invalid zone details"],
      [{ npc: { 1: { provenance: { fields: { name: { source: "rxp:forever" } } } } } }, "rxp:forever is not among the bundle's sources"],
    ] as const) {
      expect(() => validateEntityDataFile({ ...file, details })).toThrow(message);
    }
  });

  it("rejects incomplete, empty, duplicate, and malformed bundles", () => {
    for (const input of [null, {}, { version: 1 }]) {
      expect(() => validateEntityDataFile(input)).toThrow("Invalid entity data schema");
    }
    expect(() => validateEntityDataFile({ version: 2, entities: {} })).toThrow("Missing item data");
    const empty = fixture();
    (empty.entities as Record<string, unknown>).item = [];
    expect(() => validateEntityDataFile(empty)).toThrow("Missing item data");
    for (const rows of [
      [
        [1, "x"],
        [1, "y"],
      ],
      [[0, "x"]],
      [[1.5, "x"]],
      [[Number.MAX_SAFE_INTEGER + 1, "x"]],
      [[1, ""]],
      [[1, "x\ny"]],
      [[1, " padded "]],
      [[1, "x", "Rank 1"]],
      [[1, 2]],
    ]) {
      const input = fixture();
      (input.entities as Record<string, unknown>).item = rows;
      expect(() => validateEntityDataFile(input)).toThrow("Invalid or duplicate item record");
    }
  });
});
