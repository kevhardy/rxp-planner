import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundleJson, fixturePin, installFixture } from "../../src/routing/fixtures/repin.ts";
import { DEFAULT_STOP_SETTINGS, parseStopTable, STOP_TABLE_FILE, stopTableText } from "../../src/routing/stop-table.ts";
import { ensureStopTable, probeHash } from "./stop-keys.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function install(routing: boolean) {
  const data = await mkdtemp(join(tmpdir(), "planner-stop-keys-"));
  directories.push(data);
  vi.stubEnv("RXP_DATASET", "");
  await cp(resolve("data/fixtures/generic-dataset"), join(data, "dataset"), { recursive: true });
  if (routing) {
    await mkdir(join(data, "routing"));
    await writeFile(join(data, "bundle.json"), JSON.stringify(bundleJson(await installFixture(join(data, "routing/m0")))));
  }
  return data;
}
const read = async (data: string) => parseStopTable(JSON.parse(await readFile(join(data, STOP_TABLE_FILE), "utf8")));

describe("ensureStopTable", () => {
  it("writes a table of each installed map, with the keys that the current code finds on the coarse fixture", async () => {
    const data = await install(true);
    await ensureStopTable(data);
    const table = await read(data);
    expect(table.settings).toEqual(DEFAULT_STOP_SETTINGS);
    expect(table.probe).toBe(await probeHash(DEFAULT_STOP_SETTINGS));
    expect(table.maps.map(({ map, artifact }) => [map, artifact])).toEqual([[0, (await fixturePin()).id]]);
  });

  it("keeps a table that the current code made for the installed transports and artifacts", async () => {
    const data = await install(true);
    await ensureStopTable(data);
    const kept = JSON.stringify(await read(data));
    await writeFile(join(data, STOP_TABLE_FILE), kept);
    await ensureStopTable(data);
    expect(await readFile(join(data, STOP_TABLE_FILE), "utf8")).toBe(kept);
  });

  it("writes the table again when older code made it", async () => {
    const data = await install(true);
    await ensureStopTable(data);
    const table = await read(data);
    await writeFile(join(data, STOP_TABLE_FILE), stopTableText({ ...table, probe: "0".repeat(64) }));
    await ensureStopTable(data);
    expect((await read(data)).probe).toBe(table.probe);
  });

  it("writes the table again when the installed transports changed", async () => {
    const data = await install(true);
    await ensureStopTable(data);
    const table = await read(data);
    await writeFile(join(data, STOP_TABLE_FILE), stopTableText({ ...table, transports: "f".repeat(64) }));
    await ensureStopTable(data);
    expect((await read(data)).transports).toBe(table.transports);
  });

  it("writes the table again when the installed artifacts changed", async () => {
    const data = await install(true);
    await ensureStopTable(data);
    const table = await read(data);
    const maps = table.maps.map((m) => ({ ...m, artifact: `${m.artifact.slice(0, -1)}${m.artifact.endsWith("0") ? "1" : "0"}` }));
    await writeFile(join(data, STOP_TABLE_FILE), stopTableText({ ...table, maps }));
    await ensureStopTable(data);
    expect((await read(data)).maps.map((m) => m.artifact)).toEqual([(await fixturePin()).id]);
  });

  it("writes the table again when its settings are not the defaults", async () => {
    const data = await install(true);
    await ensureStopTable(data);
    const table = await read(data);
    await writeFile(
      join(data, STOP_TABLE_FILE),
      stopTableText({ ...table, settings: { ...table.settings, hazards: !table.settings.hazards } }),
    );
    await ensureStopTable(data);
    expect((await read(data)).settings).toEqual(DEFAULT_STOP_SETTINGS);
  });

  it("writes no table when no routing is installed", async () => {
    const data = await install(false);
    await ensureStopTable(data);
    await expect(readFile(join(data, STOP_TABLE_FILE))).rejects.toThrow(/ENOENT/);
  });
});
