import { describe, expect, it } from "vitest";
import { EntityIndex } from "../data/index.ts";
import { plannerData, plannerNames } from "../data/plannerFixture.ts";
import { parseGuide, serializeGuide, type GuideRecord } from "../guide/index.ts";
import { guideChain, openRoute, playbackRoute, previewDoc, startLevelWarning, type RouteView, type StartLevel } from "./chain.ts";
import { createProfile } from "./profile.ts";
import { guideMeta } from "./registration.ts";
import { factionData } from "./simData.ts";

describe("previewDoc", () => {
  const text = "#name A\r\n#group G << Mage\r\n#group H\r\n#frobnicate x\r\nstep\r\n    .frobnicate 1";

  it("reads the RegisterGuide group in place of each #group line, and leaves the record and its parsed lines as saved", () => {
    const record: GuideRecord = { id: "a", text, registerArgs: { group: "Override", defaultFor: "Human" }, order: 0 };
    const parsed = parseGuide(text);
    const doc = previewDoc(record, parsed);
    expect(serializeGuide(doc)).toBe("#name A\r\n#group Override\r\n#group Override\r\n#frobnicate x\r\nstep\r\n    .frobnicate 1");
    expect([serializeGuide(parsed), record]).toEqual([
      text,
      { id: "a", text, registerArgs: { group: "Override", defaultFor: "Human" }, order: 0 },
    ]);
  });

  it("adds the RegisterGuide group at the end of a header without #group, and reads a guide without one as saved", () => {
    const docs = [
      previewDoc({ id: "a", text: "#name A\nstep\n", registerArgs: { group: "X" }, order: 0 }),
      previewDoc({ id: "b", text, order: 0 }),
    ];
    expect(docs.map((doc) => serializeGuide(doc))).toEqual(["#name A\n#group X\nstep\n", text]);
  });

  it("gives the same document for the same record, and a new one for a copy of it", () => {
    const record: GuideRecord = { id: "a", text, registerArgs: { group: "Override" }, order: 0 };
    const doc = previewDoc(record);
    expect([previewDoc(record) === doc, previewDoc({ ...record }) === doc]).toEqual([true, false]);
  });
});

describe("guideChain", () => {
  it("keeps the records, reads each as RXP does, and names a guide without #name (no #name)", () => {
    const records: GuideRecord[] = [
      { id: "a", text: "#group G\nstep\n", order: 0 },
      { id: "b", text: "#name B\n#group G\nstep\n", registerArgs: { group: "R" }, order: 1 },
    ];
    const chain = guideChain(records);
    expect(chain.records).toBe(records);
    expect([chain.docs.map((doc) => serializeGuide(doc)), chain.names]).toEqual([
      ["#group G\nstep\n", "#name B\n#group R\nstep\n"],
      ["(no #name)", "B"],
    ]);
  });
});

describe("playbackRoute", () => {
  it("simulates a solo self-found route that was only previewed", () => {
    const record: GuideRecord = { id: "a", text: "#name A\n#group G\nstep\n    .accept 783\n", order: 0 };
    const character = createProfile({ race: "Human", class: "WARRIOR", soloSelfFound: true });
    const route = openRoute(
      { guides: new Map([["a", record]]), builtins: new Map() },
      { id: "a" },
      character,
      { start: null, startLevel: "auto" },
      undefined,
    )!;
    const { sim } = factionData(plannerData(), new EntityIndex(plannerNames), "Alliance");
    const played = playbackRoute(route, sim, {}, "auto");
    expect([route.simulation === undefined, played.simulation?.guides.map((g) => g.source)]).toEqual([true, [0]]);
  });
});

const humanWarrior = createProfile({ race: "Human", class: "WARRIOR" });

function routeOf(texts: string[], open: string, options: { startLevel?: StartLevel; builtins?: GuideRecord[]; reversed?: boolean } = {}) {
  const { startLevel = "auto", builtins = [], reversed = false } = options;
  const guides = texts.map((text, order): GuideRecord => ({ id: `g${order}`, text, order }));
  const id = [...builtins, ...guides].find((g) => g.id === open || guideMeta(g).name === open)!.id;
  const byId = (records: GuideRecord[]) => new Map(records.map((r) => [r.id, r]));
  const library = { guides: byId(reversed ? guides.reverse() : guides), builtins: byId(builtins) };
  return openRoute(library, { id }, humanWarrior, { start: null, startLevel }, undefined)!;
}

