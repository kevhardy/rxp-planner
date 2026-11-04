import type { GameDataFile, QuestPoint, QuestRow } from "../../packages/data-contract/model.ts";
import type { WorldLocation } from "../../packages/data-contract/geometry.ts";
import type { WorldMapData } from "../../packages/data-contract/worldMap.ts";
import type { DatasetGeometry, DatasetAsset } from "../../packages/data-contract/manifest.ts";
import type { TransportsFile } from "../../packages/data-contract/transports.ts";
import { sha256, fixture, guideIconsFixture, image, transparentPng, transportsFixture } from "./manifestFixture.ts";
import { describe, expect, it } from "vitest";
import {
  acceptGuideIconImage,
  acceptMapTile,
  startupAssets,
  validateDataset,
  validateDatasetAsset,
  validateDatasetManifest,
  type DatasetManifest,
} from "../../packages/data-contract/manifest.ts";
import { canvasToWorld, locateCanvas, percentToWorld, worldToCanvas } from "../../packages/data-contract/geometry.ts";
import {
  cropKey,
  guideIconCell,
  guideIconSheetSize,
  parseCropKey,
  textureKey,
  type GuideIconsFile,
  type TextureCrop,
} from "../../packages/data-contract/guideIcons.ts";

describe("complete dataset contract v2", () => {
  it("throws the abort reason instead of checking an asset after its signal aborts", async () => {
    const f = fixture();
    await expect(validateDataset(f.manifest, f.files, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  });

  it("accepts independent complete bytes, preserves unknowns and reconstructs calibrated geometry without mutation", async () => {
    const f = fixture();
    const before = JSON.stringify(f.manifest),
      bytes = [...f.files].map(([path, data]) => [path, sha256(data)]);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.quests.quests[0]).toMatchObject({
      requiredLevel: 9,
      questLevel: 14,
      requiredRaceMask: null,
      requiredFaction: null,
      preQuestSingle: [],
      rewardItems: [],
      rewardMoney: 500,
    });
    expect(result.quests.quests[0]).not.toHaveProperty("requiredMaxLevel");
    expect(result.entities.entities.spell).toEqual([[585, "Smite", "Rank 1"]]);
    expect(result.bounds.get(1413)).toEqual(f.geometry.bounds[1413]);
    expect(result.bounds.get(2521)?.instance).toBe(2991);
    expect(percentToWorld([result.bounds.get(99)], 25, 75)).toEqual({ ok: false, reason: "no-bounds" });
    expect(percentToWorld([result.bounds.get(1413)], 62.6, 36.2)).toMatchObject({
      ok: true,
      world: { instance: 1, x: expect.closeTo(-3720.55, 2), y: expect.closeTo(-833.26, 2) },
    });
    expect(canvasToWorld(result.terrain, { x: 560.9, y: 601.3 })).toEqual({
      instance: 1,
      x: expect.closeTo(-3680.1, 2),
      y: expect.closeTo(-951.35, 2),
    });
    expect(worldToCanvas(result.terrain, { instance: 1, x: -3680.1, y: -951.35 })).toEqual({
      x: expect.closeTo(560.9, 1),
      y: expect.closeTo(601.3, 1),
    });
    expect(locateCanvas(result.terrain, "zephras-isle", { x: 560.9, y: 601.3 })).toEqual({ ok: false, reason: "ambiguous" });
    expect(locateCanvas(result.terrain, "kalimdor", { x: 227, y: 601.3 })).toEqual({ ok: false, reason: "off-map" });
    expect(JSON.stringify(f.manifest)).toBe(before);
    expect([...f.files].map(([path, data]) => [path, sha256(data)])).toEqual(bytes);
  });

  it.each([false, true])("requires a routes icon only when its category has POI markers: %s", async (hasMarker) => {
    const f = fixture();
    const category = { key: "routes", group: "travel", name: "Routes", icon: "routes" };
    Object.assign(f.terrain, { categories: [...f.terrain.categories, category] });
    if (hasMarker) Object.assign(f.terrain.pois[0]!, { category: "routes" });
    f.replace("terrain.json", f.terrain);
    const before = new Uint8Array(f.files.get("terrain.json")!);
    if (hasMarker) {
      await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(/Invalid category icon routes/);
    } else {
      const result = await validateDataset(f.manifest, f.files);
      expect(result.terrain.categories).toContainEqual(category);
      expect(result.terrain.routes).toEqual([
        {
          id: "ship-bootybay-ratchet",
          path: 241,
          vessel: "ship",
          color: 0,
          points: [
            [716, 653.4],
            [1964.4, 594.6],
          ],
        },
      ]);
      expect(result.manifest.icons).not.toHaveProperty("routes");
      expect(f.files.get("terrain.json")).toEqual(before);
    }
  });

  it("retains faction facts, external game references, and paths of suppressed routes", async () => {
    const f = fixture();
    f.quests.sources = [{ source: "Independent/one", pins: { source: "snapshot identifier, not a label key" } }];
    const row = f.quests.quests[0]!;
    row.byFaction = {
      Alliance: { baseXp: 0, provenance: { baseXp: { source: "Independent/one" } } },
      Horde: { baseXp: 100, provenance: { baseXp: { source: "Independent/one" } } },
    };
    row.objectives = [{ type: "item", id: 99, ids: [99], name: "Unknown item" }];
    row.nextQuestInChain = 890;
    Object.assign(f.terrain.pois[0]!, { paths: [241, 99] });
    f.replace("quests.json", f.quests);
    f.replace("terrain.json", f.terrain);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.quests.quests[0]).toMatchObject({
      baseXp: null,
      byFaction: { Alliance: { baseXp: 0 }, Horde: { baseXp: 100 } },
      objectives: [{ id: 99, ids: [99] }],
      nextQuestInChain: 890,
    });
    expect(result.quests.quests[0]!.objectives[0]).not.toHaveProperty("index");
    expect(result.terrain.pois[0]!.paths).toEqual([241, 99]);
  });

  it("keeps a one-way route whose pin at its first point arrives at its last", async () => {
    const f = fixture();
    Object.assign(f.terrain.routes[0]!, { oneWay: true });
    f.replace("terrain.json", f.terrain);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.terrain.routes[0]).toMatchObject({ oneWay: true });
    expect(result.terrain.pois[0]!.links).toEqual([{ route: "ship-bootybay-ratchet", arrival: [1964.4, 594.6] }]);
  });

  it("preserves hit grids with unused alphabet entries but rejects used missing indices", async () => {
    const f = fixture();
    const grid = f.quests.continents[0]!.hitGrid;
    grid.alphabet = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+";
    f.replace("quests.json", f.quests);
    const before = JSON.stringify(grid);
    const result = await validateDataset(f.manifest, f.files);
    expect(JSON.stringify(result.quests.continents[0]!.hitGrid)).toBe(before);
    grid.rows = [" b"];
    f.replace("quests.json", f.quests);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(/continent/);
  });

  it.each(["quest", "NPC", "faction quest", "faction NPC"])("preserves unmapped positive %s zone facts", async (kind) => {
    const f = fixture();
    const turnIn = (sourceId: number, sourceName: string, x: number, y: number, world: WorldLocation): QuestPoint => ({
      zoneId: 17,
      uiMapId: 1413,
      x,
      y,
      world,
      kind: "turn-in",
      sourceType: "npc",
      sourceId,
      sourceName,
    });
    const quest = (fields: Partial<QuestRow>): QuestRow => ({ ...f.quests.quests[0]!, startPoints: [], ...fields });
    if (kind === "quest")
      f.quests.quests.push(
        quest({
          id: 1178,
          name: "Goblin Sponsorship",
          requiredLevel: 29,
          questLevel: 37,
          zoneIds: [400],
          preQuestSingle: [1176],
          nextQuestInChain: 1180,
          endPoints: [turnIn(3391, "Gazlowe", 62.6, 36.2, { instance: 1, x: -3720.55, y: -833.26 })],
        }),
      );
    if (kind === "NPC") f.quests.npcs = { 38: { zoneIds: [12] } };
    if (kind === "faction quest")
      f.quests.quests.push(
        quest({
          id: 1718,
          name: "The Islander",
          requiredLevel: 30,
          questLevel: 30,
          requiredClassMask: 1,
          zoneIds: [],
          nextQuestInChain: 1719,
          endPoints: [turnIn(6236, "Klannoc Macleod", 68.6, 49, { instance: 1, x: -4328.55, y: -1698.06 })],
          byFaction: { Alliance: { zoneIds: [17, 1497, 1519, 1537, 1637, 1638] }, Horde: { zoneIds: [17, 1497, 1537, 1637, 1638] } },
        }),
      );
    if (kind === "faction NPC") f.quests.npcs = { 12144: { zoneIds: { byFaction: { Alliance: [148], Horde: [17] } } } };
    f.replace("quests.json", f.quests);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.quests).toEqual(f.quests);
  });

  it("accepts flight nodes on each map instance of the geometry", async () => {
    const f = fixture();
    const flightNodes = {
      "32": { name: "Theramore, Dustwallow Marsh", faction: "Alliance", world: { instance: 1, x: -4516.58, y: -3825.37 } },
      "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: { instance: 0, x: 478.62, y: -8832.77 } },
    } satisfies GameDataFile["flightNodes"];
    f.quests.flightNodes = flightNodes;
    f.replace("quests.json", f.quests);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.quests.flightNodes).toStrictEqual(flightNodes);
  });

  it("reads the transports file at startup, with its nodes on map instances of the geometry", async () => {
    const f = transportsFixture();
    expect(startupAssets(f.manifest).map((a) => a.path)).toContain("transports.json");
    const result = await validateDataset(f.manifest, f.files);
    expect(result.transports).toStrictEqual(f.transports);
  });

  it("accepts any ride class and race when the quest bundle has no classes or races", async () => {
    const f = transportsFixture();
    delete f.quests.classes;
    delete f.quests.races;
    f.replace("quests.json", f.quests);
    f.transports.links[1]!.requires.class = "MAGE";
    f.transports.links[2]!.requires.race = "Human";
    f.replace("transports.json", f.transports);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.transports?.links.map((l) => l.requires)).toStrictEqual([
      { faction: "Horde" },
      { faction: "Horde", class: "MAGE" },
      { faction: "Alliance", race: "Human" },
      { faction: "Horde" },
    ]);
  });

  it.each([
    ["version 2", (t: TransportsFile) => Object.assign(t, { version: 2 }), "Invalid transports file version 2, expected version 1"],
    [
      "a node without a name",
      (t: TransportsFile) => {
        t.nodes[0]!.name = "";
      },
      "Invalid transport node DOCK_SKYWATCHER",
    ],
    [
      "two nodes with one id",
      (t: TransportsFile) => {
        t.nodes[1]!.id = "DOCK_SKYWATCHER";
      },
      "Invalid duplicate transport node DOCK_SKYWATCHER",
    ],
    [
      "a link estimate other than true or reference",
      (t: TransportsFile) => Object.assign(t.links[0]!, { estimate: "model" }),
      "Invalid transport link 0",
    ],
    [
      "a link average above its max",
      (t: TransportsFile) => {
        t.links[0]!.seconds.average = 500;
      },
      "Invalid transport link 0",
    ],
    [
      "a link to a missing node",
      (t: TransportsFile) => {
        t.links[2]!.to = "DOCK_MISSING";
      },
      "Invalid transport link 2 stop reference",
    ],
    [
      "a node on a map with no geometry",
      (t: TransportsFile) => {
        t.nodes[1]!.world.instance = 99;
      },
      "Invalid transport node DOCK_VALANAAR map reference",
    ],
    [
      "a ride class that the quest bundle does not have",
      (t: TransportsFile) => {
        t.links[1]!.requires.class = "MAGE";
      },
      "Invalid transport link 1 class reference",
    ],
    [
      "a ride race that the quest bundle does not have",
      (t: TransportsFile) => {
        t.links[2]!.requires.race = "Orc";
      },
      "Invalid transport link 2 race reference",
    ],
  ] as const)("rejects transports with %s", async (_, change, error) => {
    const f = transportsFixture();
    change(f.transports);
    f.replace("transports.json", f.transports);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it.each([
    [
      "WebP oversized chunk",
      "webp",
      (bytes: Uint8Array<ArrayBuffer>) => {
        new DataView(bytes.buffer).setUint32(16, 0xffffffff, true);
        return bytes;
      },
    ],
    [
      "WebP empty image chunk",
      "webp",
      (bytes: Uint8Array<ArrayBuffer>) => {
        const shell = bytes.slice(0, 20);
        const view = new DataView(shell.buffer);
        view.setUint32(4, 12, true);
        view.setUint32(16, 0, true);
        return shell;
      },
    ],
    [
      "WebP extended header without image",
      "webp",
      () => new Uint8Array([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ],
    ["JPEG empty shell", "jpeg", () => new Uint8Array([255, 216, 255, 217])],
    ["JPEG oversized segment", "jpeg", () => new Uint8Array([255, 216, 255, 224, 255, 255, 255, 217])],
    [
      "PNG empty shell",
      "png",
      () => {
        const b = new Uint8Array(33);
        b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
        return b;
      },
    ],
    [
      "PNG oversized chunk",
      "png",
      () => {
        const b = new Uint8Array(
          Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64"),
        );
        new DataView(b.buffer).setUint32(33, 0xffffffff);
        return b;
      },
    ],
  ] as const)("rejects rehashed %s with a valid outer signature", async (_, format, corrupt) => {
    const f = fixture();
    const bytes = corrupt(new Uint8Array(f.files.get("art/map.webp")!));
    f.files.set("art/map.webp", bytes);
    Object.assign(
      f.manifest.assets.find((a) => a.path === "art/map.webp")!,
      { format, bytes: bytes.length, sha256: sha256(bytes) },
    );
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(/image container/);
  });

  it("rejects ambiguous directory spelling and unreferenced assets", async () => {
    const f = fixture();
    const extra = { ...f.manifest.assets[4]!, path: "Art/extra.webp" };
    f.manifest.assets.push(extra);
    expect(() => validateDatasetManifest(f.manifest)).toThrow(/directory case alias/);
    extra.path = "art/extra.webp";
    f.files.set(extra.path, f.files.get("art/map.webp")!);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(/unreferenced declared asset/);
  });

  it.each([
    ["invalid JSON", new TextEncoder().encode("{broken"), "identity", SyntaxError],
    // Node gives a bad gzip stream an empty message, so its zlib code names the error.
    ["invalid gzip", new Uint8Array([31, 139, 0, 0]), "gzip", expect.objectContaining({ code: "Z_DATA_ERROR" })],
  ] as const)("rejects %s even when integrity checks pass", async (_, bytes, encoding, error) => {
    const f = fixture();
    f.files.set("quests.json", bytes);
    Object.assign(f.manifest.assets[0]!, { bytes: bytes.length, sha256: sha256(bytes), encoding });
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it("rejects invalid optional NPC facts and dangling entity details", async () => {
    const f = fixture();
    f.quests.npcs = { 3391: { levels: { min: 10, max: 1 } } };
    f.replace("quests.json", f.quests);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(/NPC records/);
    const g = fixture();
    g.entities.details = { npc: { 99: { changes: { status: "new", labels: [], lines: [] } } } };
    g.replace("entities.json.gz", g.entities);
    await expect(validateDataset(g.manifest, g.files)).rejects.toThrow(/Details for unknown npc 99/);
  });

  it.each([
    "../escape",
    "/absolute",
    "C:/drive",
    "a\\b",
    "a//b",
    "a/./b",
    "a/../b",
    "a%2fb",
    "a?b",
    "a#b",
    "a:b",
    "a\0b",
    "a/",
    "a.",
    "CON.txt",
    " a",
    "é/a",
  ])("rejects unsafe asset path %j structurally", (path) => {
    const { manifest } = fixture();
    manifest.assets[0]!.path = path;
    expect(() => validateDatasetManifest(manifest)).toThrow(/asset declaration/);
  });

  it.each([
    ["unsupported manifest", (m: DatasetManifest) => Object.assign(m, { version: 3 }), /manifest/],
    ["missing bundle", (m: DatasetManifest) => m.assets.shift(), /asset reference/],
    [
      "wrong format",
      (m: DatasetManifest) => {
        Object.assign(m.assets[0]!, { format: "geometry", version: 2 });
      },
      /asset reference/,
    ],
    [
      "quests of contract 0.5.0",
      (m: DatasetManifest) => {
        m.assets[0]!.version = 2;
      },
      "Invalid quests asset quests.json version 2, expected version 3",
    ],
    [
      "a point provenance file, a format the contract no longer has",
      (m: DatasetManifest) => {
        Object.assign(m, { pointProvenance: "points.json.gz" });
        m.assets.push({ ...m.assets[0]!, path: "points.json.gz" });
        Object.assign(m.assets.at(-1)!, { format: "point-provenance", version: 1 });
      },
      /asset declaration/,
    ],
    [
      "transports that names another format",
      (m: DatasetManifest) => {
        m.transports = "quests.json";
      },
      "Invalid transports asset reference quests.json",
    ],
    [
      "a transports asset the manifest does not name",
      (m: DatasetManifest) => {
        m.assets.push({ ...m.assets[0]!, path: "transports.json", format: "transports", version: 1 });
      },
      "Invalid unreferenced transports asset transports.json",
    ],
    [
      "guide icons that names another format",
      (m: DatasetManifest) => {
        m.guideIcons = "quests.json";
      },
      "Invalid guide-icons asset reference quests.json",
    ],
    [
      "a guide icons asset the manifest does not name",
      (m: DatasetManifest) => {
        m.assets.push({ ...m.assets[0]!, path: "guide-icons.json", format: "guide-icons", version: 1 });
      },
      "Invalid unreferenced guide-icons asset guide-icons.json",
    ],
    [
      "unsupported format version",
      (m: DatasetManifest) => {
        m.assets[0]!.version = 1;
      },
      "Invalid quests asset quests.json version 1, expected version 3",
    ],
    [
      "hash format",
      (m: DatasetManifest) => {
        m.assets[0]!.sha256 = "sha256:ABC";
      },
      /asset declaration/,
    ],
    [
      "fractional size",
      (m: DatasetManifest) => {
        m.assets[0]!.bytes = 1.5;
      },
      /asset declaration/,
    ],
    [
      "zero size",
      (m: DatasetManifest) => {
        m.assets[0]!.bytes = 0;
      },
      /asset declaration/,
    ],
    ["duplicate path", (m: DatasetManifest) => m.assets.push({ ...m.assets[0]! }), /duplicate asset/],
    ["case alias", (m: DatasetManifest) => m.assets.push({ ...m.assets[0]!, path: "QUESTS.json" }), /duplicate asset/],
    ["file directory collision", (m: DatasetManifest) => m.assets.push({ ...m.assets[0]!, path: "art" }), /collision/],
    ["missing icon", (m: DatasetManifest) => Reflect.deleteProperty(m.icons, "quest-turn-in"), /icon coverage/],
  ] as const)("rejects %s before reading bytes", (_, change, error) => {
    const { manifest } = fixture();
    change(manifest);
    expect(() => validateDatasetManifest(manifest)).toThrow(error);
  });

  it("checks exact stored bytes against an independent SHA-256 vector", async () => {
    const asset: DatasetAsset = {
      path: "vector.json",
      bytes: 3,
      sha256: "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      format: "geometry",
      version: 2,
      encoding: "identity",
    };
    await expect(validateDatasetAsset(asset, new TextEncoder().encode("abc"))).resolves.toBeUndefined();
    await expect(validateDatasetAsset(asset, new TextEncoder().encode("abd"))).rejects.toThrow(/checksum/);
    await expect(validateDatasetAsset(asset, new TextEncoder().encode("ab"))).rejects.toThrow(/size/);
  });

  it.each([
    ["missing bytes", (f: ReturnType<typeof fixture>) => f.files.delete("art/map.webp"), /coverage/],
    ["extra bytes", (f: ReturnType<typeof fixture>) => f.files.set("extra", new Uint8Array([1])), /coverage/],
    [
      "wrong size",
      (f: ReturnType<typeof fixture>) => {
        f.manifest.assets[0]!.bytes++;
      },
      /size/,
    ],
    [
      "wrong checksum",
      (f: ReturnType<typeof fixture>) => {
        f.files.get("quests.json")![0] = 0;
      },
      /checksum/,
    ],
    [
      "wrong encoding",
      (f: ReturnType<typeof fixture>) => {
        f.manifest.assets[1]!.encoding = "identity";
      },
      /encoding/,
    ],
    ["malformed image", (f: ReturnType<typeof fixture>) => f.replace("art/map.webp", {}), /image container/],
  ] as const)("rejects %s", async (_, change, error) => {
    const f = fixture();
    change(f);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it.each([
    [
      "empty quests",
      "quests",
      (v: GameDataFile) => {
        v.quests = [];
      },
      /coverage/,
    ],
    ["missing required quest field", "quests", (v: GameDataFile) => Reflect.deleteProperty(v.quests[0]!, "baseXp"), /quest 887 fields/],
    ["bad point", "quests", (v: GameDataFile) => Object.assign(v.quests[0]!.startPoints[0]!, { x: "25" }), /quest 887 fields/],
    [
      "half-normalized point",
      "quests",
      (v: GameDataFile) => Reflect.deleteProperty(v.quests[0]!.startPoints[0]!, "world"),
      /quest 887 fields/,
    ],
    [
      "dangling point map",
      "quests",
      (v: GameDataFile) => Object.assign(v.quests[0]!.startPoints[0]!, { uiMapId: 99 }),
      /point map reference/,
    ],
    [
      "dangling placed point zone",
      "quests",
      (v: GameDataFile) => Object.assign(v.quests[0]!.startPoints[0]!, { zoneId: 99 }),
      /point zone reference/,
    ],
    [
      "flight node on a map with no geometry",
      "quests",
      (v: GameDataFile) => {
        v.flightNodes = { "32": { name: "Theramore, Dustwallow Marsh", world: { instance: 99, x: 0, y: 0 } } };
      },
      /flight node 32 map reference/,
    ],
    [
      "invalid zone fact",
      "quests",
      (v: GameDataFile) => {
        v.quests[0]!.zoneIds = [0];
      },
      /quest 887 fields/,
    ],
    [
      "bad grid",
      "quests",
      (v: GameDataFile) => {
        v.continents[0]!.hitGrid.rows = [" z"];
      },
      /continent/,
    ],
    [
      "unknown provenance",
      "quests",
      (v: GameDataFile) => {
        v.quests[0]!.provenance = { fields: { name: { source: "missing" } } };
      },
      /not among/,
    ],
  ] as const)("rejects %s in checked quest bytes", async (_, _kind, change, error) => {
    const f = fixture();
    change(f.quests);
    f.replace("quests.json", f.quests);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it.each([
    [
      "missing bounds",
      (g: DatasetGeometry) => {
        g.bounds = {};
      },
      /bounds table/,
    ],
    [
      "inverted bounds",
      (g: DatasetGeometry) => {
        g.bounds = { ...g.bounds, 1413: { instance: 1, minX: 1, maxX: 0, minY: 0, maxY: 1 } };
      },
      /map bounds 1413/,
    ],
    [
      "alias map ID",
      (g: DatasetGeometry) => {
        g.bounds = { ...Object.fromEntries([["01413", g.bounds[1413]!]]), 1414: g.bounds[1414]!, 2521: g.bounds[2521]! };
      },
      /map bounds 01413/,
    ],
    [
      "missing table source",
      (g: DatasetGeometry) => {
        g.source = "missing";
      },
      /not among/,
    ],
  ] as const)("rejects geometry %s", async (_, change, error) => {
    const f = fixture();
    change(f.geometry);
    f.replace("geometry.json", f.geometry);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it.each([
    ["missing area", (m: WorldMapData) => Object.assign(m, { areas: m.areas.slice(1) }), /area coverage/],
    ["zero scale", (m: WorldMapData) => Object.assign(m, { yardsPerChunk: 0 }), /schema/],
    ["missing zoom", (m: WorldMapData) => Object.assign(m.areas[0]!, { tiles: {} }), /zoom coverage/],
    [
      "overlapping tiles",
      (m: WorldMapData) =>
        Object.assign(m.areas[0]!, {
          tiles: {
            2: [
              [1, 1, 2],
              [1, 2, 3],
            ],
          },
        }),
      /tile range/,
    ],
    ["out of range tile", (m: WorldMapData) => Object.assign(m.areas[0]!, { tiles: { 2: [[1, 1, 4]] } }), /tile range/],
    ["missing tile asset", (m: WorldMapData) => Object.assign(m.areas[0]!, { tiles: { 2: [[1, 1, 2]] } }), /image asset reference/],
    ["unknown group", (m: WorldMapData) => Object.assign(m.categories[0]!, { group: "missing" }), /category/],
    ["unknown icon", (m: WorldMapData) => Object.assign(m.categories[0]!, { icon: "missing" }), /category icon/],
    ["unknown route", (m: WorldMapData) => Object.assign(m.pois[0]!, { links: [{ route: "missing" }] }), /route reference/],
    [
      "invalid arrival",
      (m: WorldMapData) => Object.assign(m.pois[0]!, { links: [{ route: "ship-bootybay-ratchet", arrival: [0, 0] }] }),
      /route arrival/,
    ],
    ["one-way value other than true", (m: WorldMapData) => Object.assign(m.routes[0]!, { oneWay: false }), /world map route/],
    [
      "one-way arrival at the first point",
      (m: WorldMapData) => {
        Object.assign(m.routes[0]!, { oneWay: true });
        Object.assign(m.pois[0]!, { links: [{ route: "ship-bootybay-ratchet", arrival: [716, 653.4] }] });
      },
      /route arrival/,
    ],
    [
      "one-way arrival for a pin off the first point",
      (m: WorldMapData) => {
        Object.assign(m.routes[0]!, { oneWay: true });
        Object.assign(m.pois[0]!, { x: 850, y: 780 });
      },
      /route arrival/,
    ],
  ] as const)("rejects terrain %s", async (_, change, error) => {
    const f = fixture();
    change(f.terrain);
    f.replace("terrain.json", f.terrain);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it("rejects empty entity categories and missing source labels", async () => {
    const f = fixture();
    f.entities.entities.spell = [];
    f.replace("entities.json.gz", f.entities);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(/Missing spell data/);
    const g = fixture();
    g.manifest.sources = { elsewhere: { name: "Other source" } };
    await expect(validateDataset(g.manifest, g.files)).rejects.toThrow(/source display Independent\/one/);
  });
});

describe("deferred terrain tiles", () => {
  const path = "world/tiles/kalimdor/2/1/1.webp";

  it("leaves the tiles out of the startup assets", () => {
    expect(startupAssets(fixture().manifest).map((a) => a.path)).toEqual([
      "quests.json",
      "entities.json.gz",
      "geometry.json",
      "terrain.json",
      "art/map.webp",
    ]);
  });

  it("validates core bytes without tiles and accepts a checked tile later", async () => {
    const f = fixture();
    const startup = new Map(startupAssets(f.manifest).map((asset) => [asset.path, f.files.get(asset.path)!]));
    const data = await validateDataset(f.manifest, startup);
    expect(data.terrain.areas.map((area) => area.key)).toEqual(["kalimdor", "eastern-kingdoms", "zephras-isle"]);
    await expect(acceptMapTile(data, path, f.files.get(path)!)).resolves.toBeUndefined();
    expect([...startup.keys()]).toEqual(["quests.json", "entities.json.gz", "geometry.json", "terrain.json", "art/map.webp"]);
  });

  it.each(["size", "checksum", "image container"])("rejects tile %s both on demand and in a complete artifact", async (failure) => {
    const f = fixture();
    const startup = new Map(startupAssets(f.manifest).map((asset) => [asset.path, f.files.get(asset.path)!]));
    const data = await validateDataset(f.manifest, startup);
    let bytes = f.files.get(path)!.slice();
    if (failure === "size") bytes = bytes.slice(1);
    else if (failure === "checksum") bytes[0] = 0;
    else {
      new DataView(bytes.buffer).setUint32(16, 0xffffffff, true);
      data.manifest.assets.find((asset) => asset.path === path)!.sha256 = sha256(bytes);
      f.manifest.assets.find((asset) => asset.path === path)!.sha256 = sha256(bytes);
    }
    f.files.set(path, bytes);
    await expect(acceptMapTile(data, path, bytes)).rejects.toThrow(new RegExp(failure));
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(new RegExp(failure));
  });

  it("requires exact terrain membership and a declared WebP asset", async () => {
    const f = fixture();
    const data = await validateDataset(f.manifest, f.files);
    const bytes = f.files.get(path)!;
    const asset = data.manifest.assets.find((a) => a.path === path)!;
    for (const extra of ["world/tiles/kalimdor/2/1/2.webp", "world/tiles/kalimdor/2/1/../1.webp", "art/extra.webp"]) {
      data.manifest.assets.push({ ...asset, path: extra });
      await expect(acceptMapTile(data, extra, bytes)).rejects.toThrow(`Invalid map tile reference ${extra}`);
    }
    await expect(acceptMapTile(data, "world/undeclared.webp", bytes)).rejects.toThrow(/map tile reference/);
    asset.format = "png";
    await expect(acceptMapTile(data, path, bytes)).rejects.toThrow(/map tile reference/);
  });
});

describe("guide icons", () => {
  const sheet = "guide-icons/icons.png";
  const atStartup = (f: ReturnType<typeof guideIconsFixture>) =>
    validateDataset(f.manifest, new Map(startupAssets(f.manifest).map((a) => [a.path, f.files.get(a.path)!])));

  it.each([
    ["Interface/Icons/Ability_Druid_DemoralizingRoar", "interface/icons/ability_druid_demoralizingroar"],
    ["interface/icons/ability_warrior_revenge.blp", "interface/icons/ability_warrior_revenge"],
    ["Interface/Icons/Ability_Warrior_WarCry.BLP", "interface/icons/ability_warrior_warcry"],
    ["interface/worldmap/chatbubble_64grey.blp", "interface/worldmap/chatbubble_64grey"],
    ["Interface/cursor/crosshair/interact.blp", "interface/cursor/crosshair/interact"],
    ["Interface/Icons/inv_knife_1h_skybornec60_b_01", "interface/icons/inv_knife_1h_skybornec60_b_01"],
    ["Interface\\Icons\\INV_Misc_Rune_01.blp", "interface/icons/inv_misc_rune_01"],
    ["interface/icons/inv.blp.blp", "interface/icons/inv.blp"],
    ["07792229", "7792229"],
    ["134414", "134414"],
  ])("gives the texture key of %s", (raw, key) => {
    expect(textureKey(raw)).toBe(key);
  });

  it.each([
    ["the FileDataID 0", "0"],
    ["an empty key", ""],
    ["a FileDataID above the safe integers", "9007199254740992"],
    ["a lone slash", "/"],
    ["an absolute path", "/interface/icons/inv"],
    ["an empty segment", "a//b"],
    ["a parent segment", "../x"],
    ["a dot segment", "interface/./inv"],
    ["a name with no folder", "inv_misc_rune_01"],
    ["a bare extension", "interface/icons/.blp"],
    ["a control character", "interface/icons/inv\u0001"],
    ["a space", "interface/icons/a b"],
    ["a texture delimiter", "interface/icons/inv:0"],
  ])("gives no texture key for %s", (_, raw) => {
    expect(textureKey(raw)).toBeUndefined();
  });

  const poi = (left: number, right: number): TextureCrop => ({ width: 128, height: 128, left, right, top: 0, bottom: 4 });

  it("writes a crop key in the order of a texture escape and reads it back", () => {
    expect(cropKey(136441, poi(63, 72))).toBe("136441:128:128:63:72:0:4");
    expect(parseCropKey("136441:128:128:63:72:0:4")).toStrictEqual({ fileDataId: 136441, crop: poi(63, 72) });
    expect(cropKey(136441, { width: 256, height: 512, left: 0, right: 256, top: 0, bottom: 512 })).toBe("136441:256:512:0:256:0:512");
  });

  it.each([
    ["an empty box", poi(72, 72)],
    ["a reversed box", poi(72, 63)],
    ["a box past the right edge", poi(63, 129)],
    ["a box past the bottom", { ...poi(63, 72), bottom: 129 }],
    ["a negative edge", poi(-1, 72)],
    ["a fractional edge", poi(63.5, 72)],
    ["a zero width", { ...poi(0, 0), width: 0 }],
  ])("gives no crop key for %s", (_, crop) => {
    expect(cropKey(136441, crop)).toBeUndefined();
  });

  it.each([
    ["a texture key", "136441"],
    ["a missing edge", "136441:128:128:63:72:0"],
    ["a leading zero", "136441:128:128:063:72:0:4"],
    ["a path for the file", "interface/minimap/poiicons:128:128:63:72:0:4"],
    ["the FileDataID 0", "0:128:128:63:72:0:4"],
    ["an empty box", "136441:128:128:72:72:0:4"],
    ["an exponent", "136441:128:128:63:72:0:4e0"],
  ])("reads no crop key from %s", (_, raw) => {
    expect(parseCropKey(raw)).toBeUndefined();
  });

  it("accepts parts of one file after the whole file, in crop order", async () => {
    const f = guideIconsFixture();
    const path = "interface/worldmap/chatbubble_64grey";
    f.guideIcons.icons.splice(2, 1, { fileDataId: 308474, path, crop: poi(45, 54) }, { fileDataId: 308474, path, crop: poi(63, 72) });
    f.replace("guide-icons/icons.json.gz", f.guideIcons);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.guideIcons?.icons.map(({ fileDataId, crop }) => (crop ? cropKey(fileDataId, crop) : fileDataId))).toStrictEqual([
      132121,
      308474,
      "308474:128:128:45:54:0:4",
      "308474:128:128:63:72:0:4",
    ]);
  });

  it("places each 64 px cell inside a 68 px slot", () => {
    expect(guideIconCell(0, 21)).toStrictEqual({ x: 2, y: 2, width: 64, height: 64 });
    expect(guideIconCell(22, 21)).toStrictEqual({ x: 70, y: 70, width: 64, height: 64 });
    expect(guideIconCell(439, 21)).toStrictEqual({ x: 1294, y: 1362, width: 64, height: 64 });
    expect(guideIconSheetSize(440, 21)).toStrictEqual({ width: 1428, height: 1428 });
    expect(guideIconSheetSize(3, 2)).toStrictEqual({ width: 136, height: 136 });
  });

  it("reads the table at startup and the sheet on demand", async () => {
    const f = guideIconsFixture();
    expect(startupAssets(f.manifest).map((a) => a.path)).toStrictEqual([
      "quests.json",
      "entities.json.gz",
      "geometry.json",
      "terrain.json",
      "art/map.webp",
      "guide-icons/icons.json.gz",
    ]);
    const full = await validateDataset(f.manifest, f.files);
    expect(full.guideIcons).toStrictEqual(f.guideIcons);
    const startup = await atStartup(f);
    expect(startup.guideIcons?.icons.map((icon) => icon.fileDataId)).toStrictEqual([132121, 308474, 7792229]);
    await expect(acceptGuideIconImage(startup, sheet, f.files.get(sheet)!)).resolves.toBeUndefined();
  });

  it.each([
    [839910, "interface/icons/inv_heart_of_the_thunder king_icon"],
    [1387609, "interface/icons/inv_first_aid_70_ jar"],
  ])("accepts a listfile path with a space for %s", async (fileDataId, path) => {
    const f = guideIconsFixture();
    Object.assign(f.guideIcons.icons[1]!, { fileDataId, path });
    f.replace("guide-icons/icons.json.gz", f.guideIcons);
    const result = await validateDataset(f.manifest, f.files);
    expect(result.guideIcons?.icons[1]).toStrictEqual({ fileDataId, path });
  });

  it("validates a release with no guide icons", async () => {
    const f = fixture();
    const result = await validateDataset(f.manifest, f.files);
    expect(Object.hasOwn(result, "guideIcons")).toBe(false);
    await expect(acceptGuideIconImage(result, sheet, transparentPng(136, 136))).rejects.toThrow(
      `Invalid guide icons image reference ${sheet}`,
    );
  });

  it("rejects a sheet that a map icon also uses", async () => {
    const f = guideIconsFixture();
    f.manifest.icons["quest-giver"]!.file = sheet;
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(`Invalid guide icons image reference ${sheet}`);
  });

  it("rejects a sheet that is not a declared PNG", async () => {
    const f = guideIconsFixture();
    f.guideIcons.image = "art/map.webp";
    f.replace("guide-icons/icons.json.gz", f.guideIcons);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow("Invalid guide icons image reference art/map.webp");
  });

  const row = (fileDataId: number, path: string) => ({ fileDataId, path });
  const part = (fileDataId: number, crop: TextureCrop) => ({ fileDataId, path: "interface/worldmap/chatbubble_64grey", crop });
  it.each([
    ["version 2", (t: GuideIconsFile) => Object.assign(t, { version: 2 }), "Invalid guide icons file version 2, expected version 1"],
    ["no rows", (t: GuideIconsFile) => Object.assign(t, { icons: [], columns: 1 }), "Invalid guide icons file"],
    ["zero columns", (t: GuideIconsFile) => Object.assign(t, { columns: 0 }), "Invalid guide icons columns 0"],
    ["fractional columns", (t: GuideIconsFile) => Object.assign(t, { columns: 1.5 }), "Invalid guide icons columns 1.5"],
    ["more columns than rows", (t: GuideIconsFile) => Object.assign(t, { columns: 4 }), "Invalid guide icons columns 4"],
    [
      "two rows with one FileDataID",
      (t: GuideIconsFile) => t.icons.splice(1, 1, row(132121, "interface/icons/other")),
      "Invalid duplicate guide icon 132121",
    ],
    [
      "two rows with one path",
      (t: GuideIconsFile) => t.icons.splice(1, 1, row(308474, "interface/icons/ability_druid_demoralizingroar")),
      "Invalid duplicate guide icon path interface/icons/ability_druid_demoralizingroar",
    ],
    ["unsorted rows", (t: GuideIconsFile) => t.icons.reverse(), "Invalid guide icon 308474 order"],
    [
      "a path with capitals",
      (t: GuideIconsFile) => t.icons.splice(1, 1, row(308474, "Interface/WorldMap/ChatBubble_64Grey")),
      "Invalid guide icon 308474 path",
    ],
    [
      "a path with its extension",
      (t: GuideIconsFile) => t.icons.splice(1, 1, row(308474, "interface/worldmap/chatbubble_64grey.blp")),
      "Invalid guide icon 308474 path",
    ],
    ...[
      ["backslashes", "interface\\icons\\inv"],
      ["a control character", "interface/icons/inv\u0001"],
      ["a final newline", "interface/icons/inv\n"],
      ["a delete character", "interface/icons/inv\u007f"],
      ["non-ASCII text", "interface/icons/é"],
      ["one segment", "inv_misc_rune_01"],
      ["an empty segment", "interface//inv"],
      ["a dot segment", "interface/./inv"],
      ["a parent segment", "interface/../inv"],
    ].map(
      ([name, path]) =>
        [`a path with ${name}`, (t: GuideIconsFile) => t.icons.splice(1, 1, row(308474, path!)), "Invalid guide icon 308474 path"] as const,
    ),
    ["a FileDataID for a path", (t: GuideIconsFile) => t.icons.splice(1, 1, row(308474, "308474")), "Invalid guide icon 308474 path"],
    [
      "two rows with one crop",
      (t: GuideIconsFile) => t.icons.splice(2, 0, part(308474, poi(63, 72)), part(308474, poi(63, 72))),
      "Invalid duplicate guide icon 308474:128:128:63:72:0:4",
    ],
    [
      "crops out of order",
      (t: GuideIconsFile) => t.icons.splice(2, 0, part(308474, poi(63, 72)), part(308474, poi(45, 54))),
      "Invalid guide icon 308474:128:128:45:54:0:4 order",
    ],
    [
      "a crop before its whole file",
      (t: GuideIconsFile) => t.icons.splice(1, 0, part(308474, poi(63, 72))),
      "Invalid guide icon 308474 order",
    ],
    ["an empty crop", (t: GuideIconsFile) => t.icons.splice(2, 0, part(308474, poi(72, 72))), "Invalid guide icon 308474 crop"],
    ["a crop past the edge", (t: GuideIconsFile) => t.icons.splice(2, 0, part(308474, poi(63, 129))), "Invalid guide icon 308474 crop"],
    [
      "a crop with a missing edge",
      (t: GuideIconsFile) => t.icons.splice(2, 0, { ...part(308474, poi(63, 72)), crop: { width: 128, height: 128 } as TextureCrop }),
      "Invalid guide icon 308474 crop",
    ],
    [
      "a crop of another file's path",
      (t: GuideIconsFile) => t.icons.splice(2, 0, part(7792228, poi(63, 72))),
      "Invalid duplicate guide icon path interface/worldmap/chatbubble_64grey",
    ],

    ["a FileDataID of 0", (t: GuideIconsFile) => t.icons.splice(0, 1, row(0, "interface/icons/zero")), "Invalid guide icon 0"],
  ] as const)("rejects a guide icons file with %s", async (_, change, error) => {
    const f = guideIconsFixture();
    change(f.guideIcons);
    f.replace("guide-icons/icons.json.gz", f.guideIcons);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it.each([
    ["size", (bytes: Uint8Array<ArrayBuffer>) => bytes.slice(1), false, "Invalid asset size guide-icons/icons.png"],
    [
      "checksum",
      (bytes: Uint8Array<ArrayBuffer>) => {
        const changed = bytes.slice();
        changed[40]! ^= 1;
        return changed;
      },
      false,
      "Invalid asset checksum guide-icons/icons.png",
    ],
    ["container", () => image("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), true, "Invalid image container guide-icons/icons.png"],
    ["sheet size", () => transparentPng(136, 68), true, "Invalid guide icons image size guide-icons/icons.png"],
  ] as const)("rejects a sheet with the wrong %s on demand and in a full release", async (_, change, declare, error) => {
    const f = guideIconsFixture();
    const startup = await atStartup(f);
    const bytes = change(f.files.get(sheet)!);
    if (declare)
      for (const m of [f.manifest, startup.manifest])
        Object.assign(
          m.assets.find((a) => a.path === sheet)!,
          { bytes: bytes.length, sha256: sha256(bytes) },
        );
    await expect(acceptGuideIconImage(startup, sheet, bytes)).rejects.toThrow(error);
    f.files.set(sheet, bytes);
    await expect(validateDataset(f.manifest, f.files)).rejects.toThrow(error);
  });

  it("accepts only the sheet that the table names", async () => {
    const f = guideIconsFixture();
    const startup = await atStartup(f);
    const bytes = f.files.get(sheet)!;
    const asset = startup.manifest.assets.find((a) => a.path === sheet)!;
    startup.manifest.assets.push({ ...asset, path: "guide-icons/other.png" });
    await expect(acceptGuideIconImage(startup, "guide-icons/other.png", bytes)).rejects.toThrow(
      "Invalid guide icons image reference guide-icons/other.png",
    );
    asset.format = "webp";
    await expect(acceptGuideIconImage(startup, sheet, bytes)).rejects.toThrow(`Invalid guide icons image reference ${sheet}`);
  });
});
