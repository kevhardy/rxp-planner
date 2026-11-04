import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, guideIconsFixture, interiorsFixture, plannerRelease, sha256 } from "./manifestFixture.ts";
import { fetchDatasetArtifact } from "./dataset.ts";
import { readDataset } from "./node.ts";

const fetchBlob = globalThis.fetch;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(transport: "browser" | "Node", f = plannerRelease()) {
  if (transport === "browser") {
    vi.stubGlobal("window", { location: new URL("http://localhost/planner/") });
    const fetch = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      const bytes =
        path === "/supplied/manifest.json"
          ? new TextEncoder().encode(JSON.stringify(f.manifest))
          : f.files.get(path.slice("/planner/assets/".length));
      return new Response(bytes ?? null, { status: bytes ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetch);
    return {
      load: async (manifestHash?: string) => {
        const artifact = await fetchDatasetArtifact(
          { manifest: "/supplied/manifest.json", base: "/planner/assets", manifestHash },
          new AbortController().signal,
        );
        cleanups.push(async () => artifact.dispose());
        return artifact.data;
      },
      fetch,
    };
  }
  const dir = await mkdtemp(join(tmpdir(), "planner-dataset-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const base = join(dir, "assets");
  await mkdir(base);
  for (const [path, bytes] of f.files) {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), bytes);
  }
  const manifest = join(dir, "manifest.json");
  await writeFile(manifest, JSON.stringify(f.manifest));
  return { load: (manifestHash?: string) => readDataset({ manifest, base, manifestHash }), base };
}

it("reads the interiors file at startup and no interior image, so a missing image does not stop startup", async () => {
  const f = interiorsFixture(plannerRelease());
  f.files.delete("interiors/the-deadmines-35530/ground-plan.webp");
  const { load, fetch } = await setup("browser", f);
  const data = await load();
  const paths = fetch!.mock.calls.map(([url]) => new URL(url).pathname);
  expect(paths.filter((path) => path.startsWith("/planner/assets/interiors"))).toEqual(["/planner/assets/interiors.json.gz"]);
  expect([...data.imageUrls!.keys()].filter((url) => url.includes("/interiors/"))).toEqual([]);
});

it("reads and checks each interior image on first use, again after a failure, and releases it on dispose", async () => {
  const f = interiorsFixture(plannerRelease());
  const path = "interiors/the-deadmines-35530/ground-plan.webp";
  const good = f.files.get(path)!;
  f.files.set(path, f.files.get("art/map.webp")!);
  const { load, fetch } = await setup("browser", f);
  const data = await load();
  const reads = () => fetch!.mock.calls.filter(([url]) => url.endsWith(path)).length;
  const revoked = vi.spyOn(URL, "revokeObjectURL");
  const interiors = data.worldMap.interiors!;

  await expect(interiors.image(path)).rejects.toThrow(`Invalid asset size ${path}`);
  f.files.set(path, good);
  const [first, second] = await Promise.all([interiors.image(path), interiors.image(path)]);
  expect([first, second, await interiors.image(path), reads()]).toEqual([first, first, first, 2]);
  expect(first).toMatch(/^blob:/);
  expect(data.imageUrls!.get(`${data.base}${path}`)).toBe(first);
  cleanups.splice(0).forEach((cleanup) => void cleanup());
  expect(revoked).toHaveBeenCalledWith(first);
});

it("reads, checks, and decodes an interior's surfaces asset on first use, and again after a failed check", async () => {
  const f = interiorsFixture(plannerRelease());
  const path = "interiors/the-deadmines-35530/surfaces.bin.gz";
  const good = f.files.get(path)!;
  f.files.set(path, new Uint8Array(good.length));
  const { load, fetch } = await setup("browser", f);
  const interiors = (await load()).worldMap.interiors!;
  const cave = interiors.list[0]!;
  const reads = () => fetch!.mock.calls.filter(([url]) => url.endsWith(path)).length;
  const pixel = (col: number) => ({ instance: 0, x: 1516.5 - (col + 0.5) / 2, y: -11093.25 });

  expect(reads()).toBe(0);
  await expect(interiors.surfaces(cave)).rejects.toThrow(`Invalid asset checksum ${path}`);
  expect(interiors.loadedSurfaces(cave)).toBeUndefined();
  f.files.set(path, good);
  const first = await interiors.surfaces(cave);
  expect([await interiors.surfaces(cave), interiors.loadedSurfaces(cave), reads()]).toEqual([first, first, 2]);
  expect([1, 2, 3].map((col) => first.at(pixel(col)).map((s) => `${s.place} ${s.height}`))).toEqual([
    ["Defias Hideout 20", "The Deadmines 37"],
    ["Defias Hideout 36.875", "The Deadmines 43.125"],
    ["Defias Hideout 51"],
  ]);
});

it("refuses a dataset that declares interiors version 1", async () => {
  const f = interiorsFixture(plannerRelease());
  f.manifest.assets.find((a) => a.path === "interiors.json.gz")!.version = 1;
  const { load } = await setup("browser", f);
  await expect(load()).rejects.toThrow(
    new Error("Could not load dataset /supplied/manifest.json: Invalid interiors asset interiors.json.gz version 1, expected version 2"),
  );
});

it("keeps a failed read visible when its error has no message", async () => {
  const { load, fetch } = await setup("browser");
  const served = fetch!.getMockImplementation()!;
  fetch!.mockImplementationOnce(() => Promise.reject(new TypeError("")));
  // An Error with an empty message prints as its class name alone.
  await expect(load()).rejects.toThrow(new Error("Could not load dataset /supplied/manifest.json: TypeError"));
  fetch!.mockImplementation(async (url: string) => (url.endsWith("/quests.json") ? Promise.reject(new TypeError("")) : served(url)));
  await expect(load()).rejects.toThrow(
    new Error("Could not load dataset /supplied/manifest.json: Could not read dataset asset quests.json: TypeError"),
  );
});

describe.each(["browser", "Node"] as const)("%s supplied dataset", (transport) => {
  it("requires the exact manifest bytes named by the selected pin", async () => {
    const f = plannerRelease();
    const { load } = await setup(transport, f);
    await expect(load(sha256(new TextEncoder().encode(JSON.stringify(f.manifest))))).resolves.toHaveProperty("manifest.id", "independent");
    await expect(load(sha256(new TextEncoder().encode(JSON.stringify(f.manifest, null, 2))))).rejects.toThrow(/selected content pin/);
  });

  it("loads complete independent bytes with geometry, labels, names and asset locations", async () => {
    const { load } = await setup(transport);
    const data = await load();
    expect(data.game.quest(887)?.name).toBe("Southsea Freebooters");
    expect(data.entities.lookup("npc", 3391)?.name).toBe("Gazlowe");
    expect(data.game.sourceLabel("Independent/one")).toBe("Independent survey");
    expect(data.game.locateGoto(["1413", "62.6", "36.2"])).toMatchObject({
      ok: true,
      world: { instance: 1, x: expect.closeTo(-3720.55, 2), y: expect.closeTo(-833.26, 2) },
    });
    expect(data.entities.lookup("spell", 585)).toMatchObject({ name: "Smite", subtext: "Rank 1" });
    expect(data.worldMap.tileBase).toBe(`${data.base}world/`);
    if (transport === "browser") expect(data.worldMap.tileBase).toBe("http://localhost/planner/assets/world/");
    expect(data.manifest.icons["quest-giver"]).toEqual({ file: "art/map.webp", x: -24, y: -48, width: 192 });
    expect(data.game.rules.raceBits.Windshaper).toBe(2 ** 33);
    expect(data.transports).toEqual({ version: 1, nodes: [], links: [] });
    expect(data.game.terrainMap(data.worldMap).canvas).toEqual({ left: 228, width: 3000, height: 1224 });
  });

  it("gives the world map the inside maps only when the manifest names them", async () => {
    expect((await (await setup(transport)).load()).worldMap.interiors).toBeUndefined();
    const data = await (await setup(transport, interiorsFixture(plannerRelease()))).load();
    const map = data.game.terrainMap(data.worldMap);
    expect(map.interiors?.list.map((interior) => interior.id)).toEqual(["the-deadmines-35530"]);
  });

  it.each([
    [
      "malformed",
      (f: ReturnType<typeof fixture>) => {
        f.manifest.version = 3 as 2;
      },
      /manifest/,
    ],
    [
      "unsafe path",
      (f: ReturnType<typeof fixture>) => {
        f.manifest.assets[0]!.path = "../escape";
      },
      /asset declaration/,
    ],
    [
      "hash mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.files.get("quests.json")![0] = 0;
      },
      /checksum.*quests.json/,
    ],
    [
      "missing image",
      (f: ReturnType<typeof fixture>) => {
        f.files.delete("art/map.webp");
      },
      /art\/map.webp/,
    ],
    [
      "unsupported terrain",
      (f: ReturnType<typeof fixture>) => {
        f.replace("terrain.json", { ...f.terrain, version: 2 });
      },
      /world map/,
    ],
    [
      "changed terrain bytes",
      (f: ReturnType<typeof fixture>) => {
        f.files.get("terrain.json")![0] = 0;
      },
      /checksum.*terrain/,
    ],
    [
      "invalid content",
      (f: ReturnType<typeof fixture>) => {
        f.quests.quests = [];
        f.replace("quests.json", f.quests);
      },
      /coverage/,
    ],
    [
      "a quest field from a source the bundle does not list",
      (f: ReturnType<typeof fixture>) => {
        f.quests.quests.find((q) => q.id === 887)!.provenance!.fields.name = { source: "missing-source" };
        f.replace("quests.json", f.quests);
      },
      "Quest 887.name: missing-source is not among the bundle's sources",
    ],
    [
      "an empty entity category",
      (f: ReturnType<typeof fixture>) => {
        f.entities.entities.spell = [];
        f.replace("entities.json.gz", f.entities);
      },
      "Missing spell data",
    ],
    [
      "a release from before the game tables",
      (f: ReturnType<typeof fixture>) => {
        const { flightNodes: _, factionNames: __, ...old } = f.quests;
        const races = Object.fromEntries(Object.entries(old.races!).map(([id, { startingFlightNodes: _nodes, ...race }]) => [id, race]));
        f.replace("quests.json", { ...old, races });
      },
      "The dataset release predates data contract 0.18.0. Its quest bundle has no flightNodes, factionNames, races[].startingFlightNodes.",
    ],
    [
      "a release from before the rule tables",
      (f: ReturnType<typeof fixture>) => {
        const { professions: _, standings: __, xpToNextLevel: ___, ...old } = f.quests;
        const races = Object.fromEntries(Object.entries(old.races!).map(([id, { maskBit: _bit, ...race }]) => [id, race]));
        f.replace("quests.json", { ...old, races });
      },
      "The dataset release predates data contract 0.18.0. Its quest bundle has no professions, standings, xpToNextLevel, races[].maskBit.",
    ],
    [
      "a release from before starting flight nodes",
      (f: ReturnType<typeof fixture>) => {
        const races = Object.fromEntries(Object.entries(f.quests.races!).map(([id, { startingFlightNodes: _, ...race }]) => [id, race]));
        f.replace("quests.json", { ...f.quests, races });
      },
      "The dataset release predates data contract 0.18.0. Its quest bundle has no races[].startingFlightNodes.",
    ],
    [
      "race classes without classes",
      (f: ReturnType<typeof fixture>) => {
        f.replace("quests.json", { ...f.quests, raceClasses: {} });
      },
      "The dataset release predates data contract 0.18.0. Its quest bundle has no classes.",
    ],
    [
      "races without a race of the planner",
      (f: ReturnType<typeof fixture>) => {
        const { "96": _, ...races } = f.quests.races!;
        f.replace("quests.json", { ...f.quests, races });
      },
      "The dataset's races lack Windshaper.",
    ],
    [
      "an XP table for another top level",
      (f: ReturnType<typeof fixture>) => {
        f.replace("quests.json", { ...f.quests, maxLevel: 59, xpToNextLevel: f.quests.xpToNextLevel!.slice(1) });
      },
      "The dataset's XP table ends at level 59, not at level 60.",
    ],
    [
      "a release without the transports asset",
      (f: ReturnType<typeof fixture>) => {
        delete f.manifest.transports;
        f.manifest.assets = f.manifest.assets.filter((a) => a.format !== "transports");
      },
      "The dataset release predates data contract 0.18.0. Its manifest has no transports asset.",
    ],
    [
      "a release without the transports asset whose zones GameData also refuses",
      (f: ReturnType<typeof fixture>) => {
        const barrens = { id: 18, uiMapId: 2521, name: "The Barrens", category: "zone", instance: 2991 } as const;
        f.replace("quests.json", { ...f.quests, zones: [...f.quests.zones, barrens] });
        delete f.manifest.transports;
        f.manifest.assets = f.manifest.assets.filter((a) => a.format !== "transports");
      },
      "The dataset release predates data contract 0.18.0. Its manifest has no transports asset.",
    ],
  ] as const)("rejects %s without returning partial runtime data", async (_, change, error) => {
    const f = plannerRelease();
    change(f);
    const { load } = await setup(transport, f);
    await expect(load()).rejects.toThrow(error);
  });
});

