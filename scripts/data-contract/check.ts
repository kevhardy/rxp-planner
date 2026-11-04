import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guideIconsFixture, interiorsFixture, transportsFixture } from "../../src/data/manifestFixture.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "data-contract-"));
mkdirSync(output, { recursive: true });
const run = (command: string, args: string[], cwd = root) => {
  const result = execFileSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  process.stdout.write(result);
  return result;
};
run("pnpm", ["contract:build"]);
run("pnpm", ["pack", "--out", join(output, "contract.tgz")], join(root, "packages/data-contract"));
const tarball = join(output, "contract.tgz");
const contents = run("tar", ["-tzf", tarball]).trim().split("\n");
assert(
  contents.every((path) => /^package\/(package\.json|LICENSE|dist\/[A-Za-z]+\.(js|d\.ts))$/.test(path)),
  "Unexpected packed file",
);
const consumer = mkdtempSync(join(output, "consumer-"));
const json = (name: string, value: unknown) => writeFileSync(join(consumer, name), JSON.stringify(value, null, 2) + "\n");
copyFileSync(tarball, join(consumer, "contract.tgz"));
json("package.json", { private: true, type: "module", dependencies: { "@rxp-planner/data-contract": "file:./contract.tgz" } });
run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
const installed = join(consumer, "node_modules/@rxp-planner/data-contract");
assert(realpathSync(installed).startsWith(consumer + "/"), "Package must be installed, not linked to workspace");
const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as Record<string, unknown>;
for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  assert.equal(Object.keys(pkg[field] ?? {}).length, 0, `Unexpected ${field}`);
}
const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8")) as { packages: Record<string, unknown> };
assert.deepEqual(Object.keys(lock.packages).sort(), ["", "node_modules/@rxp-planner/data-contract"]);
for (const name of readdirSync(join(installed, "dist"))) {
  const code = readFileSync(join(installed, "dist", name), "utf8");
  for (const match of code.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1]!;
    assert(/^\.\/[A-Za-z]+\.(ts|js)$/.test(specifier), `Nonlocal import: ${specifier}`);
    const target = name.endsWith(".d.ts") ? specifier.replace(/\.(ts|js)$/, ".d.ts") : specifier;
    readFileSync(join(installed, "dist", target));
  }
}
const f = guideIconsFixture(transportsFixture(interiorsFixture()));
f.quests.npcs = {
  594: {
    spawns: [
      { world: { instance: 0, x: 1515.71, y: -11093.9 }, z: 29.6174, guid: 89539, interior: "the-deadmines-35530" },
      { world: { instance: 0, x: 1448.67, y: -11010 } },
    ],
    provenance: { fields: { spawns: { source: "Independent/one" } } },
  },
};
f.replace("quests.json", f.quests);
const fileList = (files: Map<string, Uint8Array>) => [...files].map(([path, bytes]) => ({ path, bytes: [...bytes] }));
json("fixture.json", {
  manifest: f.manifest,
  files: fileList(f.files),
  references: { version: 1, references: [{ edition: "forever", type: "quest", id: 890 }] },
});
copyFileSync(join(root, "scripts/data-contract/consumer.ts"), join(consumer, "consumer.ts"));
json("tsconfig.json", {
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    module: "NodeNext",
    moduleResolution: "NodeNext",
    types: [],
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    resolveJsonModule: true,
    outDir: "out",
    noEmitOnError: true,
  },
  include: ["consumer.ts"],
});
const typeFiles = run(join(root, "node_modules/.bin/tsc"), ["-p", join(consumer, "tsconfig.json"), "--listFiles"], consumer)
  .trim()
  .split("\n");
// The platform compiler package holds TypeScript's standard library.
const compilerRequire = createRequire(realpathSync(join(root, "node_modules/typescript/package.json")));
const compiler = dirname(compilerRequire.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`));
for (const path of typeFiles) {
  const actual = realpathSync(path);
  assert(actual.startsWith(consumer + "/") || actual.startsWith(compiler + "/"), `Typecheck read outside consumer/toolchain: ${path}`);
}
run(process.execPath, ["--permission", `--allow-fs-read=${consumer}`, join(consumer, "out/consumer.js")], consumer);
run("npm", ["ls", "--all", "--offline"], consumer);
writeFileSync(
  join(output, "verification.json"),
  JSON.stringify(
    {
      package: pkg.name,
      version: pkg.version,
      tarball,
      sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
      consumer,
      contents,
      typeFiles,
      node: process.version,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Verified local artifact: ${tarball}\nEvidence: ${output}`);
