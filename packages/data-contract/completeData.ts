import type { GameDataFile, QuestRow, ZoneHitGrid, ZoneRecord } from "./model.ts";
import type { EntityDataFile } from "./entities.ts";
import { validateEntityDataFile, validateGameDataFile } from "./validation.ts";
import { worldBounds } from "./geometryValidation.ts";
import {
  fields,
  finite,
  natural,
  positive,
  integer,
  object,
  name,
  text,
  boolean,
  list,
  optional,
  nullable,
  oneOf,
  idDictionary,
  requireValid,
  unique,
  world,
  faction,
  type Check,
} from "./checks.ts";

const names = list(text),
  ids = list(positive);
const ascending = (v: unknown): v is number[] => ids(v) && v.every((id, i, all) => i === 0 || all[i - 1]! < id);
const ascendingIds: Check = (v) => ascending(v) && v.length > 0;
const range: Check = (v) => fields(v, { min: natural, max: natural }) && v.min <= v.max;
const items = list((v) => fields(v, { item: positive, count: positive }));
const chance: Check = (v) => finite(v) && v > 0 && v <= 1;
const absent: Check = (v) => v === undefined;
const withoutLootCounts = { loot: absent, count: absent, outof: absent };
const reputation: Check = (v) => fields(v, { faction: positive, value: integer });
const changes: Check = (v) => {
  if (!fields(v, { status: oneOf("new", "updated", "unchanged", "unconfirmed"), labels: names, lines: names, notShown: optional(names) }))
    return false;
  const { labels, lines, notShown = [] } = v;
  let at = 0;
  return unique(labels) && notShown.every((line) => (at = lines.indexOf(line, at) + 1) > 0);
};
const standings: Check = (v) =>
  list((s) => fields(s, { name, min: integer }))(v) &&
  v.length > 0 &&
  unique(v.map((s) => s.name)) &&
  v.every((s, i, all) => i === 0 || all[i - 1]!.min < s.min);
const point: Check = (v) =>
  fields(v, {
    zoneId: positive,
    x: finite,
    y: finite,
    kind: oneOf("start", "turn-in", "mob", "item", "object", "trigger", "extra"),
    sourceType: oneOf("npc", "object", "item", "trigger", "extra"),
    sourceId: optional(positive),
    sourceName: text,
    association: optional(natural),
    uiMapId: positive,
    world,
  });
const objective: Check = (v) =>
  fields(v, {
    index: optional(positive),
    type: name,
    id: nullable(positive),
    ids,
    name: text,
    text: optional(text),
    count: optional(positive),
    need: optional(oneOf("kills", "providedItem", "action")),
  });
