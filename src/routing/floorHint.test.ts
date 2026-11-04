import type { Point } from "./frame.ts";
import { describe, expect, it } from "vitest";
import { CELLS } from "./artifact.ts";
import { flat, records, withFloor } from "./fixtures/region.ts";
import type { Building } from "./floor.ts";
import { floorHint, floorHintText } from "./floorHint.ts";
import { CELL_SPACING } from "./terrain.ts";

const centre = (x: number, y: number): Point => [x * 4 + 2, y * 4 + 2];
const units = ([x, y]: Point): [number, number] => [x * 16, y * 16];

const house: Building = {
  placement: 1,
  box: [0, 0, 16 * 16, 16 * 16],
  ground: 1,
  floors: [-56, 0, 40],
  doors: [],
  targets: [
    { point: units(centre(1, 1)), floor: 2, kind: 0 },
    { point: units(centre(2, 2)), floor: 255, kind: 1 },
  ],
  paths: [],
};

function town() {
  const region = withFloor(
    flat(CELLS, CELLS, CELL_SPACING),
    {
      [30 * CELLS + 30]: { layers: [{ height: -6 }, { height: 0 }, { height: 2 }, { height: 7 }] },
      [40 * CELLS + 40]: { layers: [{ height: 0 }, { height: 7 }] },
      [50 * CELLS + 50]: { layers: [{ height: 100, buried: true }, { height: 106, buried: true }, { height: 300 }] },
    },
    [records([0, 0], { buildings: [house], hints: [[...units(centre(40, 40)), 7 * 8]] })],
  );
  region.elevation[50 * CELLS + 50] = 300;
  return region;
}

describe("floorHint", () => {
  it("gives the floor that the producer matched, else the stacked floors", () => {
    const region = town();
    const hints = [centre(1, 1), centre(2, 2), centre(30, 30), centre(40, 40), centre(50, 50), centre(60, 60)].map((p) => {
      const hint = floorHint(region, p);
      return [hint, floorHintText(hint)];
    });
    expect(hints).toEqual([
      [{ kind: "known", floors: [-7, 0, 5], floor: 2 }, "The NPC is upstairs, 5 yd up. Floors: -7, 0, 5 yd from the ground floor."],
      [
        { kind: "stacked", floors: [-7, 0, 5] },
        "Stacked floors here: the NPC may be upstairs or downstairs. Floors: -7, 0, 5 yd from the ground floor.",
      ],
      [
        { kind: "stacked", floors: [-6, 0, 7] },
        "Stacked floors here: the NPC may be upstairs or downstairs. Floors: -6, 0, 7 yd from the ground floor.",
      ],
      [{ kind: "known", floors: [0, 7], floor: 1 }, "The NPC is upstairs, 7 yd up. Floors: 0, 7 yd from the ground floor."],
      [{ kind: "stacked", floors: [0, 6] }, "Stacked floors here: the NPC may be upstairs. Floors: 0, 6 yd from the ground floor."],
      [{ kind: "single" }, undefined],
    ]);
  });
});
