import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { calibrate, calibrationBytes, calibrationMarkdown, loadObservations } from "../../src/routing/calibration.ts";
import { routeCorridors } from "./corridors.ts";
import { openInstalled } from "./installed.ts";

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const [command, ...args] = process.argv.slice(2);
try {
  let result: unknown;
  if (command === "calibrate" && args.length === 2) {
    const [cases, out] = args as [string, string];
    const { artifact, terrain } = await openInstalled();
    const { manifest } = artifact;
    const routed = await routeCorridors(terrain, await readJson(cases));
    const report = calibrate({ artifact: manifest.id, scope: manifest.scope, ...routed, observations: await loadObservations(artifact) });
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "calibration.json"), calibrationBytes(report));
    await writeFile(join(out, "calibration.md"), calibrationMarkdown(report));
    result = { report: join(out, "calibration.json"), ...report.counts };
  } else throw new Error("Usage: node scripts/routing/cli.ts calibrate CASES OUT");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
