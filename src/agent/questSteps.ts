import {
  centralSpawn,
  locatedSpawns,
  yards,
  type MapLocation,
  type Quest,
  type QuestObjective,
  type QuestPoint,
  type WorldLocation,
} from "../data/index.ts";
import { floorHintText } from "../routing/floorHint.ts";
import type { Faction } from "../rules/index.ts";
import { parsePoint, POINT, pointPlace, type CharacterInput } from "./data.ts";
import { CLASS, FACTION, factionFor, mobsIn, RACE } from "./quests.ts";
import { ToolError, type AgentContext, type Tool } from "./tool.ts";

const TALK = "|Tinterface/worldmap/chatbubble_64grey.blp:20|t";
const color = (kind: "FRIENDLY" | "ENEMY" | "LOOT" | "PICK" | "WARN", text: string) => `|cRXP_${kind}_${text}|r`;
const list = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

const SAME_STEP_YARDS = 200;
const MAX_MOBS = 3;

interface Built {
  kind: "accept" | "objective" | "turnin";
  text: string;
  at?: string;
}

async function giverOrEnderStep(
  ctx: AgentContext,
  quest: Quest,
  points: readonly QuestPoint[],
  role: "accept" | "turnin",
  near: WorldLocation | undefined,
  notes: string[],
): Promise<Built> {
  const verb = role === "accept" ? "Accept" : "Turn in";
  const command = `.${role} ${quest.id} >> ${verb} ${quest.name}`;
  const point = near ? [...points].sort((a, b) => yards(a.world, near) - yards(b.world, near))[0] : points[0];
  if (!point) {
    notes.push(`The data has no place for the ${role === "accept" ? "giver" : "ender"}; find it with npc_find.`);
    return { kind: role, text: ["step", `    ${command}`].join("\n") };
  }
  const place = pointPlace(ctx.game, point);
  const name = point.sourceName;
  const lines = ["step"];
  if (point.sourceType === "item") {
    lines.push(`    >>${color("WARN", "Use the")} ${color("LOOT", name)} ${color("WARN", "to start the quest")}`, `    ${command}`);
    notes.push(`${quest.name} starts from the item ${name}; it drops while you work, so put this line where the item drops.`);
    return { kind: role, text: lines.join("\n") };
  }
  lines.push(`    .goto ${place.goto}`);
  lines.push(point.sourceType === "npc" ? `    >>${TALK}Talk to ${color("FRIENDLY", name)}` : `    >>Click ${color("PICK", name)}`);
  const hint = await ctx.floorHint?.(point.world);
  const floor = hint && floorHintText(hint)?.replace(/ Floors: .*$/, "");
  if (floor) lines.push(`    >>${color("WARN", floor)}`);
  lines.push(`    ${command}`);
  if (point.sourceType === "npc") lines.push(`    .target ${name}`);
  if (points.length > 1 && new Set(points.map((p) => p.sourceId)).size > 1)
    notes.push(`${verb}: ${new Set(points.map((p) => p.sourceName)).size} NPCs or objects serve this quest; the step uses ${name}.`);
  return { kind: role, text: lines.join("\n"), at: place.goto };
}

interface ObjectiveWork {
  objective: QuestObjective;
  points: QuestPoint[];
  center?: { point: QuestPoint; at: MapLocation };
}

function objectiveLines(ctx: AgentContext, quest: Quest, work: ObjectiveWork, faction: Faction | undefined): string[] {
  const { objective: o, points } = work;
  const count = o.count === undefined ? "" : ` (x${o.count})`;
  const { center } = work;
  const near = center ? points.filter((p) => yards(p.world, center.point.world) <= SAME_STEP_YARDS) : points;
  const gotoNpc = center?.point.sourceType === "npc" ? center.point.sourceId : undefined;
  const mobs = mobsIn(ctx, near, faction)
    .sort((a, b) => b.spawns - a.spawns)
    .filter((m, i) => i < MAX_MOBS || m.id === gotoNpc)
    .map((m) => m.name);
  const objects = [...new Set(near.filter((p) => p.sourceType === "object").map((p) => p.sourceName))].slice(0, MAX_MOBS);
  const ground = near.some((p) => p.sourceType === "item");
  const lines: string[] = [];
  if (o.type === "monster") {
    lines.push(`>>Kill ${list(mobs.length ? mobs.map((m) => color("ENEMY", m)) : [color("ENEMY", o.name)])}`);
    lines.push(`.complete ${quest.id},${o.index} --Kill ${o.name}${count}`);
  } else if (o.type === "item") {
    const ways = [
      ...(mobs.length ? [`Kill ${list(mobs.map((m) => color("ENEMY", m)))}`] : []),
      ...(objects.length ? [`Open ${list(objects.map((n) => color("PICK", n)))}`] : []),
      ...(ground ? [`Pick up ${color("PICK", o.name)} on the ground`] : []),
    ];
    lines.push(
      ways.length ? `>>${ways.join(". ")}. Loot them for ${color("LOOT", o.name)}` : `>>Collect ${color("LOOT", o.name)}`,
      `.complete ${quest.id},${o.index} --Collect ${o.name}${count}`,
    );
  } else if (o.type === "object") {
    lines.push(`>>Click ${color("PICK", objects[0] ?? o.name)}`, `.complete ${quest.id},${o.index} --${o.name}${count}`);
  } else {
    lines.push(`>>${o.text ?? o.name}`, `.complete ${quest.id},${o.index} --${o.name}${count}`);
  }
  lines.push(...mobs.map((m) => `.mob ${m}`));
  return lines;
}

