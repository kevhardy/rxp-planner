import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeInteriorsFile, type InteriorImages, type InteriorsFile } from "../../packages/data-contract/interiors.ts";
import {
  decodeInteriorSurfaces,
  encodeInteriorSurfaces,
  insideInterior,
  surfaceHeightsAt,
  type InteriorSurfaces,
} from "../../packages/data-contract/interiorSurfaces.ts";
import { acceptInteriorImage, acceptInteriorSurfaces, startupAssets, validateDataset } from "../../packages/data-contract/manifest.ts";
import { fixture, image, interiorsFixture, sha256 } from "./manifestFixture.ts";

const lossy4x2 = "UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoEAAIAAgA0JaACdLoABDAAAP7lCv/sWctgXj/q7E+FDkAA";
const lossy2x4 = "UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoCAAQAAgA0JaACdLoABDAAAP7lCv/sWctgXj/q7E+FDkAA";
const grey8 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAAAAABawyK/AAAACXBIWXMAAAABAAAAAQBPJcTWAAAADklEQVR4nGNoAAIGEAEAFAoEAeiOg+cAAAAASUVORK5CYII=";
const dir = "interiors/the-deadmines-35530";
const surfacesPath = `${dir}/surfaces.bin.gz`;

function swap(
  f: { files: Map<string, Uint8Array<ArrayBuffer>>; manifest: { assets: { path: string }[] } },
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  f.files.set(path, bytes);
  Object.assign(
    f.manifest.assets.find((a) => a.path === path)!,
    { bytes: bytes.length, sha256: sha256(bytes) },
  );
}

function version1(f: ReturnType<typeof interiorsFixture>) {
  const { ground, surfaces, places, ...cave } = f.interiors.interiors[0]!;
  const images = { minimap: ground.minimap, plan: ground.plan };
  const floor = { id: "level-1", name: "Level 1", bottom: 20, top: 51, images: { ...images, heights: `${dir}/level-1-heights.png` } };
  f.replace("interiors.json.gz", { version: 1, interiors: [{ ...cave, all: images, floors: [floor], main: "level-1" }] });
}

const startupOf = (f: ReturnType<typeof interiorsFixture>) =>
  validateDataset(f.manifest, new Map(startupAssets(f.manifest).map((a) => [a.path, f.files.get(a.path)!])));

const cavePixel = (col: number, row: number) => ({ instance: 0, x: 1516.5 - (col + 0.5) / 2, y: -11093 - (row + 0.5) / 2 });

describe("NPC spawns in interiors", () => {
  const henchman = { world: { instance: 0, x: 1515.71, y: -11093.9 }, z: 29.6174, guid: 89539 };
  const withSpawn = (f: ReturnType<typeof fixture>, spawn: { interior: string; world?: ReturnType<typeof cavePixel> }) => {
    f.quests.npcs = { 594: { spawns: [{ ...henchman, ...spawn }], provenance: { fields: {} } } };
    f.replace("quests.json", f.quests);
    return f;
  };

  it("accepts a spawn labeled with an interior on its map", async () => {
    const f = withSpawn(interiorsFixture(), { interior: "the-deadmines-35530" });
    expect((await validateDataset(f.manifest, f.files)).quests.npcs?.[594]?.spawns?.[0]).toStrictEqual({
      world: { instance: 0, x: 1515.71, y: -11093.9 },
      z: 29.6174,
      guid: 89539,
      interior: "the-deadmines-35530",
    });
  });

  it.each([
    ["an unknown interior", interiorsFixture(), { interior: "fargodeep-mine" }],
    ["an interior on another map", interiorsFixture(), { interior: "the-deadmines-35530", world: { ...henchman.world, instance: 1 } }],
    ["an interior in a dataset without interiors", fixture(), { interior: "the-deadmines-35530" }],
  ])("refuses a spawn labeled with %s", async (_, f, spawn) => {
    const labeled = withSpawn(f, spawn);
    await expect(validateDataset(labeled.manifest, labeled.files)).rejects.toThrow(/Invalid NPC 594 spawn interior reference/);
  });

  describe("insideInterior", () => {
    const { interiors, surfaces } = interiorsFixture();
    const cave = interiors.interiors[0]!;

    it("reads the surface heights at a point, bottom first", () => {
      expect([surfaceHeightsAt(cave, surfaces, cavePixel(3, 1)), surfaceHeightsAt(cave, surfaces, cavePixel(0, 1))]).toEqual([
        [51],
        [20, 37],
      ]);
    });

    it("takes a spawn from 2 yd below the lowest surface to 8 yd above the highest", () => {
      const at = cavePixel(0, 1);
      expect([17.9, 18, 28, 45, 45.1].map((z) => insideInterior(cave, surfaces, at, z))).toEqual([false, true, true, true, false]);
    });

    it("takes a ledge spawn 4.2 yd above the surface, and leaves out a rim spawn 38 yd above it", () => {
      const at = cavePixel(3, 1);
      expect([insideInterior(cave, surfaces, at, 51 + 4.2), insideInterior(cave, surfaces, at, 51 + 38)]).toEqual([true, false]);
    });

    it("leaves out a spawn on another map, or outside the bounds where the nearest edge pixel has a surface", () => {
      expect([
        insideInterior(cave, surfaces, { ...cavePixel(3, 1), instance: 1 }, 51),
        insideInterior(cave, surfaces, { ...cavePixel(3, 1), y: -10687 }, 51),
      ]).toEqual([false, false]);
      expect(surfaceHeightsAt(cave, surfaces, { ...cavePixel(3, 1), y: -10687 })).toEqual([51]);
    });
  });
});

