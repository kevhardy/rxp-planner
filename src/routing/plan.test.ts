import { describe, expect, it } from "vitest";
import {
  addDestination,
  addStart,
  cancelDrag,
  clear,
  createPlan,
  DEFAULT_LEG,
  dragStop,
  endDrag,
  insertWaypoint,
  moveStop,
  parseWorldPoint,
  record,
  removeWaypoint,
  reverse,
  setLeg,
  startHistory,
  undo,
  type Leg,
  type PlanHistory,
  type RoutePlan,
  type WorldStop,
} from "./plan.ts";

const terrain: Leg = { ...DEFAULT_LEG };
const flat: Leg = { ...DEFAULT_LEG, downhill: false };
const straight: Leg = { ...DEFAULT_LEG, followTerrain: false, downhill: false };
const straightDownhill: Leg = { ...DEFAULT_LEG, followTerrain: false };

const at = (x: number, y: number, height: number | null = null, instance = 0): WorldStop => ({ instance, x, y, height });

function plan(stops: WorldStop[], legs: Leg[]): RoutePlan {
  return { ...createPlan(at(0, 0), at(0, 0), "p"), stops, legs };
}

const abc = plan([at(100, 100), at(200, 200), at(300, 300)], [straight, flat]);

it("creates a plan with one terrain leg, downhill, damaging falls, flight paths, and ship paths on, fatal falls, lava, and the other faction's rides off, and swimming enabled", () => {
  const fresh = createPlan({ instance: 0, x: -8913.25, y: -133.5, height: null }, { instance: 1, x: 1, y: 2, height: 368 }, "id");
  expect(Object.keys(fresh)).toEqual(["id", "stops", "legs", "settings"]);
  expect(fresh).toMatchObject({
    id: "id",
    stops: [
      { instance: 0, x: -8913.25, y: -133.5, height: null },
      { instance: 1, x: 1, y: 2, height: 368 },
    ],
    legs: [
      {
        followTerrain: true,
        downhill: true,
        damagingFalls: true,
        fatalFalls: false,
        hazards: false,
        otherFaction: false,
        flightPaths: true,
        shipPaths: true,
      },
    ],
  });
  expect(fresh.settings).toMatchObject({ swimming: { enabled: true, speed: 4.7 } });
  expect(fresh.settings.modes.map((mode) => mode.name)).toEqual(["Run", "Mount", "Epic mount", "Ghost Wolf", "Travel Form"]);
});

it("inserts a waypoint into a leg, and both halves keep its settings", () => {
  const next = insertWaypoint(abc, 0, at(150, 150));
  expect(next.stops).toEqual([at(100, 100), at(150, 150), at(200, 200), at(300, 300)]);
  expect(next.legs).toEqual([straight, straight, flat]);
  expect(next.legs[0]).not.toBe(next.legs[1]);
  expect(next).toMatchObject({ id: abc.id, settings: abc.settings });
});

describe("removing a waypoint", () => {
  it.each([
    ["two straight legs stay straight", [straight, straight], straight],
    ["a straight leg and a terrain leg follow terrain", [straight, terrain], flat],
    ["downhill stays on only when both legs had it", [straightDownhill, terrain], terrain],
    ["one leg without downhill turns it off", [terrain, flat], flat],
    [
      "one leg without damaging falls turns them off",
      [terrain, { ...terrain, damagingFalls: false }],
      { ...terrain, damagingFalls: false },
    ],
    ["fatal falls stay on only when both legs had them", [{ ...terrain, fatalFalls: true }, terrain], terrain],
    [
      "lava and slime stay on only when both legs had them",
      [
        { ...terrain, hazards: true },
        { ...flat, hazards: true },
      ],
      { ...flat, hazards: true },
    ],
    ["one leg without lava and slime turns them off", [{ ...terrain, hazards: true }, terrain], terrain],
    [
      "the other faction's rides stay on only when both legs had them",
      [
        { ...terrain, otherFaction: true },
        { ...terrain, otherFaction: true },
      ],
      { ...terrain, otherFaction: true },
    ],
    ["one leg without the other faction's rides turns them off", [{ ...terrain, otherFaction: true }, terrain], terrain],
    ["one leg without flight paths turns them off", [terrain, { ...terrain, flightPaths: false }], { ...terrain, flightPaths: false }],
    ["one leg without ship paths turns them off", [{ ...terrain, shipPaths: false }, terrain], { ...terrain, shipPaths: false }],
  ])("%s", (_, legs, joined) => {
    const next = removeWaypoint(plan(abc.stops, legs), 1);
    expect(next.stops).toEqual([at(100, 100), at(300, 300)]);
    expect(next.legs).toEqual([joined]);
  });

  it("refuses the start and the destination", () => {
    expect(() => removeWaypoint(abc, 0)).toThrow("Only waypoints");
    expect(() => removeWaypoint(abc, 2)).toThrow("Only waypoints");
  });
});

