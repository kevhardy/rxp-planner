import { describe, expect, it } from "vitest";
import {
  insertLine,
  parseGuide,
  parseLine,
  setCommandArgs,
  setTag,
  updateLine,
  type BodyLine,
  type CommandLine,
  type GuideDocument,
} from "../guide/index.ts";
import { createProfile, previewRoute } from "../rules/index.ts";
import type { StoredLibrary } from "../storage/index.ts";
import { guideMeta } from "../rules/registration.ts";
import { EditorStore } from "./store.ts";

const texts = (store: EditorStore, ids: string[]) => ids.map((id) => store.getState().guides.get(id)!.text);

describe("EditorStore library operations", () => {
  it("renames a guide and retargets #next items across the library", () => {
    const store = new EditorStore();
    const ids = store.addGuides([
      { text: "#group G\n#name A\n#next B;G\\B;Other\nstep\n    .goto Elwynn Forest,1,2\n" },
      { text: "#group G\n#name B\nstep\n" },
      { text: "#group H\n#next B\n#name C\nstep\n" },
      { text: "#group H\n#next G\\B\n#name D\nstep\n" },
    ]);
    expect(store.renameGuide(ids[1]!, "Bee")).toEqual({ ok: true });
    expect(texts(store, ids)).toEqual([
      "#group G\n#name A\n#next Bee;G\\Bee;Other\nstep\n    .goto Elwynn Forest,1,2\n",
      "#group G\n#name Bee\nstep\n",
      "#group H\n#next B\n#name C\nstep\n",
      "#group H\n#next G\\Bee\n#name D\nstep\n",
    ]);
  });

  it("undoes a rename of several guides as one step", () => {
    const store = new EditorStore();
    const ids = store.addGuides([{ text: "#group G\n#name A\n#next B\nstep\n" }, { text: "#group G\n#name B\nstep\n" }]);
    const before = texts(store, ids);
    store.renameGuide(ids[1]!, "Bee");
    store.undo();
    expect(texts(store, ids)).toEqual(before);
    store.redo();
    expect(texts(store, ids)).toEqual(["#group G\n#name A\n#next Bee\nstep\n", "#group G\n#name Bee\nstep\n"]);
  });

  it("undo and redo open the guide and selection from before and after the edit", () => {
    const store = new EditorStore();
    const [a, b] = store.addGuides([{ text: "#group G\n#name A\nstep\nstep\nstep\n" }, { text: "#group G\n#name B\nstep\n" }]);
    store.open(a!);
    store.select({ step: 0, line: null });
    store.edit((doc) => setTag(doc, null, "name", "A2"), { step: 2, line: null });
    store.open(b!);
    store.undo();
    expect(store.getState().current?.name).toBe("A");
    expect(store.getState().selection).toEqual({ step: 0, line: null });
    store.open(b!);
    store.redo();
    expect(store.getState().current?.name).toBe("A2");
    expect(store.getState().selection).toEqual({ step: 2, line: null });
  });

  it("renames a group held only in RegisterGuide arguments, as one undo step", () => {
    const store = new EditorStore();
    const [id] = store.addGuides([{ text: "#name A\nstep\n", registerArgs: { group: "G" } }]);
    const added = store.getState().guides.get(id!);
    expect(store.renameGroup("G", "H")).toEqual({ ok: true });
    expect(store.getState().guides.get(id!)!.registerArgs).toEqual({ group: "H" });
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(store.getState().guides.get(id!)).toBe(added);
  });

  it("renames and copies a registered guide by its RegisterGuide group, not #group", () => {
    const store = new EditorStore();
    const [id] = store.addGuides([{ text: "#group Display\n#name A\nstep\n", registerArgs: { group: "Actual" } }]);
    expect(store.renameGroup("Actual", "New")).toEqual({ ok: true });
    expect(store.getState().guides.get(id!)).toMatchObject({ text: "#group Display\n#name A\nstep\n", registerArgs: { group: "New" } });
    expect(store.duplicate([id!], "Copy")).toEqual({ ok: true });
    expect(store.getState().current?.record).toMatchObject({ text: "#group Display\n#name A\nstep\n", registerArgs: { group: "Copy" } });
    expect(store.getState().current?.group).toBe("Copy");
  });

  it("renames a group and retargets qualified #next items everywhere", () => {
    const store = new EditorStore();
    const ids = store.addGuides([
      { text: "#group G\n#name A\n#next G\\B\nstep\n" },
      { text: "#group G\n#name B\nstep\n" },
      { text: "#group K\n#name C\n#next G\\A;B\nstep\n" },
    ]);
    expect(store.renameGroup("G", "H")).toEqual({ ok: true });
    expect(texts(store, ids)).toEqual([
      "#group H\n#name A\n#next H\\B\nstep\n",
      "#group H\n#name B\nstep\n",
      "#group K\n#name C\n#next H\\A;B\nstep\n",
    ]);
  });

  it("duplicates guides, pointing links between copies at the copies", () => {
    const store = new EditorStore();
    const [a] = store.addGuides([
      { text: "#group G\r\n#name A\r\n#next G\\B;C\r\nstep\r\n    .accept 1  >>odd  spacing\r\n" },
      { text: "#group G\n#name B\nstep\n" },
      { text: "#group G\n#name C\nstep\n" },
    ]);
    expect(store.duplicate([a!], "G2")).toEqual({ ok: true });
    const copy = store.getState().current!;
    expect(copy.id).not.toBe(a);
    expect(copy.group).toBe("G2");
    expect(copy.record.text).toBe("#group G2\r\n#name A\r\n#next G\\B;C\r\nstep\r\n    .accept 1  >>odd  spacing\r\n");

    const all = [...store.getState().guides.values()].filter((g) => g.text.startsWith("#group G\n") || g.id === a);
    expect(
      store.duplicate(
        all.map((g) => g.id),
        "G3",
      ),
    ).toEqual({ ok: true });
    expect(store.getState().current!.record.text).toBe(
      "#group G3\r\n#name A\r\n#next G3\\B;C\r\nstep\r\n    .accept 1  >>odd  spacing\r\n",
    );
  });

  it("rejects names that RXP would read differently and changes nothing", () => {
    const store = new EditorStore();
    const [id] = store.addGuides([{ text: "#group G\n#name A\nstep\n" }]);
    const guides = store.getState().guides;
    expect(store.createGuide("Test -- keep this", "New guide")).toMatchObject({ ok: false });
    expect(store.duplicate([id!], "Test -- keep this")).toMatchObject({ ok: false });
    expect(store.renameGroup("G", "Test -- keep this")).toMatchObject({ ok: false });
    expect(store.renameGuide(id!, "B -- note")).toMatchObject({ ok: false });
    expect(store.getState().guides).toBe(guides);
  });
});

