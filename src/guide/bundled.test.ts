import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { argSpecAt, COMMANDS, TAGS, tagAllowedIn } from "./catalog.ts";
import { assertRepresentable, edited } from "./edit.ts";
import { extractGuides } from "./lua.ts";
import type { BodyLine } from "./model.ts";
import { parseGuide, parseLine } from "./parse.ts";
import { guideMeta } from "../rules/registration.ts";
import { serializeGuide } from "./serialize.ts";

const dir = join(import.meta.dirname, "../../guides/rxp-forever");
const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".lua"))
  .sort();
const guides = files.flatMap((file) => extractGuides(readFileSync(join(dir, file), "utf8")).map((g) => ({ file, ...g })));

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

describe("bundled Forever guides", () => {
  it("extracts all 80 RegisterGuide texts", () => {
    expect(guides).toHaveLength(80);
  });

  it("extracts all steps in v4.11.30", () => {
    const steps = guides.reduce((n, g) => n + parseGuide(g.text).steps.length, 0);
    expect(steps).toBe(8586);
  });

  it.each(guides.map((g) => [`${g.file}:${g.line}`, g.text] as const))("%s round-trips", (_, text) => {
    expect(serializeGuide(parseGuide(text))).toBe(text);
  });

  it("reads a level range from every bundled #name", () => {
    const metas = guides.map((g, i) => guideMeta({ id: `g${i}`, text: g.text, order: i }));
    expect(metas.filter((m) => m.name && !m.range).map((m) => m.name)).toEqual([]);
  });

  it("formats every line so it parses back to the same model", () => {
    for (const { text } of guides) {
      for (const raw of normalize(text).split("\n")) {
        expect(() => assertRepresentable(edited(parseLine(raw))), raw).not.toThrow();
      }
    }
  });

  it("catalogs the guides except preserved upstream extras and unsupported includes", () => {
    const missing = new Set<string>();
    const check = (lines: BodyLine[], section: "header" | "step") => {
      for (const line of lines) {
        if (line.kind === "command") {
          const spec = COMMANDS.get(line.name);
          if (!spec) missing.add(`.${line.name}`);
          else if (line.args.length > 0 && !argSpecAt(spec, line.args.length - 1)) missing.add(line.raw!.trim());
        }
        if (line.kind === "tag") {
          const tag = TAGS.get(line.name);
          if (!tag || !tagAllowedIn(tag, section)) missing.add(`${section} #${line.name}`);
        }
      }
    };
    for (const { text } of guides) {
      const doc = parseGuide(text);
      check(doc.header, "header");
      for (const step of doc.steps) check(step.body, "step");
    }
    // `addon.ProcessGuideTable` in GuideWindow.lua expands #include in a step; the planner preserves it but still
    // warns that it is unsupported. RXP's `.goto` handler in functions.lua ignores the sixth argument.
    expect([...missing]).toEqual(["step #include", ".goto 1421/0,1609.1399,798.6667,50,0,0"]);
  });
});
