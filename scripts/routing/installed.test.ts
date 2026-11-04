import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { bundleJson, installFixture } from "../../src/routing/fixtures/repin.ts";
import { installedArtifact } from "./installed.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "planner-installed-"));
  directories.push(directory);
  return directory;
}

it("loads the installed routing artifact of a map", async () => {
  const data = await temporary();
  await mkdir(join(data, "routing"));
  await writeFile(join(data, "bundle.json"), JSON.stringify(bundleJson(await installFixture(join(data, "routing/m0")))));
  const { manifest } = await installedArtifact(0, data);
  expect({ map: manifest.scope.map, id: manifest.id }).toEqual({ map: 0, id: "routing-forever-1.60.1.70124-m0-bdefc88aa88d6fe1" });
});

it("gives the installation advice for a map with no installed routing artifact", async () => {
  await expect(installedArtifact(9, await temporary())).rejects.toThrow(
    "No routing artifact is installed for map 9. Install it with pnpm data:install.",
  );
});
