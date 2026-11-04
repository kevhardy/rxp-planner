import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameDataFile } from "./model.ts";

export function genericFile(): GameDataFile {
  return JSON.parse(readFileSync(join(import.meta.dirname, "../../data/fixtures/generic-dataset/quests.json"), "utf8")) as GameDataFile;
}
