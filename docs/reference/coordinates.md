# Coordinates

## Why Era coordinates fail on some maps

The planner places points on Forever's maps, with the map bounds of the
selected dataset and no built-in fallback tables. Forever redrew some maps,
such as Mulgore and Stormwind City, so Era percentages on those maps do not
match. Forever also adds maps, such as Zephras Isle on instance 2991. A world
line such as `.goto 2521/1,x,y` names instance 1, so it fails as
`wrong-instance`.

`src/data/maps.ts` owns RXP's zone names and aliases, and its comments cite
the RXP sources.

## Why guides never store pixels

Guides store map percentages or world coordinates, so a terrain replacement
cannot move a saved point. Route plans store world positions for the same
reason, as [Route stops](routing.md#route-stops) tells. `locateOnTerrain`
turns a click into a map position through the selected terrain geometry.

`locateCanvas` gives the world position of a pixel in the area that its
source declares. `canvasToWorld` resolves a viewer click on the area drawn on
top. The two differ where areas overlap. The ship and zeppelin paths of the
world map (`WorldMapRoute`) are canvas polylines that cross atlas gaps and
instances, so the planner does not convert their points to world positions.

## Why the zone estimate can be wrong

`GameData.zoneAt` estimates a zone from the dataset's continent hit grid, and
then from overlapping map rectangles. Neither follows the real zone borders,
so the estimate can name a neighbor zone, such as Felwood for Auberdine. It
does not reproduce `C_Map.GetBestMapForUnit`. So the simulator keeps the zone
that a guide position names for `.zoneskip`, as
[Travel gates](simulation.md#travel-gates) describes. Quest suggestions use
the estimate. The coordinate readout under the map takes the zone from the
routing artifact's zone grid, and uses `zoneAt` only when the grid gives no
usable zone. The Playback bind label uses `zoneAt`, so it can disagree with
the travel gate.
