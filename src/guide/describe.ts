import { COMMANDS, TAGS, tagAllowedIn } from "./catalog.ts";
import type { BodyLine, TextMarker } from "./model.ts";
import { simComment } from "./simComment.ts";

export type LineHome = "lines" | "settings" | "simulation";

export interface LineDescription {
  title: string;
  description: string;
  syntax: string;
  home: LineHome;
}

type Describers = {
  [K in BodyLine["kind"]]: (line: Extract<BodyLine, { kind: K }>, section: "header" | "step") => LineDescription;
};

const TEXT_MARKERS: Record<TextMarker, Pick<LineDescription, "title" | "description">> = {
  ">>": { title: "Instruction", description: "Text that RXP shows in the step." },
  "+": { title: "Text objective", description: "An objective that the player checks off by hand." },
  "*": { title: "Note", description: "Text that RXP shows in the step without a tooltip." },
};

const DESCRIBERS: Describers = {
  command: (line) => {
    const spec = COMMANDS.get(line.name);
    const syntax = `.${line.name}`;
    if (!spec)
      return { title: `Unknown command ${syntax}`, description: "Not in the catalog; RXP may not know it.", syntax, home: "lines" };
    return { title: spec.title, description: spec.description, syntax, home: "lines" };
  },
  tag: (line, section) => {
    const spec = TAGS.get(line.name);
    const syntax = `#${line.name}`;
    const home = section === "step" ? "settings" : "lines";
    if (!spec) return { title: `Unknown tag ${syntax}`, description: "Not in the catalog; RXP may not know it.", syntax, home };
    const misplaced = !tagAllowedIn(spec, section);
    const description = misplaced ? `${spec.description} It belongs in the ${section === "step" ? "header" : "steps"}.` : spec.description;
    return { title: spec.title, description, syntax, home };
  },
  text: (line) => ({ ...TEXT_MARKERS[line.marker], syntax: line.marker, home: "lines" }),
  // RXP strips `<<` from a step line and reads nothing that is left; only the header acts on it.
  condition: (_, section) =>
    section === "header"
      ? { title: "Guide condition", description: "Hides the guide from characters that it does not match.", syntax: "<<", home: "lines" }
      : {
          title: "Condition only",
          description: "A condition with nothing before it, which RXP ignores in a step.",
          syntax: "<<",
          home: "lines",
        },
  comment: (line, section) =>
    simComment(line) === undefined
      ? { title: "Comment", description: "Text after `--`, which RXP ignores.", syntax: "--", home: "lines" }
      : {
          title: "Simulation data",
          description: "Planner-only data for the XP simulation, which RXP ignores.",
          syntax: "-- @sim",
          home: section === "step" ? "simulation" : "lines",
        },
  blank: () => ({ title: "Blank line", description: "An empty line, which RXP ignores.", syntax: "", home: "lines" }),
  other: () => ({
    title: "Unrecognized line",
    description: "Text with no command, tag, or text marker, which RXP ignores.",
    syntax: "",
    home: "lines",
  }),
};

export function describeLine(line: BodyLine, section: "header" | "step"): LineDescription {
  switch (line.kind) {
    case "command":
      return DESCRIBERS.command(line, section);
    case "tag":
      return DESCRIBERS.tag(line, section);
    case "text":
      return DESCRIBERS.text(line, section);
    case "condition":
      return DESCRIBERS.condition(line, section);
    case "comment":
      return DESCRIBERS.comment(line, section);
    case "blank":
      return DESCRIBERS.blank(line, section);
    case "other":
      return DESCRIBERS.other(line, section);
    default: {
      const _exhaustive: never = line;
      return _exhaustive;
    }
  }
}
