import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects an unknown class before loading the dataset", () => {
  const run = spawnSync(process.execPath, ["scripts/guides/opportunities.ts", "--guide", "1-6 Northshire", "--class", "NOT_A_CLASS"], {
    encoding: "utf8",
    env: { ...process.env, RXP_DATASET: "/missing-opportunities-dataset" },
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("Unknown class NOT_A_CLASS");
});

it.each(["HighOrder", "Windshaper"])("accepts %s before validating the class", (race) => {
  const run = spawnSync(
    process.execPath,
    ["scripts/guides/opportunities.ts", "--guide", "1-14 Zephras Isle", "--race", race, "--class", "NOT_A_CLASS"],
    { encoding: "utf8", env: { ...process.env, RXP_DATASET: "/missing-opportunities-dataset" } },
  );
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("Unknown class NOT_A_CLASS");
});
