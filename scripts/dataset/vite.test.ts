import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { build, preview, createServer, resolveConfig } from "vite";
import { readDataset } from "../../src/data/node.ts";
import { bundleJson, installFixture } from "../../src/routing/fixtures/repin.ts";
import { DEFAULT_STOP_SETTINGS, parseStopTable, STOP_TABLE_FILE } from "../../src/routing/stop-table.ts";
import { probeHash } from "../routing/stop-keys.ts";
import { installedDataset, installedTransports, validateInstalled } from "./local.ts";
import { localDataset } from "./vite.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "planner-vite-"));
  directories.push(directory);
  return directory;
}
async function dataset(directory: string) {
  const copy = join(directory, "dataset");
  await cp(resolve("data/fixtures/generic-dataset"), copy, { recursive: true });
  vi.stubEnv("RXP_DATASET", copy);
  return copy;
}
const address = (server: { address(): unknown } | null | undefined, base: string) => {
  const bound = server?.address();
  if (!bound || typeof bound !== "object" || !("port" in bound)) throw new Error("Expected TCP listener");
  return `http://127.0.0.1:${String(bound.port)}${base}`;
};

it("loads a dataset folder and refuses a changed or missing asset", async () => {
  const copy = await dataset(await temporary());
  const data = await validateInstalled();
  const loaded = await readDataset(data.location);
  expect(loaded.manifest.id).toBe("generic-demo");
  expect(loaded.game.quests[0]?.name).toBe("Southsea Freebooters");
  await writeFile(join(copy, "quests.json"), "corrupt");
  await expect(validateInstalled()).rejects.toThrow(/quests.json/);
  await rm(join(copy, "quests.json"));
  await expect(validateInstalled()).rejects.toThrow(
    new Error(
      `Could not load the dataset in ${copy}. Install it with pnpm data:install. ENOENT: no such file or directory, open '${join(copy, "quests.json")}'`,
    ),
  );
});

it("opens the installed dataset for a Node script, and gives the installation advice when it cannot", async () => {
  const copy = await dataset(await temporary());
  const { manifest, game, entities } = await installedDataset();
  expect({ id: manifest.id, quest: game.quest(887)?.name, npc: entities.lookup("npc", 3391)?.name }).toEqual({
    id: "generic-demo",
    quest: "Southsea Freebooters",
    npc: "Gazlowe",
  });
  await writeFile(join(copy, "quests.json"), "corrupt");
  await expect(installedDataset()).rejects.toThrow(/quests.json/);
  vi.stubEnv("RXP_DATASET", "/missing-node-loader-dataset");
  await expect(installedDataset()).rejects.toThrow(
    "Could not load the dataset in /missing-node-loader-dataset. Install it with pnpm data:install.",
  );
});

it("reads the transports asset without the gzip encoding", async () => {
  await dataset(await temporary());
  expect((await installedTransports()).nodes.map((n) => n.id)).toEqual([
    "DOCK_SKYWATCHER",
    "DOCK_VALANAAR",
    "elevator-thunder-bluff-east-1:bottom",
    "elevator-thunder-bluff-east-1:top",
    "FLIGHT_22",
    "FLIGHT_22:air",
    "TAXI_22",
    "TAXI_63",
  ]);
});

