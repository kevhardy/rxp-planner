import { datasetPath, fields, finite, list, name, natural, object, oneOf, optional, positive, requireValid } from "./checks.ts";
import type { InstanceId } from "./shared.ts";

/** The interiors file that the manifest's `interiors` field names: inside maps of caves, buildings, and cities. */
export interface InteriorsFile {
  version: 2;
  interiors: Interior[];
}

export interface Interior {
  /** Stable key, such as "ironforge" or "coldridge-troll-cave". */
  id: string;
  label: string;
  kind: "city" | "cave" | "building";
  map: InstanceId;
  /** The WMO placement that the images come from. */
  placement: { model: number; id: number };
  /** World yards. North and south are world X. West and east are world Y. */
  bounds: { north: number; south: number; west: number; east: number };
  /** Image size in pixels. 2 px for each yard. */
  size: [width: number, height: number];
  /** World yards. Height value v is base + (v - 1) / 8. */
  heightBase: number;
  /** Art of the lowest walkable surface at each pixel. */
  ground: InteriorImages;
  /** An `interior-surfaces` asset. */
  surfaces: string;
  /** At most 255 names, sorted by code unit. Place value p of 1 or more names places[p - 1]. 0 is no name. */
  places: string[];
}

/** Dataset-relative paths to webp assets. */
export interface InteriorImages {
  minimap: string;
  plan: string;
  /**
   * A webp mask the size of the interior: opaque white on indoor ground and on each gap whose nearest ground is indoor,
   * clear elsewhere. Absent: everything inside the outline is indoor.
   */
  indoor?: string;
}

const idOrIndex = (id: unknown, index: number) => (typeof id === "string" ? id : index);

const version1Fields = ["all", "floors", "main"] as const;

/** Checks every interiors rule that needs no asset bytes. Unknown keys survive, except the fields of version 1. */
export function decodeInteriorsFile(input: unknown): InteriorsFile {
  validateInteriorsFile(input);
  return input;
}

function validateInteriorsFile(input: unknown): asserts input is InteriorsFile {
  requireValid(object(input), "interiors file");
  requireValid(input.version === 2, `interiors file version ${String(input.version)}, expected version 2`);
  requireValid(fields(input, { interiors: list(object) }), "interiors file");
  const ids = new Set<string>();
  for (const [i, interior] of input.interiors.entries()) {
    const where = `interior ${idOrIndex(interior.id, i)}`;
    requireValid(
      fields(interior, {
        id: name,
        label: name,
        kind: oneOf("city", "cave", "building"),
        map: natural,
        placement: (v) => fields(v, { model: positive, id: positive }),
        size: (v) => Array.isArray(v) && v.length === 2 && v.every(positive),
        heightBase: finite,
      }),
      where,
    );
    requireValid(!ids.has(interior.id), `duplicate interior ${interior.id}`);
    ids.add(interior.id);
    const { bounds } = interior;
    requireValid(
      fields(bounds, { north: finite, south: finite, west: finite, east: finite }) &&
        bounds.north > bounds.south &&
        bounds.west > bounds.east,
      `${where} bounds`,
    );
    for (const key of version1Fields) requireValid(!Object.hasOwn(interior, key), `${where} field ${key}`);
    requireValid(
      fields(interior, {
        ground: (v) => fields(v, { minimap: datasetPath, plan: datasetPath, indoor: optional(datasetPath) }),
        surfaces: datasetPath,
        places: (v) => list(name)(v) && v.length <= 255 && v.every((p, j, all) => j === 0 || all[j - 1]! < p),
      }),
      where,
    );
  }
}
