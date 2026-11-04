import {
  mapToWorld,
  worldToCanvas,
  type GameData,
  type MapLocation,
  type UiMapId,
  type WorldBounds,
  type WorldLocation,
  type WorldMapData,
} from "../../data/index.ts";
import type { Step } from "../../guide/index.ts";
import type { Fit, Frame } from "./viewport.ts";
import { stepLocations, type StepPoints } from "../../rules/points.ts";
import { locateOnTerrain, type Placed, type ViewPoint } from "./points.ts";
import { canvasSize, canvasToView, TERRAIN_ASPECT_ZOOM, viewToCanvas } from "./viewport.ts";

export interface Surface {
  key: string;
  name: string;
  aspect: number;
  maxZoom: (w: number) => number;
  place(step: Step): StepPoints<Placed>;
  mapOf(point: MapLocation): UiMapId;
  describe(point: MapLocation): string;
  project(location: MapLocation): ViewPoint | undefined;
  projectOutline(world: WorldLocation): ViewPoint | undefined;
  locate(at: ViewPoint, prefer?: MapLocation): MapLocation | undefined;
  fitMap(uiMapId: UiMapId): Fit | undefined;
}

export function terrainSurface(data: GameData, map: WorldMapData, cache: WeakMap<Step, StepPoints<Placed>>): Surface {
  map = data.terrainMap(map);
  const size = canvasSize(map);
  const pxPerYard = map.pxPerChunk / map.yardsPerChunk;
  const mapName = (uiMapId: UiMapId) => data.mapName(uiMapId);
  const projectWorld = (world: MapLocation["world"]) => {
    const at = worldToCanvas(map, world);
    return at && canvasToView(map, at);
  };
  const rect = (x: number, y: number, width: number, height: number): Frame => ({
    left: ((x - size.left) / size.width) * 100,
    top: (y / size.height) * 100,
    width: (width / size.width) * 100,
    height: (height / size.height) * 100,
  });
  const areaOf = (instance: number) => map.areas.find((a) => a.map === instance);
  const placed = (p: MapLocation): MapLocation => {
    if (!data.continentByUiMapId(p.uiMapId)) return p;
    const at = worldToCanvas(map, p.world);
    return (at && locateOnTerrain(data, map, at)) ?? p;
  };
  return {
    key: "terrain",
    name: "Azeroth (terrain)",
    aspect: size.width / size.height,
    maxZoom: (w) => (TERRAIN_ASPECT_ZOOM * size.width) / w,
    place: (step) =>
      cached(cache, step, () => {
        const located = stepLocations(data, step);
        const staged = <P extends MapLocation>(p: P) => {
          const at = projectWorld(p.world);
          return at && { ...p, at };
        };
        const problems = [...located.problems];
        const points = located.points.flatMap((p) => {
          const point = staged(p);
          if (point) return [point];
          problems.push({ line: p.line, command: p.command, message: `The terrain map does not show ${mapName(p.uiMapId)}.` });
          return [];
        });
        const paths = located.paths.flatMap((path) => {
          const pathPoints = path.points.map(staged);
          if (pathPoints.every((p) => p !== undefined)) return [{ ...path, points: pathPoints }];
          problems.push({
            line: path.line,
            command: path.command,
            message: `The terrain map does not show ${mapName(path.points[0]!.uiMapId)}.`,
          });
          return [];
        });
        return { ...located, points, paths, problems: problems.sort((a, b) => a.line - b.line) };
      }),
    mapOf: (p) => placed(p).uiMapId,
    describe: (p) => {
      const q = placed(p);
      return `${mapName(q.uiMapId)} ${q.x.toFixed(2)}, ${q.y.toFixed(2)}`;
    },
    project: (p) => projectWorld(p.world),
    projectOutline: (world) => {
      const area = areaOf(world.instance);
      return (
        area &&
        canvasToView(map, {
          x: area.canvasX + (32 - world.x / map.yardsPerChunk - area.originCol) * map.pxPerChunk,
          y: area.canvasY + (32 - world.y / map.yardsPerChunk - area.originRow) * map.pxPerChunk,
        })
      );
    },
    locate: (at, prefer) => locateOnTerrain(data, map, viewToCanvas(map, at), prefer && placed(prefer).uiMapId),
    fitMap: (uiMapId) => {
      const bounds = data.mapBounds.get(uiMapId);
      if (!bounds) return undefined;
      const area = areaOf(bounds.instance);
      if (!area) return undefined;
      if (data.continentByUiMapId(uiMapId) || uiMapId === ZEPHRAS_ISLE) {
        return rect(area.canvasX + area.cropLeft, area.canvasY, area.width - area.cropLeft, area.height);
      }
      const center = worldToCanvas(map, { instance: bounds.instance, ...mapToWorld(bounds, 50, 50) });
      if (!center) return undefined;
      const [width, height] = [yardsWide(bounds) * pxPerYard, yardsTall(bounds) * pxPerYard];
      return rect(center.x - width / 2, center.y - height / 2, width, height);
    },
  };
}

const ZEPHRAS_ISLE = 2521;

/** HereBeDragons' x runs along the game's Y axis, so a map's width in yards is its Y extent. */
const yardsWide = (b: WorldBounds) => b.maxY - b.minY;
const yardsTall = (b: WorldBounds) => b.maxX - b.minX;

function cached(cache: WeakMap<Step, StepPoints<Placed>>, step: Step, compute: () => StepPoints<Placed>): StepPoints<Placed> {
  let points = cache.get(step);
  if (!points) cache.set(step, (points = compute()));
  return points;
}