it("serves the declared raw bytes under a nested base, and keeps the bytes that it loaded", async () => {
  const directory = await temporary();
  const copy = await dataset(directory);
  const original = await validateInstalled();
  const noInstall = join(directory, "no-install");
  const builtins = await readFile("public/data/rxp-forever.json.gz");
  const checkAliases = async (base: string) => {
    for (const path of ["%64ataset/quests.json", "dataset%2fquests.json", "dataset/%71uests.json", "%64ata/rxp-forever.json.gz"]) {
      const response = await fetch(base + path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-encoding"), path).toBeNull();
      const expected = path.includes("rxp-forever") ? builtins : original.files.get("quests.json")!;
      expect(Buffer.from(await response.arrayBuffer()).equals(expected), path).toBe(true);
    }
    for (const path of ["%2564ataset/quests.json", "dataset/%zz", "dataset%5cquests.json", "dataset/%2e%2e%2fdata/rxp-forever.json.gz"]) {
      expect((await fetch(base + path)).status, path).toBe(404);
    }
  };
  const server = await createServer({
    configFile: false,
    plugins: [localDataset({ data: noInstall })],
    base: "/nested/app(copy)/",
    server: { host: "127.0.0.1", port: 0, watch: null },
  });
  await server.listen();
  try {
    const base = address(server.httpServer, "/nested/app(copy)/");
    for (const [path, bytes] of original.files) {
      const response = await fetch(`${base}dataset/${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
    expect((await fetch(`${base}dataset/undeclared.json`)).status).toBe(404);
    await checkAliases(base);
    for (const path of [
      "data/fixtures/generic-dataset/manifest.json",
      "public/data/rxp-forever.json.gz",
      "data/fixtures/generic-dataset/manifest.json?import",
      "data/fixtures/generic-dataset/manifest.json?raw",
      "scripts/dataset/local.ts",
      "scripts/dataset/pin.json",
      `@fs/${resolve("data/fixtures/generic-dataset/manifest.json")}`,
      `@id/${resolve("data/fixtures/generic-dataset/manifest.json")}`,
      "%64ata/fixtures/generic-dataset/manifest.json",
      "src/%2e%2e%2fdata/fixtures/generic-dataset/manifest.json",
      "src%5c..%5cdata/fixtures/generic-dataset/manifest.json",
      "%2564ata/fixtures/generic-dataset/manifest.json",
    ]) {
      expect.soft((await fetch(base + path)).status, path).toBe(404);
    }
    for (const path of ["", "src/main.tsx", "@vite/client", `@fs/${resolve("src/main.tsx")}`]) {
      const response = await fetch(base + path);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain(path === "" ? "root" : "import");
    }
    const manifest = JSON.parse(await readFile(join(copy, "manifest.json"), "utf8"));
    manifest.release = "2";
    await writeFile(join(copy, "manifest.json"), JSON.stringify(manifest));
    expect((await validateInstalled()).manifest.release).toBe("2");
    expect(await (await fetch(`${base}dataset/manifest.json`)).text()).toBe(original.manifestBytes.toString());
    expect(server.config.publicDir).toBe("");
    await writeFile(join(directory, "index.html"), "<!doctype html><title>Build transport fixture</title>");
    await build({
      configFile: false,
      root: directory,
      plugins: [localDataset({ data: noInstall })],
      base: "/nested/app(copy)/",
      logLevel: "silent",
    });
    vi.stubEnv("RXP_DATASET", join(directory, "missing"));
    const built = await preview({
      configFile: false,
      root: directory,
      plugins: [localDataset({ data: noInstall })],
      base: "/nested/app(copy)/",
      preview: { host: "127.0.0.1", port: 0 },
    });
    try {
      const prefix = `${address(built.httpServer, "/nested/app(copy)/")}dataset/`;
      for (const [path, bytes] of original.files) {
        const response = await fetch(prefix + path);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-encoding")).toBeNull();
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      }
      expect((await (await fetch(prefix + "manifest.json")).json()).release).toBe("2");
      expect((await fetch(prefix + "undeclared.json")).status).toBe(404);
      await writeFile(join(directory, "dist/dataset/quests.json"), "changed after load");
      await checkAliases(prefix.replace(/dataset\/$/, ""));
    } finally {
      await built.close();
    }
  } finally {
    await server.close();
  }
});

it("serves each installed map's exact bytes in development, build, and preview, with the reason for a map that fails", async () => {
  const directory = await temporary();
  await dataset(directory);
  const data = join(directory, "install");
  await mkdir(join(data, "routing"), { recursive: true });
  const eastern = await installFixture(join(data, "routing/m0"));
  await installFixture(join(data, "routing/m1"));
  const kalimdor = { ...eastern, map: 1 };
  const bundle = `${JSON.stringify(bundleJson(eastern, kalimdor))}\n`;
  await writeFile(join(data, "bundle.json"), bundle);
  const expected = ["manifest.json", "tiles/9_22.bin"].map(async (path) => [path, await readFile(join(data, "routing/m0", path))] as const);
  const check = async (base: string, m1Reason: string) => {
    expect(await (await fetch(`${base}bundle.json`)).text()).toBe(bundle);
    for (const [path, bytes] of await Promise.all(expected)) {
      const response = await fetch(`${base}routing/m0/${path}`);
      expect(response.status, path).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
    expect((await fetch(`${base}routing/m0/tiles/10_22.bin`)).status).toBe(404);
    const failed = await fetch(`${base}routing/m1/manifest.json`);
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe(`Routing is unavailable for map 1: ${m1Reason}. Run pnpm data:install.`);
  };
  const dev = await createServer({
    configFile: false,
    plugins: [localDataset({ data })],
    base: "/app/",
    server: { host: "127.0.0.1", port: 0, watch: null },
  });
  await dev.listen();
  try {
    await check(address(dev.httpServer, "/app/"), "manifest.scope.map: expected 1, found 0");
  } finally {
    await dev.close();
  }
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Routing transport fixture</title>");
  const buildTo = (outDir: string, from: string) =>
    build({
      configFile: false,
      root: directory,
      plugins: [localDataset({ data: from })],
      base: "/app/",
      logLevel: "silent",
      build: { outDir },
    });
  const previewOf = (outDir: string) =>
    preview({
      configFile: false,
      root: directory,
      plugins: [localDataset({ data: join(directory, "no-install") })],
      base: "/app/",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
    });
  await buildTo("with-routing", data);
  await rm(data, { recursive: true });
  const withRouting = await previewOf("with-routing");
  try {
    await check(
      address(withRouting.httpServer, "/app/"),
      `ENOENT: no such file or directory, open '${join(directory, "with-routing/routing/m1/manifest.json")}'`,
    );
  } finally {
    await withRouting.close();
  }
  await buildTo("without-routing", join(directory, "no-install"));
  const without = await previewOf("without-routing");
  try {
    const base = address(without.httpServer, "/app/");
    expect((await fetch(`${base}bundle.json`)).status).toBe(404);
    expect((await fetch(`${base}routing/m0/manifest.json`)).status).toBe(404);
    expect((await fetch(`${base}dataset/manifest.json`)).status).toBe(200);
  } finally {
    await without.close();
  }
});

async function staleTable(directory: string) {
  const data = join(directory, "install");
  await mkdir(join(data, "routing"), { recursive: true });
  await writeFile(join(data, "bundle.json"), JSON.stringify(bundleJson(await installFixture(join(data, "routing/m0")))));
  await writeFile(join(data, STOP_TABLE_FILE), "{}");
  return data;
}

it("writes a stop table that older code made again, and serves it in development, build, and preview", async () => {
  const directory = await temporary();
  await dataset(directory);
  const data = await staleTable(directory);
  const plugins = [localDataset({ data })];
  const dev = await createServer({ configFile: false, plugins, base: "/app/", server: { host: "127.0.0.1", port: 0, watch: null } });
  await dev.listen();
  let served: string;
  try {
    const response = await fetch(`${address(dev.httpServer, "/app/")}${STOP_TABLE_FILE}`);
    expect(response.status).toBe(200);
    served = await response.text();
  } finally {
    await dev.close();
  }
  const table = parseStopTable(JSON.parse(served));
  expect(table.probe).toBe(await probeHash(DEFAULT_STOP_SETTINGS));
  expect(table.maps.map((m) => m.map)).toEqual([0]);
  expect(await readFile(join(data, STOP_TABLE_FILE), "utf8")).toBe(served);
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Stop table fixture</title>");
  await build({ configFile: false, root: directory, plugins, base: "/app/", logLevel: "silent" });
  await rm(data, { recursive: true });
  expect(await readFile(join(directory, "dist", STOP_TABLE_FILE), "utf8")).toBe(served);
  const built = await preview({ configFile: false, root: directory, plugins, base: "/app/", preview: { host: "127.0.0.1", port: 0 } });
  try {
    expect(await (await fetch(`${address(built.httpServer, "/app/")}${STOP_TABLE_FILE}`)).text()).toBe(served);
  } finally {
    await built.close();
  }
});

it("serves no stop table when it cannot replace one that older code made", async () => {
  const directory = await temporary();
  await dataset(directory);
  const data = await staleTable(directory);
  await mkdir(join(data, `${STOP_TABLE_FILE}.new`));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dev = await createServer({
    configFile: false,
    plugins: [localDataset({ data })],
    base: "/app/",
    server: { host: "127.0.0.1", port: 0, watch: null },
  });
  await dev.listen();
  try {
    expect((await fetch(`${address(dev.httpServer, "/app/")}${STOP_TABLE_FILE}`)).status).toBe(404);
    expect((await fetch(`${address(dev.httpServer, "/app/")}bundle.json`)).status).toBe(200);
  } finally {
    await dev.close();
  }
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^The stop key table is unavailable: EISDIR/));
});

it("names the installed release file, or a dataset folder elsewhere, for the build", async () => {
  const directory = await temporary();
  await dataset(directory);
  await writeFile(join(directory, ".sha256"), "02e84c02d112c4d0b8af38c1621240832adb7f7e1eb53fed8af9b778e95810a1");
  const version = async () =>
    (await resolveConfig({ configFile: false, root: directory, plugins: [localDataset({ data: directory })], logLevel: "silent" }, "build"))
      .define?.["import.meta.env.VITE_DATASET_VERSION"];
  expect(await version()).toBe(
    JSON.stringify(
      JSON.stringify({ name: "data-02e84c02d112", url: "https://github.com/kevhardy/rxp-planner/releases/tag/data-02e84c02d112" }),
    ),
  );
  await dataset(await temporary());
  expect(await version()).toBe(JSON.stringify(JSON.stringify({ name: "1 (custom)" })));
});
