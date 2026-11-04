import { describe, expect, it } from "vitest";
import { describeLine, type LineHome } from "./describe.ts";
import { parseLine } from "./parse.ts";

describe("describeLine", () => {
  it.each<[string, "header" | "step", string, string, string, LineHome]>([
    [".goto Durotar,52.1,43.2", "step", "Go to", "Set a map waypoint.", ".goto", "lines"],
    [".accept 33 >> Accept it", "step", "Accept quest", "Accept a quest.", ".accept", "lines"],
    [".complete 7,1 -- @sim kills=3", "step", "Quest objective", "Track a quest objective.", ".complete", "lines"],
    [".foo 1,2", "step", "Unknown command .foo", "Not in the catalog; RXP may not know it.", ".foo", "lines"],
    ["#sofcore", "step", "Softcore only (misspelled)", "Misspelled `#softcore`; RXP ignores it.", "#sofcore", "settings"],
    ["#name 1-6 Durotar", "header", "Guide name", "Guide name; required.", "#name", "lines"],
    ["#name 1-6 Durotar", "step", "Guide name", "Guide name; required. It belongs in the header.", "#name", "settings"],
    ["#nosuchtag x", "step", "Unknown tag #nosuchtag", "Not in the catalog; RXP may not know it.", "#nosuchtag", "settings"],
    [">>Kill boars", "step", "Instruction", "Text that RXP shows in the step.", ">>", "lines"],
    ["+Kill boars", "step", "Text objective", "An objective that the player checks off by hand.", "+", "lines"],
    ["*Kill boars", "step", "Note", "Text that RXP shows in the step without a tooltip.", "*", "lines"],
    ["<< Horde", "header", "Guide condition", "Hides the guide from characters that it does not match.", "<<", "lines"],
    ["<< Horde", "step", "Condition only", "A condition with nothing before it, which RXP ignores in a step.", "<<", "lines"],
    ["-- a note", "step", "Comment", "Text after `--`, which RXP ignores.", "--", "lines"],
    [
      "--wolves @sim extra=2 mob=299",
      "step",
      "Simulation data",
      "Planner-only data for the XP simulation, which RXP ignores.",
      "-- @sim",
      "simulation",
    ],
    [
      "-- @sim killmult=0.5",
      "header",
      "Simulation data",
      "Planner-only data for the XP simulation, which RXP ignores.",
      "-- @sim",
      "lines",
    ],
    ["", "step", "Blank line", "An empty line, which RXP ignores.", "", "lines"],
    ["Kill boars", "step", "Unrecognized line", "Text with no command, tag, or text marker, which RXP ignores.", "", "lines"],
  ])("describes %j in the %s", (raw, section, title, description, syntax, home) => {
    const line = parseLine(raw);
    if (line.kind === "step") throw new Error("A step line is not a body line");
    expect(describeLine(line, section)).toEqual({ title, description, syntax, home });
  });
});
