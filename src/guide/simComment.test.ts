import { describe, expect, it } from "vitest";
import { parseGuide } from "./parse.ts";
import { simComment } from "./simComment.ts";

describe("simComment", () => {
  it("gives the @sim directive without the comment text before it, and nothing for a plain comment", () => {
    const [step] = parseGuide(
      "step\n.complete 179,1 --Tough Wolf Meat (8) @sim kills=3\n.complete 1,1 --Tough Wolf Meat\n-- @sim level=5",
    ).steps;
    expect(step!.body.map(simComment)).toEqual(["@sim kills=3", undefined, "@sim level=5"]);
  });
});