it("rejects Node asset symlinks outside the explicit base", async () => {
  const { load, base } = await setup("Node");
  const path = join(base!, "art/map.webp");
  const outside = join(base!, "../outside.webp");
  await writeFile(outside, fixture().files.get("art/map.webp")!);
  await rm(path);
  await symlink(outside, path);
  await expect(load()).rejects.toThrow(/escapes dataset base/);
});

it("rejects a remote browser location before fetching", async () => {
  const { fetch } = await setup("browser");
  await expect(
    fetchDatasetArtifact({ manifest: "https://elsewhere.test/manifest.json", base: "/planner/assets" }, new AbortController().signal),
  ).rejects.toThrow(/this origin/);
  expect(fetch).not.toHaveBeenCalled();
});

describe("a response with a transport Content-Encoding", () => {
  const encoded = async (body: (path: string, bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>) => {
    const { fetch, load } = await setup("browser");
    const serve = fetch!.getMockImplementation()!;
    // fetch removes the transport encoding before the page reads the body.
    fetch!.mockImplementation(async (url: string) => {
      const response = await serve(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return new Response(body(new URL(url).pathname, bytes), { status: response.status, headers: { "Content-Encoding": "gzip" } });
    });
    return load;
  };
  const gzipFile = (path: string) => path.endsWith(".gz");

  it("loads the stored bytes", async () => {
    const load = await encoded((_, bytes) => bytes);
    expect((await load()).game.quest(887)?.name).toBe("Southsea Freebooters");
  });

  it("rejects a host that also removes the stored gzip layer", async () => {
    const load = await encoded((path, bytes) => (gzipFile(path) ? gunzipSync(bytes) : bytes));
    await expect(load()).rejects.toThrow(/entities\.json\.gz/);
  });

  it("rejects a host that compresses the same content again", async () => {
    const load = await encoded((path, bytes) => (gzipFile(path) ? gzipSync(gunzipSync(bytes), { level: 1 }) : bytes));
    await expect(load()).rejects.toThrow(/asset (size|checksum) entities\.json\.gz/);
  });
});

it("stops validation at the next asset after abort without publishing images", async () => {
  await setup("browser");
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hashes = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (algorithm, bytes) => {
    await gate;
    return digest(algorithm, bytes);
  });
  const images = vi.spyOn(URL, "createObjectURL");
  const controller = new AbortController();
  const result = fetchDatasetArtifact({ manifest: "/supplied/manifest.json", base: "/planner/assets" }, controller.signal);
  await vi.waitFor(() => expect(hashes).toHaveBeenCalledTimes(1));
  controller.abort();
  release();
  await expect(result).rejects.toThrow(/abort/i);
  expect(hashes).toHaveBeenCalledTimes(1);
  expect(images).not.toHaveBeenCalled();
});

it("starts with checked core data without reading any terrain tile", async () => {
  const f = plannerRelease();
  f.files.delete("world/tiles/kalimdor/2/1/1.webp");
  const { load, fetch } = await setup("browser", f);
  const data = await load();
  expect(data.game.quest(887)?.name).toBe("Southsea Freebooters");
  expect(fetch!.mock.calls.map(([url]) => new URL(url).pathname).filter((path) => path.includes("/world/tiles/"))).toEqual([]);
  expect([...data.imageUrls!.keys()]).toEqual(["http://localhost/planner/assets/art/map.webp"]);
});

it("checks tiles on first use, shares requests, retries failed checks, and releases checked URLs", async () => {
  const f = plannerRelease();
  const path = "world/tiles/kalimdor/2/1/1.webp";
  const tilePath = "tiles/kalimdor/2/1/1.webp";
  const good = f.files.get(path)!;
  f.files.set(path, new Uint8Array(good.length));
  const { load, fetch } = await setup("browser", f);
  const data = await load();
  const tile = data.worldMap.tile!;
  const reads = () => fetch!.mock.calls.filter(([url]) => url.endsWith(path)).length;
  const revoked = vi.spyOn(URL, "revokeObjectURL");
  expect(reads()).toBe(0);
  await expect(tile(tilePath)).rejects.toThrow(`Invalid asset checksum ${path}`);
  f.files.set(path, good);
  const [first, second] = await Promise.all([tile(tilePath), tile(tilePath)]);
  expect([second, await tile(tilePath), reads()]).toEqual([first, first, 2]);
  expect(first).toMatch(/^blob:/);
  expect(data.imageUrls!.get(`${data.worldMap.tileBase}${tilePath}`)).toBe(first);
  expect(new Uint8Array(await (await fetchBlob(first)).arrayBuffer())).toEqual(good);
  cleanups.splice(0).forEach((cleanup) => void cleanup());
  expect(revoked).toHaveBeenCalledWith(first);
  expect([...data.imageUrls!]).toEqual([]);
});

it("does not create a tile URL when an in-flight read finishes after disposal", async () => {
  const f = plannerRelease();
  const { fetch } = await setup("browser", f);
  const artifact = await fetchDatasetArtifact(
    { manifest: "/supplied/manifest.json", base: "/planner/assets" },
    new AbortController().signal,
  );
  let release!: (response: Response) => void;
  fetch!.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const created = vi.spyOn(URL, "createObjectURL");
  const loading = artifact.data.worldMap.tile!("tiles/kalimdor/2/1/1.webp");
  artifact.dispose();
  release(new Response(f.files.get("world/tiles/kalimdor/2/1/1.webp")));
  await expect(loading).rejects.toThrow(/abort/i);
  expect(created).not.toHaveBeenCalled();
  expect([...artifact.data.imageUrls!]).toEqual([]);
  await expect(artifact.data.worldMap.tile!("tiles/eastern-kingdoms/2/0/1.webp")).rejects.toThrow(/abort/i);
});

it("checks and decodes the guide icon sheet after startup, shows it through one CSS property, retries a failure, and releases it", async () => {
  const f = guideIconsFixture(plannerRelease());
  const path = "guide-icons/icons.png";
  const good = f.files.get(path)!;
  f.files.set(path, new Uint8Array(good.length));
  const style = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        getPropertyValue: (name: string) => style.get(name) ?? "",
        setProperty: (name: string, value: string) => style.set(name, value),
        removeProperty: (name: string) => style.delete(name),
      },
    },
  });
  const decoded: string[] = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = async () => void decoded.push(this.src);
    },
  );
  const revoked = vi.spyOn(URL, "revokeObjectURL");
  const { load, fetch } = await setup("browser", f);
  const data = await load();
  const sheet = data.guideIconSheet!;
  const states: string[] = [sheet.state];
  sheet.subscribe(() => states.push(sheet.state));
  await vi.waitFor(() => expect(sheet.state).toBe("failed"));
  expect([...style]).toEqual([]);
  f.files.set(path, good);
  sheet.retry();
  await vi.waitFor(() => expect(sheet.state).toBe("ready"));
  const url = decoded[0]!;
  expect(url).toMatch(/^blob:/);
  expect([states, [...style], fetch!.mock.calls.filter(([u]) => u.endsWith(path)).length]).toEqual([
    ["loading", "failed", "loading", "ready"],
    [["--rxp-guide-icons", `url("${url}")`]],
    2,
  ]);
  cleanups.splice(0).forEach((cleanup) => void cleanup());
  expect(revoked).toHaveBeenCalledWith(url);
  expect([...style]).toEqual([]);
});

it("gives a release with no guide icons table an empty catalog and no sheet", async () => {
  const data = await (await setup("browser")).load();
  expect([data.guideIcons.all, data.guideIconSheet]).toEqual([[], undefined]);
});
