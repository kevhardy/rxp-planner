import { describe, expect, it } from "vitest";
import { argSpecAt, COMMANDS, TAGS } from "./catalog.ts";
import { parseLine } from "./parse.ts";

function argNames(raw: string): (string | undefined)[] {
  const line = parseLine(raw);
  if (line.kind !== "command") throw new Error(`Not a command: ${raw}`);
  const spec = COMMANDS.get(line.name);
  if (!spec) throw new Error(`Not cataloged: ${line.name}`);
  return line.args.map((_, i) => argSpecAt(spec, i)?.name);
}

describe("argSpecAt", () => {
  it.each<[string, (string | undefined)[]]>([
    [".collect 5075", ["itemId"]],
    [".collect 769,10,2178,1,0x20,cooking", ["itemId", "count", "questId", "objectiveFlags", "flags", "profession"]],
    [
      ".collect 2589,20,0,0,0x20,tailoring,2,50,120",
      ["itemId", "count", "questId", "objectiveFlags", "flags", "profession", "multiplier", "skillStart", "minimum"],
    ],
    [".accept 5092,2,5091", ["questId", "flags", "requiredTurnIn"]],
    [
      ".waypoint Durotar,52.1,43.2,20,OnEvent,QUEST_ACCEPTED,QUEST_TURNED_IN",
      ["zone", "x", "y", "radius", "lowPriorityOrCallback", "event", "event"],
    ],
    [".waypoint Durotar,52.1,43.2,20,0", ["zone", "x", "y", "radius", "lowPriorityOrCallback"]],
    [".aura 1234,<60", ["spellId", "check"]],
    [".aura -1234,3+,target", ["spellId", "check", "unit"]],
    [".goto Durotar,52.1,43.2,20,0", ["zone", "x", "y", "radius", "optional"]],
    // RXP ignores a sixth `.goto` argument.
    [".goto 1420/0,1714.76,1760.68,40,0,0", ["zone", "x", "y", "radius", "optional", undefined]],
    [".questwaypoint Durotar,52.1,43.2,20,4641,1,8,1", ["zone", "x", "y", "radius", "questId", "objective", "max", "lowPriority"]],
    // RXP passes `.questgoto`'s eighth argument to a `.goto` position that it ignores.
    [".questgoto Durotar,52.1,43.2,20,4641,1,8,1", ["zone", "x", "y", "radius", "questId", "objective", "max", undefined]],
    [".pin Durotar,52.1,43.2,Kolkar camp", ["zone", "x", "y", "tooltip"]],
    [".ingamewaypoint Durotar,52.1,43.2,Kolkar camp", ["zone", "x", "y", undefined]],
    [".treasure Durotar,52.1,43.2,31408", ["zone", "x", "y", "questId"]],
    [".rare Durotar,52.1,43.2,Kazon", ["zone", "x", "y", "npc"]],
    [".emote WAVE", ["emote"]],
    [".cooldown pet,17253,<5s,1", ["type", "id", "remaining", "updateOnce"]],
    [".target Grimtotem Mercenary;Kodo", ["npc", "npc"]],
    [".loop 25,Elwynn Forest,20,20,40,20", ["range", "zone", "x", "y", "x", "y"]],
  ])("names the arguments of %s", (raw, names) => {
    expect(argNames(raw)).toEqual(names);
  });

  it("marks the new optional arguments", () => {
    const optional = (command: string, index: number) => argSpecAt(COMMANDS.get(command)!, index)?.optional;
    expect(optional("collect", 1)).toBe(true);
    expect(optional("accept", 2)).toBe(true);
    expect(optional("emote", 1)).toBe(true);
    expect(optional("fly", 0)).toBe(true);
  });
});

describe("titles", () => {
  it.each([
    ["commands", [...COMMANDS.values()]],
    ["tags", [...TAGS.values()]],
  ])("gives every one of the %s a title of its own", (_, specs) => {
    const titles = specs.map((s) => s.title.trim());
    expect(titles.filter((t) => t === "")).toEqual([]);
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  it("names misspelled tags as misspelled", () => {
    const misspelled = [...TAGS.values()].flatMap((t) => (t.misspellingOf ? [t.title] : []));
    expect(misspelled).toEqual(["Complete with (misspelled)", "Softcore only (misspelled)"]);
  });
});
