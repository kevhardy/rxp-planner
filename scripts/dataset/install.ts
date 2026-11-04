import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ensureStopTable } from "../routing/stop-keys.ts";
import { DATA_DIR, undefinedIfMissing } from "./local.ts";

export interface Pin {
  sha256: string;
}

const PIN_FILE = fileURLToPath(new URL("./pin.json", import.meta.url));

async function readPin(file = PIN_FILE): Promise<Pin> {
  const pin = JSON.parse(await readFile(file, "utf8")) as Partial<Pin>;
  if (typeof pin.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pin.sha256))
    throw new Error(`${file}: expected { "sha256": 64 lowercase hex digits }`);
  return { sha256: pin.sha256 };
}

export const releaseUrl = (pin: Pin) =>
  `https://github.com/kevhardy/rxp-planner/releases/download/data-${pin.sha256.slice(0, 12)}/rxp-bundle.tar`;

async function download(url: string, file: string) {
  console.log(`Downloading ${url}`);
  const failed = (reason: string) => new Error(`Could not download ${url}: ${reason}`);
  // fetch reports a network failure as "fetch failed" or "terminated" and keeps the reason in `cause`.
  const rethrow = (error: Error & { cause?: Error }) => {
    throw failed(error.cause?.message ?? error.message);
  };
  const response = await fetch(url).catch(rethrow);
  if (response.status === 404) throw failed("the release tag was not found (HTTP 404)");
  if (!response.ok || !response.body) throw failed(`HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(file)).catch(rethrow);
}

async function sha256Of(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function installBundle({
  pin,
  file,
  url = releaseUrl(pin),
  target,
}: {
  pin: Pin;
  file?: string | undefined;
  url?: string;
  target: string;
}) {
  if ((await readFile(join(target, ".sha256"), "utf8").catch(undefinedIfMissing)) === pin.sha256)
    return { changed: false, sha256: pin.sha256 };
  const temp = await mkdtemp(`${target}.new-`);
  try {
    const tar = file ? resolve(file) : join(temp, "rxp-bundle.tar");
    if (!file) await download(url, tar);
    const found = await sha256Of(tar);
    if (found !== pin.sha256) throw new Error(`SHA-256 mismatch for ${file ?? url}: expected ${pin.sha256}, found ${found}`);
    const unpacked = join(temp, "data");
    await mkdir(unpacked);
    await promisify(execFile)("tar", ["-xf", tar, "-C", unpacked]);
    await writeFile(join(unpacked, ".sha256"), pin.sha256);
    const old = join(temp, "old");
    const hadOld = await rename(target, old).then(() => true, undefinedIfMissing);
    await rename(unpacked, target).catch(async (error: unknown) => {
      if (hadOld) await rename(old, target);
      throw error;
    });
    return { changed: true, sha256: pin.sha256 };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // pnpm runs the script in the repository root, and INIT_CWD is the folder where the user typed the command.
    const file = process.argv[2] && resolve(process.env.INIT_CWD ?? ".", process.argv[2]);
    const { changed, sha256 } = await installBundle({ pin: await readPin(), file, target: DATA_DIR });
    console.log(changed ? `Installed ${sha256} in ${DATA_DIR}.` : `Already installed: ${sha256} in ${DATA_DIR}.`);
    await ensureStopTable();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
