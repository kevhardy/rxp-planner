import { describe, expect, it } from "vitest";
import type { WorldLocation } from "../../packages/data-contract/geometry.ts";
import type { Interior } from "../../packages/data-contract/interiors.ts";
import { groundSurfaces, interiorsFixture } from "../data/manifestFixture.ts";
import { fromSurfaces, type SurfaceMap } from "../data/surfaces.ts";
import type { LoadedInteriors } from "../data/worldMap.ts";
import { RouteEditor, type Floors } from "./editor.ts";
import { createPlan, insertWaypoint, reverse, withHeight, type RoutePlan, type WorldStop } from "./plan.ts";

const { interiors: file, surfaces } = interiorsFixture();
const at = (id: string, bounds: Interior["bounds"], extra: Partial<Interior>): Interior => ({
  ...file.interiors[0]!,
  id,
  bounds,
  places: [],
  ...extra,
});
const city = at("stormwind", { north: -8081.93, south: -9344.89, west: 1438.14, east: 208.17 }, { kind: "city", heightBase: 30 });
const hall = at(
  "stormwind-harbor-66885945",
  { north: -8490.09, south: -8526.35, west: 1338.16, east: 1292.05 },
  { kind: "building", heightBase: 5 },
);
const built = new Map([city, hall].map((interior) => [interior.id, fromSurfaces(interior, surfaces)]));
const inMemory: LoadedInteriors = {
  list: [city, hall],
  image: async (path) => `blob:${path}`,
  surfaces: async (interior) => built.get(interior.id)!,
  loadedSurfaces: (interior) => built.get(interior.id),
};

function loadLater() {
  const memory = new Map<string, SurfaceMap>();
  let settle = (_error?: Error) => {};
  const interiors: LoadedInteriors = {
    ...inMemory,
    loadedSurfaces: (interior) => memory.get(interior.id),
    surfaces: (interior) =>
      new Promise((resolve, reject) => {
        settle = (error) => {
          if (error) return reject(error);
          memory.set(interior.id, built.get(interior.id)!);
          resolve(built.get(interior.id)!);
        };
      }),
  };
  const release = async (error?: Error) => {
    settle(error);
    await new Promise((resolve) => setTimeout(resolve));
  };
  return { interiors, release };
}

const spot = (location: WorldLocation, height?: number): WorldStop => withHeight(location, height ?? null);
const floors = (interiors: LoadedInteriors = inMemory, inside = true): Floors => ({ interiors, inside });
const heights = (p: RoutePlan) => p.stops.map((stop) => stop.height);

const pixel = ({ bounds: b }: Interior, col: number, row: number, width = 4, height = 2) => ({
  instance: 0,
  x: b.west - ((col + 0.5) * (b.west - b.east)) / width,
  y: b.north - ((row + 0.5) * (b.north - b.south)) / height,
});
const inHall = (col: number, row: number, height?: number) => spot(pixel(hall, col, row), height);
const inCity = (height?: number) => spot(pixel(city, 0, 1), height);
const outside = () => spot({ instance: 0, x: 62, y: -9464 });

const editing = (...stops: WorldStop[]) => {
  const errors: unknown[] = [];
  const editor = new RouteEditor((error) => errors.push(error));
  const ends = createPlan(stops[0]!, stops.at(-1)!, "plan");
  const plan = stops.slice(1, -1).reduce((p, stop, i) => insertWaypoint(p, i, stop), ends);
  editor.open(plan);
  return { editor, errors, plan };
};
const plan = (editor: RouteEditor) => editor.get().history!.plan!;

const placedHeight = (where: Floors, stop: WorldStop, before?: WorldStop) => {
  let placed: WorldStop | undefined;
  new RouteEditor(() => {}).place(where, stop, before, (p) => (placed = p));
  return placed?.height;
};
const movedHeight = (where: Floors, from: WorldStop, to: WorldStop, before = outside()) => {
  const { editor } = editing(before, from, outside());
  editor.move(where, 1, to, "edit waypoint 1", () => {});
  return plan(editor).stops[1]!.height;
};

