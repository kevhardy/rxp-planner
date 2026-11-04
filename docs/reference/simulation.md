# Leveling simulation

`simulateRoute` in `src/rules/simulate.ts` decides what the character does
at each step of a route. `buildTimeline` in `src/rules/timeline.ts` then
decides how long each act takes. A guide author steers both with `-- @sim`
comments, which RXP reads as plain comments.

## Where the route starts

The route always runs through the open guide. **Start from** in the Start
card can choose an earlier guide whose `#next` leads to the open guide. The
list leaves out a guide that a later guide with the same group and name
replaces, because RXP loads only the later one. If the route from the
chosen guide does not reach the open guide, the route starts at the open
guide.

These two rules are the planner's, not RXP's:

- The open copy of a built-in guide takes the built-in's place, so `#next`
  lines that name the built-in lead to the copy. A first edit opens a copy,
  so the route and its start stay the same.
- **Auto** start level is the low end of the level range in the start
  guide's `#name`, with 0 XP. A name with no range starts at level 1. RXP
  does not read a level from the guide name.

The app starts each route with an empty quest log, no quests turned in, no
position, and no Hearthstone bind. The character knows only the flight
masters that its race starts with. To mark the prerequisites that earlier
guides turn in, write `-- @sim done=` in the header.

Without a seed, `simulateRoute` and `buildTimeline` count as turned in each
quest that the guides leading to the start guide turn in (`priorTurnIns`).
The CLIs and the agent tools use this default.

## `@sim` comments

A `@sim` comment can follow other comment text, as in
`--Tough Wolf Meat (8) @sim kills=3`. A comment after a body line applies to
that line. A comment line in a step, or a comment on the `step` line, applies to
the step. A comment line in the header applies to the guide. For a setting such
as `killmult=`, `respawn=`, or `party=`, the last value in each scope wins, and
a step value replaces the header value. Each `done=`, `level=`, and `state=`
applies. An unknown key, a bad value, a key in the wrong place, or a key given
twice in one comment gives a warning. `readPairs` in `src/rules/simComments.ts`
reads the keys in this table.