describe("interiors dataset contract", () => {
  it("passes a dataset with ground images and a surfaces asset, and reads the surfaces only on demand", async () => {
    const f = interiorsFixture();
    const result = await validateDataset(f.manifest, f.files);
    expect(result.interiors).toMatchObject({
      version: 2,
      interiors: [
        {
          id: "the-deadmines-35530",
          kind: "cave",
          size: [4, 2],
          heightBase: 12,
          surfaces: surfacesPath,
          places: ["Defias Hideout", "The Deadmines"],
        },
      ],
    });
    expect(startupAssets(f.manifest).filter((a) => a.path.startsWith(`${dir}/`))).toEqual([]);
    const decoded = await acceptInteriorSurfaces(await startupOf(f), surfacesPath, f.files.get(surfacesPath)!);
    expect(decoded).toEqual(f.surfaces);
    const plain = fixture();
    expect(await validateDataset(plain.manifest, plain.files)).not.toHaveProperty("interiors");
  });

  it("keeps unknown keys", () => {
    const file = structuredClone(interiorsFixture().interiors);
    Object.assign(file.interiors[0]!, { note: "one cave" });
    expect(decodeInteriorsFile(file).interiors[0]).toMatchObject({ id: "the-deadmines-35530", note: "one cave" });
  });

  it("refuses a version 1 dataset, and a version 1 interiors file that the manifest calls version 2", async () => {
    const f = interiorsFixture();
    version1(f);
    await expect(validateDataset(f.manifest, f.files)).rejects.toEqual(new Error("Invalid interiors file version 1, expected version 2"));
    f.manifest.assets.find((a) => a.path === "interiors.json.gz")!.version = 1;
    await expect(validateDataset(f.manifest, f.files)).rejects.toEqual(
      new Error("Invalid interiors asset interiors.json.gz version 1, expected version 2"),
    );
  });

  it.each<[string, (file: InteriorsFile) => void, string]>([
    ["file version", (file) => Object.assign(file, { version: 3 }), "Invalid interiors file version 3, expected version 2"],
    ["file without interiors", (file) => Object.assign(file, { interiors: {} }), "Invalid interiors file"],
    ["interior id", (file) => Object.assign(file.interiors[0]!, { id: 7 }), "Invalid interior 0"],
    [
      "ground without a plan",
      (file) => delete (file.interiors[0]!.ground as Partial<InteriorImages>).plan,
      "Invalid interior the-deadmines-35530",
    ],
    [
      "ground indoor mask that is not a dataset path",
      (file) => Object.assign(file.interiors[0]!.ground, { indoor: "../indoor.webp" }),
      "Invalid interior the-deadmines-35530",
    ],
    [
      "non-finite bounds",
      (file) => Object.assign(file.interiors[0]!.bounds, { west: Infinity }),
      "Invalid interior the-deadmines-35530 bounds",
    ],
    ["empty bounds", (file) => Object.assign(file.interiors[0]!.bounds, { north: -11094 }), "Invalid interior the-deadmines-35530 bounds"],
    [
      "duplicate interior",
      (file) => file.interiors.push(structuredClone(file.interiors[0]!)),
      "Invalid duplicate interior the-deadmines-35530",
    ],
  ])("rejects an interiors file with a %s", (_, change, message) => {
    const file = structuredClone(interiorsFixture().interiors);
    change(file);
    expect(() => decodeInteriorsFile(file)).toThrow(new Error(message));
  });

  it.each([
    ["all", { minimap: `${dir}/ground-minimap.webp`, plan: `${dir}/ground-plan.webp` }],
    ["floors", []],
    ["main", "level-1"],
  ])("rejects an interior with the version 1 field %s", (key, value) => {
    const file = structuredClone(interiorsFixture().interiors);
    Object.assign(file.interiors[0]!, { [key]: value });
    expect(() => decodeInteriorsFile(file)).toThrow(new Error(`Invalid interior the-deadmines-35530 field ${key}`));
  });

  it.each<[string, (f: ReturnType<typeof interiorsFixture>) => void, string]>([
    [
      "minimap that is not a WebP asset",
      (f) => {
        f.add(`${dir}/ground-minimap.png`, "png", image(grey8));
        f.interiors.interiors[0]!.ground.minimap = `${dir}/ground-minimap.png`;
        f.replace("interiors.json.gz", f.interiors);
      },
      `Invalid interior image reference ${dir}/ground-minimap.png`,
    ],
    [
      "plan of the wrong size",
      (f) => swap(f, `${dir}/ground-plan.webp`, f.files.get("art/map.webp")!),
      `Invalid interior image size ${dir}/ground-plan.webp`,
    ],
    [
      "lossy minimap of the wrong size",
      (f) => swap(f, `${dir}/ground-minimap.webp`, image(lossy2x4)),
      `Invalid interior image size ${dir}/ground-minimap.webp`,
    ],
    [
      "interiors field naming another format",
      (f) => (f.manifest.interiors = "quests.json"),
      "Invalid interiors asset reference quests.json",
    ],
    [
      "unreferenced interiors asset",
      (f) => {
        const extra = { ...f.manifest.assets.find((a) => a.path === "interiors.json.gz")!, path: "more-interiors.json.gz" };
        f.manifest.assets.push(extra);
        f.files.set(extra.path, f.files.get("interiors.json.gz")!);
      },
      "Invalid unreferenced interiors asset more-interiors.json.gz",
    ],
    [
      "surfaces asset that no interior names",
      (f) => {
        const extra = { ...f.manifest.assets.find((a) => a.path === surfacesPath)!, path: `${dir}/more.bin.gz` };
        f.manifest.assets.push(extra);
        f.files.set(extra.path, f.files.get(surfacesPath)!);
      },
      "Invalid unreferenced declared asset",
    ],
    [
      "interiors asset of version 3",
      (f) => (f.manifest.assets.find((a) => a.path === "interiors.json.gz")!.version = 3),
      "Invalid interiors asset interiors.json.gz version 3, expected version 2",
    ],
    [
      "surfaces that name an image",
      (f) => {
        f.interiors.interiors[0]!.surfaces = `${dir}/ground-plan.webp`;
        f.replace("interiors.json.gz", f.interiors);
      },
      `Invalid interior surfaces reference ${dir}/ground-plan.webp`,
    ],
    [
      "surfaces asset without gzip",
      (f) => {
        swap(f, surfacesPath, encodeInteriorSurfaces(f.surfaces));
        f.manifest.assets.find((a) => a.path === surfacesPath)!.encoding = "identity";
      },
      "Invalid asset declaration",
    ],
    [
      "places out of order",
      (f) => {
        f.interiors.interiors[0]!.places = ["The Deadmines", "Defias Hideout"];
        f.replace("interiors.json.gz", f.interiors);
      },
      "Invalid interior the-deadmines-35530",
    ],
    [
      "surfaces with a place past the interior's places",
      (f) => {
        f.interiors.interiors[0]!.places = ["Defias Hideout"];
        f.replace("interiors.json.gz", f.interiors);
      },
      "Invalid interior the-deadmines-35530 surfaces place",
    ],
  ])("rejects an installed dataset with a %s", async (_, change, message) => {
    const f = interiorsFixture();
    change(f);
    await expect(validateDataset(f.manifest, f.files)).rejects.toEqual(new Error(message));
  });

  it("reads the size of a lossy WebP without alpha", async () => {
    const f = interiorsFixture();
    swap(f, `${dir}/ground-minimap.webp`, image(lossy4x2));
    const result = await validateDataset(f.manifest, f.files);
    expect(result.interiors?.interiors[0]!.ground.minimap).toBe(`${dir}/ground-minimap.webp`);
  });

  it("passes an indoor mask as an interior image of the interior's size", async () => {
    const f = interiorsFixture();
    const indoor = `${dir}/ground-indoor.webp`;
    f.add(indoor, "webp", image(lossy4x2));
    f.interiors.interiors[0]!.ground.indoor = indoor;
    f.replace("interiors.json.gz", f.interiors);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.interiors?.interiors[0]!.ground.indoor).toBe("interiors/the-deadmines-35530/ground-indoor.webp");
    swap(f, indoor, image(lossy2x4));
    await expect(acceptInteriorImage(await startupOf(f), indoor, f.files.get(indoor)!)).rejects.toEqual(
      new Error("Invalid interior image size interiors/the-deadmines-35530/ground-indoor.webp"),
    );
  });

  describe("interior images on demand", () => {
    it("validates the startup assets without any interior image", async () => {
      const f = interiorsFixture();
      const result = await startupOf(f);
      expect(result.interiors?.interiors.map((interior) => interior.id)).toEqual(["the-deadmines-35530"]);
      await expect(acceptInteriorImage(result, `${dir}/ground-plan.webp`, f.files.get(`${dir}/ground-plan.webp`)!)).resolves.toBe(
        undefined,
      );
    });

    it.each<[string, (f: ReturnType<typeof interiorsFixture>) => [string, Uint8Array<ArrayBuffer>], string]>([
      [
        "wrong hash",
        (f) => [`${dir}/ground-minimap.webp`, f.files.get(`${dir}/ground-minimap.webp`)!.map((byte, i) => (i === 40 ? byte ^ 1 : byte))],
        `Invalid asset checksum ${dir}/ground-minimap.webp`,
      ],
      [
        "wrong size",
        (f) => {
          swap(f, `${dir}/ground-plan.webp`, f.files.get("art/map.webp")!);
          return [`${dir}/ground-plan.webp`, f.files.get(`${dir}/ground-plan.webp`)!];
        },
        `Invalid interior image size ${dir}/ground-plan.webp`,
      ],
      [
        "wrong format",
        (f) => {
          swap(f, `${dir}/ground-minimap.webp`, image(grey8));
          return [`${dir}/ground-minimap.webp`, f.files.get(`${dir}/ground-minimap.webp`)!];
        },
        `Invalid image container ${dir}/ground-minimap.webp`,
      ],
      [
        "path that is not an interior image",
        (f) => ["art/map.webp", f.files.get("art/map.webp")!],
        "Invalid interior image reference art/map.webp",
      ],
    ])("rejects a fetched image with a %s", async (_, change, message) => {
      const f = interiorsFixture();
      const [path, bytes] = change(f);
      const dataset = await startupOf(f);
      await expect(acceptInteriorImage(dataset, path, bytes)).rejects.toEqual(new Error(message));
    });
  });

  describe("surfaces asset", () => {
    it.each<[string, (gzip: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>, string]>([
      ["bad deflate block", (gzip) => Uint8Array.from([...gzip.subarray(0, 10), 0xff, ...gzip.subarray(11)]), "invalid block type"],
      ["bad check value", (gzip) => gzip.map((byte, i) => (i === gzip.length - 5 ? byte ^ 0xff : byte)), "incorrect data check"],
      ["cut end", (gzip) => gzip.slice(0, -3), "unexpected end of file"],
    ])("rejects surfaces with a %s, and names the asset and the gzip failure", async (_, change, reason) => {
      const f = interiorsFixture();
      swap(f, surfacesPath, change(new Uint8Array(gzipSync(encodeInteriorSurfaces(f.surfaces)))));
      await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(new Error(`Invalid asset gzip ${surfacesPath} (${reason})`));
    });

    it("stops reading surfaces at the most bytes that their header allows, before the end of the gzip", async () => {
      const f = interiorsFixture();
      const raw = new Uint8Array(53 + (1 << 20));
      raw.set(encodeInteriorSurfaces(f.surfaces));
      const gzip = new Uint8Array(gzipSync(raw));
      gzip[gzip.length - 5]! ^= 0xff;
      swap(f, surfacesPath, gzip);
      await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(
        new Error("Invalid interior the-deadmines-35530 surfaces size above 3868 bytes"),
      );
    });
  });

  describe("surfaces codec", () => {
    const { surfaces, interiors } = interiorsFixture();
    const cave = interiors.interiors[0]!;
    const decode = (s: InteriorSurfaces) => decodeInteriorSurfaces(encodeInteriorSurfaces(s), cave);

    it("decodes what it encodes", () => {
      expect(decode(surfaces)).toEqual(surfaces);
      expect([...encodeInteriorSurfaces(surfaces)]).toEqual([
        ...[0, 0, 0, 65, 0, 200, 1, 57, 0, 65, 0, 120, 0, 250, 1, 57],
        ...[0, 1, 1, 1, 1, 1, 2, 2],
        ...[0, 0, 0, 5],
        ...[1, 2, 0, 201, 2],
        ...[1, 2, 0, 250, 2],
        ...[2, 2, 0, 201, 0],
        ...[1, 2, 0, 220, 2],
        ...[1, 2, 1, 44, 2],
      ]);
    });

    it("writes a pixel step of 128 or more in more than one byte", () => {
      const wide = { ...cave, size: [200, 1] as [number, number] };
      const groundHeight = new Uint16Array(200).fill(9);
      const s: InteriorSurfaces = {
        width: 200,
        height: 1,
        groundHeight,
        groundPlace: new Uint8Array(200),
        stacked: Uint32Array.of(3, 190),
        upperStart: Uint32Array.of(0, 1, 2),
        upperHeight: Uint16Array.of(17, 17),
        upperPlace: Uint8Array.of(0, 0),
      };
      const bytes = encodeInteriorSurfaces(s);
      expect([...bytes.subarray(604)]).toEqual([3, 2, 0, 17, 0, 0xbb, 1, 2, 0, 17, 0]);
      expect(decodeInteriorSurfaces(bytes, wide)).toEqual(s);
    });

    it("writes up to 255 surfaces at a pixel, and refuses more", () => {
      const deep = (k: number): InteriorSurfaces => ({
        ...surfaces,
        stacked: Uint32Array.of(1),
        upperStart: Uint32Array.of(0, k - 1),
        upperHeight: Uint16Array.from({ length: k - 1 }, (_, i) => 66 + i),
        upperPlace: new Uint8Array(k - 1),
      });
      expect(decode(deep(255)).upperHeight.at(-1)).toBe(319);
      expect(() => encodeInteriorSurfaces(deep(256))).toThrow(new Error("Invalid surfaces at pixel 1, 256 of at most 255"));
    });

    it.each<[string, () => Uint8Array, string]>([
      ["short file", () => encodeInteriorSurfaces(surfaces).subarray(0, -1), "size"],
      ["place past the places", () => encodeInteriorSurfaces({ ...surfaces, groundPlace: Uint8Array.of(0, 1, 1, 3, 1, 1, 2, 2) }), "place"],
      [
        "upper height not above the one below",
        () => encodeInteriorSurfaces({ ...surfaces, upperHeight: Uint16Array.of(201, 200, 201, 220, 300) }),
        "height order",
      ],
      [
        "stacked pixel without ground",
        () => encodeInteriorSurfaces({ ...surfaces, stacked: Uint32Array.of(0, 2, 4, 5, 6) }),
        "stacked pixel",
      ],
    ])("rejects a %s", (_, bytes, rule) => {
      expect(() => decodeInteriorSurfaces(bytes(), cave)).toThrow(new Error(`Invalid interior the-deadmines-35530 surfaces ${rule}`));
    });
  });
});