const captured = list((v) =>
  fields(v, {
    text,
    quantity: optional(positive),
    links: list((l) => fields(l, { type: oneOf("npc", "object", "item", "spell"), id: positive })),
  }),
);
const questFields = {
  id: positive,
  name,
  requiredLevel: nullable(natural),
  questLevel: nullable((v) => v === -1 || natural(v)),
  requiredRaceMask: nullable(natural),
  requiredClassMask: nullable(natural),
  requiredFaction: optional(nullable(faction)),
  raceRequirement: text,
  classRequirement: text,
  zoneIds: ids,
  types: names,
  preQuestGroup: nullable(ids),
  preQuestSingle: nullable(ids),
  nextQuestInChain: nullable(natural),
  baseXp: nullable(natural),
  startPoints: list(point),
  endPoints: list(point),
  objectiveText: names,
  objectives: list(objective),
  objectivePoints: list(point),
  changes: optional(changes),
  rewardItems: optional(items),
  rewardChoices: optional(items),
  rewardReputation: optional(list(reputation)),
  rewardMoney: optional(natural),
  capturedObjectives: optional(captured),
  capturedObjectiveText: optional((v) => fields(v, { text, limitation: oneOf("text-nodes-before-first-element") })),
  textObjectives: optional(
    list((v) =>
      fields(v, {
        name: text,
        count: optional(positive),
        need: oneOf("kills", "providedItem", "action"),
        link: optional((l) => fields(l, { kind: oneOf("npc", "item"), id: positive })),
      }),
    ),
  ),
  exclusiveTo: optional(ids),
  parentQuest: optional(natural),
  requiredMaxLevel: optional(natural),
  requiredSkill: optional(nullable((v) => fields(v, { skill: positive, value: natural }))),
  requiredMinRep: optional(nullable(reputation)),
  requiredMaxRep: optional(nullable(reputation)),
  requiredSpecialization: optional(natural),
  observation: optional((v) => fields(v, { source: name, capturedAt: name, partial: oneOf(true) })),
} satisfies Record<Exclude<keyof QuestRow, "provenance" | "byFaction">, Check>;
const rect: Check = (v) => fields(v, { left: finite, top: finite, width: (n) => finite(n) && n > 0, height: (n) => finite(n) && n > 0 });
const hitGrid = (g: unknown): g is ZoneHitGrid => {
  if (!fields(g, { width: positive, height: positive, alphabet: text, zoneIds: list(natural), rows: names })) return false;
  return (
    g.zoneIds[0] === 0 &&
    unique(g.zoneIds) &&
    unique(Array.from(g.alphabet)) &&
    g.zoneIds.length <= g.alphabet.length &&
    g.rows.length === g.height &&
    g.rows.every(
      (r) =>
        r.length === g.width &&
        Array.from(r).every((c) => {
          const index = g.alphabet.indexOf(c);
          return index >= 0 && index < g.zoneIds.length;
        }),
    )
  );
};
const spawns: Check = (v) => {
  if (!list(object)(v)) return false;
  const all = v as { guid?: number; world: { x: number; y: number } }[];
  const firstPlace = all.findIndex((s) => !Object.hasOwn(s, "guid"));
  const [confirmed, places] = firstPlace < 0 ? [all, []] : [all.slice(0, firstPlace), all.slice(firstPlace)];
  return (
    confirmed.length > 0 &&
    confirmed.every(
      (s, i) => fields(s, { world, z: finite, guid: positive, interior: optional(name) }) && (i === 0 || confirmed[i - 1]!.guid! < s.guid),
    ) &&
    places.every((s, i) => {
      const before = places[i - 1]?.world;
      return (
        fields(s, { world }) &&
        Object.keys(s).length === 1 &&
        (!before || before.x < s.world.x || (before.x === s.world.x && before.y < s.world.y))
      );
    })
  );
};
const factionValue =
  (check: Check): Check =>
  (v) =>
    check(v) ||
    (fields(v, { byFaction: (f) => fields(f, { Alliance: check, Horde: check }) }) &&
      object(v) &&
      object(v.byFaction) &&
      Object.keys(v).length === 1 &&
      Object.keys(v.byFaction).length === 2 &&
      JSON.stringify(v.byFaction.Alliance) !== JSON.stringify(v.byFaction.Horde));

const unchecked = (entry: unknown, key: string): unknown => (entry as Record<string, unknown>)[key];