const routeIds = (route: RouteView) => route.preview.guides.map((g) => route.records[g.source]!.id);

describe("openRoute", () => {
  it("registers the built-ins before the saved guides, each by its order, whatever the order of the records", () => {
    const texts = [
      "#group G\n#name Start\n#next Copy\nstep",
      "#group G\n#name Copy\n#next Old end\nstep",
      "#group G\n#name Copy\n#next New end\nstep",
      "#group G\n#name Old end\nstep",
      "#group G\n#name New end\nstep",
    ];
    const builtins = [{ id: "rxp:t#1", order: 99, text: "#group G\n#name Copy\n#next Built-in end\nstep" }];
    const ids = (open: string) => routeIds(routeOf(texts, open, { builtins, reversed: true }));
    expect([ids("g0"), ids("g1")]).toEqual([
      ["g0", "g2", "g4"],
      ["g1", "g3"],
    ]);
  });

  it("follows a built-in's #next into a saved guide in the group it names", () => {
    const builtins = [
      { id: "rxp:t#1", order: 0, text: "#group Test Group\n#name 1-10 Example Start\n#next 10-20 Example Middle\nstep\n" },
      { id: "rxp:t#2", order: 1, text: "#group Test Group\n#name 10-20 Example Middle\n#next Test Group\\21-23 Example Zone\nstep\n" },
    ];
    const route = routeOf(["#group Test Group\n#name 21-23 Example Zone\nstep\n"], "rxp:t#1", { builtins });
    expect([routeIds(route), route.preview.end?.kind]).toEqual([["rxp:t#1", "rxp:t#2", "g0"], "last"]);
  });
});

describe("startLevelWarning", () => {
  const ranged = (first: string) => [
    `#name ${first}\n#group G\n#next 6-11 B\nstep\n`,
    "#name 6-11 B\n#group G\n#next 12-14 C\nstep\n",
    "#name 12-14 C\n#group G\nstep\n",
  ];
  const leadIns = (dwarf: string, human: string) => [
    `#name ${dwarf}\n#group G\n#defaultfor Gnome/Dwarf\n#next 12-14 C\nstep\n`,
    `#name ${human}\n#group G\n#defaultfor Human\n#next 12-14 C\nstep\n`,
    "#name 12-14 C\n#group G\nstep\n",
  ];
  const warning = (texts: string[], startLevel: StartLevel) => {
    const route = routeOf(texts, "12-14 C", { startLevel });
    const found = startLevelWarning(route);
    return found && [found.level, route.names[found.start], found.range, found.earlier === undefined ? null : route.names[found.earlier]];
  };
  const level = (n: number): StartLevel => ({ level: n, xp: 0 });

  it.each([
    ["the earlier guide whose range starts at the level", ranged("1-6 A"), "1-6 A"],
    ["the nearest earlier guide when no earlier range starts at the level", ranged("3-6 A"), "6-11 B"],
    ["the earlier guide default for the character before one registered first", leadIns("1-6 Dwarf", "1-6 Human"), "1-6 Human"],
    ["a guide for other characters that fits when no default guide fits", leadIns("1-6 Dwarf", "3-6 Human"), "1-6 Dwarf"],
    ["the first default guide when no guide fits", leadIns("3-6 Dwarf", "3-6 Human"), "3-6 Human"],
  ])("offers %s", (_, texts, earlier) => {
    expect(warning(texts, level(1))).toEqual([1, "12-14 C", { min: 12, max: 14 }, earlier]);
  });

  it("does not warn for Auto or a level in range, and warns one level below it", () => {
    const texts = ranged("1-6 A");
    expect([warning(texts, "auto"), warning(texts, level(12)), warning(texts, level(14)), warning(texts, level(11))]).toEqual([
      null,
      null,
      null,
      [11, "12-14 C", { min: 12, max: 14 }, "6-11 B"],
    ]);
  });
});
