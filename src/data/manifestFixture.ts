import { createHash } from "node:crypto";
import { crc32, deflateSync, gzipSync } from "node:zlib";
import type { DatasetManifest, DatasetGeometry, DatasetAsset } from "../../packages/data-contract/manifest.ts";
import type { GameDataFile } from "../../packages/data-contract/model.ts";
import type { EntityDataFile } from "../../packages/data-contract/entities.ts";
import type { WorldMapData } from "../../packages/data-contract/worldMap.ts";
import type { InteriorsFile } from "../../packages/data-contract/interiors.ts";
import type { TransportsFile } from "../../packages/data-contract/transports.ts";
import type { GuideIconsFile, TextureKey } from "../../packages/data-contract/guideIcons.ts";
import { encodeInteriorSurfaces, type InteriorSurfaces } from "../../packages/data-contract/interiorSurfaces.ts";

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export function fixture() {
  const geometry: DatasetGeometry = {
    version: 2,
    sources: [{ source: "Independent/one", pins: { build: "one" } }],
    source: "Independent/one",
    bounds: {
      1413: { instance: 1, minX: -5143.75, minY: -7510.4165, maxX: 1612.4999, maxY: 2622.9165 },
      1414: { instance: 1, minX: -11733.2998, minY: -19733.2109, maxX: 12799.9004, maxY: 17066.5996 },
      1415: { instance: 0, minX: -16000, minY: -19199.9004, maxX: 7466.6001, maxY: 16000 },
      2521: { instance: 2991, minX: 1247.917, minY: -1331.25, maxX: 4956.25, maxY: 4231.25 },
    },
  };
  const quests: GameDataFile = {
    source: { name: "Independent", version: "one", pack: "complete" },
    maxLevel: 60,
    sources: [{ source: "Independent/one", pins: { survey: "one" } }],
    quests: [
      {
        id: 887,
        name: "Southsea Freebooters",
        requiredLevel: 9,
        questLevel: 14,
        requiredRaceMask: null,
        requiredClassMask: null,
        requiredFaction: null,
        raceRequirement: "Unknown",
        classRequirement: "Unknown",
        zoneIds: [17],
        types: [],
        preQuestGroup: null,
        preQuestSingle: [],
        nextQuestInChain: null,
        baseXp: null,
        startPoints: [
          {
            zoneId: 17,
            x: 62.6,
            y: 36.2,
            kind: "start",
            sourceType: "npc",
            sourceId: 3391,
            sourceName: "Gazlowe",
            uiMapId: 1413,
            world: { instance: 1, x: -3720.55, y: -833.26 },
          },
        ],
        endPoints: [],
        objectivePoints: [],
        objectives: [],
        objectiveText: [],
        rewardItems: [],
        rewardMoney: 500,
        provenance: { fields: { name: { source: "Independent/one" }, startPoints: { source: "Independent/one" } } },
      },
    ],
    zones: [{ id: 17, uiMapId: 1413, name: "The Barrens", category: "zone", instance: 1 }],
    continents: [
      {
        instance: 1,
        uiMapId: 1414,
        name: "Kalimdor",
        crop: { left: 0, top: 0, width: 100, height: 100 },
        hitGrid: { width: 2, height: 1, alphabet: " a", zoneIds: [0, 17], rows: [" a"] },
      },
    ],
    npcNames: { 3391: "Gazlowe" },
    flightNodes: {},
    factionNames: {},
  };
  const { rewardMoney: _, ...ratchet } = structuredClone(quests.quests[0]!);
  quests.quests.push({
    ...ratchet,
    id: 95819,
    name: "Sign Me Up!",
    requiredLevel: 1,
    questLevel: 60,
    startPoints: [],
    provenance: { fields: { name: { source: "Independent/one" } } },
  });
  const entities: EntityDataFile = {
    version: 2,
    entities: {
      quest: [
        [887, "Southsea Freebooters"],
        [95819, "Sign Me Up!"],
      ],
      npc: [[3391, "Gazlowe"]],
      item: [[159, "Refreshing Spring Water"]],
      object: [[142075, "Mailbox"]],
      spell: [[585, "Smite", "Rank 1"]],
    },
  };
  const area = { width: 1024, height: 1024, canvasX: 100, canvasY: 200, cropLeft: 128 };
  const terrain: WorldMapData = {
    version: 1,
    tileSize: 256,
    minZoom: 2,
    nativeZoom: 2,
    pxPerChunk: 512,
    yardsPerChunk: 533.33333,
    canvas: { left: 228, width: 3000, height: 1224 },
    areas: [
      { ...area, key: "kalimdor", map: 1, originCol: 38, originRow: 33, tiles: { 2: [[1, 1, 1]] } },
      { ...area, key: "eastern-kingdoms", map: 0, canvasX: 1500, originCol: 31, originRow: 30, tiles: { 2: [[0, 1, 1]] } },
      { ...area, key: "zephras-isle", map: 2991, originCol: 29, originRow: 28, tiles: { 2: [[0, 1, 1]] } },
    ],
    groups: [{ key: "travel", name: "Travel" }],
    categories: [{ key: "ship", group: "travel", name: "Ship", icon: "quest-giver" }],
    places: [{ name: "Ratchet", kind: "landmark", area: "kalimdor", x: 560.9, y: 601.3, minZoom: 1 }],
    routes: [
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
    ],
    pois: [
      {
        name: "To Booty Bay",
        category: "ship",
        area: "kalimdor",
        x: 716,
        y: 653.4,
        side: 0,
        level: 0,
        paths: [241],
        links: [{ route: "ship-bootybay-ratchet", arrival: [1964.4, 594.6] }],
      },
    ],
  };
  const manifest: DatasetManifest = {
    version: 2,
    id: "independent",
    release: "one",
    locale: "enUS",
    producer: { name: "Independent", version: "one" },
    sources: { "Independent/one": { name: "Independent survey" } },
    quests: "quests.json",
    entities: "entities.json.gz",
    geometry: "geometry.json",
    terrain: "terrain.json",
    tileBase: "world",
    icons: {
      "quest-giver": { file: "art/map.webp", x: -24, y: -48, width: 192 },
      "quest-turn-in": { file: "art/map.webp", x: -48, y: -48, width: 192 },
    },
    assets: [],
  };
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const add = (
    path: string,
    format: DatasetAsset["format"],
    bytes: Uint8Array<ArrayBuffer>,
    encoding: DatasetAsset["encoding"] = "identity",
  ) => {
    files.set(path, bytes);
    manifest.assets.push({
      path,
      format,
      bytes: bytes.length,
      sha256: sha256(bytes),
      encoding,
      version: format === "quests" ? 3 : ["entities", "geometry", "interiors"].includes(format) ? 2 : 1,
    });
  };
  add("quests.json", "quests", bytesOf(quests));
  add("entities.json.gz", "entities", new Uint8Array(gzipSync(bytesOf(entities))), "gzip");
  add("geometry.json", "geometry", bytesOf(geometry));
  add("terrain.json", "terrain", bytesOf(terrain));
  const pixel = new Uint8Array(Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"));
  add("art/map.webp", "webp", pixel);
  add("world/tiles/kalimdor/2/1/1.webp", "webp", pixel);
  add("world/tiles/eastern-kingdoms/2/0/1.webp", "webp", pixel);
  add("world/tiles/zephras-isle/2/0/1.webp", "webp", pixel);
  const replace = (path: string, value: unknown) => {
    const asset = manifest.assets.find((a) => a.path === path)!;
    const bytes = asset.encoding === "gzip" ? new Uint8Array(gzipSync(bytesOf(value))) : bytesOf(value);
    files.set(path, bytes);
    Object.assign(asset, { bytes: bytes.length, sha256: sha256(bytes) });
  };
  return { manifest, files, geometry, quests, entities, terrain, add, replace };
}

export const image = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const lossyAlpha4x2 =
  "UklGRlYAAABXRUJQVlA4WAoAAAAQAAAAAwAAAQAAQUxQSAkAAAAAf39/f39/f38AVlA4ICYAAACQAQCdASoEAAIAAsBMJaACdLoAA5gA/upl/1ERBSWpfELvZAYAAA==";
const lossless4x2 = "UklGRh4AAABXRUJQVlA4TBEAAAAvA0AAAAdQs2Z2pv+BiOh/AAA=";
const caveAt = (name: string) => `interiors/the-deadmines-35530/${name}`;
const deadmines = {
  id: "the-deadmines-35530",
  label: "The Deadmines",
  kind: "cave",
  map: 0,
  placement: { model: 108444, id: 35530 },
  bounds: { north: -11093, south: -11094, west: 1516.5, east: 1514.5 },
  size: [4, 2],
  heightBase: 12,
} as const;

export function interiorsFixture(f = fixture()) {
  const surfaces: InteriorSurfaces = {
    width: 4,
    height: 2,
    groundHeight: Uint16Array.of(0, 65, 200, 313, 65, 120, 250, 313),
    groundPlace: Uint8Array.of(0, 1, 1, 1, 1, 1, 2, 2),
    stacked: Uint32Array.of(1, 2, 4, 5, 6),
    upperStart: Uint32Array.of(0, 1, 2, 3, 4, 5),
    upperHeight: Uint16Array.of(201, 250, 201, 220, 300),
    upperPlace: Uint8Array.of(2, 2, 0, 2, 2),
  };
  const interiors: InteriorsFile = {
    version: 2,
    interiors: [
      {
        ...deadmines,
        bounds: { ...deadmines.bounds },
        size: [...deadmines.size],
        ground: { minimap: caveAt("ground-minimap.webp"), plan: caveAt("ground-plan.webp") },
        surfaces: caveAt("surfaces.bin.gz"),
        places: ["Defias Hideout", "The Deadmines"],
      },
    ],
  };
  f.add("interiors.json.gz", "interiors", new Uint8Array(gzipSync(bytesOf(interiors))), "gzip");
  f.manifest.interiors = "interiors.json.gz";
  const cave = interiors.interiors[0]!;
  f.add(cave.ground.minimap, "webp", image(lossyAlpha4x2));
  f.add(cave.ground.plan, "webp", image(lossless4x2));
  f.add(cave.surfaces, "interior-surfaces", new Uint8Array(gzipSync(encodeInteriorSurfaces(surfaces))), "gzip");
  return { ...f, interiors, surfaces };
}

export function plannerRelease(f = fixture()) {
  Object.assign(f.quests, {
    races: {
      "1": { fileName: "Human", faction: "Alliance", maskBit: 0, startingFlightNodes: [] },
      "2": { fileName: "Orc", faction: "Horde", maskBit: 1, startingFlightNodes: [] },
      "3": { fileName: "Dwarf", faction: "Alliance", maskBit: 2, startingFlightNodes: [] },
      "4": { fileName: "NightElf", faction: "Alliance", maskBit: 3, startingFlightNodes: [] },
      "5": { fileName: "Scourge", faction: "Horde", maskBit: 4, startingFlightNodes: [] },
      "6": { fileName: "Tauren", faction: "Horde", maskBit: 5, startingFlightNodes: [] },
      "7": { fileName: "Gnome", faction: "Alliance", maskBit: 6, startingFlightNodes: [] },
      "8": { fileName: "Troll", faction: "Horde", maskBit: 7, startingFlightNodes: [] },
      "95": { fileName: "Skyborne", faction: "Alliance", maskBit: 32, startingFlightNodes: [] },
      "96": { fileName: "Skyborne", faction: "Horde", maskBit: 33, startingFlightNodes: [] },
    },
    professions: {},
    standings: [{ name: "Neutral", min: 0 }],
    xpToNextLevel: Array.from({ length: f.quests.maxLevel - 1 }, () => 400),
  } satisfies Partial<GameDataFile>);
  f.replace("quests.json", f.quests);
  f.add("transports.json", "transports", bytesOf({ version: 1, nodes: [], links: [] } satisfies TransportsFile));
  f.manifest.transports = "transports.json";
  return f;
}

export function transportsFixture(f = fixture()) {
  f.quests.races = { "95": { fileName: "Skyborne", faction: "Alliance" }, "96": { fileName: "Skyborne", faction: "Horde" } };
  f.quests.classes = { "11": { fileName: "DRUID" } };
  f.replace("quests.json", f.quests);
  const transports: TransportsFile = {
    version: 1,
    nodes: [
      { id: "DOCK_SKYWATCHER", name: "Skywatcher Plateau", world: { instance: 1, x: 368.75, y: -793.75 }, height: 190.13 },
      { id: "DOCK_VALANAAR", name: "Valanaar Harbor", world: { instance: 2991, x: 1014.58, y: 1960.42 }, height: 662.88 },
      { id: "TAXI_63", name: "Nighthaven", world: { instance: 1, x: -2404.07, y: 7787.77 } },
      { id: "TAXI_22", name: "Thunder Bluff", world: { instance: 1, x: 29.76, y: -1197.22 } },
      { id: "PORTAL_STORMWIND_DALARAN", name: "Wizard's Sanctum", world: { instance: 0, x: 856.43, y: -8999.76 } },
      { id: "PORTAL_DALARAN_STORMWIND", name: "Dalaran", world: { instance: 0, x: 445.93, y: 447.95 } },
      { id: "FLIGHT_3203:air", name: "Rog'mar", world: { instance: 0, x: -4782.96, y: -7923.74 }, air: true },
      { id: "FLIGHT_3274:air", name: "Powderfuse Port", world: { instance: 0, x: -5724.67, y: -8157.2 }, air: true },
    ],
    links: [
      {
        service: "ship-valanaar-skywatcher",
        mode: "ship",
        from: "DOCK_SKYWATCHER",
        to: "DOCK_VALANAAR",
        requires: { faction: "Horde" },
        seconds: { min: 140, average: 310, max: 480 },
      },
      {
        service: "druid-moonglade-thunderbluff",
        mode: "druid-flight",
        from: "TAXI_63",
        to: "TAXI_22",
        requires: { faction: "Horde", class: "DRUID" },
        seconds: { min: 362, average: 362, max: 362 },
      },
      {
        service: "portal-stormwind-dalaran",
        mode: "portal",
        from: "PORTAL_STORMWIND_DALARAN",
        to: "PORTAL_DALARAN_STORMWIND",
        requires: { faction: "Alliance", race: "Skyborne" },
        seconds: { min: 2, average: 2, max: 2 },
      },
      {
        service: "FLIGHT_PATH_3203-3274",
        mode: "flight",
        from: "FLIGHT_3203:air",
        to: "FLIGHT_3274:air",
        requires: { faction: "Horde" },
        seconds: { min: 53.91, average: 53.91, max: 53.91 },
        estimate: "reference",
        path: [
          [-4783, -7924],
          [-5725, -8157],
        ],
      },
    ],
  };
  f.add("transports.json", "transports", bytesOf(transports));
  f.manifest.transports = "transports.json";
  return { ...f, transports };
}

export const groundSurfaces = ({ width, height, values }: { width: number; height: number; values: Uint16Array }): InteriorSurfaces => ({
  width,
  height,
  groundHeight: values,
  groundPlace: new Uint8Array(values.length),
  stacked: new Uint32Array(),
  upperStart: Uint32Array.of(0),
  upperHeight: new Uint16Array(),
  upperPlace: new Uint8Array(),
});

export function transparentPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, data.length + 8)), data.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(
    Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]),
  );
}

export function guideIconsFixture(f = fixture()) {
  const key = (path: string) => path as TextureKey;
  const guideIcons: GuideIconsFile = {
    version: 1,
    image: "guide-icons/icons.png",
    columns: 2,
    icons: [
      { fileDataId: 132121, path: key("interface/icons/ability_druid_demoralizingroar") },
      { fileDataId: 308474, path: key("interface/worldmap/chatbubble_64grey") },
      { fileDataId: 7792229, path: key("interface/icons/inv_knife_1h_skybornec60_b_01") },
    ],
  };
  f.add("guide-icons/icons.json.gz", "guide-icons", new Uint8Array(gzipSync(bytesOf(guideIcons))), "gzip");
  f.add(guideIcons.image, "png", transparentPng(136, 136));
  f.manifest.guideIcons = "guide-icons/icons.json.gz";
  return { ...f, guideIcons };
}
