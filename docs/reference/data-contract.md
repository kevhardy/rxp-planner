# Data contract

`packages/data-contract/`, the package `@rxp-planner/data-contract`, defines the
dataset that the planner reads. The data producer builds each dataset with the
same package. The planner also needs some fields that the package keeps
optional, as [Versions](#versions) tells.

## What a dataset holds

A dataset is a folder with `manifest.json` and the assets that the manifest
lists. `DatasetManifest` and `DatasetAsset` in
`packages/data-contract/manifest.ts` give the manifest's fields. Each asset has
a format, which is a key of `ASSET_VERSIONS` in the same file:

| Format                    | What it holds                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `quests`                  | The quest bundle: quests, zones, continents, NPCs, item droppers and sellers, game tables. |
| `entities`                | The names and details of each type in `ENTITY_TYPES`, for search and links.                |
| `geometry`                | The bounds of each map of the game's UI.                                                   |
| `terrain`                 | The areas of the world map and its tile grid.                                              |
| `interiors`               | The inside maps of buildings and caves.                                                    |
| `interior-surfaces`       | The surface heights of one interior.                                                       |
| `transports`              | The fixed rides, such as ships, trams, portals, and flights, and their stops.              |
| `guide-icons`             | The files that guide texture escapes name, and their cells in one PNG sheet.               |
| `png`, `jpeg`, and `webp` | Map tiles, interior images, map icons, and the guide icon sheet.                           |

## How the planner loads and checks a dataset

The planner checks every dataset before it uses the data. In Node,
`pnpm data:validate` reads the manifest and every asset, and `validateDataset`
checks the size, the hash, the format version, and the records of each asset.
`pnpm build` runs `pnpm data:validate` first, so a bad dataset stops the build.

The browser reads the manifest and the assets that `startupAssets` lists, and
checks each one in the same way. It reads terrain tiles, interior images, and
interior surfaces when it first needs them, and the guide icon sheet in the
background. It checks each of these assets when it reads it. If a tile fails
its check, only that tile is missing, and the map's **Retry** reads it again.
The browser never falls back to other data.

- **Stored bytes.** Sizes and hashes cover the stored bytes, gzip included.
  A host can compress a response with a `Content-Encoding`, because `fetch`
  removes that layer before the check. A host that removes the stored gzip
  layer of a `.gz` file, or changes the stored bytes in another way, makes the
  bytes fail their hashes.
- **Revalidation.** The browser reads dataset files with `no-cache`, so each
  load asks the host whether a file changed. A host that sends `ETag` or
  `Last-Modified` answers an unchanged file with a 304 response.
- **External IDs.** Quest and NPC `zoneIds`, and the game IDs in objectives,
  prerequisites, rewards, drops, and sales, are game facts. A bundle need not
  hold a record for each one, so validation does not require one.
- **Absent is not false.** The producer sets an optional field only from
  evidence, and the decoders never fill in a default. So an absent field means
  no evidence, not a negative fact. For example, an absent dropper `chance`
  means no estimate, not no drop. The doc comments in `model.ts` give
  the meaning of each absent field that is not plain.
- **Checks prove bytes, not truth.** The image checks read the image container
  and its size, and do not decode pixels. A hash proves which bytes the
  manifest declared, not that their content is true.
- **Unknown keys survive.** Extra producer metadata survives decoding but has
  no meaning in the planner. An unknown asset format fails validation, so a
  manifest that still declares a `point-provenance` asset fails. The interiors
  file also rejects the old fields that `version1Fields` in `interiors.ts`
  names.

## Versions

The package adds optional fields without a new manifest or format version. A
consumer that does not know a field ignores it, and some strict shapes reject
it. So the planner moves to the new package version before any dataset uses
the new field. A format gets a new version only for a change that older
consumers cannot read safely, and `ASSET_VERSIONS` lists both versions while
consumers move.

- `packages/data-contract/package.json` gives the package version.
- Each asset's module in the package defines its record types, and `model.ts`
  holds the types of the quest bundle.
- `requireGameTables` and `runtimeDataset` in `src/data/dataset.ts` refuse a
  release that lacks a field that the planner needs, and `PREDATES` names the
  oldest package version that has them all. `pnpm data:validate` runs only the
  package checks, so it can pass a release that the planner refuses.

`pnpm contract:check` builds the package tarball, installs it in a new project,
and checks it there. pnpm always packs a package's README, and the tarball
holds only `package.json`, `LICENSE`, and `dist/`, so this page lives outside
the package.

## Decoder result types

`validateGameDataFile` accepts producer intermediates, so it asserts only
`GameDataRecords`. Only `validateCompleteGameData` asserts `GameDataFile`, so
a consumer calls it before it reads a decoded bundle as a `GameDataFile`.

## Game tables

The quest bundle can carry game tables from the game client, such as
`flightNodes`, `races`, and `xpToNextLevel`, and the game rules that quest
requirements and the leveling simulation need. The `GameDataFile` fields in
`model.ts` list the tables, and their doc comments give each table's key and
meaning.

`validateCompleteGameData` in `completeData.ts` checks each table that is
present, and the references between tables. A reference such as `raceClasses`
to `races` is checked only when both tables are present. A race with
`startingFlightNodes` is the exception, because it needs `flightNodes`, and
each of its nodes must serve the race's faction.

- A quest can name a faction that `factionNames` does not hold, because the
  client can lack that faction.
- A race's `maskBit` is checked so that `2 ** maskBit` stays a safe integer.

`requireGameTables` refuses a release without the tables and race fields that
it needs. For example, the leveling simulation starts each character with the
flight masters that its race knows, so a race without `startingFlightNodes`
stops the load.

## Transports

The manifest's optional `transports` field names a `transports` asset, which
is a startup asset. `TransportsFile` in `transports.ts` gives its stops and
rides. A ride's `mode` is a string, so a new mode needs no new package version.

`decodeTransportsFile` checks the file alone. `validateDataset` also checks each
stop's instance against the geometry, and each ride's class and race against
the quest bundle's `classes` and `races` when they are present.
The planner refuses a release without the asset.

## Guide icons

The manifest's optional `guideIcons` field names a `guide-icons` asset, which
is a startup asset. `GuideIconsFile` in `guideIcons.ts` gives its rows and its
PNG sheet. `acceptGuideIconImage` checks the sheet when the browser reads it.

A guide writes an icon as a texture escape, such as `|T134414:0|t` or
`|TInterface/Icons/Ability_Warrior_Revenge.blp:0|t`. `textureKey` gives the one
form of the key that the planner and the data producer compare, and its doc
comment gives the rules. A FileDataID key and a path key both find a
whole-file row. A row's path can contain spaces, but a guide texture path
cannot, so a guide names such a file by FileDataID.

A row with a `crop` shows a part of a file, such as one cell of an icon
atlas. The data producer cuts that part before it makes the row's cell. A
line mark names such a row by its crop key, which `cropKey` writes as the
FileDataID and then the crop arguments of a texture escape, such as
`136441:128:128:63:72:0:4`. A texture key never names a part, so a guide's
texture escape and the icon picker see only whole files. One file can have a
whole-file row and part rows. `compareGuideIcons` gives their order.

`decodeGuideIconsFile` and `validateDataset` check the row order and paths,
that the sheet is a declared `png` asset that no other owner uses, and that the
sheet's PNG header gives the size that `guideIconSheetSize` returns. The sheet
geometry changes only with a new `guide-icons` format version. Only
`guideIconCell` and `guideIconSheetSize` compute positions in the sheet.

## Guaranteed quest drops

An NPC dropper can carry `guaranteed: { source }`, as `Dropper.guaranteed`
describes. The source must be an entry in the quest bundle's `sources`, also
when its key starts with `override:`, because the declared source holds the
evidence pins. A manifest display label alone does not declare a source.
Validation rejects a guarantee on an object or item dropper. A dropper can carry
both a guarantee and a `chance`, and `dropChance` in `src/rules/drops.ts`
uses the guarantee.

## Drop chances

A dropper's `chance`, as `Dropper.chance` describes, is the only drop rate
that a dataset carries. It is an estimate, not a measured rate. Validation
rejects a `loot`, `count`, or `outof` field on a dropper, so a release cannot
hold raw loot counts. The producer decides how it estimates each chance. The
planner uses any chance that passes validation.

## NPC spawns

An NPC record can carry `spawns`, the places where players find the NPC.
`NpcSpawn` gives the two shapes of an entry, and the `NpcRecord.spawns` doc
comment gives the order that validation requires.

When `spawns` is absent, a consumer keeps the NPC's quest objective points as
its kill targets. A present list replaces those points for the NPC on every
quest and for grinds. The `NpcRecord.spawns` doc comment also gives the rule by
which the producer admits a row, and a consumer does not repeat it.

`validateDataset` checks that each `interior` names an interior of the
interiors file on the spawn's map, so a dataset without an interiors file has
no `interior` labels. `insideInterior` says whether a spawn is in an interior,
and its doc comment gives the height margins and their reason.
