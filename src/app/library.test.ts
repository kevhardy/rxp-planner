import { describe, expect, it } from "vitest";
import { parseGuide, serializeGuide, type GuideRecord } from "../guide/index.ts";
import { createProfile } from "../rules/profile.ts";
import { guideMeta } from "../rules/registration.ts";
import { builtinTree, copyLabels, libraryGroups, mapNext } from "./library.ts";

let order = 0;
const guide = (text: string, group?: string): GuideRecord => {
  const stored: GuideRecord = { id: `g${order}`, text, order: order++ };
  if (group) stored.registerArgs = { group };
  return stored;
};
const named = (name: string, next?: string) => guide(`#group G\n#name ${name}\n${next ? `#next ${next}\n` : ""}step\n`);

describe("libraryGroups", () => {
  it("puts every guide after the guides that lead to it", () => {
    const guides = [named("A", "B;C"), named("B", "D"), named("C", "B"), named("D")];
    expect(libraryGroups(guides)[0]!.guides.map((g) => guideMeta(g).name)).toEqual(["A", "C", "B", "D"]);
  });

  it("keeps import order for ties and breaks cycles at the earliest guide", () => {
    const guides = [named("X", "Y"), named("P", "Q"), named("Y", "X"), named("Q")];
    expect(libraryGroups(guides)[0]!.guides.map((g) => guideMeta(g).name)).toEqual(["P", "Q", "X", "Y"]);
  });

  it("orders each group only by links to guides in that group", () => {
    const guides = [named("A", "H\\B"), named("B", "A"), guide("#group H\n#name B\nstep\n"), named("C", "H\\X;B")];
    const [g, h] = libraryGroups(guides);
    expect(g!.guides.map((x) => guideMeta(x).name)).toEqual(["B", "A", "C"]);
    expect(h!.guides.map((x) => guideMeta(x).name)).toEqual(["B"]);
  });

  it("keeps copies of a name together, in import order, where the first would go", () => {
    const pack = () => [named("A", "B"), named("B", "C2"), named("C", "D"), named("D")];
    const [first, second] = [pack(), pack()];
    const ordered = libraryGroups([...first, ...second])[0]!.guides;
    expect(ordered.map((g) => guideMeta(g).name)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D"]);
    expect(ordered.map((g) => g.id)).toEqual(first.flatMap((g, i) => [g.id, second[i]!.id]));
  });
});

describe("copyLabels", () => {
  it("numbers guides that share a name by import order", () => {
    const [b1, a, b2, b3] = [named("B"), named("A"), named("B"), named("B")];
    const labels = copyLabels([b3, a, b2, b1]);
    expect([b1, b2, b3].map((g) => labels.get(g))).toEqual(["copy 1 of 3", "copy 2 of 3", "copy 3 of 3"]);
    expect(labels.has(a)).toBe(false);
  });
});

describe("builtinTree", () => {
  const human = createProfile({ race: "Human", class: "WARRIOR" });
  const builtin = (id: string, header: string): GuideRecord => ({ id, text: `${header}\nstep\n`, order: order++, fileName: "test.lua" });
  const tree = (guides: GuideRecord[], all = false) =>
    builtinTree(new Map(guides.map((g) => [g.id, g])), () => human, all).map((group) => [
      group.name,
      group.subgroups.map((sub) => [sub.name, sub.guides.map((e) => (e.reason ? `${e.guide.id}: ${e.reason}` : e.guide.id))]),
    ]);

  it("lists only the last built-in registered under a group and name", () => {
    expect(
      tree([
        builtin("first", "#group G\n#name Shared"),
        builtin("last", "#group G\n#name Shared"),
        builtin("other", "#group G\n#name Other"),
      ]),
    ).toEqual([["G", [["", ["last", "other"]]]]]);
  });

  it("sorts groups and subgroups by name and keeps #next order inside a subgroup", () => {
    const guides = [
      builtin("b", "#group B\n#name One"),
      builtin("able", "#group A\n#subgroup B\n#name Able"),
      builtin("zed", "#group A\n#subgroup B\n#name Zed\n#next Able"),
      builtin("bare", "#group A\n#name Bare"),
      builtin("a", "#group A\n#subgroup A\n#name Any"),
    ];
    expect(tree(guides)).toEqual([
      [
        "A",
        [
          ["", ["bare"]],
          ["A", ["a"]],
          ["B", ["zed", "able"]],
        ],
      ],
      ["B", [["", ["b"]]]],
    ]);
  });

  it("lists a guide that the menu leaves out only with all, with its reason", () => {
    const guides = [builtin("shown", "#group G\n#name Shown"), builtin("helper", "#group G\n#name Helper\n#internal")];
    expect(tree(guides)).toEqual([["G", [["", ["shown"]]]]]);
    expect(tree(guides, true)).toEqual([["G", [["", ["shown", "helper: Internal guide"]]]]]);
  });
});

describe("mapNext", () => {
  const rename = (text: string, group: string, newGroup = group) =>
    serializeGuide(mapNext(parseGuide(text), group, newGroup, (t) => (t.group === "G" ? { group: "H", name: t.name } : undefined)));

  it("rewrites qualified items and the unqualified items that follow them", () => {
    expect(rename("#next G\\A; B;K\\C\nstep\n", "K")).toBe("#next H\\A; B;K\\C\nstep\n");
  });

  it("qualifies an item whose target no longer shares the guide's group", () => {
    const keepG = (text: string) =>
      serializeGuide(mapNext(parseGuide(text), "G", "G2", (t) => (t.name === "A" ? { group: "G2", name: "A" } : undefined)));
    expect(keepG("#next A;B\nstep\n")).toBe("#next A;G\\B\nstep\n");
  });

  it("leaves unaffected lines as they were", () => {
    const text = "#next  Other\\A ;B -- note\nstep\n";
    expect(rename(text, "K")).toBe(text);
  });
});