/** Finished bundles require every row's fields; `validateGameDataFile` also accepts producer intermediates. */
export function validateCompleteGameData(input: unknown): asserts input is GameDataFile {
  validateGameDataFile(input);
  requireValid(
    positive(input.maxLevel) && input.quests.length && input.zones.length && input.continents.length,
    "complete game data coverage",
  );
  for (const row of input.quests) {
    requireValid(fields(row, questFields), `quest ${String(row.id)} fields`);
    for (const facts of Object.values(row.byFaction ?? {})) {
      requireValid(
        Object.keys(facts).every((key) => key === "provenance" || Object.hasOwn(questFields, key)),
        `quest ${row.id} faction fields`,
      );
      requireValid(fields({ ...row, ...facts }, questFields), `quest ${row.id} faction values`);
    }
    const quest = row as QuestRow;
    for (const facts of [quest, ...Object.values(quest.byFaction ?? {})]) {
      const indices = (facts.objectives ?? []).flatMap((o) => (o.index === undefined ? [] : [o.index]));
      requireValid(unique(indices), `quest ${row.id} objective indices`);
    }
  }
  requireValid(
    unique(input.zones.map((z) => unchecked(z, "id"))) &&
      unique(input.continents.map((c) => unchecked(c, "instance"))) &&
      unique(input.continents.map((c) => unchecked(c, "uiMapId"))),
    "map identities",
  );
  for (const z of input.zones) {
    requireValid(
      fields(z, {
        id: positive,
        uiMapId: optional(positive),
        name,
        category: oneOf("city", "zone", "dungeon", "raid", "battleground", "other"),
        instance: natural,
        bounds: optional(worldBounds),
        minLevel: optional(natural),
        maxLevel: optional(natural),
      }),
      `zone ${String(unchecked(z, "id"))}`,
    );
    const { minLevel, maxLevel, bounds, instance } = z;
    requireValid(
      (minLevel === undefined || maxLevel === undefined || minLevel <= maxLevel) && (bounds === undefined || bounds.instance === instance),
      `zone ${String(unchecked(z, "id"))}`,
    );
  }
  const zoneIds = new Set(input.zones.map((z) => (z as ZoneRecord).id));
  for (const c of input.continents) {
    requireValid(
      fields(c, { instance: natural, uiMapId: positive, name, crop: rect, hitGrid }),
      `continent ${String(unchecked(c, "uiMapId"))}`,
    );
    requireValid(
      c.hitGrid.zoneIds.every((id) => id === 0 || zoneIds.has(id)),
      `continent ${String(unchecked(c, "uiMapId"))} zone reference`,
    );
  }
  requireValid(idDictionary(text)(input.npcNames), "NPC names");
  requireValid(optional(idDictionary(ascendingIds))(input.raceClasses), "race classes");
  requireValid(optional(idDictionary((v) => fields(v, { name, faction: optional(faction), world })))(input.flightNodes), "flight nodes");
  requireValid(optional(idDictionary(name))(input.factionNames), "faction names");
  requireValid(
    optional(idDictionary((v) => fields(v, { fileName: name, faction, maskBit: optional((b) => natural(b) && b < 53) })))(input.races),
    "races",
  );
  requireValid(optional(idDictionary((v) => fields(v, { fileName: name })))(input.classes), "classes");
  requireValid(
    optional(idDictionary((v) => fields(v, { name, noSpecialization: optional(oneOf(true)) })))(input.professions),
    "professions",
  );
  requireValid(optional(standings)(input.standings), "standings");
  requireValid(optional((v) => list(positive)(v) && v.length === input.maxLevel - 1)(input.xpToNextLevel), "XP to next level");
  const { raceClasses, races, classes, professions, flightNodes } = input as Pick<
    GameDataFile,
    "raceClasses" | "races" | "classes" | "professions" | "flightNodes"
  >;
  requireValid(unique(Object.values(races ?? {}).map((r) => JSON.stringify([r.fileName, r.faction]))), "races");
  requireValid(unique(Object.values(races ?? {}).flatMap((r) => (r.maskBit === undefined ? [] : [r.maskBit]))), "race mask bits");
  requireValid(unique(Object.values(classes ?? {}).map((c) => c.fileName)), "classes");
  if (raceClasses && races)
    requireValid(
      Object.keys(raceClasses).every((id) => Object.hasOwn(races, id)),
      "race classes race reference",
    );
  if (raceClasses && classes)
    requireValid(
      Object.values(raceClasses).every((ids) => ids.every((id) => Object.hasOwn(classes, id))),
      "race classes class reference",
    );
  for (const { faction: raceFaction, startingFlightNodes } of Object.values(races ?? {})) {
    if (startingFlightNodes === undefined) continue;
    requireValid(ascending(startingFlightNodes), "race starting flight nodes");
    requireValid(
      flightNodes &&
        startingFlightNodes.every((id) => Object.hasOwn(flightNodes, id) && (flightNodes[id]!.faction ?? raceFaction) === raceFaction),
      "race starting flight node reference",
    );
  }
  if (professions)
    for (const quest of input.quests as QuestRow[])
      for (const facts of [quest, ...Object.values(quest.byFaction ?? {})])
        requireValid(
          [facts.requiredSkill?.skill, facts.requiredSpecialization].every((key) => !key || Object.hasOwn(professions, key)),
          `quest ${quest.id} profession reference`,
        );
  requireValid(
    optional(
      idDictionary((v) =>
        fields(v, {
          levels: optional(range),
          elite: optional(boolean),
          zoneIds: optional(factionValue(ids)),
          spawns: optional(spawns),
        }),
      ),
    )(input.npcs),
    "NPC records",
  );
  requireValid(
    optional(
      idDictionary(
        factionValue(
          list((v) =>
            fields(v, {
              type: oneOf("npc", "object", "item"),
              id: positive,
              objectiveExcluded: optional(oneOf(true)),
              chance: optional(chance),
              ...withoutLootCounts,
            }),
          ),
        ),
      ),
    )(input.droppers),
    "item droppers",
  );
  requireValid(
    optional(idDictionary((v) => list((s) => fields(s, { id: positive }))(v) && unique(v.map((s) => s.id))))(input.sellers),
    "item sellers",
  );
}

export function validateCompleteEntityData(input: unknown): asserts input is EntityDataFile {
  validateEntityDataFile(input);
  requireValid(Object.keys(input.entities).length === 5, "entity categories");
  for (const records of Object.values(input.details ?? {}))
    for (const [id, detail] of Object.entries(records)) requireValid(optional(changes)(detail.changes), `entity ${id} changes`);
}
