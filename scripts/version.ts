import { execFileSync } from "node:child_process";
import type { Version } from "../src/app/version.ts";

const SOURCE_REPO = "https://github.com/kevhardy/rxp-planner";

export interface Commit {
  sha: string;
  short: string;
  dirty: boolean;
}

/**
 * `tag` is `APP_VERSION`, which a release build sets to its `vX.Y.Z` tag. `commit` is undefined
 * without git, and the source link then names the repository, since AGPL section 13 needs one.
 */
export function appVersion({ tag, commit }: { tag: string | undefined; commit: Commit | undefined }): Version {
  if (tag) return { name: tag, url: `${SOURCE_REPO}/tree/${tag}` };
  if (!commit) return { name: "dev", url: SOURCE_REPO };
  return { name: commit.dirty ? `${commit.short}-dirty` : commit.short, url: `${SOURCE_REPO}/tree/${commit.sha}` };
}

export function readCommit(cwd: string): Commit | undefined {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { sha: git("rev-parse", "HEAD"), short: git("rev-parse", "--short", "HEAD"), dirty: git("status", "--porcelain") !== "" };
  } catch {
    return undefined;
  }
}

export function datasetVersion({ bundleSha256, release }: { bundleSha256: string | undefined; release: string }): Version {
  if (!bundleSha256) return { name: `${release} (custom)` };
  const tag = `data-${bundleSha256.slice(0, 12)}`;
  return { name: tag, url: `${SOURCE_REPO}/releases/tag/${tag}` };
}