describe("the height of a new stop", () => {
  it("is the ground, the lowest of the surfaces at the point", () => {
    expect([placedHeight(floors(), inHall(1, 0)), placedHeight(floors(), inHall(2, 1))]).toEqual([13, 36.125]);
  });

  it("is the surface nearest the height of the stop before it in the same interior", () => {
    expect([placedHeight(floors(), inHall(1, 0), inHall(2, 1, 42.375)), placedHeight(floors(), inHall(1, 0), inHall(2, 1, 15))]).toEqual([
      30, 13,
    ]);
  });

  it("is the ground after a stop with a null height or in another interior", () => {
    expect([placedHeight(floors(), inHall(1, 0), inHall(2, 1)), placedHeight(floors(), inHall(1, 0), inCity(55))]).toEqual([13, 13]);
  });

  it("is the ground after a stop on another map", () => {
    expect(placedHeight(floors(), inHall(1, 0), { ...pixel(hall, 2, 1), instance: 1, height: 42.375 })).toBe(13);
  });

  it("is null with the inside map off, or outside every interior", () => {
    expect([placedHeight(floors(inMemory, false), inHall(1, 0), inHall(2, 1, 42.375)), placedHeight(floors(), outside())]).toEqual([
      null,
      null,
    ]);
  });
});

describe("the height of a moved stop", () => {
  it("is the surface at the new point nearest its old height in the same interior", () => {
    expect([
      movedHeight(floors(), inHall(2, 1, 42.375), inHall(1, 0)),
      movedHeight(floors(), inHall(2, 1, 36.125), inHall(1, 1)),
      movedHeight(floors(inMemory, false), inHall(2, 1, 36.125), inHall(1, 0)),
    ]).toEqual([30, 32.375, 30]);
  });

  it("stays null in the same interior", () => {
    expect(movedHeight(floors(), inHall(2, 1), inHall(1, 0))).toBeNull();
  });

  it("is a new stop's height after the stop before it when it leaves its interior", () => {
    expect([
      movedHeight(floors(), inHall(2, 1, 42.375), inCity()),
      movedHeight(floors(), inHall(2, 1, 42.375), inCity(), inCity(60)),
      movedHeight(floors(inMemory, false), inHall(2, 1, 42.375), inCity()),
      movedHeight(floors(), inHall(2, 1, 42.375), outside()),
    ]).toEqual([38, 55, null, null]);
  });

  it("is null far from every surface of an interior with one surface pixel, and the surface within reach of it", () => {
    const den = at(
      "the-grizzled-den-350747",
      { north: -5347.81, south: -5648.57, west: -81.39, east: -411.18 },
      { label: "The Grizzled Den", heightBase: 343 },
    );
    const lone = fromSurfaces(den, groundSurfaces({ width: 8, height: 1, values: Uint16Array.of(313, 0, 0, 0, 0, 0, 0, 0) }));
    const where = floors({ ...inMemory, list: [den], loadedSurfaces: () => lone });
    const inDen = (col: number, height?: number) => spot(pixel(den, col, 0, 8, 1), height);
    expect([placedHeight(where, inDen(5)), placedHeight(where, inDen(2)), movedHeight(where, inDen(0, 382), inDen(3))]).toEqual([
      null,
      382,
      null,
    ]);
  });
});

