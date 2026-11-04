# Routing fixtures

The routing tests use fixtures from the data producer. Keep the copied
manifests and binary files unchanged so both decoders use the same inputs.
To change a fixture, get a new copy from the data producer.

## Directories

- `artifact/` is a synthetic artifact. Its frame is the frame of map 0, but
  its tile, floors, and zone grid are synthetic. They do not show the real
  ground at tile [9, 22]. The fixtures root's `artifact-pin.json` holds its
  manifest `id`, `scope`, and the SHA-256 of its `manifest.json`.
- `artifact-coarse/` is a synthetic artifact with a coarse layer.
  `coarse.ts` names the places in its ground that the tests use.
- `records/invalid/` holds invalid manifests. For each case, the planner
  must report the error in the case's `error` field. The data producer's
  wrong-variant case is not here, because the planner accepts any variant.
- `slices/coldridge-caves/` is a slice of a real map: the tiles around the
  Coldridge caves, cut from a map 0 artifact. `source.json` lists the
  tiles, the `artifactId` of the full artifact, and the `manifestSha256` of
  its manifest. `manifest.json` holds the ID of the slice itself.

The other files are code. `synthetic.ts` builds flat synthetic artifacts in
memory, and `region.ts` builds synthetic terrain regions.

## Refresh a fixture

1. Get the new copy from the data producer. For a slice, ask for the map
   and the tiles that `source.json` lists.
2. Replace the fixture's manifests and binary files with the new copy.
3. For `artifact/`, set `id` and `scope` in `artifact-pin.json` from the new
   `manifest.json`, and set `manifestSha256` to that file's SHA-256.
4. For a slice, update `source.json` with the map, tiles, full artifact ID,
   and full manifest hash. Keep producer source paths and commit IDs out
   of this metadata.
5. Run `pnpm test src/routing`.
