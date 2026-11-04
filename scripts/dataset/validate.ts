import { datasetDir, validateInstalled } from "./local.ts";

try {
  const { manifest, files } = await validateInstalled();
  console.log(`Dataset validated: ${manifest.id}@${manifest.release}, ${files.size} assets, in ${datasetDir()}.`);
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