| Key              | Where                                                               | What it does                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `party=2`        | Header                                                              | Makes the guide a duo guide. `party=1`, or no `party=`, makes it solo. See [Party](#party).                                                                               |
| `done=ID,ID`     | Header                                                              | Counts the quests as turned in.                                                                                                                                           |
| `level=TARGET`   | Header, step, or line                                               | A checkpoint. See below.                                                                                                                                                  |
| `kills=N`        | `.complete` line                                                    | Counts N kills of the line's objective at the line, of `mob=ID` when given.                                                                                               |
| `mob=ID`         | `.complete` line                                                    | Sets the mob of the objective's kills.                                                                                                                                    |
| `mob=ID,Name`    | Grind step, its `step` line, an `.xp` line, or a line with `level=` | Sets the mobs of the grind. See [Grind mob](#grind-mob).                                                                                                                  |
| `extra=N mob=ID` | Step or line                                                        | Kills N of the mob where the comment stands, for no objective.                                                                                                            |
| `drop=P`         | `.complete` line                                                    | Sets the drop chance for this line's kills. See [Drop chance](#drop-chance).                                                                                              |
| `killmult=X`     | Header or step                                                      | Multiplies the solo XP of each kill.                                                                                                                                      |
| `killxp=N`       | Step                                                                | Sets the solo XP of each kill. It wins over `killmult=`.                                                                                                                  |
| `respawn=S`      | Header or step                                                      | Seconds before a killed mob's spawn has a mob again. The default is the Playback **Mob respawn** setting.                                                                 |
| `area=Y`         | Header or step                                                      | The radius of the [kill area](#kill-time-and-the-kill-walk) in yards. The default is the **Kill area** setting.                                                           |
| `near=X,Y`       | Step                                                                | Centers the kill area at map coordinates, in the zone of the step's last `.goto` or `.waypoint` that names one.                                                           |
| `pass=Y`         | Header or `#completewith` step                                      | How far in yards a spawn can be from the walked line for a [background kill](#background-kills). `pass=0` turns them off. The default is `passReach` in `TIMELINE_MODEL`. |
| `state={...}`    | Step                                                                | Sets parts of the character on arrival. See [State on arrival](#state-on-arrival).                                                                                        |

The party belongs to the guide, so each guide of a route sets it for its own
steps. When two players group up, a new guide starts, and it assumes that
both players did the same steps.

`level=` takes the `.xp` forms: `8`, `8+1200` (1200 XP into level 8), `8.5`
(half of level 8), and `8-300` (300 XP short of level 8). When the simulated
XP is below the target, the simulation grinds up to it. When the XP is past
the target, the XP stays. When the XP differs from the target, `level=`
gives a warning that shows how far off the simulation is. An `.xp` line
grinds the same way with no warning.

`killmult=` and `killxp=` change the solo XP, and a duo guide still splits
the result. A kill-area setting in a step with no kills gives a warning, and
so does a `near=` that the simulator cannot place.

### State on arrival

`-- @sim state={...}` sets parts of the character when the route reaches a
step. Use it when the simulation is wrong about the character there. The
value is a JSON object, which runs to the last `}` of the comment.

```text
step
    -- @sim state={"level": 7, "hearth": 900, "log": {"313": {"1": 2}}}
    .goto Dun Morogh,46.7,53.6
```

Each value is absolute, so `"xp": 500` sets 500 XP, not 500 more. A field
that the object leaves out keeps its simulated value. `log`, `done`, and
`flightPaths` change only the keys that they name. The table follows
`STATE_FIELDS` in `src/rules/stateOverride.ts`, in the same order.

| Field         | Value                                           | Sets                                                                     |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `level`       | Whole number from 1 to 60                       | The level. XP into the level stays if the new level holds it, else 0.    |
| `xp`          | Whole number below the level's XP               | XP into the level.                                                       |
| `hearth`      | Seconds, 0 or more                              | When the Hearthstone is ready, in seconds after arrival. 0 is ready now. |
| `bind`        | Place                                           | The Hearthstone bind.                                                    |
| `position`    | Place                                           | Where the character stands. The move there takes no time.                |
| `flightPaths` | Flight master name to `true` or `false`         | Learned flight masters.                                                  |
| `done`        | Quest ID to `true` or `false`                   | Turned-in quests.                                                        |
| `log`         | Quest ID to `false`, `"complete"`, or an object | Quests in the log.                                                       |

A place is a string of `.goto` arguments, such as `"Dun Morogh,46.7,53.6"`.
A flight master name must match one flight master, as a
[`.fp` name](#line-effects) does.

In `log`, `false` takes the quest out of the log, and `"complete"` puts it
in the log with every objective complete. An object gives counts by
`.complete` objective index, such as `{"1": 2}`. The counts are progress
already made, so a later `.complete` line or the turn-in counts only the
rest.

The fields apply in table order, so `xp` uses the level that the same object
sets. The step's gates, such as `#level` and `.isQuestTurnedIn`, read the
new state, and the state stays when a gate then skips the step. A step that
its `step <<` condition drops, a step that a jump passes over, and a step in
a hidden guide do not apply `state=`.

A field that `state=` cannot use gives a warning, and the other fields still
apply. JSON that does not parse gives one warning and applies nothing. There
is no field for bag items, because the simulator holds items only for the
quests of `.collect` lines. Set an item objective's count in `log` instead.
The simulator does not model money or reputation.

## Kills

### Which line counts kills

A `.complete` line counts its objective's kills up to the line's count, else
all that no earlier line counted. Two kinds of line count none at the line:

- A line that `.disablecheckbox` follows. The guide hides its checkbox, so
  it does not expect the line to finish while the step shows. The line
  still marks the objective done, and a later line counts the kills.
- A line in a `#completewith` step. Its kills come from
  [background kills](#background-kills).

`kills=` counts its kills at the line in both cases. The first line that
counts kills sets the mob, unless an earlier line set it with `mob=` or a
`#completewith` step set it with `.mob`, `.target`, or `.unitscan` lines.

The turn-in counts the kills that no line counted, before the quest XP.
Items that `.collect` lines hold still need those kills, because the player
killed for them. Items that an `#ah` step bought need none.

### Drop chance

An item objective needs the kills that give its items at each dropper's
chance. For `x` items and `n` droppers, the expected kills are
`(x / n) * sum(1 / chance)`. The simulator rounds the running total of
expected kills, not each line's share, so partial lines and the turn-in add
up to the kills of one whole line.

`dropChance` in `src/rules/drops.ts` takes the first chance that applies:

1. A source-backed [guaranteed quest
   drop](data-contract.md#guaranteed-quest-drops) has a chance of 1 while the
   quest needs the item.
2. A dropper's [estimated chance](data-contract.md#drop-chances) gives its
   value unchanged.
3. Else the chance is `DEFAULT_DROP_CHANCE`, because the dataset has no
   estimate for that dropper.

The dataset's chance is an estimate, not a measured rate. `drop=` replaces
every dropper's chance, also a guarantee, for the kills of its own line only.

### Shared kills

A step's kills for one objective also drop the items of the item objectives
that the step's `.collect` lines hold or that background kills keep
running. Each kill counts once for each objective, at its dropper's chance,
and never again for its own objective.

The simulator keeps fractional expected items and rounds once, at the next
line that counts kills. Take 4 Chunks of Boar Meat and 6 Crag Boar Ribs,
each at a chance of 0.6 from a Crag Boar. The 7 kills for the meat give 4.2
expected ribs, so the ribs need 3 more kills, 10 in total. A duo needs a
drop for each member. Its 13 kills for the meat give 7.8 expected ribs, and
the ribs need 7 more kills, 20 in total. Rounding down to 7 ribs would add a
kill.

### Grind mob

An `.xp` line or a `level=` checkpoint above the simulated XP is a grind,
which kills mobs until the gap closes. A `level=` in the header grinds only
the route's last killed mob.

A grind override `-- @sim mob=1125,Frostmane Seer` wins over every other
mob source. It also applies to the step's `level=` checkpoints, and an
override on a line replaces the step's. Names can contain spaces. Use IDs
when a name is ambiguous. A mob that the data does not know, or that has no
levels, gives a warning and is left out. Several mobs mean an equal mix in
list order, one kill of each in turn. The estimate stops at the first kill
that covers the gap, and the checkpoint grants exactly the gap.

Without an override, the grind takes the first mob that it finds, in the
order of `nearestMob` in `src/rules/simulate.ts`:

1. The step's `.mob`, `.target`, or `.unitscan` lines.
2. A local mob, from the NPCs with record spawns and the NPCs that the route
   has killed. It must not be elite, must give XP, and must have at least
   two spawns within `grindReach` of the character. The most spawns win,
   then the nearest spawn.
3. The route's last killed mob, when it has at least two spawns in the
   step's kill area. With no spawn data or no position, the grind skips
   step 2 and takes the last mob with no check.
4. A name in `|cRXP_ENEMY_<name>|r` in the line's text. A plural name, such
   as "Frostmane Novices", also matches the singular.

A grind with no mob, or whose mobs give no XP, takes no time and gives a
warning in Playback.

### Background kills

RXP shows a `#completewith` step alongside the steps after it until its
window ends (`addon.UpdateStepCompletion` and `addon:LoadGuide` in
`GuideWindow.lua`). The window lasts through the step that its label names.
For `next`, it lasts through the next step that is not `#completewith` or
`#sticky`. When the label names a `#completewith` step, the window also
lasts through that step's window, because that step shows until its own
window ends.

In the window, the step's `.complete` lines without `kills=`, and its
`.collect` lines, keep their objectives running. RXP tells the player to
kill these mobs on the way, not to go out of the way. So each step in the
window kills the mobs whose spawns lie within the `pass=` distance of its
walk:

- The walk is a straight line through each place that the step
  [travels to](#which-places-cost-travel). A hearth or a flight passes no
  mobs.
- Each spawn gives one kill in each step, and the walk does not wait for a
  respawn. The kills stop when the objective reaches the line's count.
- The mobs are the ones that the line counts, as on any `.complete` line.
  For an item, they are the step's `.mob`, `.target`, and `.unitscan` mobs
  that drop it. Else they are the droppers in the quest's zones, else the
  first dropper.

The simulation runs before ground routing, so the walk does not use the
routed way. Routed legs would make kills, XP, and skipped steps depend on
the routing, and the editor, the CLI, and Playback would not agree.

The simulator places these kills only after it knows the walk. It then pays
each XP gain of the step in act order, at the level reached before it. So a
kill on the way to a turn-in gets the XP of the level before the turn-in,
and kills on the way to a grind shrink its gap.

An objective that the window leaves unfinished stays unfinished. A step
with `.isQuestComplete` for the quest then does not run, as in RXP
(`addon.functions.isQuestComplete` in `functions.lua`), so a later step must
hunt the rest. A turn-in step without that gate stays in RXP until the
player turns the quest in (`addon.functions.turnin`), and the game takes
only a complete quest. So the turn-in counts the kills that are left, as
[Which places cost travel](#which-places-cost-travel) describes.

### Spawns

`npcSpawns` in `src/data/spawns.ts` gives the kill targets of each NPC to
every caller. An NPC record with `spawns` gives that list for every quest
and for grinds. Else the quest's objective points of the NPC give the
targets, and a grind with no quest has none.

Objective points have no spawn ID, and the data cannot tell a repeat
sighting from two mobs that stand close together. So `npcSpawns`
counts close spawns of one NPC as one spawn, for record spawns and objective
points alike. The rule is an estimate. It compares spawn rows with a height
in three dimensions, and only in one interior. Objective points have no
height, so for them the rule does not tell floors apart. The map's spawn
layer uses the same rule.

## Timeline

`simulateRoute` emits the acts of each step in order (`Act` in
`src/rules/character.ts`). An act has no time. Its effects are absolute
values, such as "the objective count is now 3", so an effect applied twice
changes nothing. `advance` applies one effect. The timeline and the replay
change a `SimState` only through `advance`. The simulator also sets a step's
`state=` values and its final level and XP directly.

`buildTimeline` is `simulateRoute` and then `priceRoute`, which prices each
shown step's acts as activities with a start and seconds. `BUCKET` names
the step total that each activity kind counts toward.

`TIMELINE_MODEL` in `src/rules/model.ts` holds every timing constant of the
timeline, each
with its source. A source that starts with "guess" is a guess. When you
calibrate, change only guesses, and record the measurement in the source.

### Line effects

Commands that this list leaves out take no time.

- A point command runs as RXP runs it: as `.goto`, as `.waypoint`, as
  `.ingamewaypoint`, or as a pin. The `point` facet of each command in
  `COMMAND_RULES` (`src/rules/commands.ts`) says which. A line that runs
  as `.goto` or `.waypoint` goes to the place, because RXP's arrow leads
  there (`updateArrowData` in `map.lua`). An `.ingamewaypoint` goes to the
  place too, because RXP sets and tracks the game's own waypoint there. A
  pin adds no travel, because nothing leads to it.
- RXP drops a `.questgoto` or `.questwaypoint` line unless its radius,
  quest ID, and objective index are numbers (`addon.functions.questgoto` in
  `functions.lua`). Such a line is not a point (`droppedPointArg`), and the
  editor warns on it.
- A `.questgoto` or `.questwaypoint` adds no travel, and does not make its
  step travel only to its first place, when its `objMax` is above 0 and the
  character is on the quest with at least `objMax` of the objective. RXP
  skips such a point, so no pin or arrow leads there (`QuestWP` in
  `functions.lua`). The step reads the count that it starts with, because
  RXP also runs the check when the step becomes active.
- `.accept`, `.turnin`, `.home`, `.fp`, `.train`, and `.vendor` take their
  seconds from `TIMELINE_MODEL.interact`. A `.fly` line takes no time of its
  own. Its flight takes the time, which includes `flightOverhead`. An item that
  only objects give takes `gather` seconds each. An item that an NPC sells needs
  no kills.
- `.complete` and `.turnin` kill the kills that they count. `.xp` and
  `level=` grind.
- `.home` binds the Hearthstone where the character stands. Before any
  `.home`, the bind is the first place that the character travels to.
- `.hs` returns to the bind. On cooldown, the character walks to the bind
  or waits, whichever is shorter, with a warning. The cooldown carries
  across guides, so a late `.hs` in one guide can make the next guide wait.

A flight master is in reach within `FLIGHT_MASTER_REACH` of where the
character stands, else of the step's last `.goto`. Each race starts with the
flight masters in its `startingFlightNodes`, because the server grants them
at character creation.

- `.fp` learns a flight master by name. As in RXP (`addon.functions.fp`),
  the name matches text in a full name, ignoring case. Guides also give
  zone names that no full name holds, so a name that starts with a full
  name's town or zone matches too, such as `Redridge Mountains` for
  "Lakeshire, Redridge". When the name matches no flight master, `.fp`
  learns the one in reach, as talking to it does in game. When it matches
  several, `.fp` learns the one in reach if that is one of them. Else the
  line gives a warning.
- `.fly` learns the flight master in reach where it takes off, never the
  one where it lands, because the flight map offers only known flight
  masters. Then, in the same step, it flies to the one flight master that
  its name matches. In a `#completewith` step, it takes off only from a
  flight master in reach, because RXP's `.fly` waits for the player to open
  one.
- A `.fly` walks there with a warning when no flight master is in reach,
  when the character has not learned the destination, or when Playback
  finds no flight to it. A name that matches no flight
  master, or several, gives a warning and does not fly.

### Death skips

`.deathskip` moves the character to the nearest Spirit Healer on the same
world map (`GameData.spiritHealer`). The terrain has no links from death
zones to graveyards, so the nearest healer approximates the game's choice.
The step takes `deathskip` seconds. The simulation models no corpse run,
resurrection sickness, or durability loss. With the Playback setting
**Ignore death skips** on, the simulation skips each `.deathskip` line, and
the next step walks from where the character died.

### Playback settings

`PLAYBACK_SETTINGS` in `src/rules/playbackSettings.ts` lists the player's
Playback settings. The settings type, the defaults, the validator
`readPlaybackChoices`, and the Playback **Settings** menu come from this
list.

`simulateRoute` takes the player's choices as its last argument and keeps
them, with the defaults, on `RouteSimulation.settings`. `priceRoute` and the
Hearthstone rerun read them from there. The Edit preview, `buildTimeline`,
the agent tools, and the scripts pass no choices and get the defaults.

- **Mob respawn** (`respawn`) is the respawn of a step without `respawn=`.
- **Kill area** (`area`) is the kill-area radius of a step without `area=`.
- **Ignore death skips** (`ignoreDeathskip`) skips each `.deathskip`.

To add a setting, add an entry to `PLAYBACK_SETTINGS`, read it in the rule
that it changes, and add a test and a line here. The menu, the saved form,
and the validator need no change.

### Travel gates

RXP completes a step on a `.zoneskip` or `.cooldown` line
(`addon.functions.zoneskip` and `addon.functions.cooldown` in
`functions.lua`). The walk checks each line once, when the step starts.

- `.zoneskip` skips the step when the character stands on one of the listed
  maps, or with an odd flag, such as 1 or 3, on none of them. A position
  keeps the zone map that the guide named for it, also through `.home` and a
  hearth. A position with no guide zone, such as a quest NPC, uses
  `GameData.zoneAt`. The guide's map comes first because `zoneAt` reads
  overlapping map rectangles and can name a neighbor far from a border, such
  as Felwood at Auberdine. An unknown zone lets the step run.
- `.cooldown item,6948` skips the step when more than the threshold is left
  on the Hearthstone, or with `<`, less. A threshold under 2 seconds is 2.
  Other cooldowns pass.

Only the timeline clock knows when the Hearthstone is ready. `simulateRoute`
assumes a ready Hearthstone, or the `hearth` of the step's `state=`. When a
gate goes the other way on the clock, `priceRoute` simulates the route again
with the clock's cooldown at that step and prices it from the start. So the
simulation and the priced timeline always agree. The step list shows the
simulation alone.

### Which places cost travel

RXP completes a step when every element is complete or informational
(`addon.UpdateStepCompletion`). Before a step runs, `completeOnArrival` in
`simulate.ts` checks its elements against the arriving character. If all are
done, the step takes no time, and the character stays in place. Manual `+`
objectives, commands that the simulator does not model, and `@sim kills=`,
`extra=`, or `level=` keep the step active. So do kills that a
`.disablecheckbox` line left to a later line. A line that runs as `.goto`
counts only when it has a positive radius and is not optional
(`addon.functions["goto"]`), and it completes within that radius. Every
other point line is informational.

A line that runs as `.goto` is optional when it has a fifth argument, also
`0`. A `.questgoto` is always optional (`isOptionalPoint`). An optional
point adds no stop. RXP still arrows through an optional point, but the
timeline leaves out that detour. A step with no other stop goes to its last
point, unless it is a `#completewith` step. The fifth `.waypoint` argument
sets arrow priority or a callback, so a line that runs as `.waypoint` is
never optional.

- A step that walks among mobs (`travelMode`) travels only to its first
  place. Such a step has kills of its own, a `.complete` line that names
  mobs, a `#loop` tag, or lines that run as `.waypoint`. RXP shows all lines
  of a step at once, and its arrow leads to the first waypoint
  (`generatePins` and `updateArrowData` in `map.lua`). So the step goes
  there before its kills, also when its `.goto` follows the `.complete`
  line.
- A `#completewith` step travels only to each line that runs as `.goto` or
  `.waypoint` and has a positive radius, and to no quest NPC. RXP lists the
  shown `#completewith` steps first (`addon.SetStep`), and its arrow leads
  to their waypoints first. A waypoint with a positive radius completes when
  the player comes that near (`addon.UpdateGotoSteps`). A radius of 0 with
  no flag has no arrow, and a waypoint with no radius never completes.
- Other steps travel to each place in turn. A step with no place of its own
  goes to the quest NPC before that NPC's `.accept` or `.turnin`, else to
  the guide's last place.

A `.turnin` can count kills that no `.complete` line counted. If a
`.disablecheckbox` line left them to a later line, the player made them on
the way, and the timeline prices them. Otherwise no step shows where or when
the player made them, so they take no time. They still give their XP and
complete their objectives, because RXP keeps the step until the player turns
the quest in. The step gives a warning that suggests `state=`. A guide that
leaves out a kill step can therefore look faster. Read these warnings when
you compare versions of a guide.

### Travel

`buildTimeline` takes a `Travel` function. The timeline gives it a
`TravelLeg`: the start, the end, the mode, and the spawn of an NPC that the
step names, when there is one. The mode is Mount from the mount level
before the step, else Run. The function returns the leg's seconds, its
`source`, and an optional `way`. The timeline copies `way` to the activity
and never reads it, so Playback can draw and replay the way. Rules code
does not import `src/routing`. Playback calls `priceRoute` again on one
simulation for each better set of routed legs. Each price resolves its legs
again, because a longer routed run between kills can change which spawns
the character kills, and so where the next leg starts.

The default, `straightTravel`, takes the straight line times `detour` at
`runSpeed`, and rides in the Mount mode when that is faster. A leg
between maps costs `crossMap`. The route's start has no place, so the first
leg takes no time. A flight takes the straight line times `flightDetour` at
`flightSpeed`, plus `flightOverhead`. Playback takes the routed flight
instead ([Playback](routing.md#playback)).

### Kill time and the kill walk

A kill costs the combat seconds for the mob's color at the level before the
step, times `classSpeed`, times `eliteFactor` for an elite, divided by
`partyDamage`. `rest` adds a fraction for the class. Grind kills use the
middle of the mob's level range.

The kill area keeps a step's kill walk local, so the walk does not cross a
zone to reach a mob. The area is fixed at the step's `near=`, else where
the character stands when the first kill starts.

- Each kill goes to the spawn in the area where its fight can start first,
  counting the wait for a respawn. So a long respawn sends the walk to
  farther spawns, and kills that outnumber the spawns wait. The walk stops
  `pullReach` short of the spawn.
- Respawn timers key on `Spawn.id`. They carry over to later steps and to
  kills for another quest of the same NPC.
- A kill of an NPC with no spawn in the area walks `noSpawnWalk` in place.
  When the NPC has spawns elsewhere on the map, the step gives a warning.
  Add a step that goes there.

A grind walks the NPC's record spawns, else the spawns of the quest that
last killed it. The model leaves out mobs that other players kill.

### Party

A duo has two players of one race, class, and level, who do each step together.
One `SimState` describes each member, so an item count in the quest log is each
member's count. Each member gets half of each kill's XP ([group
experience](https://warcraft.wiki.gg/wiki/Mob_experience#Group_Experience)),
rounded to a whole number. Quest XP is not split.

A monster kill credits both members, so a monster objective needs the same
kills. An item drop credits one member, so an item objective needs a drop
for each member's item. A duo walks farther only because it makes more
kills. **Add step** shows the kills that a new `.complete` line would count
for the guide's party.

### Replay fields

Each `TimelineStep` holds `before`, the character before the step, and its
`activities` in order. `momentAt(timeline, t)` folds the activities'
effects from `before` to give the character at second `t`, with a short
text of what it does. A kill counts when its walk gives its `end`. With no
walk, kill `i` of `n` counts at `start + i/n` of the activity's seconds. The
text counts the party's work, so an item objective counts drops.

`mobsAt(timeline, t, activity)` gives the mobs at second `t`. A mob is dead
from the end of its kill until the step's `respawn` seconds later. A kill
or grind activity also shows the spawns in its kill area that it does not
kill. A pass-by kill activity shows the spawns near the walked line.

### Run it

```sh
pnpm --silent guides:timeline --guide "1-6 Northshire" --race Human --class WARRIOR
```

The header of [`scripts/guides/timeline.ts`](../../scripts/guides/timeline.ts)
lists the flags. The CLI plays solo self-found, as Playback does, and each
guide's header sets its party. Unlike the app, the CLI counts the turn-ins
of the guides that lead to the start guide. With `--travel routing`, a leg
keeps the straight estimate when the search budget runs out, when the map
has no installed routing artifact, or when the search finds no ground path.
The summary counts each fallback by its reason (`routingTravel`).

## While-you're-here opportunities

The opportunity finder reads a simulated guide. At each step that works on
quest objectives, it lists other objectives whose spawns are near. For
example, at a step that kills gnolls for Patrolling Westfall, it can
suggest looting oats for Poor Old Blanchy. Each result has RXP text to paste
into the guide. `findOpportunities` in `src/rules/opportunities.ts` owns the
method, and `scripts/guides/opportunities.ts` runs it.

### Run it

```sh
pnpm --silent guides:opportunities --guide "1-6 Northshire" --race Human --class WARRIOR --ssf --zone 40
```

The header of
[`scripts/guides/opportunities.ts`](../../scripts/guides/opportunities.ts)
lists the flags. Give `--ssf` for Forever, which has no auction house.
Without it, the simulator buys the items of each `#ah` step, so their
objectives are already done. Like the timeline CLI, the run counts the
turn-ins of the guides that lead to the start guide. `--radius`, `--focus`,
and `--min-share` set the options in [Method](#method).

### Method

1. Each shown step reads its applying `.complete` and `.collect` lines,
   which name its objectives. The finder skips a `#completewith` or
   `#sticky` step, which is already an as-you-go step.
2. An objective's spawns are its quest's objective points whose source is
   one of its NPCs, an NPC or object that drops one of its items, or one of
   its items on the ground. The step's area is the spawns of its objectives
   within `focus` yards of its `.goto` points, in the zone that holds most
   of them. A step without `.goto` points uses all the spawns. A step whose
   `.goto` points are all far from the spawns has no area, because the
   player does that step somewhere else, such as at an auction house.
3. A candidate is an objective that is not the step's own and is not
   complete before the step. Its quest is in the log, or the character can
   take it now. A pickup must pass `questAccess` with no lock and must not
   be gray. A quest that the player takes and hands in at one visit, such
   as a cloth donation, is never a pickup.
4. `overlapShare` is the share of the area points that have a spawn of the
   candidate in the step's zone within `radius` yards. The finder drops a
   candidate below `minShare`. `distanceYards` is the shortest distance
   from the area to such a spawn, in world yards (see
   [coordinates.md](coordinates.md)).
5. The finder ranks objectives that are not covered first, then quests in
   the log before pickups, then the overlap share times the share that
   remains, then the distance.

An objective is `covered` when an active `#completewith` or `#sticky` step
before the step names it. The window's kills, or a `#sticky` step's
`.complete` line, can mark it done while the window still works on it. So a
covered objective reads its progress from before the first as-you-go step
that names it. `plannedStep` is the next step that works on the objective,
or that accepts the quest of a pickup.

### Check it against a guide author

The built-in guide 13-15 Westfall has hand-made as-you-go steps. Remove its
`#completewith` and `#sticky` steps, and run the finder on the result for a
Human Warrior with `--ssf`. At each step where the original guide covers an
objective, the finder must suggest that objective.

### Limits

- The finder ignores drop chances, so a quest that guide authors skip for a
  low drop rate still shows.
- A pickup's distance leaves out the trip to its giver.
- An area of one point, such as a chest, gives a share of 1 to each
  candidate within the radius.
- Spawn points show where a mob can spawn, not how many mobs are there.
- The finder does not read `.mob`, `.target`, or `.unitscan` lines, so a
  step that names only mobs has no area.
- After a `#completewith` window ends, the finder reads the simulated
  progress. The simulation credits a lone `#sticky` step's objectives at the
  step, so the finder ends that window from the guide instead. The window
  covers an objective until the first later step, not as you go, whose
  `.complete` or `.collect` line needs at least as many of it as the sticky
  line. A line needs its own count, and a `.complete` line with no count
  needs the objective's count. RXP caps a `.complete` line's count at the
  objective's count. The finder caps a `.collect` line's count the same way,
  because the window covers only the objective. RXP ends the line when the
  game finishes the objective, which can be earlier. With no such step, the
  objective stays covered while its quest is in the log.