describe("stop edits while surfaces load", () => {
  it("places the stop once its interior's surfaces load, and refuses every other edit until then", async () => {
    const { interiors, release } = loadLater();
    const { editor, plan: opened } = editing(outside(), inHall(2, 1, 42.375), outside());
    const placed: (number | null)[] = [];
    expect(editor.place(floors(interiors), inHall(1, 0), undefined, (p) => placed.push(p.height))).toBe(true);
    const waiting = editor.get();
    expect([placed, waiting.loading?.id]).toEqual([[], hall.id]);
    expect([
      editor.edit(reverse, "swap to destination"),
      editor.open(null),
      editor.undo(),
      editor.clear(),
      editor.setPending(outside()),
      editor.drag(1, inHall(1, 1), "move waypoint 1"),
      editor.cancelDrag(),
      editor.place(floors(), outside(), undefined, (p) => placed.push(p.height)),
      editor.move(floors(), 1, outside(), "move waypoint 1", () => {}),
    ]).toEqual([false, false, false, undefined, false, false, false, false, false]);
    expect(editor.get()).toBe(waiting);
    await release();
    expect([placed, editor.get()]).toEqual([
      [13],
      { history: { plan: opened, past: [], dragging: false }, pending: null, loading: null, plans: null },
    ]);
    expect(editor.edit(reverse, "swap to destination")).toBe(true);
  });

  it("places a stop at once with the inside map off, without a load", () => {
    const { interiors } = loadLater();
    const { editor } = editing(outside(), outside());
    let placed: WorldStop | undefined;
    editor.place(floors(interiors, false), inHall(1, 0), undefined, (p) => (placed = p));
    expect([placed?.height, editor.busy]).toEqual([null, false]);
  });

  it("drops a dragged stop on the surface nearest its height before the drag once the surfaces load, as one edit", async () => {
    const { interiors, release } = loadLater();
    const { editor } = editing(outside(), inHall(2, 1, 42.375), outside());
    let moved = 0;
    editor.drag(1, inCity(), "move waypoint 1");
    editor.move(floors(interiors), 1, inHall(1, 0), "move waypoint 1", () => moved++);
    expect([moved, editor.busy]).toEqual([0, true]);
    await release();
    const { history } = editor.get();
    expect([heights(history!.plan!), history!.past.map((p) => p.label), history!.dragging, moved]).toEqual([
      [null, 30, null],
      ["move waypoint 1"],
      false,
      1,
    ]);
  });

  it("returns a dragged stop to where it was when the surfaces fail to load, with nothing to undo", async () => {
    const { interiors, release } = loadLater();
    const { editor, errors, plan: opened } = editing(outside(), inHall(2, 1, 42.375), outside());
    let moved = 0;
    editor.drag(1, inHall(1, 0), "move waypoint 1");
    editor.move(floors(interiors), 1, inHall(1, 0), "move waypoint 1", () => moved++);
    expect([plan(editor).stops[1]!.height, editor.get().history!.dragging, editor.busy]).toEqual([42.375, true, true]);
    const failure = new Error("Invalid height map checksum");
    await release(failure);
    expect([editor.get().history, errors, moved]).toEqual([{ plan: opened, past: [], dragging: false }, [failure], 0]);
    expect(editor.edit(reverse, "swap to destination")).toBe(true);
  });

  it("places no new stop when the surfaces fail to load", async () => {
    const { interiors, release } = loadLater();
    const { editor, errors } = editing(outside(), outside());
    const placed: WorldStop[] = [];
    editor.place(floors(interiors), inHall(1, 0), undefined, (p) => placed.push(p));
    await release(new Error("Invalid height map checksum"));
    expect([placed, errors.length, editor.busy]).toEqual([[], 1, false]);
  });
});

describe("stop moves and undo", () => {
  it("makes a drag one undoable edit on the surface nearest the stop's height before the drag", () => {
    const { editor, plan: opened } = editing(outside(), inHall(2, 1, 42.375), outside());
    editor.drag(1, inCity(), "move waypoint 1");
    const to = inHall(1, 0);
    let moved = 0;
    editor.move(floors(), 1, to, "move waypoint 1", () => moved++);
    const { history } = editor.get();
    expect([history!.plan!.stops[1], heights(history!.plan!), history!.past.map((p) => p.label), history!.dragging, moved]).toEqual([
      { ...to, height: 30 },
      [null, 30, null],
      ["move waypoint 1"],
      false,
      1,
    ]);
    editor.undo();
    expect(editor.get().history).toEqual({ plan: opened, past: [], dragging: false });
  });

  it("makes a coordinate entry one undoable edit", () => {
    const { editor } = editing(outside(), inHall(2, 1, 42.375), outside());
    editor.move(floors(), 1, inHall(1, 1), "edit waypoint 1", () => {});
    expect([heights(plan(editor)), editor.get().history!.past.map((p) => p.label)]).toEqual([[null, 32.375, null], ["edit waypoint 1"]]);
  });

  it("drops a new route's start on undo", () => {
    const { editor } = editing(outside(), outside());
    editor.clear();
    editor.setPending(outside());
    editor.undo();
    expect([editor.get().pending, editor.get().history!.plan!.id]).toEqual([null, "plan"]);
  });
});

describe("the saved plans", () => {
  const starts = (editor: RouteEditor) => editor.get().plans!.map((p) => [p.id, p.stops[0]]);

  it("take each committed plan in ID order, and a dragged plan only when the drag ends", () => {
    const editor = new RouteEditor(() => {});
    editor.load([createPlan(outside(), inCity(), "b")]);
    editor.open(createPlan(outside(), inCity(), "a"));
    editor.edit(reverse, "swap");
    editor.drag(0, inHall(1, 0), "move start");
    const dragging = starts(editor);
    editor.move(floors(), 0, outside(), "move start", () => {});
    expect([dragging, starts(editor)]).toEqual([
      [
        ["a", inCity()],
        ["b", outside()],
      ],
      [
        ["a", outside()],
        ["b", outside()],
      ],
    ]);
  });

  it("drop a forgotten plan that stays open until its next edit", () => {
    const { editor } = editing(outside(), inCity());
    editor.load([plan(editor)]);
    editor.forget("plan");
    const forgotten = starts(editor);
    editor.edit(reverse, "swap");
    expect([forgotten, starts(editor)]).toEqual([[], [["plan", inCity()]]]);
  });
});
