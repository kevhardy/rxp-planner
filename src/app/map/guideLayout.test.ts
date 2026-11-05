// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { plannerData } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { zonePoint, ZONES } from "../testing.ts";
import { followedMap, guideLayout, type Layout, type LayoutInput } from "./guideLayout.ts";
import { ELWYNN, stageAt } from "./mapPanelFixture.ts";
import type { Area } from "./MapCanvas.tsx";
import type { QuestSpot } from "./points.ts";
import { terrainSurface } from "./surfaces.ts";

const data = plannerData();
const surface = terrainSurface(data, worldMap, new WeakMap());
const dughan = zonePoint(ZONES.elwynn, 42.11, 65.93, { kind: "turn-in", sourceType: "npc", sourceId: 240, sourceName: "Marshal Dughan" });
const SPOT: QuestSpot = { ...dughan, kind: "end", label: "Turn in Hogger: Marshal Dughan" };

const input = (text: string, change: Partial<LayoutInput> = {}): LayoutInput => ({
  data,
  doc: parseGuide(`#group T\n#name One\n${text}`),
  selection: { step: 0, line: null },
  spots: [],
  areas: [],
  highlight: null,
  showGuide: true,
  previousSteps: "hidden",
  upcomingSteps: "dimmed",
  ...change,
});

