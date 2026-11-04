import type { MapBoundsRecords, WorldBounds } from "./geometry.ts";
import type { WorldMapData } from "./worldMap.ts";
import { WORLD_MAP_AREAS } from "./worldMap.ts";
import { fields, finite, natural, positive, object, name, text, list, optional, oneOf, pair, requireValid, unique } from "./checks.ts";

export const worldBounds = (v: unknown): v is WorldBounds =>
  fields(v, { instance: natural, minX: finite, minY: finite, maxX: finite, maxY: finite }) && v.minX < v.maxX && v.minY < v.maxY;

export function validateMapBounds(input: unknown): asserts input is MapBoundsRecords {
  requireValid(object(input) && Object.keys(input).length > 0, "map bounds table");
  for (const [id, bounds] of Object.entries(input))
    requireValid(positive(Number(id)) && String(Number(id)) === id && worldBounds(bounds), `map bounds ${id}`);
}

export function validateWorldMapData(input: unknown): asserts input is WorldMapData {
  requireValid(
    fields(input, {
      version: oneOf(1),
      tileSize: positive,
      minZoom: natural,
      nativeZoom: natural,
      pxPerChunk: (v) => finite(v) && v > 0,
      yardsPerChunk: (v) => finite(v) && v > 0,
      canvas: (v) => fields(v, { left: finite, width: finite, height: finite }),
      areas: list(object),
      groups: list((v) => fields(v, { key: name, name })),
      categories: list(object),
      places: list(object),
      pois: list(object),
      routes: list(object),
    }),
    "world map schema",
  );
  requireValid(
    input.minZoom <= input.nativeZoom && input.nativeZoom <= 30 && input.canvas.left < input.canvas.width && input.canvas.height > 0,
    "world map extent",
  );
  requireValid(
    input.areas.length === WORLD_MAP_AREAS.length && unique(input.areas.map((a) => a.key)) && unique(input.areas.map((a) => a.map)),
    "world map area coverage",
  );
  for (const a of input.areas) {
    requireValid(
      fields(a, {
        key: oneOf(...WORLD_MAP_AREAS),
        map: natural,
        width: positive,
        height: positive,
        canvasX: finite,
        canvasY: finite,
        originCol: natural,
        originRow: natural,
        cropLeft: natural,
        tiles: object,
      }) &&
        a.cropLeft < a.width &&
        a.originCol < 64 &&
        a.originRow < 64,
      `area ${a.key}`,
    );
    requireValid(Object.keys(a.tiles).length === input.nativeZoom - input.minZoom + 1, `area ${a.key} zoom coverage`);
    for (let zoom = input.minZoom; zoom <= input.nativeZoom; zoom++) {
      const runs = a.tiles[zoom];
      requireValid(Array.isArray(runs) && runs.length > 0, `area ${a.key} zoom ${zoom}`);
      const size = input.tileSize * 2 ** (input.nativeZoom - zoom);
      const rows = new Map<number, number>();
      for (const run of runs) {
        requireValid(Array.isArray(run) && run.length === 3 && run.every(natural), `area ${a.key} tile run`);
        const row = run[0]!,
          first = run[1]!,
          last = run[2]!;
        requireValid(
          first <= last &&
            row < Math.ceil(a.height / size) &&
            last < Math.ceil(a.width / size) &&
            (first + 1) * size > a.cropLeft &&
            first > (rows.get(row) ?? -1),
          `area ${a.key} tile range`,
        );
        rows.set(row, last);
      }
    }
  }
  requireValid(
    input.groups.length && input.categories.length && unique(input.groups.map((g) => g.key)) && unique(input.categories.map((c) => c.key)),
    "world map categories",
  );
  const groups = new Set(input.groups.map((g) => g.key));
  for (const c of input.categories)
    requireValid(
      fields(c, {
        key: name,
        group: (v) => typeof v === "string" && groups.has(v),
        name,
        icon: name,
        startsOff: optional(oneOf(true)),
        labelMinZoom: optional(finite),
        labelLayer: optional(name),
      }),
      `category ${c.key}`,
    );
  const position = { area: oneOf(...WORLD_MAP_AREAS), x: finite, y: finite };
  const side = oneOf(0, 1, 2);
  for (const p of input.places)
    requireValid(
      fields(p, {
        ...position,
        name,
        kind: oneOf("zone", "capital", "landmark"),
        minZoom: finite,
        roomZoom: optional(finite),
        side: optional(side),
        levels: optional(text),
        new: optional(oneOf(true)),
      }),
      "world map place",
    );
  const routes = new Map(
    input.routes.map((r) => {
      requireValid(
        fields(r, {
          id: name,
          path: positive,
          vessel: oneOf("ship", "zeppelin"),
          color: natural,
          points: list(pair),
          oneWay: optional(oneOf(true)),
          new: optional(oneOf(true)),
        }) &&
          r.color <= 0xffffff &&
          r.points.length >= 2,
        "world map route",
      );
      return [r.id, r];
    }),
  );
  requireValid(routes.size === input.routes.length, "world map route");
  const categories = new Set(input.categories.map((c) => c.key));
  for (const p of input.pois) {
    requireValid(
      fields(p, {
        ...position,
        name,
        label: optional(text),
        category: (v) => typeof v === "string" && categories.has(v),
        side,
        level: finite,
        entity: optional((v) => fields(v, { type: oneOf("npc", "item"), id: positive })),
        levels: optional(text),
        paths: optional(list(positive)),
        links: optional(list((v) => fields(v, { route: name, arrival: optional(pair) }))),
        group: optional(name),
        groupName: optional(text),
        new: optional(oneOf(true)),
      }),
      "world map pin",
    );
    for (const link of p.links ?? []) {
      const route = routes.get(link.route);
      requireValid(route && p.paths?.includes(route.path), "pin route reference");
      const [first, last] = [route.points[0]!, route.points.at(-1)!];
      const at = (end: readonly [number, number]) => end[0] === link.arrival?.[0] && end[1] === link.arrival?.[1];
      requireValid(
        !link.arrival || (route.oneWay ? at(last) && p.x === first[0] && p.y === first[1] : at(first) || at(last)),
        "pin route arrival",
      );
    }
  }
}
