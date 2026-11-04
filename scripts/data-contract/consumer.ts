import {
  validateDataset,
  validateDatasetManifest,
  validateDatasetAsset,
  validateDatasetGeometry,
  validateCompleteGameData,
  validateCompleteEntityData,
  validateWorldMapData,
  validateMapBounds,
  acceptInteriorImage,
  acceptMapTile,
  acceptInteriorSurfaces,
  encodeInteriorSurfaces,
  decodeInteriorSurfaces,
  startupAssets,
  decodeJson,
  percentToWorld,
  worldToCanvas,
  locateCanvas,
  parseGuideReferenceExport,
  decodeInteriorsFile,
  decodeTransportsFile,
  decodeGuideIconsFile,
  textureKey,
  guideIconCell,
  guideIconSheetSize,
  acceptGuideIconImage,
  surfaceHeightsAt,
  insideInterior,
  type NpcSpawn,
  type Dropper,
  type SourceKey,
  type SourceDisplay,
  type GuideReferenceExport,
  type GameDataFile,
  type InteriorsFile,
  type InteriorSurfaces,
  type TransportsFile,
  type TextureKey,
  type GuideIconsFile,
} from "@rxp-planner/data-contract";
import fixture from "./fixture.json" with { type: "json" };

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(run: () => unknown, pattern: RegExp) {
  try {
    await run();
  } catch (error) {
    check(error instanceof Error && pattern.test(error.message), `Wrong rejection: ${String(error)}`);
    return;
  }
  throw new Error(`Expected rejection: ${pattern}`);
}
const manifest: unknown = fixture.manifest;
const files = new Map(fixture.files.map(({ path, bytes }) => [path, new Uint8Array(bytes)] as const));
validateDatasetManifest(manifest);
const result = await validateDataset(manifest, files);
const label: SourceDisplay | undefined = result.manifest.sources["Independent/one"];
check(label?.name === "Independent survey", "SourceDisplay");
const quests: GameDataFile = result.quests;
validateCompleteGameData(quests);
const guaranteedSource: SourceKey = "Independent/one";
const guaranteedDropper: Dropper = { type: "npc", id: 103, guaranteed: { source: guaranteedSource }, chance: 0.001 };
const guaranteedQuests = structuredClone(quests);
guaranteedQuests.droppers = { "182": [guaranteedDropper] };
validateCompleteGameData(guaranteedQuests);
await rejects(
  () =>
    validateCompleteGameData({
      ...guaranteedQuests,
      droppers: { "182": [{ ...guaranteedDropper, guaranteed: { source: "override:undeclared" } }] },
    }),
  /not among the bundle's sources/,
);
await rejects(
  () => validateCompleteGameData({ ...guaranteedQuests, droppers: { "182": [{ ...guaranteedDropper, loot: { count: 1, outof: 1000 } }] } }),
  /Invalid item droppers/,
);
const gameTables: Pick<
  GameDataFile,
  "flightNodes" | "factionNames" | "races" | "classes" | "raceClasses" | "professions" | "standings" | "xpToNextLevel"