describe("guideLayout", () => {
  it("puts the faint steps' pins first, then the selected step's, then quest locations", () => {
    const text =
      "step\n.goto Elwynn Forest,40,40\n.goto Elwynn Forest,45,45\nstep\n.goto Elwynn Forest,50,50\nstep\n.goto Elwynn Forest,55,55\n";
    const laid = guideLayout(surface, input(text, { selection: { step: 1, line: null }, spots: [SPOT], previousSteps: "dimmed" }));
    expect(laid.pins.map((p) => [p.key, p.kind, "spot" in p.target ? p.target.title : [p.target.step, p.target.line]])).toEqual([
      ["p0:0", "previous", [0, null]],
      ["p0:1", "previous", [0, null]],
      ["p2:0", "upcoming", [2, null]],
      ["p1:0", "goto", [1, 0]],
      ["q0", "end", "Turn in Hogger: Marshal Dughan (Elwynn Forest 42.1, 65.9)"],
    ]);
  });

  it("lets only the selected step's .goto and .waypoint pins be dragged", () => {
    const text =
      "step\n.goto Elwynn Forest,40,40\n.waypoint Elwynn Forest,41,41\n.pin Elwynn Forest,42,42\n.questgoto Elwynn Forest,43,43,10,33,1\nstep\n.goto Elwynn Forest,50,50\n";
    const laid = guideLayout(surface, input(text));
    expect(laid.pins.map((p) => [p.key, "drag" in p.target ? p.target.drag?.line : undefined])).toEqual([
      ["p1:0", undefined],
      ["p0:0", 0],
      ["p0:1", 1],
      ["p0:2", undefined],
      ["p0:3", undefined],
    ]);
  });

  it.each([
    ["goto", "goto", ""],
    ["groundgoto", "goto", ""],
    ["flygoto", "goto", ""],
    ["questgoto", "goto", ",10,33,1"],
    ["waypoint", "waypoint", ""],
    ["questwaypoint", "waypoint", ",10,33,1"],
    ["ingamewaypoint", "waypoint", ""],
    ["pin", "goto", ""],
    ["treasure", "goto", ""],
    ["rare", "goto", ",Hogger"],
  ])("draws the selected step's .%s pin as a %s marker", (command, kind, rest) => {
    const laid = guideLayout(surface, input(`step\n.${command} Elwynn Forest,40,40${rest}\n`));
    expect(laid.pins.map((p) => [p.key, p.kind])).toEqual([["p0:0", kind]]);
  });

  it("returns the given areas while nothing is highlighted, and draws a highlighted area last", () => {
    const areas: Area[] = [
      { key: "o2", color: "red", d: "M1 1Z" },
      { key: "o1", color: "blue", d: "M2 2Z" },
    ];
    const text = "step\n.goto Elwynn Forest,40,40\n";
    expect(guideLayout(surface, input(text, { areas })).areas).toBe(areas);
    expect(guideLayout(surface, input(text, { areas, highlight: "o2" })).areas.map((a) => [a.key, a.state])).toEqual([
      ["o1", "dim"],
      ["o2", "focus"],
    ]);
    expect(guideLayout(surface, input(text, { areas, selection: { step: null, line: null } })).areas).toEqual([]);
  });

  it("places a calibrated world-coordinate .goto at its retained zone percentages, and follows its zone", () => {
    const laid = input("step\n.goto 1429/0,-136.48375244,-8933.4649402\n");
    const [pin] = guideLayout(surface, laid).pins;
    expect(pin!.label).toBe("Selected step 1, line 1: .goto Elwynn Forest 48.17, 42.94");
    expect(pin!.at.x).toBeCloseTo(at(48.17, 42.94).x, 6);
    expect(pin!.at.y).toBeCloseTo(at(48.17, 42.94).y, 6);
    expect(followedMap(surface, data, laid.doc, laid.selection, "Alliance")).toBe(1429);
  });

  it("fades optional points and joins only required points", () => {
    const text =
      "step\n.goto Elwynn Forest,20,20,60,0\n.groundgoto Elwynn Forest,30,30,60,1\n.goto Elwynn Forest,40,40\nstep\n.waypoint Elwynn Forest,50,50,60,0\n";
    const laid = guideLayout(surface, input(text));
    expect(pinsOf(laid)).toEqual([
      ["Upcoming step 2: .waypoint Elwynn Forest 50.00, 50.00", at(50, 50), 0.8],
      ["Selected step 1, line 1: .goto Elwynn Forest 20.00, 20.00 (optional)", at(20, 20), 0.45],
      ["Selected step 1, line 2: .groundgoto Elwynn Forest 30.00, 30.00 (optional)", at(30, 30), 0.45],
      ["Selected step 1, line 3: .goto Elwynn Forest 40.00, 40.00", at(40, 40), 1],
    ]);
    expect(shapesOf(laid)).toEqual([["route upcoming", false, [at(40, 40), at(50, 50)], 0.8]]);
  });

  it("leaves pins, treasures, and rares off the route line", () => {
    const text =
      "step\n.goto Elwynn Forest,20,20\n.pin Elwynn Forest,25,25\n.treasure Elwynn Forest,30,30,48\n.rare Elwynn Forest,35,35,Mother Fang\n.goto Elwynn Forest,40,40\n";
    const laid = guideLayout(surface, input(text));
    expect(laid.pins.map((p) => p.label)).toEqual([
      "Selected step 1, line 1: .goto Elwynn Forest 20.00, 20.00",
      "Selected step 1, line 2: .pin Elwynn Forest 25.00, 25.00",
      "Selected step 1, line 3: .treasure Elwynn Forest 30.00, 30.00",
      "Selected step 1, line 4: .rare Elwynn Forest 35.00, 35.00",
      "Selected step 1, line 5: .goto Elwynn Forest 40.00, 40.00",
    ]);
    expect(shapesOf(laid)).toEqual([["route selected", false, [at(20, 20), at(40, 40)], 1]]);
  });

  it("follows the zone of a step that has only a .line, and counts its vertices as points", () => {
    const laid = input("step\n.goto Durotar,50,50\nstep\n.line Elwynn Forest,20,20,40,40\n", { selection: { step: 1, line: null } });
    const layout = guideLayout(surface, laid);
    expect(followedMap(surface, data, laid.doc, laid.selection, "Alliance")).toBe(1429);
    expect(shapesOf(layout)).toEqual([["rxp-line selected", false, [at(20, 20), at(40, 40)], 1]]);
    expect(layout.placed).toBe(2);
  });

  it("follows step 1's first point while a header line is selected, not the step 1 line with the same index", () => {
    const laid = input("step\n.goto Elwynn Forest,40,40\n.goto Durotar,50,50\n", { selection: { step: null, line: 1 } });
    expect(followedMap(surface, data, laid.doc, laid.selection, "Alliance")).toBe(1429);
  });

  it("closes .loop paths and #loop routes but leaves .line paths open", () => {
    const text =
      "step\n#loop\n.goto Elwynn Forest,10,10\n.goto Elwynn Forest,20,10\n.goto Elwynn Forest,20,20\n.line Elwynn Forest,30,30,40,40\n.loop 25,Elwynn Forest,50,50,60,50,60,60\n";
    expect(shapesOf(guideLayout(surface, input(text)))).toEqual([
      ["route selected", true, [at(10, 10), at(20, 10), at(20, 20)], 1],
      ["rxp-line selected", false, [at(30, 30), at(40, 40)], 1],
      ["rxp-line selected", true, [at(50, 50), at(60, 50), at(60, 60)], 1],
    ]);
  });

  it("joins the route through a point the terrain map does not show, and reports that point", () => {
    const laid = guideLayout(surface, input("step\n.goto Elwynn Forest,20,20\n.goto 2524,50,50\n.goto Elwynn Forest,40,40\n"));
    expect(shapesOf(laid)).toEqual([["route selected", false, [at(20, 20), at(40, 40)], 1]]);
    expect(laid.pins.map((p) => p.label)).toEqual([
      "Selected step 1, line 1: .goto Elwynn Forest 20.00, 20.00",
      "Selected step 1, line 3: .goto Elwynn Forest 40.00, 40.00",
    ]);
    expect(laid.problems).toEqual([{ line: 1, command: "goto", message: "The terrain map does not show Darkspear Islands." }]);
  });

  describe("steps around the selection", () => {
    const steps = Array.from({ length: 13 }, (_, i) => `step\n.goto Elwynn Forest,${10 + i * 5},50\n`).join("");
    const FADES = [0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44, 0.38, 0.32, 0.26];
    const round = (fade: number | undefined) => Math.round(fade! * 100) / 100;
    const side = (laid: Layout) =>
      laid.pins.filter((p) => p.kind === "upcoming" || p.kind === "previous").map((p) => [p.text, p.kind, round(p.fade)]);

    it("hides previous steps and dims the ten upcoming ones by default, fading with distance, with a route to each", () => {
      const laid = guideLayout(surface, input(steps, { selection: { step: 2, line: null } }));
      expect(side(laid)).toEqual(FADES.map((fade, i) => [String(i + 4), "upcoming", fade]));
      expect(laid.shapes.map((s) => [s.className, s.points, round(s.fade)])).toEqual(
        FADES.map((fade, i) => ["route upcoming", [at(20 + i * 5, 50), at(25 + i * 5, 50)], fade]),
      );
    });

    it("shows the ten steps after the guide's start as upcoming while no step is selected", () => {
      const laid = guideLayout(surface, input(steps, { selection: { step: null, line: null } }));
      expect(side(laid)).toEqual(FADES.map((fade, i) => [String(i + 1), "upcoming", fade]));
    });

    it("numbers only the given count of upcoming steps, and draws later ones faint, without numbers", () => {
      const laid = guideLayout(surface, input(steps, { selection: { step: 2, line: null }, numberedAhead: 1 }));
      expect(side(laid)).toEqual([["4", "upcoming", 0.8], ...Array.from({ length: 9 }, () => [undefined, "upcoming", 0.35])]);
      expect(laid.shapes.map((s) => round(s.fade))).toEqual([0.8, ...Array<number>(9).fill(0.35)]);
    });
  });
});

const at = (x: number, y: number) => stageAt(ELWYNN, x, y);
const pinsOf = (laid: Layout) => laid.pins.map((p) => [p.label, p.at, p.fade]);
const shapesOf = (laid: Layout) => laid.shapes.map((s) => [s.className, s.closed, s.points, s.fade]);