it("moves a stop and keeps every leg's settings", () => {
  const next = moveStop(abc, 2, at(310, 320));
  expect(next.stops).toEqual([at(100, 100), at(200, 200), at(310, 320)]);
  expect(next.legs).toEqual(abc.legs);
  expect(() => moveStop(abc, 3, at(0, 0))).toThrow("No stop 3");
});

it("reads typed coordinates as signed decimal world yards", () => {
  expect(parseWorldPoint(" -8913.25, 34 ")).toEqual({ x: -8913.25, y: 34 });
  expect(() => parseWorldPoint("12")).toThrow("Enter one point as x, y in yards.");
  expect(() => parseWorldPoint("1,2,3")).toThrow("Enter one point as x, y in yards.");
  expect(() => parseWorldPoint("1e3, 2")).toThrow("Enter one point as x, y in yards.");
  expect(() => parseWorldPoint(`${"9".repeat(309)}, 0`)).toThrow("Enter one point as x, y in yards.");
});

it("changes one leg's settings and keeps downhill while a leg is straight", () => {
  const next = setLeg(abc, 1, { followTerrain: false });
  expect(next.legs).toEqual([straight, straight]);
  expect(setLeg(setLeg(plan(abc.stops, [terrain, flat]), 0, { followTerrain: false }), 0, { followTerrain: true }).legs[0]).toEqual(
    terrain,
  );
});

it("reverses the stops and leg settings for Swap to start and Swap to destination", () => {
  const next = reverse(abc);
  expect(next.stops).toEqual([at(300, 300), at(200, 200), at(100, 100)]);
  expect(next.legs).toEqual([flat, straight]);
  expect(reverse(next)).toEqual(abc);
});

it("adds a new start, and the old start becomes the next stop", () => {
  const next = addStart(abc, at(50, 50));
  expect(next.stops).toEqual([at(50, 50), ...abc.stops]);
  expect(next.legs).toEqual([terrain, straight, flat]);
});

it("appends a destination, and the old destination becomes a waypoint", () => {
  const next = addDestination(abc, at(400, 400));
  expect(next.stops).toEqual([...abc.stops, at(400, 400)]);
  expect(next.legs).toEqual([straight, flat, terrain]);
});

it("keeps the map of each stop through every edit", () => {
  const maps = (p: RoutePlan) => p.stops.map((stop) => stop.instance);
  const two = createPlan(at(1, 2), at(3, 4, null, 1), "id");
  const edited = addStart(insertWaypoint(two, 0, at(5, 6, null, 1)), at(7, 8));
  expect(maps(edited)).toEqual([0, 0, 1, 1]);
  expect(maps(reverse(edited))).toEqual([1, 1, 0, 0]);
  expect(maps(removeWaypoint(edited, 2))).toEqual([0, 0, 1]);
  expect(maps(moveStop(edited, 3, at(3, 4)))).toEqual([0, 0, 1, 0]);
  expect(maps(addDestination(edited, at(9, 9, null, 1)))).toEqual([0, 0, 1, 1, 1]);
  const dragged = endDrag(dragStop(startHistory(edited), 3, at(3, 4), "move"));
  expect(dragged.past).toHaveLength(1);
});

