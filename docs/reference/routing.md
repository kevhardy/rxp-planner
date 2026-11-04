# Routing

The planner finds ground routes on a routing artifact for each map. The
**Routes** map, Playback, and the agent tool `travel_time` use the same
search in `src/routing/`. Floor hints use the same artifact and the same stop
classes, but not the search. This page tells how a route stores its stops,
how the search finds a route, how Playback uses it, and how floor hints work.

## The routing artifact

A routing artifact holds the terrain tiles of one map, with the walkable
cells and their heights. It also holds the floor tiles of buildings and
caves, a coarse layer that bounds the cost of a route, and a zone grid. The
floor tiles hold the buildings, their floors and doors, the targets that the
data producer matched to a floor, and the endpoint hints. The data producer
defines the format. Each file in `src/routing/` that follows the format
cites it in its header comment.

`.local-data/bundle.json` gives the SHA-256 hash of each map's manifest, and
the manifest gives the size and the hash of every asset. So the hash in
`bundle.json` pins every byte of the map. When a map fails its checks, only
that map has no routing.

The rides, such as ships, zeppelins, and flights, come from the dataset's
`transports` asset. `.local-data/stop-keys.json` holds the search keys of
their stops on each installed map. Without it, routes are the same, but the
first search is slower, because the search must read the terrain around
each ride stop.

## Route stops

A route plan stores each stop as a world position. A stop has the map
instance, x and y in yards as `.goto` lines give them, and a height in
yards. A null height means a stop on the ground. Saved plans and route text
(`ROUTE_VERSION` in `src/routing/share.ts`) hold these stops and name no
artifact and no pixel. So a new dataset release does not move a saved stop.

The search reads native pixels. Before each search, `nativePlan` in
`src/routing/frame.ts` rounds each stop to the nearest pixel on the frame of
the loaded artifact of its map. Frame origins are whole tiles, so the world
position of a pixel rounds back to that pixel on each frame of its map. A
stop gets no route when its map has no loaded artifact, and the error names
that map. A stop outside native pixels 0 to 32767 also gets no route.

## Search

`routeLeg` in `src/routing/search.ts` routes one leg on the terrain cells
and the floor nodes. First, `classifyStop` in `src/routing/indoor.ts` gives
each end of the leg a class. The first class that matches wins:

- **Target.** The stop is within `MATCH_PIXELS` of a target of a building.
  The producer matched a target of kind 0 to a floor. A target of kind 1 has
  no known floor.
- **Building.** The stop's cell is in a building.
- **Hint.** The stop is within `MATCH_PIXELS` of an endpoint hint.
- **Ground.** Any other stop.

These rules then apply:

- **Ground stops.** In a floor cell, `snapNode` looks at the nodes of the
  cells whose centres are within `SNAP` yards in 2D. It snaps the stop to
  the nearest of these nodes in 3D, and to the lower node on a tie. The
  stop's height is the requested height, else `groundHeight` in
  `src/routing/terrain.ts`. `groundHeight` is the lowest buried,
  non-descent layer of the cell, else the terrain height. So a stop with no
  height in Ironforge snaps to the city floor under the mountain.
- **Hint stops.** The nearest hint gives the height. When another hint
  within reach is a storey (`STOREY`) or more from it, the stop is
  `ambiguous`.
- **Stops with a height.** A stop with a requested height, such as a kill
  run that ends at a spawn's height, matches a target of kind 0 only when
  the target's floor is within a storey of that height. It matches a
  building only when one of the building's floors is within a storey of it.
  Otherwise the next class applies. So a stop in a cave under a building, or
  on a floor above a colocated target, keeps its height. A target of kind 1
  matches at any height.
- **Steep stops.** A ground stop on terrain steeper than `maxSlope` snaps
  like a stop in a floor cell, but only to a node within `STEEP_RISE` of its
  height. So the route does not climb a cliff or a wall to reach a guide
  point on a steep face. With no such node, the result is `no-path`. The
  snap does not change the slope limit of the search.
