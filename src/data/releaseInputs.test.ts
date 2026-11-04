import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { plannerRelease } from "./manifestFixture.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function releaseInputs(f: ReturnType<typeof plannerRelease>) {
  const dir = await mkdtemp(join(tmpdir(), "planner-release-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  for (const [path, bytes] of f.files) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), bytes);
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(f.manifest));
  vi.stubEnv("RXP_RELEASE_MANIFEST", join(dir, "manifest.json"));
  vi.stubEnv("RXP_RELEASE_BASE", dir);
  return import("./releaseInputs.ts");
}

it("builds the release's game data and entities from the release named by the environment", async () => {
  const { releaseData, releaseEntities } = await releaseInputs(plannerRelease());
  const game = releaseData();
  expect({
    quest: game.quest(887)?.name,
    label: game.sourceLabel("Independent/one"),
    raceBit: game.rules.raceBits.Windshaper,
    npc: game.npcName(3391),
    entity: releaseEntities().lookup("spell", 585)?.subtext,
  }).toEqual({ quest: "Southsea Freebooters", label: "Independent survey", raceBit: 8589934592, npc: "Gazlowe", entity: "Rank 1" });
});

it("rejects the release's entities when a category is empty", async () => {
  const f = plannerRelease();
  f.entities.entities.spell = [];
  f.replace("entities.json.gz", f.entities);
  const { releaseEntities } = await releaseInputs(f);
  expect(() => releaseEntities()).toThrow("Missing spell data");
});
