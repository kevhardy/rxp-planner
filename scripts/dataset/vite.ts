import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { parseBundleRouting, type RoutingPin } from "../../src/routing/artifact.ts";
import { STOP_TABLE_FILE } from "../../src/routing/stop-table.ts";
import { ensureStopTable } from "../routing/stop-keys.ts";
import type { Version } from "../../src/app/version.ts";
import { datasetVersion } from "../version.ts";
import { DATA_DIR, datasetDir, validateInstalled, loadRouting, undefinedIfMissing, type Loaded } from "./local.ts";
import { errorText } from "../../src/data/errorText.ts";

const under = (prefix: string, data: Loaded) =>
  new Map([...data.files, ["manifest.json", data.manifestBytes] as const].map(([path, bytes]) => [`${prefix}/${path}`, bytes]));

export function localDataset({ data = DATA_DIR }: { data?: string } = {}): Plugin {
  let base = "/";
  let files = new Map<string, Uint8Array>();
  let failure: string | undefined;
  const routingFailures = new Map<string, string>();
  const addRouting = async (from: string, warn: (message: string) => void) => {
    let pins: RoutingPin[];
    try {
      const optional = (path: string) => readFile(join(from, path)).catch(undefinedIfMissing);
      const bundle = await optional("bundle.json");
      pins = bundle ? parseBundleRouting(JSON.parse(bundle.toString("utf8"))) : [];
      if (bundle) files.set("bundle.json", bundle);
      const table = await optional(STOP_TABLE_FILE);
      if (table) files.set(STOP_TABLE_FILE, table);
    } catch (error) {
      routingFailures.set("routing", `Routing is unavailable: ${errorText(error)}`);
      return warn(routingFailures.get("routing")!);
    }
    for (const pin of pins) {
      const { map } = pin;
      try {
        for (const [path, bytes] of under(`routing/m${map}`, await loadRouting(pin, from))) files.set(path, bytes);
      } catch (error) {
        routingFailures.set(`routing/m${map}`, `Routing is unavailable for map ${map}: ${errorText(error)}. Run pnpm data:install.`);
        warn(routingFailures.get(`routing/m${map}`)!);
      }
    }
  };
  const serve = (server: ViteDevServer | PreviewServer) => {
    const dev = "moduleGraph" in server;
    const root = dev ? server.config.root : resolve(server.config.root, server.config.build.outDir);
    const allowed = (dev ? ["src", "packages/data-contract", "node_modules"] : ["assets"]).map((path) => resolve(root, path));
    const allowedFiles = [resolve(root, "index.html")];
    server.middlewares.use((req, res, next) => {
      const reject = () => {
        res.statusCode = 404;
        res.end("Not served by the planner");
      };
      let path: string;
      try {
        path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      } catch {
        return reject();
      }
      if (!path.startsWith("/") || /[%\\\0]/.test(path) || path.split("/").some((part) => part === "." || part === "..")) return reject();
      // Vite may strip its configured base before middleware runs.
      const relative = path.startsWith(base) ? path.slice(base.length) : path.slice(1);
      const routing = relative.startsWith("routing/") || relative === "bundle.json" || relative === STOP_TABLE_FILE;
      if (!relative.startsWith("dataset/") && !routing && relative !== "data/rxp-forever.json.gz") {
        if (dev && ["@vite/client", "@vite/env", "@react-refresh"].includes(relative)) return next();
        // Vite's root, /@fs/ and ?raw/?import handlers otherwise expose repository
        // files. Admit only the app and dependencies, including their real paths.
        try {
          const file = realpathSync(
            relative.startsWith("@fs/") ? resolve("/", relative.slice(4)) : resolve(root, relative || "index.html"),
          );
          if (!allowedFiles.includes(file) && !allowed.some((directory) => file.startsWith(directory + sep))) return reject();
        } catch {
          return reject();
        }
        return next();
      }
      const bytes = files.get(relative);
      res.setHeader("Cache-Control", "no-store");
      if (!bytes) {
        const problem = routing ? (routingFailures.get(relative.split("/", 2).join("/")) ?? routingFailures.get("routing")) : failure;
        res.statusCode = problem ? 503 : 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(problem ?? (routing ? "No routing artifact asset" : "Undeclared dataset asset"));
        return;
      }
      res.setHeader("Content-Type", relative.endsWith(".json") ? "application/json" : "application/octet-stream");
      res.setHeader("Content-Length", bytes.byteLength);
      res.end(bytes);
    });
  };
  return {
    name: "local-dataset",
    async config(_config, env) {
      if (env.mode === "test" || env.isPreview) return { publicDir: false };
      let manifestHash: string | undefined;
      let version: Version | undefined;
      try {
        const dir = datasetDir(data);
        const dataset = await validateInstalled(dir);
        files = under("dataset", dataset);
        manifestHash = dataset.manifestHash;
        const installed = resolve(dir) === resolve(data, "dataset");
        const bundleSha256 = installed ? await readFile(join(data, ".sha256"), "utf8").catch(undefinedIfMissing) : undefined;
        version = datasetVersion({ bundleSha256, release: dataset.manifest.release });
      } catch (error) {
        failure = errorText(error);
        if (env.command === "build") throw error;
        console.warn(failure);
      }
      const table = await ensureStopTable(data).then(
        () => true,
        (error: unknown) => console.warn(`The stop key table is unavailable: ${errorText(error)}`),
      );
      await addRouting(data, console.warn);
      if (!table) files.delete(STOP_TABLE_FILE);
      files.set("data/rxp-forever.json.gz", await readFile(new URL("../../public/data/rxp-forever.json.gz", import.meta.url)));
      return {
        publicDir: false,
        define: {
          "import.meta.env.VITE_DATASET_MANIFEST_HASH": manifestHash === undefined ? "undefined" : JSON.stringify(manifestHash),
          "import.meta.env.VITE_DATASET_VERSION": version === undefined ? "undefined" : JSON.stringify(JSON.stringify(version)),
        },
      };
    },
    configResolved(config) {
      base = config.base;
    },
    configureServer: serve,
    async configurePreviewServer(server) {
      const out = resolve(server.config.root, server.config.build.outDir);
      try {
        files = under("dataset", await validateInstalled(join(out, "dataset")));
      } catch (error) {
        failure = errorText(error);
        server.config.logger.warn(failure);
      }
      await addRouting(out, (message) => server.config.logger.warn(message));
      files.set("data/rxp-forever.json.gz", await readFile(resolve(out, "data/rxp-forever.json.gz")));
      serve(server);
    },
    generateBundle() {
      for (const [fileName, source] of files) this.emitFile({ type: "asset", fileName, source });
    },
  };
}
