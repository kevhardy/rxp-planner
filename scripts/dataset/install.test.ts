import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installBundle, releaseUrl } from "./install.ts";

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close().closeAllConnections();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/rxp-bundle.tar`;
}

async function release(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "planner-install-"));
  directories.push(directory);
  const source = join(directory, "source");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), text);
  }
  const file = join(directory, "bundle.tar");
  execFileSync("tar", ["-cf", file, "-C", source, ...Object.keys(files)]);
  const sha256 = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  const parent = join(directory, "install");
  await mkdir(parent);
  return { file, sha256, parent, target: join(parent, ".local-data") };
}

const FIRST = { "bundle.json": '{"version":"1"}\n', "dataset/manifest.json": '{"id":"first"}\n' };

it("installs a local file with its exact bytes and records the hash", async () => {
  const { file, sha256, target } = await release(FIRST);
  expect(await installBundle({ pin: { sha256 }, file, target })).toEqual({ changed: true, sha256 });
  expect(await readFile(join(target, "bundle.json"), "utf8")).toBe('{"version":"1"}\n');
  expect(await readFile(join(target, "dataset/manifest.json"), "utf8")).toBe('{"id":"first"}\n');
  expect(await readFile(join(target, ".sha256"), "utf8")).toBe(sha256);
});

it("leaves an install of the pinned hash alone", async () => {
  const { file, sha256, target } = await release(FIRST);
  await installBundle({ pin: { sha256 }, file, target });
  await writeFile(join(target, "added.txt"), "kept");
  await rm(file);
  expect(await installBundle({ pin: { sha256 }, target })).toEqual({ changed: false, sha256 });
  expect(await readFile(join(target, "added.txt"), "utf8")).toBe("kept");
});

it("refuses a file with another hash before it unpacks, and keeps the old install", async () => {
  const { file, sha256, parent, target } = await release(FIRST);
  await installBundle({ pin: { sha256 }, file, target });
  const other = await release({ "bundle.json": '{"version":"2"}\n' });
  const expected = "0".repeat(64);
  await expect(installBundle({ pin: { sha256: expected }, file: other.file, target })).rejects.toThrow(
    `SHA-256 mismatch for ${other.file}: expected ${expected}, found ${other.sha256}`,
  );
  expect(await readFile(join(target, "bundle.json"), "utf8")).toBe('{"version":"1"}\n');
  expect(await readFile(join(target, ".sha256"), "utf8")).toBe(sha256);
  expect(await readdir(parent)).toEqual([".local-data"]);
});

it("builds the release URL from the first 12 hex digits of the pin", () => {
  expect(releaseUrl({ sha256: "02e84c02d112c4d0b8af38c1621240832adb7f7e1eb53fed8af9b778e95810a1" })).toBe(
    "https://github.com/kevhardy/rxp-planner/releases/download/data-02e84c02d112/rxp-bundle.tar",
  );
});

it("downloads the release file, installs it, and removes the download", async () => {
  const { file, sha256, parent, target } = await release(FIRST);
  const bytes = await readFile(file);
  const url = await serve((request, response) => {
    if (request.url !== "/rxp-bundle.tar") return response.writeHead(500).end();
    response.end(bytes);
  });
  await rm(file);
  expect(await installBundle({ pin: { sha256 }, url, target })).toEqual({ changed: true, sha256 });
  expect(await readFile(join(target, "dataset/manifest.json"), "utf8")).toBe('{"id":"first"}\n');
  expect(await readFile(join(target, ".sha256"), "utf8")).toBe(sha256);
  expect(await readdir(parent)).toEqual([".local-data"]);
});

const SECOND = { "bundle.json": '{"version":"2"}\n' };

async function failedDownload(handler: (bytes: Buffer) => RequestListener) {
  const first = await release(FIRST);
  await installBundle({ pin: { sha256: first.sha256 }, file: first.file, target: first.target });
  const second = await release(SECOND);
  const url = await serve(handler(await readFile(second.file)));
  const result = installBundle({ pin: { sha256: second.sha256 }, url, target: first.target });
  return { url, second, result, first };
}

async function expectFirstInstalled({ sha256, parent, target }: { sha256: string; parent: string; target: string }) {
  expect(await readFile(join(target, "bundle.json"), "utf8")).toBe('{"version":"1"}\n');
  expect(await readFile(join(target, ".sha256"), "utf8")).toBe(sha256);
  expect(await readdir(parent)).toEqual([".local-data"]);
}

it("refuses a download with another hash, and keeps the old install", async () => {
  const other = await release({ "bundle.json": '{"version":"3"}\n' });
  const otherBytes = await readFile(other.file);
  const { url, second, result, first } = await failedDownload(() => (_request, response) => response.end(otherBytes));
  await expect(result).rejects.toThrow(`SHA-256 mismatch for ${url}: expected ${second.sha256}, found ${other.sha256}`);
  await expectFirstInstalled(first);
});

it("says the release tag was not found on HTTP 404, and keeps the old install", async () => {
  const { url, result, first } = await failedDownload(() => (_request, response) => response.writeHead(404).end());
  await expect(result).rejects.toThrow(`Could not download ${url}: the release tag was not found (HTTP 404)`);
  await expectFirstInstalled(first);
});

it("fails when the server closes the connection early, and keeps the old install", async () => {
  const { url, result, first } = await failedDownload((bytes) => (_request, response) => {
    response.writeHead(200, { "Content-Length": bytes.length });
    response.write(bytes.subarray(0, bytes.length / 2), () => response.socket?.destroy());
  });
  await expect(result).rejects.toThrow(`Could not download ${url}: other side closed`);
  await expectFirstInstalled(first);
});
