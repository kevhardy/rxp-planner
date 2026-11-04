import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["HighOrder", "Windshaper", "Human"])("accepts %s before validating the class", (race) => {
  const run = spawnSync(
    process.execPath,
    ["scripts/guides/timeline.ts", "--guide", "1-14 Zephras Isle", "--race", race, "--class", "NOT_A_CLASS"],
    { encoding: "utf8", env: { ...process.env, RXP_DATASET: "/missing-timeline-dataset" } },
  );
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("--class must be one of WARRIOR, PALADIN, HUNTER, ROGUE, PRIEST, SHAMAN, MAGE, WARLOCK, DRUID");
});
