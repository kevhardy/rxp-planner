import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../data/index.ts";
import { plannerData } from "../data/plannerFixture.ts";
import { parseGuide } from "../guide/index.ts";
import { insertIndex, isOptionalPoint, isRouteStop, stepLocations } from "./points.ts";

let data: GameData;

beforeAll(() => {
  data = plannerData();
});

const firstStep = (body: string) => parseGuide(`#group T\n#name One\nstep\n${body}\n`).steps[0]!;

describe("stepLocations", () => {
  it("places a continent .goto that no zone map covers, keeping its map", () => {
    const { points, problems } = stepLocations(data, firstStep(".goto 1415,44.910,52.030"));
    expect(problems).toEqual([]);
    expect(points).toMatchObject([{ uiMapId: 1415 }]);
    expect([points[0]!.x, points[0]!.y].map((n) => n.toFixed(3))).toEqual(["44.910", "52.030"]);
  });

  it("keeps .line percentages for zone aliases, as RXP's .line handler does", () => {
    const { paths, problems } = stepLocations(data, firstStep(".line StormwindNew,25,25,75,75"));
    expect(problems).toEqual([]);
    expect(paths[0]!.points.map((p) => [data.mapName(p.uiMapId), p.x, p.y])).toEqual([
      ["Stormwind City", 25, 25],
      ["Stormwind City", 75, 75],
    ]);
  });

  it("places .loop coordinates after its range as a closed path", () => {
    const { paths, problems } = stepLocations(
      data,
      firstStep(".line Elwynn Forest,10,10,20,20\n.loop +25,Elwynn Forest,20,20,40,20,30,40"),
    );
    expect(problems).toEqual([]);
    expect(paths.map((p) => [p.command, p.points.map((q) => [data.mapName(q.uiMapId), q.x, q.y])])).toEqual([
      [
        "line",
        [
          ["Elwynn Forest", 10, 10],
          ["Elwynn Forest", 20, 20],
        ],
      ],
      [
        "loop",
        [
          ["Elwynn Forest", 20, 20],
          ["Elwynn Forest", 40, 20],
          ["Elwynn Forest", 30, 40],
        ],
      ],
    ]);
  });

  it("locates Zephras Isle points and paths", () => {
    const step = firstStep(".goto Zephras Isle,43,43.2\n.line 2521,40,40,45,45");
    const located = stepLocations(data, step);
    expect(located.problems).toEqual([]);
    expect(located.points).toMatchObject([{ line: 0, command: "goto", uiMapId: 2521, x: 43, y: 43.2, world: { instance: 2991 } }]);
    expect(located.paths[0]!.points.map((p) => [p.uiMapId, p.x, p.y])).toEqual([
      [2521, 40, 40],
      [2521, 45, 45],
    ]);
  });

  it("reports coordinates Forever cannot place, including the world form in .loop, as RXP's .loop handler does", () => {
    const step = firstStep(".goto Nowhere,1,2\n.goto Mulgore,50\n.loop 25,0/0,20,20");
    expect(stepLocations(data, step).problems).toEqual([
      { line: 0, command: "goto", message: 'RXP has no zone named "Nowhere".' },
      { line: 1, command: "goto", message: 'Coordinates "50," are not numbers.' },
      { line: 2, command: "loop", message: 'RXP has no zone named "0/0".' },
    ]);
  });
});

describe("isOptionalPoint", () => {
  const optional = (line: string) => isOptionalPoint(firstStep(line).body[0]!);

  // `addon.functions.flygoto` passes its arguments to `.goto`, whose sixth argument after the text is `optional`.
  // `addon.functions.questgoto` always passes `.goto` an `optional` of "0" (both in functions.lua).
  it.each([
    [".flygoto Elwynn Forest,48,42,60,0", true],
    [".flygoto Elwynn Forest,48,42,60", false],
    [".questgoto Elwynn Forest,48,42,60,33,1,4", true],
    [".questgoto Elwynn Forest,48,42,60,33,1", true],
  ])("reads %s as optional: %s", (line, expected) => {
    expect(optional(line)).toBe(expected);
  });
});

// `addon.functions.questgoto` and `addon.functions.questwaypoint` in functions.lua read the radius, quest ID, and
// objective index with `tonumber`, and make no element unless all three are numbers.
describe("quest points", () => {
  it.each([
    ["questgoto", "60", []],
    ["questgoto", "far,33,1", []],
    ["questgoto", "60,33", []],
    ["questgoto", "60,33,0b1", []],
    ["questgoto", "60,0x21,1", [0]],
    ["questgoto", "0x1p2,33,1", [0]],
    ["questwaypoint", "60", []],
    ["questwaypoint", "far,33,1", []],
    ["questwaypoint", "60,33", []],
    ["questwaypoint", "60,33,0b1", []],
    ["questwaypoint", "60,0x21,1", [0]],
  ])("places .%s Elwynn Forest,48,42,%s on lines %j", (command, args, lines) => {
    const { points, problems } = stepLocations(data, firstStep(`.${command} Elwynn Forest,48,42,${args}`));
    expect([points.map((p) => p.line), problems]).toEqual([lines, []]);
  });
});

describe("isRouteStop", () => {
  it.each([
    [".goto Elwynn Forest,48,42", true],
    [".goto Elwynn Forest,48,42,60,0", false],
    [".groundgoto Elwynn Forest,48,42", true],
    [".flygoto Elwynn Forest,48,42", true],
    [".questgoto Elwynn Forest,48,42,60,33,1,4", false],
    [".waypoint Elwynn Forest,48,42,60,0", true],
    [".questwaypoint Elwynn Forest,48,42,60,33,1,4", true],
    [".ingamewaypoint Elwynn Forest,48,42", true],
    [".pin Elwynn Forest,48,42,Chest", false],
    [".treasure Elwynn Forest,48,42,48", false],
    [".rare Elwynn Forest,48,42,Mother Fang", false],
    [".accept 33", false],
  ])("reads %s as a stop: %s", (line, expected) => {
    expect(isRouteStop(firstStep(line).body[0]!)).toBe(expected);
  });
});

describe("insertIndex", () => {
  const body = (text: string) => firstStep(text).body;
  const points = body(".goto Elwynn Forest,48,42\n.accept 33\n.waypoint Elwynn Forest,50,40\n.turnin 34");

  it("goes after the selected line when it is a point line", () => {
    expect(insertIndex(points, 0)).toBe(1);
  });

  it("goes after the step's last point line when the selected line is not a point line", () => {
    expect(insertIndex(points, 1)).toBe(3);
  });

  it("goes after the step's last point line when no line is selected", () => {
    expect(insertIndex(points, null)).toBe(3);
  });

  it("goes after the leading tags when the step has no point line", () => {
    expect(insertIndex(body("#completewith next\n.accept 33\n.turnin 34"), null)).toBe(1);
  });

  it("goes at the end of a body of tags only", () => {
    expect(insertIndex(body("#completewith next\n#label start"), null)).toBe(2);
  });
});
