import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { appVersion, datasetVersion, readCommit } from "./version.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "planner-version-"));
  directories.push(directory);
  return directory;
}

const commit = { sha: "1d3a6988c0ffee0123456789abcdef0123456789", short: "1d3a698", dirty: false };

it("names a release build by its tag and links the source at that tag", () => {
  expect(appVersion({ tag: "v0.1.0", commit: { ...commit, dirty: true } })).toEqual({
    name: "v0.1.0",
    url: "https://github.com/kevhardy/rxp-planner/tree/v0.1.0",
  });
});

it("names another build by its short commit and links the source at the full commit", () => {
  const url = "https://github.com/kevhardy/rxp-planner/tree/1d3a6988c0ffee0123456789abcdef0123456789";
  expect(appVersion({ tag: undefined, commit })).toEqual({ name: "1d3a698", url });
  expect(appVersion({ tag: "", commit: { ...commit, dirty: true } })).toEqual({ name: "1d3a698-dirty", url });
});

it("names a build without git dev and links the repository", () => {
  expect(appVersion({ tag: undefined, commit: undefined })).toEqual({ name: "dev", url: "https://github.com/kevhardy/rxp-planner" });
});

it("reads the commit, and marks it dirty for a changed or untracked file", async () => {
  const directory = await temporary();
  expect(readCommit(directory)).toBeUndefined();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  await writeFile(join(directory, "a.txt"), "a");
  git("add", "a.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "first");
  const sha = git("rev-parse", "HEAD");
  expect(readCommit(directory)).toEqual({ sha, short: expect.stringMatching(new RegExp(`^${sha.slice(0, 7)}`)), dirty: false });
  await writeFile(join(directory, "a.txt"), "b");
  expect(readCommit(directory)?.dirty).toBe(true);
  git("checkout", "--quiet", "a.txt");
  await writeFile(join(directory, "b.txt"), "new");
  expect(readCommit(directory)?.dirty).toBe(true);
});

it("names an installed release file by its release tag and links its release page", () => {
  const bundleSha256 = "02e84c02d112c4d0b8af38c1621240832adb7f7e1eb53fed8af9b778e95810a1";
  expect(datasetVersion({ bundleSha256, release: "v1-410-gaaa105ee9" })).toEqual({
    name: "data-02e84c02d112",
    url: "https://github.com/kevhardy/rxp-planner/releases/tag/data-02e84c02d112",
  });
});

it("names another dataset folder by its manifest release, with no link", () => {
  expect(datasetVersion({ bundleSha256: undefined, release: "v1-410-gaaa105ee9" })).toEqual({ name: "v1-410-gaaa105ee9 (custom)" });
});