const groupCenter = (group: readonly ObjectiveWork[]) => group.find((w) => w.center)?.center;

function groupByArea(works: readonly ObjectiveWork[]): ObjectiveWork[][] {
  const groups: ObjectiveWork[][] = [];
  for (const work of works) {
    const at = work.center?.point.world;
    const group = at
      ? groups.find((g) => {
          const center = groupCenter(g);
          return !center || yards(center.point.world, at) <= SAME_STEP_YARDS;
        })
      : groups[0];
    if (group) group.push(work);
    else groups.push([work]);
  }
  return groups;
}

function objectiveSteps(ctx: AgentContext, quest: Quest, faction: Faction | undefined, notes: string[]): Built[] {
  const works: ObjectiveWork[] = [];
  for (const o of quest.objectives) {
    if (o.index === undefined) {
      notes.push(`Objective "${o.name}" has no index in the data, so no .complete line; check it in game.`);
      continue;
    }
    const located = locatedSpawns(ctx.game, quest, o, faction);
    const points = [...located.keys()];
    const center = centralSpawn(points, quest.zoneIds);
    works.push({ objective: o, points, ...(center && { center: { point: center, at: located.get(center)! } }) });
  }
  for (const t of quest.textObjectives ?? [])
    if (t.need !== "providedItem")
      notes.push(`Text objective "${t.name}"${t.count ? ` (${t.count})` : ""} has no .complete line; describe it with a >> line.`);
  return groupByArea(works).map((group) => {
    const center = groupCenter(group);
    const goto = center && ctx.game.formatLocation(center.at).join(",");
    const lines = group.flatMap((w) => objectiveLines(ctx, quest, w, faction));
    const body = [
      ...(goto ? [`.goto ${goto}`] : []),
      ...lines.filter((l) => !l.startsWith(".mob")),
      ...lines.filter((l) => l.startsWith(".mob")),
    ];
    return { kind: "objective", text: ["step", ...[...new Set(body)].map((l) => `    ${l}`)].join("\n"), ...(goto && { at: goto }) };
  });
}

const questSteps: Tool<{ id: number; race?: CharacterInput["race"]; class?: CharacterInput["class"]; faction?: Faction; near?: string }> = {
  name: "quest_steps",
  description:
    "Ready-to-paste RXP steps for one quest, from the quest data, in the style of RXP's built-in guides: the accept step at the giver (.goto, talk line, .accept, .target), one objective step for each spawn area (.goto at the spawn nearest the middle of the quest zone's spawns, kill or loot line, .complete with counts, .mob), and the turn-in step at the ender. A stacked-floor note joins a step when the host has routing. Use it instead of writing coordinates and quest lines by hand; then merge steps at the same NPC and order the steps across quests. `notes` lists what the data cannot settle.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1, maximum: 10_000_000 },
      race: RACE,
      class: CLASS,
      faction: FACTION,
      near: { ...POINT, description: `Pick the giver and ender nearest this point. ${POINT.description}` },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const faction = factionFor(input);
    const quest = ctx.game.quest(input.id, faction);
    if (!quest) throw new ToolError(`No quest ${input.id} in the data. Use quest_search to find IDs.`);
    const near = input.near === undefined ? undefined : parsePoint(ctx.game, input.near);
    const notes: string[] = [];
    const steps = [
      await giverOrEnderStep(ctx, quest, quest.startPoints, "accept", near, notes),
      ...objectiveSteps(ctx, quest, faction, notes),
      await giverOrEnderStep(ctx, quest, quest.endPoints, "turnin", near, notes),
    ];
    return { id: quest.id, name: quest.name, steps, text: steps.map((s) => s.text).join("\n"), ...(notes.length && { notes }) };
  },
};

export const STEP_TOOLS = [questSteps];
