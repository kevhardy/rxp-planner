import { describe, expect, it } from "vitest";
import { parseGuide, serializeGuide } from "../guide/index.ts";
import { replaceSection, sectionText } from "./sections.ts";

describe("replaceSection", () => {
  it("keeps an untouched trailing blank line in a step", () => {
    const doc = parseGuide("#name A\nstep\n.accept 1\n\nstep\n.turnin 1\n");
    const text = sectionText(doc, 0);
    expect(serializeGuide(replaceSection(doc, 0, text.replace("1", "2")))).toBe("#name A\nstep\n.accept 2\n\nstep\n.turnin 1\n");
  });

  it("reads a trailing line break as a blank line and changes nothing for unchanged text", () => {
    const doc = parseGuide("step\n.accept 1\nstep\n");
    expect(replaceSection(doc, 0, sectionText(doc, 0))).toBe(doc);
    expect(serializeGuide(replaceSection(doc, 0, "step\n.accept 1\n"))).toBe("step\n.accept 1\n\nstep\n");
  });
});
