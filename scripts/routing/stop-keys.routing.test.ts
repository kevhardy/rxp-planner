import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STOP_TABLE_FILE, stopTableText } from "../../src/routing/stop-table.ts";
import { DATA_DIR, installedTransports } from "../dataset/local.ts";
import { buildStopTable } from "./stop-keys.ts";

const text = readFileSync(join(DATA_DIR, STOP_TABLE_FILE), "utf8");

describe("the installed stop table", () => {
  it("equals a new table from the installed artifacts", { timeout: 600_000 }, async () => {
    expect(
      stopTableText(await buildStopTable(await installedTransports())),
      "make it again: delete .local-data/stop-keys.json, then run pnpm data:install",
    ).toBe(text);
  });
});