describe("EditorStore built-in guides", () => {
  const G = "RestedXP Forever Guide (A)";
  const C = `${G} (custom)`;
  const builtin = (n: number, text: string) => ({ id: `rxp:test.lua#${n}`, text, order: n - 1, fileName: "test.lua" });
  const builtins = {
    version: "v9.9.9",
    guides: [
      builtin(1, `#group ${G}\n#name A\n#next B\nstep\n    .accept 1\nstep\n    .turnin 1\n`),
      builtin(2, `<< Alliance\n#group ${G} << Alliance\n#group Other << Horde\n#name B\n#next C;RestedXP Alliance 20-30\\D\nstep\n`),
      builtin(3, `#group ${G}\n#name C\nstep\n`),
    ],
  };
  const [a, b, c] = builtins.guides.map((g) => g.id);
  const open = (id: string, library: StoredLibrary = { guides: [] }) => {
    const store = new EditorStore({ ...library, session: { guideId: id, step: 1, line: 0 } }, builtins);
    expect(store.getState().current).toMatchObject({ id, builtin: true });
    return store;
  };
  const setText = (value: string) => (d: GuideDocument) =>
    updateLine(d, { step: 1, index: 0 }, (l) => setCommandArgs(l as CommandLine, [value]));

  const A = "RestedXP Forever Guide (A)";
  const H = "RestedXP Forever Guide (H)";
  const DA = "RestedXP Forever Dungeon Guide (A)";
  const DH = "RestedXP Forever Dungeon Guide (H)";
  it.each([
    [A, "1-6 Coldridge Valley", A, "1-5 Coldridge Valley"],
    [A, "6-11 Dun Morogh", A, "5-11 Dun Morogh"],
    [A, "6-11 Dun Morogh (Hunter)", A, "5-11 Dun Morogh"],
    [H, "10-12 Tirisfal", H, "10-12 Tirisfal (Orc/Troll)"],
    [H, "13-20 The Barrens", DH, "13-20 The Barrens"],
    [H, "20-24 Stonetalon/Barrens", DH, "20-24 Stonetalon/Barrens"],
    [A, "1-14 Zephras Isle", A, "1-9 Zephras Isle"],
    [DA, "1-14 Zephras Isle", DA, "1-9 Zephras Isle"],
    [DH, "12-17 The Barrens", DH, "12-16 The Barrens"],
  ])("keeps saved routes to the moved built-in %s\\%s", (group, oldName, newGroup, newName) => {
    const target = builtin(1, `#group ${newGroup}\n#name ${newName}\nstep\n`);
    const text = `#group Mine\r\n#name Saved\r\n#next ${group}\\${oldName}\r\nstep\r\n    .accept 1  >>my edit\r\n`;
    const saved = { id: "saved", order: 0, text };
    const bundle = { version: "v4.11.23", guides: [target] };
    const store = new EditorStore({ guides: [saved] }, bundle);
    const updated = store.snapshot().guides.get("saved")!;
    expect(updated.text).toBe(text.replace(`${group}\\${oldName}`, `${newGroup}\\${newName}`));
    const route = previewRoute(
      [updated, target].map((g) => parseGuide(g.text)),
      0,
      createProfile({ race: "Human", class: "WARRIOR" }),
    );
    expect(route.guides.map((g) => g.source)).toEqual([0, 1]);
    expect(new EditorStore({ guides: [updated] }, bundle).snapshot().guides.get("saved")).toBe(updated);

    const oldTarget = { id: "old", order: 1, text: `#group ${group}\n#name ${oldName}\nstep\n` };
    expect(new EditorStore({ guides: [saved, oldTarget] }, bundle).snapshot().guides.get("saved")).toBe(saved);
    expect(new EditorStore({ guides: [saved] }).snapshot().guides.get("saved")).toBe(saved);
  });

  it("keeps a saved #next link to a user guide that registers the old target in its second group", () => {
    const text = `#group User\n#name Saved Horde link\n#next ${H}\\13-20 The Barrens\nstep\n    .goto Durotar,50,50\n`;
    const link = { id: "link", order: 0, text };
    const target = {
      id: "user-target",
      order: 1,
      text: `#group ${A} << Alliance\n#group ${H} << Horde\n#name 13-20 The Barrens\nstep\n    .goto Durotar,20,20\n`,
    };
    const moved = builtin(1, `#group ${DH}\n#name 13-20 The Barrens\nstep\n`);
    const store = new EditorStore({ guides: [link, target] }, { version: "v4.11.23", guides: [moved] });
    expect(store.snapshot().guides.get("link")!.text).toBe(text);
    const route = previewRoute(
      [store.snapshot().guides.get("link")!, target, moved].map((g) => parseGuide(g.text)),
      0,
      createProfile({ race: "Orc", class: "WARRIOR" }),
    );
    expect(route.guides.map((g) => g.source)).toEqual([0, 1]);
  });

  it("keeps a saved #next link to a user guide that registers the old target under its second, conditional #name", () => {
    const text = `#group User\n#name Saved conditional name link\n#next ${H}\\13-20 The Barrens\nstep\n.goto Durotar,50,50\n`;
    const link = { id: "link", order: 0, text };
    const target = {
      id: "user-target",
      order: 1,
      text: `#group ${H}\n#name Alternate << Alliance\n#name 13-20 The Barrens << Horde\nstep\n.goto Durotar,20,20\n>>USER TARGET\n`,
    };
    const moved = builtin(1, `#group ${DH}\n#name 13-20 The Barrens\nstep\n`);
    const store = new EditorStore({ guides: [link, target] }, { version: "v4.11.23", guides: [moved] });
    const loaded = [store.snapshot().guides.get("link")!, target, moved];
    expect(loaded[0]!.text).toBe(
      "#group User\n#name Saved conditional name link\n#next RestedXP Forever Guide (H)\\13-20 The Barrens\nstep\n.goto Durotar,50,50\n",
    );
    const route = previewRoute(
      loaded.map((g) => parseGuide(g.text)),
      0,
      createProfile({ race: "Orc", class: "WARRIOR" }),
    );
    expect(route.guides.map((g) => loaded[g.source]!.id)).toEqual(["link", "user-target"]);
  });

  it("reopens a saved built-in under the ID RXP moved it to", () => {
    const moved = {
      id: "rxp:dungeon/RestedXP-Skyborne.lua#5",
      text: `#group ${DA} << Alliance\n#group ${DH} << Horde\n#name Random Stuff\n#internal\nstep\nstep\n    .xp 14\n`,
      order: 0,
      fileName: "dungeon/RestedXP-Skyborne.lua",
    };
    const session = { guideId: "rxp:RestedXP-Skyborne.lua#4", step: 1, line: 0 };
    const store = new EditorStore({ guides: [], session }, { version: "v4.11.26", guides: [moved] });
    expect(store.getState()).toMatchObject({
      current: { id: "rxp:dungeon/RestedXP-Skyborne.lua#5", name: "Random Stuff", group: DA },
      selection: { step: 1, line: 0 },
      notice: null,
    });
  });

  it("says so when the saved open guide is gone", () => {
    const mine = { id: "mine", order: 0, text: "#group Mine\n#name Mine\nstep\n" };
    const session = { guideId: "rxp:Gone.lua#1", step: 1, line: 0 };
    const store = new EditorStore({ guides: [mine], session }, builtins);
    expect(store.getState()).toMatchObject({
      current: { id: "mine" },
      notice: "The guide open last time (rxp:Gone.lua#1) is no longer in the library.",
    });
  });

  it("copies a built-in on its first edit, as one undo step", () => {
    const store = open(a!);
    expect(store.edit(setText("2"))).toEqual({ ok: true });
    const { current, guides } = store.getState();
    expect(current).toMatchObject({ group: C, name: "A", builtin: false, viewId: a });
    expect(current!.record).toMatchObject({
      text: `#group ${G}\n#name A\n#next ${G}\\B\nstep\n    .accept 1\nstep\n    .turnin 2\n`,
      registerArgs: { group: C },
    });
    expect([...guides.keys()]).toEqual([current!.id]);
    expect(store.getState().selection).toEqual({ step: 1, line: 0 });

    store.select({ step: 0, line: null });
    store.undo();
    expect(store.getState().guides.size).toBe(0);
    expect(store.getState().current).toMatchObject({ id: a, builtin: true });
    expect(store.getState().selection).toEqual({ step: 1, line: 0 });
    store.redo();
    expect(store.getState().current!.record).toBe(current!.record);
  });

  it("overrides every #group line and copies nothing for an edit that changes nothing", () => {
    const store = open(b!);
    expect(store.edit((d) => d)).toEqual({ ok: true });
    expect(store.getState().guides.size).toBe(0);
    expect(store.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine(".xp 2") as BodyLine))).toEqual({ ok: true });
    expect(store.getState().current!.record).toMatchObject({
      text: `<< Alliance\n#group ${G} << Alliance\n#group Other << Horde\n#name B\n#next ${G}\\C;RestedXP Alliance 20-30\\D\nstep\n.xp 2\n`,
      registerArgs: { group: C },
    });
    expect(store.getState().canUndo).toBe(true);
  });

  it("opens an existing copy instead of making another", () => {
    const store = open(a!);
    store.edit(setText("2"));
    const copy = store.getState().current!;
    store.open(a!);
    const guides = store.getState().guides;
    expect(store.edit(setText("3"))).toEqual({ ok: false, reason: "opened", notice: `Opened your copy in “${C}”. Make the change there.` });
    expect(store.getState().guides).toBe(guides);
    expect(store.getState().current!.record).toBe(copy.record);
    store.undo();
    expect(store.getState().guides.size).toBe(0);
  });

  it("redirects edits to the latest registered copy within the preferred copy group", () => {
    const copies = [0, 2, 1].map((order) => ({
      id: `copy-${order}`,
      order,
      text: `#group ${C}\n#name B\nstep\n    .accept ${order + 1}\n`,
    }));
    const other = { id: "other", order: 3, text: "#group Other (custom)\n#name B\nstep\n" };
    const store = open(b!, { guides: [...copies, other] });
    store.setProfile(() => createProfile({ race: "Human", class: "WARRIOR" }));
    const guides = store.getState().guides;

    expect(store.edit(setText("99"))).toEqual({
      ok: false,
      reason: "opened",
      notice: `Opened your copy in “${C}”. Make the change there.`,
    });
    expect(store.getState().current!.record).toBe(copies[1]);
    expect(store.getState().guides).toBe(guides);
    expect(store.getState().canUndo).toBe(false);

    store.open(b!);
    store.setProfile(() => createProfile({ race: "Orc", class: "WARRIOR" }));
    store.edit(setText("99"));
    expect(store.getState().current!.record).toBe(other);
  });

  it("points links at the user's copies and existing copies at a new one", () => {
    const store = open(c!);
    store.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine(".xp 3") as BodyLine));
    store.open(a!);
    store.edit(setText("2"));
    const copyA = store.getState().current!.id;
    expect(store.getState().current!.record.text).toContain(`#next ${G}\\B\n`);

    store.open(b!);
    store.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine(".xp 2") as BodyLine));
    expect(store.getState().current!.record.text).toContain(`#next C;RestedXP Alliance 20-30\\D\n`);
    expect(store.getState().guides.get(copyA)!.text).toContain(`#next ${C}\\B\n`);
    store.undo();
    expect(store.getState().guides.get(copyA)!.text).toContain(`#next ${G}\\B\n`);
  });

  it("copies a built-in group and keeps existing copies", () => {
    const store = open(b!);
    store.edit((d) => insertLine(d, { step: 0, index: 0 }, parseLine(".xp 2") as BodyLine));
    const copyB = store.getState().current!.id;
    expect(store.duplicate([a!, b!, c!], C)).toEqual({ ok: true });
    const byName = new Map([...store.getState().guides.values()].map((g) => [guideMeta(g).name, g]));
    expect([...byName.keys()].sort()).toEqual(["A", "B", "C"]);
    expect(byName.get("B")).toMatchObject({ id: copyB, text: expect.stringContaining(`#next ${C}\\C;RestedXP Alliance 20-30\\D\n`) });
    expect(byName.get("A")).toMatchObject({ text: expect.stringContaining("#next B\n"), registerArgs: { group: C } });
    expect(store.getState().current!.id).toBe(byName.get("A")!.id);
  });

  describe("with a #group per faction", () => {
    const groups = "#group F (A) << Alliance\n#group F (H) << Horde\n";
    const factionBuiltins = {
      version: "v9.9.9",
      guides: [
        builtin(1, `${groups}#name Z\n#next Y\nstep\n    .accept 1\nstep\n    .accept 1\n`),
        builtin(2, `${groups}#name Y\nstep\n    .accept 2\nstep\n    .accept 2\n`),
      ],
    };
    const [z, y] = factionBuiltins.guides.map((g) => g.id);
    const H = "F (H) (custom)";
    const horde = () => {
      const store = new EditorStore({ guides: [], session: { guideId: z!, step: 1, line: 0 } }, factionBuiltins);
      store.setProfile(() => createProfile({ race: "Orc", class: "WARRIOR" }));
      return store;
    };
    const names = (store: EditorStore) => [...store.getState().guides.values()].map((g) => `${guideMeta(g).group}\\${guideMeta(g).name}`);

    it("customizes the Horde group once, and later edits open those copies", () => {
      const store = horde();
      expect(store.duplicate([z!, y!], H)).toEqual({ ok: true });
      const copyZ = store.getState().current!.record;
      expect(names(store)).toEqual([`${H}\\Z`, `${H}\\Y`]);
      expect(copyZ.text).toContain("#next Y\n");
      expect(store.duplicate([z!, y!], H)).toEqual({ ok: true });
      expect(names(store)).toEqual([`${H}\\Z`, `${H}\\Y`]);
      expect(store.getState().current!.record).toBe(copyZ);

      store.open(z!);
      expect(store.edit(setText("2"))).toEqual({
        ok: false,
        reason: "opened",
        notice: `Opened your copy in “${H}”. Make the change there.`,
      });
      expect(store.getState().current!.record).toBe(copyZ);

      while (store.getState().canUndo) store.undo();
      expect(store.getState().guides.size).toBe(0);
      store.redo();
      expect(names(store)).toEqual([`${H}\\Z`, `${H}\\Y`]);
    });

    it("copies into the Horde group on the first edit, as one undo step", () => {
      const store = horde();
      expect(store.edit(setText("2"))).toEqual({ ok: true });
      const copyZ = store.getState().current!;
      expect(copyZ).toMatchObject({ group: H, name: "Z" });
      expect(copyZ.record.text).toContain("#next F (H)\\Y\n");
      store.open(y!);
      store.edit(setText("3"));
      expect(store.getState().guides.get(copyZ.id)!.text).toContain(`#next ${H}\\Y\n`);

      store.undo();
      store.undo();
      expect(store.getState().guides.size).toBe(0);
      expect(store.getState().current).toMatchObject({ id: z, builtin: true });
      store.redo();
      expect(store.getState().current!.record).toBe(copyZ.record);
    });

    it("knows the built-in of a copy in each faction's custom group", () => {
      const copy = (id: string, order: number, group: string) => ({ id, order, text: `#group ${group}\n#name Z\nstep\n` });
      const store = new EditorStore(
        { guides: [copy("a", 0, "F (A) (custom)"), copy("h", 1, H), copy("x", 2, "F (custom)")] },
        factionBuiltins,
      );
      const copyOf = (id: string) => {
        store.open(id);
        return store.getState().current!.copyOf;
      };
      expect(["a", "h", "x"].map(copyOf)).toEqual([z, z, undefined]);
    });

    it("still finds the Horde copies after switching to Alliance", () => {
      const store = horde();
      store.duplicate([z!, y!], H);
      const copyZ = store.getState().current!.record;
      store.setProfile(() => createProfile({ race: "Human", class: "WARRIOR" }));

      store.open(z!);
      expect(store.edit(setText("2"))).toEqual({
        ok: false,
        reason: "opened",
        notice: `Opened your copy in “${H}”. Make the change there.`,
      });
      expect(store.duplicate([z!, y!], "F (A) (custom)")).toEqual({ ok: true });
      expect(names(store)).toEqual([`${H}\\Z`, `${H}\\Y`]);
      expect(store.getState().current!.record).toBe(copyZ);
    });
  });

  it("never saves built-ins or offers them to the library", () => {
    const store = open(a!);
    expect(store.snapshot()).toEqual({ guides: new Map(), session: { guideId: a, step: 1, line: 0 } });
    expect(store.getState()).toMatchObject({ builtinVersion: "v9.9.9", guides: new Map() });
    expect(store.getState().builtins.size).toBe(3);
    expect(store.renameGuide(a!, "Z")).toMatchObject({ ok: false });
    expect(store.renameGroup(G, "Mine")).toEqual({ ok: true });
    store.deleteGuides([a!]);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().current?.id).toBe(a);
    expect(store.getState().builtins.get(a!)).toBe(builtins.guides[0]);
  });

  it("refuses built-in names and speedrun groups", () => {
    const store = new EditorStore({ guides: [{ id: "u", text: `#group ${G}\n#name Mine\nstep\n`, order: 0 }] }, builtins);
    const guides = store.getState().guides;
    expect(store.createGuide(G, "A")).toMatchObject({ ok: false, error: expect.stringContaining("built-in") });
    expect(store.createGuide("RestedXP Alliance 20-30", "New")).toMatchObject({ ok: false, error: expect.stringContaining("speedrun") });
    expect(store.renameGuide("u", "B")).toMatchObject({ ok: false });
    expect(store.renameGroup(G, "RestedXP Horde 1-10")).toMatchObject({ ok: false });
    expect(store.duplicate(["u"], "RestedXP Alliance")).toMatchObject({ ok: false });
    expect(store.duplicate([a!], G)).toMatchObject({ ok: false });
    expect(store.getState().guides).toBe(guides);
    expect(store.createGuide(G, "Other")).toEqual({ ok: true });
    expect(store.createGuide("RestedXP Allianceish", "New")).toEqual({ ok: true });
  });

  it("keeps the view ID when the first edit renames the guide", () => {
    const store = open(a!);
    store.edit((d) => setTag(d, null, "name", "Z"));
    expect(store.getState().current).toMatchObject({ group: C, name: "Z", builtin: false, viewId: a });
    store.edit((d) => setTag(d, null, "name", "Y"));
    expect(store.getState().current).toMatchObject({ name: "Y", viewId: a });
  });

  it("copies the last registered helper when built-ins share a name", () => {
    const all = {
      version: "test",
      guides: Array.from({ length: 5 }, (_, order) => ({
        id: `rxp:helper#${order}`,
        order,
        fileName: "helper.lua",
        text: "#name 1-10 2521\n#internal\n",
        registerArgs: { group: "RestedXP Alliance 1-20" },
      })),
    };
    const helpers = all.guides.filter((g) => guideMeta(g).name === "1-10 2521").map((g) => g.id);
    expect(helpers).toHaveLength(5);
    const kept = helpers.at(-1)!;
    const custom = "RestedXP Speedrun Guide (A) (custom)";
    const bump = (d: GuideDocument) => setTag(d, null, "version", "2");
    const store = new EditorStore({ guides: [], session: { guideId: helpers[0]!, step: 0, line: null } }, all);

    // RXP keeps only the last helper. An edit of a helper that RXP drops opens the kept helper.
    expect(store.edit(bump)).toMatchObject({ ok: false, reason: "opened", notice: expect.stringContaining("later built-in") });
    expect(store.getState().current!.id).toBe(kept);
    expect(store.edit(bump)).toEqual({ ok: true });
    const copy = store.getState().current!;
    expect(copy).toMatchObject({ group: custom, name: "1-10 2521", record: { registerArgs: { group: custom } } });

    for (const id of helpers) {
      store.open(id);
      expect(store.edit(bump)).toEqual({ ok: false, reason: "opened", notice: `Opened your copy in “${custom}”. Make the change there.` });
      expect(store.getState().current!.id).toBe(copy.id);
    }
    store.undo();
    expect(store.duplicate(helpers, custom)).toEqual({ ok: true });
    expect(store.getState().guides.size).toBe(1);
    store.undo();
    expect(store.duplicate(helpers, "Mine")).toEqual({ ok: true });
    expect([...store.getState().guides.values()].map((g) => g.text)).toEqual([all.guides.find((g) => g.id === kept)!.text]);
  });

  it("restores a built-in on reload, and starts without built-ins that failed to load", () => {
    expect(open(b!).getState().selection).toEqual({ step: 0, line: null });
    const user = { id: "u", text: "#group Mine\n#name U\nstep\n", order: 0 };
    const store = new EditorStore({ guides: [user], session: { guideId: a!, step: 0, line: null } }, null);
    expect(store.getState()).toMatchObject({ builtins: new Map(), builtinVersion: null, current: { id: "u", builtin: false } });
    expect(store.getState().current!.viewId).toBe("u");
  });
});