> = {
  flightNodes: { "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: { instance: 0, x: 478.62, y: -8832.77 } } },
  factionNames: { "72": "Stormwind" },
  races: {
    "95": { fileName: "Skyborne", faction: "Alliance", maskBit: 32, startingFlightNodes: [2] },
    "96": { fileName: "Skyborne", faction: "Horde", maskBit: 33, startingFlightNodes: [] },
  },
  classes: { "1": { fileName: "WARRIOR" } },
  raceClasses: { "95": [1], "96": [1] },
  professions: { "164": { name: "Blacksmithing", noSpecialization: true } },
  standings: [
    { name: "Unfriendly", min: -3000 },
    { name: "Neutral", min: 0 },
  ],
  xpToNextLevel: Array.from({ length: quests.maxLevel - 1 }, (_, i) => 400 + i),
};
const withTables: GameDataFile = { ...quests, ...gameTables };
validateCompleteGameData(withTables);
await rejects(() => validateCompleteGameData({ ...withTables, raceClasses: { "2": [1] } }), /race classes race reference/);
const hordeStart = structuredClone(withTables);
hordeStart.races!["96"]!.startingFlightNodes = [2];
await rejects(() => validateCompleteGameData(hordeStart), /race starting flight node reference/);
const skilled = structuredClone(withTables);
skilled.quests[0]!.requiredSkill = { skill: 186, value: 1 };
await rejects(() => validateCompleteGameData(skilled), /quest 887 profession reference/);
validateCompleteEntityData(result.entities);
validateDatasetGeometry(result.geometry);
validateWorldMapData(result.terrain);
validateMapBounds(result.geometry.bounds);
check(quests.quests[0]?.requiredLevel === 9 && quests.quests[0]?.questLevel === 14, "Complete quest decoding");
check(result.entities.entities.spell[0]?.[1] === "Smite", "Gzip entities");
const startup = new Map(startupAssets(manifest).map((a) => [a.path, files.get(a.path)!] as const));
const interiorAssets = [...files.keys()].filter((path) => path.startsWith("interiors/"));
check(
  interiorAssets.length === 3 &&
    startup.size === files.size - 7 &&
    startup.has(manifest.guideIcons!) &&
    ![...startup.keys()].some((path) => path.startsWith(`${manifest.tileBase}/`)) &&
    startup.has(manifest.transports!) &&
    !interiorAssets.some((path) => startup.has(path)),
  "Startup assets",
);
const atStartup = await validateDataset(manifest, startup);
const tile = "world/tiles/kalimdor/2/1/1.webp";
await acceptMapTile(atStartup, tile, files.get(tile)!);
await rejects(() => acceptMapTile(atStartup, tile, new Uint8Array(files.get(tile)!.length)), /checksum/);
await rejects(() => acceptMapTile(atStartup, "world/tiles/kalimdor/2/1/2.webp", files.get(tile)!), /map tile reference/);
check((await decodeJson(files.get("entities.json.gz")!)) !== null, "JSON codec export");
await validateDatasetAsset(manifest.assets[0]!, files.get(manifest.assets[0]!.path)!);
const near = (value: number | undefined, expected: number) => value !== undefined && Math.abs(value - expected) < 0.01;
const point = percentToWorld([result.bounds.get(1413)], 62.6, 36.2);
check(point.ok && near(point.world.x, -3720.55) && near(point.world.y, -833.26) && point.world.instance === 1, "World geometry");
check(near(worldToCanvas(result.terrain, { instance: 1, x: -3680.1, y: -951.35 })?.x, 560.9), "Canvas geometry");
check(!locateCanvas(result.terrain, "kalimdor", { x: 227, y: 601.3 }).ok, "Off-map geometry");
const interiors: InteriorsFile | undefined = result.interiors;
check(interiors?.version === 2 && interiors.interiors[0]?.places.join() === "Defias Hideout,The Deadmines", "Interiors file and images");
await rejects(() => decodeInteriorsFile({ ...interiors, version: 1 }), /Invalid interiors file version 1, expected version 2/);
for (const image of interiorAssets.filter((path) => path.endsWith(".webp"))) await acceptInteriorImage(atStartup, image, files.get(image)!);
const minimap = "interiors/the-deadmines-35530/ground-minimap.webp";
await rejects(() => acceptInteriorImage(atStartup, minimap, files.get(minimap.replace("minimap", "plan"))!), /size/);
const surfacesPath = interiors.interiors[0]!.surfaces;
const surfaces: InteriorSurfaces = await acceptInteriorSurfaces(atStartup, surfacesPath, files.get(surfacesPath)!);
check(surfaces.stacked.length === 5 && surfaces.upperHeight[4] === 300, "Interior surfaces");
check(
  JSON.stringify(decodeInteriorSurfaces(encodeInteriorSurfaces(surfaces), interiors.interiors[0]!)) === JSON.stringify(surfaces),
  "Interior surfaces codec",
);
const transports: TransportsFile | undefined = result.transports;
check(transports?.nodes.length === 8 && transports.links[1]?.requires.class === "DRUID", "Transports file");
await rejects(
  () => decodeTransportsFile({ ...transports, links: [{ ...transports.links[0]!, to: "DOCK_MISSING" }] }),
  /transport link 0 stop reference/,
);
const guideIcons: GuideIconsFile | undefined = result.guideIcons;
check(guideIcons?.icons.length === 3 && guideIcons.columns === 2, "Guide icons file");
const knife: TextureKey | undefined = textureKey("Interface\\Icons\\INV_Knife_1h_SkyborneC60_B_01.blp");
check(knife === guideIcons.icons[2]?.path && textureKey("07792229") === "7792229" && textureKey("../x") === undefined, "Texture keys");
check(JSON.stringify(guideIconCell(2, guideIcons.columns)) === '{"x":2,"y":70,"width":64,"height":64}', "Guide icon cell");
check(JSON.stringify(guideIconSheetSize(440, 21)) === '{"width":1428,"height":1428}', "Guide icon sheet size");
await rejects(() => decodeGuideIconsFile({ ...guideIcons, icons: guideIcons.icons.toReversed() }), /guide icon 308474 order/);
await acceptGuideIconImage(atStartup, guideIcons.image, files.get(guideIcons.image)!);
await rejects(() => acceptGuideIconImage(atStartup, guideIcons.image, files.get(tile)!), /size/);
const [spawn, place]: (NpcSpawn | undefined)[] = quests.npcs?.[594]?.spawns ?? [];
check(
  spawn && "guid" in spawn && spawn.guid === 89539 && spawn.interior === "the-deadmines-35530" && place && !("z" in place),
  "NPC spawns",
);
const cave = interiors.interiors[0]!;
check(surfaceHeightsAt(cave, surfaces, spawn.world).join() === "26.875,39.375", "Surface heights");
check(insideInterior(cave, surfaces, spawn.world, spawn.z) && !insideInterior(cave, surfaces, spawn.world, 60), "Inside an interior");
await rejects(() => validateCompleteGameData({ ...quests, npcs: { 594: { spawns: [], provenance: { fields: {} } } } }), /NPC records/);
const references: GuideReferenceExport = parseGuideReferenceExport(fixture.references);
check(references.references[0]?.id === 890 && references.references[0]?.edition === "forever", "Guide references");
await rejects(
  () => parseGuideReferenceExport({ version: 1, references: [{ edition: "forever", type: "quest", id: 0 }] }),
  /positive safe integer/,
);
await rejects(() => validateDataset({ ...manifest, sources: {} }, files), /manifest/);
const damaged = new Map(files);
const path = manifest.assets[0]!.path;
const bytes = files.get(path)!.slice();
bytes[0] = bytes[0]! ^ 1;
damaged.set(path, bytes);
await rejects(() => validateDataset(manifest, damaged), /checksum/);
console.log(
  "Installed contract: complete fixture, guaranteed drop source validation, game tables reference validation with professions, standings, XP, race bits, and starting flight nodes, NPC spawns and the interior test, interiors version 2 with its images and surfaces, refusal of version 1, transports file and its stop reference, guide icons file, texture keys, and sheet, invalid manifest/checksum, codecs, geometry, SourceDisplay, G1 passed.",
);