it("keeps the height of each stop through every edit", () => {
  const heights = (p: RoutePlan) => p.stops.map((stop) => stop.height);
  const two = createPlan(at(1, 2, 368), at(3, 4), "id");
  const edited = addStart(insertWaypoint(two, 0, at(5, 6, 385.5)), at(7, 8));
  expect(heights(edited)).toEqual([null, 368, 385.5, null]);
  expect(heights(reverse(edited))).toEqual([null, 385.5, 368, null]);
  expect(heights(removeWaypoint(edited, 2))).toEqual([null, 368, null]);
  expect(heights(moveStop(edited, 1, at(1, 2)))).toEqual([null, null, 385.5, null]);
  expect(heights(addDestination(edited, at(9, 9, 397.375)))).toEqual([null, 368, 385.5, null, 397.375]);
  const dragged = endDrag(dragStop(startHistory(edited), 2, at(5, 6, 390), "move"));
  expect(heights(dragged.plan)).toEqual([null, 368, 390, null]);
  expect(dragged.past).toHaveLength(1);
  const back = endDrag(dragStop(startHistory(edited), 2, edited.stops[2]!, "move"));
  expect(back).toEqual(startHistory(edited));
});

it("refuses a stop that is not a world stop, and copies one without other keys", () => {
  expect(() => addDestination(abc, at(1, 2, null, 0.5))).toThrow("Expected a map ID from 0, found 0.5");
  expect(() => addDestination(abc, at(1, 2, null, -1))).toThrow("Expected a map ID from 0, found -1");
  expect(() => insertWaypoint(abc, 0, at(Number.NaN, 0))).toThrow("Expected finite world yards, found NaN, 0");
  expect(() => moveStop(abc, 0, at(0, 0, Number.POSITIVE_INFINITY))).toThrow("Expected a finite height or null, found Infinity");
  expect(() => insertWaypoint(abc, 2, at(0, 0))).toThrow("No leg 2");
  const extra = { ...at(1, 2), map: 7 } as WorldStop;
  expect(addDestination(abc, extra).stops[3]).toEqual({ instance: 0, x: 1, y: 2, height: null });
});

describe("undo", () => {
  it("restores each earlier plan in turn", () => {
    let history: PlanHistory = record(startHistory(abc), insertWaypoint(abc, 0, at(150, 150)), "insert waypoint 1");
    history = record(history, reverse(history.plan), "swap to destination");
    expect(history.past.map((entry) => entry.label)).toEqual(["insert waypoint 1", "swap to destination"]);
    history = undo(history);
    expect(history.plan?.stops[0]).toEqual(at(100, 100));
    history = undo(history);
    expect(history.plan).toBe(abc);
    expect(undo(history)).toEqual(history);
  });

  it("groups a drag into one edit", () => {
    let history = startHistory(abc);
    for (const x of [210, 220, 230]) history = dragStop(history, 1, at(x, 200), "move waypoint 1");
    history = endDrag(history);
    expect(history.plan.stops[1]).toEqual(at(230, 200));
    expect(history.past).toHaveLength(1);
    expect(undo(history).plan).toBe(abc);
  });

  it("ends an open drag before undoing it", () => {
    const history = dragStop(dragStop(startHistory(abc), 1, at(210, 200), "move"), 1, at(220, 200), "move");
    expect(undo(history)).toEqual(startHistory(abc));
  });

  it("starts a new drag after an edit", () => {
    let history = dragStop(startHistory(abc), 1, at(210, 200), "move");
    history = record(history, setLeg(history.plan, 0, { downhill: true }), "change leg 1");
    history = endDrag(dragStop(history, 1, at(220, 200), "move"));
    expect(history.past.map((entry) => entry.label)).toEqual(["move", "change leg 1", "move"]);
  });

  it("cancels a drag without touching earlier edits", () => {
    const edited = record(startHistory(abc), setLeg(abc, 0, { downhill: false }), "change leg 1");
    const dragged = dragStop(dragStop(edited, 1, at(210, 200), "move"), 1, at(200, 200), "move");
    expect(cancelDrag(dragged)).toEqual(edited);
    expect(cancelDrag(edited)).toBe(edited);
  });

  it("clears the plan as one edit, and undo restores it with its earlier edits", () => {
    const edited = record(startHistory(abc), setLeg(abc, 0, { downhill: false }), "change leg 1");
    const cleared = clear(edited);
    expect([cleared.plan, cleared.past.map((entry) => entry.label)]).toEqual([null, ["change leg 1", "clear route"]]);
    expect(undo(cleared)).toEqual(edited);
  });

  it("leaves nothing to undo after a drag that returns the stop to its place", () => {
    let history = dragStop(startHistory(abc), 1, at(210, 200), "move");
    history = endDrag(dragStop(history, 1, at(200, 200), "move"));
    expect(history.past).toEqual([]);
    expect(history.plan).toBe(abc);
  });
});