- **Legs inside one building.** A leg between two targets of one building
  can follow the building's stored path between them. The search uses that
  path when it is cheaper than the routes through the doors. A leg from a
  target to the same target has one point.
- **Result stops.** The route's `stops` holds a `LegStop` for the start and
  the end when either is not a ground stop or is steep. A target or building
  stop has `building`, the WMO placement of its building, and `floor`, the
  floor where the route meets it or `door`. A steep ground stop has `steep`.

## Playback

`src/routing/playback.ts` routes the legs that a timeline asks for, prices
the timeline with them, and places the character at any second. The
Playback mode of the app uses it. [Travel](simulation.md#travel) tells how
the timeline asks for legs.

### Which guides Playback prices

A route can go on through the guides that `#next` chains, and each guide
makes the price longer. So Playback prices the route only through the open
guide, and further only when the person asks for more guides. The app's
store passes that count to `PlaybackRouting.play` as `reach`, which
`priceRoute` takes as `maxGuides`. The store finds the open guide in the
last playback, because a Hearthstone on cooldown can move a guide later in
the route than the simulation has it.

### How Playback routes a leg

Each travel, flight, and run between kills asks for a leg. The key of a leg
holds the exact world position of both ends. A travel adds its mode, Run or
Mount, which the timeline gives with the leg. A run between kills always
uses Run. A flight adds the taxi nodes that the character learned. Two
nearby points can route differently or stop at different doors, so the key
does not round them. A run that starts and ends in one `cell` of
`playback.ts` asks for no leg.

`PlaybackRouting.play` prices the route at once with the straight estimate
for each leg without a route. Then it routes the missing legs one at a time,
from the playhead on, and prices the route again as they route. A price of
a whole chain can take hundreds of milliseconds, so it yields to the event
loop every `SLICE_MS`. It yields with a new task, because a microtask lets
no input in.

These rules decide the way of a leg:

- **Rides.** A ground leg takes ships and other rides, but no flights. A
  flight takes off and lands only at the flight master
  (`FLIGHT_<taxi node>`) of a node that the character learned (`ridesFor`).
  A flight takes its routed seconds, and the timeline model's seconds until
  it routes. When its route takes no flight, the timeline walks the leg
  instead, with a warning.
- **Doors.** A ground route can stop at the door of a building when the
  guide point has no stored path inside, such as an innkeeper. A straight
  line at the leg speed then joins the door to the guide point, on the floor
  of the door. At the start and the end of a ride journey, the door line
  adds its time to the journey. The leg keeps the straight estimate when its
  route leaves and enters one building, because the doors say nothing of the
  way inside. It also does so when a line is longer than `DOOR_TAIL`, or
  when a ground part of a ride journey stops at a door between rides.
- **Steep guide points.** A ground route to a guide point on a steep face
  ends at the steep snap node. A straight line at the leg speed joins that
  node to the guide point, at the height of the node. A ride journey gets no
  such line, and ends at the snap node.
- **Floor continuity.** A ground stop with no height snaps to the floor
  nearest the ground. So a leg that starts where the last routed leg ended
  can start on another floor, such as above a cave. When the leg starts in
  the cell where the last routed leg ended, and its route starts a storey or
  more from that end or finds no path, Playback asks again with that height.
  The end gets the same height, unless the route ends at a target, a
  building, or a hint, which selects its own floor. A ride journey asks
  again with the start height only. Playback takes the new way only when it
  routes, and `Playback.routing` counts both asks as one leg.
- **NPC heights.** A travel to a place within `GOTO_NPC_REACH` of a
  confirmed spawn of an NPC that the step names ends at that spawn's height.
- **Kill runs.** A kill run stops `pullReach` short of the spawn and ends at
  the spawn's height (`Spawn.z`). A spawn with no height is too far from the
  run's end for the search to match the hint at the spawn. So Playback first
  routes a leg one pixel long from the spawn. When the search matches that
  start to one hint, the run ends on the hint's floor. With no hint, or with
  an `ambiguous` hint, the run ends where a ground stop snaps. This floor
  wins over the height of a leg asked again. The leg one pixel long does not
  count in `Playback.routing`. A kill run with no routed way ends at the
  spawn's height when it is known, else at the height before it.

`WayView.estimate` tells why a way's seconds are an estimate, in whole or in
part. A step with a reason shows "≈" before its length, and its travel bar
uses the estimate style. Its tooltip reads "Straight-line travel:" and then
the text that `ESTIMATE_REASONS` in `src/app/playback/PlaybackView.tsx` gives
for the reason. The table mirrors `ESTIMATE_REASONS`, and `wayOf` and
`makePlayback` in `src/routing/playback.ts` give the reasons.

| Reason                  | What the person sees and why                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pending`               | The leg has no route yet. The step uses the straight estimate until the leg routes.                                                                                                              |
| `unavailable`           | The routing did not load, or no map has routing. Every leg uses the straight estimate.                                                                                                           |
| `off-map`               | An end of the leg is on a map with no loaded routing.                                                                                                                                            |
| `crossing`              | The leg goes to another map, and no ride connects the two ends. The step uses the fixed time of a map change.                                                                                    |
| `no-path`               | The search found no route between the ends. When Playback asks again from the last floor, this text stays until the new ask routes.                                                              |
| `failed`                | Routing the leg stopped with an error or gave no result. A stop outside the pixels of its map also gives this reason.                                                                            |
| `door-line`             | The route stops at the door of a building, and a straight line joins the door to the guide point. The time is the route's time plus the line.                                                    |
| `steep-line`            | The guide point is on a steep face. The route stops at the nearest node that can be walked, and a straight line joins it to the point.                                                           |
| `interior-path-missing` | The route stops at a door, and no short line can join the door to the guide point, as in a mine, a tunnel, or a leg that leaves and enters one building. The leg keeps the straight estimate.    |
| `flight-unknown`        | A `.fly` step walks. No flight master is near the start, the character has not learned the destination, or the route found no flight. The step shows this reason even when the walk has a route. |
| `no-terrain`            | An end of the leg is on a tile with no terrain, or outside the frame of its map.                                                                                                                 |
| `missing-coverage`      | The search reached tiles with no terrain data, where a faster route could pass. The character follows the provisional route when the search has one, at the straight estimate's time.            |
| `limit`                 | The search needed more cells than its budget. The character follows the provisional route when the search has one, at the straight estimate's time.                                              |

`EstimateReason` in `src/routing/playback.ts` lists the reasons. A search
result kind that is not a route gives its own reason, so a new kind is a type
error until `ESTIMATE_REASONS` has text for it.

`Playback.routing` counts the legs. `straight` counts the legs that keep the
straight estimate, by reason, and runs between kills count too. `pending`
counts the legs that wait. A leg with a door line or a steep line counts as
routed, and `flight-unknown` is not a count.

### The character's level

`Playback.at(t)` gives the character's place, with the route's height at
that point from `TerrainRoute.heights`. The search gives each route point
its floor height, also on stairs between the stops. The app finds the
character's level inside an interior from that height with `levelOf`. A
straight way has no height, and the marker shows no level.

### Settings

[Playback settings](simulation.md#playback-settings) lists the settings.
`PlaybackSettingsStore` in `src/app/playback/settings.ts` saves the settings
that differ from the default under the `playback` setting key.
`playbackRoute` in `src/rules/chain.ts` simulates the route again
with them. It reuses the Edit preview's simulation only when the preview
character is solo self-found and every setting has its default.
`PlaybackRouting` reads the settings only through the simulation.

## Map layers

At the zoom of the landmark labels or closer, the map shows the inside map
of the smallest interior that holds the middle of the view and is
`MIN_INTERIOR_PIXELS` across on screen. `interiorInView` in
`src/app/map/InteriorLayer.tsx` owns this rule.

When no interior meets that rule, Playback shows the inside map of the
character's interior at any zoom. The character is in an interior when the
interior has a surface at its point, within a storey of its height when the
height is known (`insideOf`). When the character is outside, Playback shows
the first interior that the step's routed ways run through. Edit and Routes
use only the zoom rule.

## Floor hints

RXP gives a guide point as x and y only, because the addon cannot read the
player's height. In a building or a city with stacked floors, a player can
look for an NPC on the wrong floor. A floor hint uses the walkable floors
that the routing artifact holds at a point to add a note to a guide step.

`floorHint` in `src/routing/floorHint.ts` gives the hint, and
`floorHintText` gives its note.

### Run it

```sh
pnpm --silent guides:floor-hints --zone "Stormwind City" --zone Ironforge
```

The header of
[`scripts/guides/floor-hints.ts`](../../scripts/guides/floor-hints.ts) lists
the flags. `--map` must name the routing artifact that holds the zones,
because the script skips a point on another map.

### The hint

`floorHint(region, point)` gives one of three kinds. The region must hold
the tiles around the tile of the point, because `classifyStop` reads
buildings from them. So call `terrain.region([point], TILE_PIXELS)`.

The kinds are the `FloorHint` type in `src/routing/floorHint.ts`, and
`floorHintText` writes the note.

| Kind      | When                                                             | Note                                                                   |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `single`  | The point has one walkable floor, or none.                       | None.                                                                  |
| `stacked` | The point has two or more floors. Its floor is not known.        | Says that the NPC may be upstairs or downstairs, and lists the floors. |
| `known`   | The point has two or more floors. The data producer matched one. | Says how far up or down the NPC is, and lists the floors.              |

`floors` lists the height of each floor in yards from the ground floor.

- **Building.** A stop of class `target` or `building` (see
  [Search](#search)) uses the floors of the building record and its ground
  floor. The producer chose the ground floor. It is the floor at the doors,
  which can be above other floors, as in Anvilmar. A target of kind 0 gives
  `known`, with the floor of the target. A target of kind 1, or a building
  stop, gives `stacked`.
- **Outside buildings.** The floors are the walkable layers of the point's
  cell. A descent layer does not count, and two layers less than `STOREY`
  apart are one floor. When the cell has a buried layer, the terrain is a
  roof, as over Ironforge. Then only the buried layers count, and the
  lowest is the ground floor. Otherwise the layer nearest the terrain height
  is the ground floor. Ground stops use the same height (`groundHeight`).
- **Endpoint hint.** A stop of class `hint` gives `known`. Its floor is the
  layer nearest the height of the hint, the lower on a tie, as in the
  search.

### Why the planner cannot always know the floor

A quest point has `world.x` and `world.y` only. So for most points, the
planner can tell that a point has stacked floors, but not which floor holds
the NPC. Only a building target of kind 0 and an endpoint hint carry a
floor. A confirmed NPC spawn can have a z, and Playback uses it, but floor
hints do not. With a z for each NPC and object point, every hint could be
`known`.

### Check it against guide authors

Many built-in guide steps say where the NPC is, such as up the stairs or on
an upper floor of a house. To check the hints, run the script on the zones
of those steps. Compare the hint at the last `.goto` of each step with the
words of the author. A `known` hint must be on the side that the author
says. A `stacked` hint must have a floor on that side.

### Limits

- A roof, a bridge, or a city wall is a walkable layer. A point under one
  gets `stacked`, although the NPC is on the street.
- A `.goto` point that an author wrote by hand can be a few yards from the
  NPC. It can then land in a cell without the floors of the NPC.
- In a building, the ground floor is the floor at the doors. A player can
  call it upstairs when the main hall is below it.
- The dataset gives quest points only for quest givers and enders. Other
  NPCs, such as trainers and innkeepers, use the `.goto` point of the step.

## Known gaps

- The planner routes no Hearthstone or mage teleport.
- The **Routes** map takes every flight point as known. Playback takes off
  and lands only at the flight masters that the character learned.
- A route can find no path where the terrain does not hold a way, such as a
  tunnel that the artifact leaves out. That no-path comes from the
  artifact, not from the search.
