import { useEffect, useEffectEvent, useSyncExternalStore, type ReactNode } from "react";
import type { InstanceId } from "../../data/index.ts";
import { CELLS, type Tile } from "../../routing/artifact.ts";
import { rideWalks, type JourneyLeg } from "../../routing/journey.ts";
import { ROUTER_LAYERS, isSearchLayer, layerCells, type LayerStyle, type RouterLayer, type SearchLayer } from "../../routing/layers.ts";
import { keepNewest } from "../../routing/kept.ts";
import type { RoutePlan } from "../../routing/plan.ts";
import type { Frame } from "../map/viewport.ts";
import { PopoverMenu } from "../map/PopoverMenu.tsx";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { rgbaColor } from "../theme/colors.ts";
import type { MapRouting } from "./engine.ts";
import { layerKey, type LayerPainter, type LayerSearch, type LayerTile } from "./layerPainter.ts";
import type { Projection } from "./lines.ts";

const VIEW_CHOICES = [
  { id: "image", label: "Map image" },
  { id: "rides", label: "Rides" },
  { id: "plans", label: "Floor plans inside" },
  { id: "mobs", label: "Mobs and respawns" },
] as const;
const ROUTER_CHOICES_BOTTOM_FIRST = [
  { id: "shading", label: "Terrain shading" },
  { id: "steep", label: "Too steep" },
  { id: "water", label: "Water and hazards" },
  { id: "floors", label: "Floors" },
  { id: "buildings", label: "Buildings and doors" },
  { id: "reachable", label: "Reachable from here", need: "Select a stop.", leaves: "Only the cells within 2 tiles of the stop show." },
  {
    id: "explored",
    label: "Explored cells",
    need: "Open a leg.",
    leaves: "The end of the leg has no mark. A leg that the router proves has no route before it searches has no marks.",
  },
] as const satisfies readonly { id: RouterLayer; label: string; need?: string; leaves?: string }[];
const CHOICES = [...VIEW_CHOICES, ...ROUTER_CHOICES_BOTTOM_FIRST];
const isViewChoice = (id: (typeof CHOICES)[number]["id"]): id is (typeof VIEW_CHOICES)[number]["id"] =>
  VIEW_CHOICES.some((choice) => choice.id === id);
export type LayerChoices = Record<(typeof CHOICES)[number]["id"], boolean>;

export const DEFAULT_LAYERS: LayerChoices = {
  image: true,
  rides: true,
  plans: false,
  mobs: true,
  shading: false,
  steep: false,
  water: false,
  floors: false,
  buildings: false,
  reachable: false,
  explored: false,
};

const SAVED: SavedSetting<LayerChoices> = {
  key: "route-layers",
  unsavedKey: "restedxp-planner:unsaved-route-layers",
  read: (saved) => {
    const value = (typeof saved === "object" && saved) || {};
    return Object.fromEntries(
      CHOICES.map(({ id }) => {
        const on = (value as Record<string, unknown>)[id];
        return [id, typeof on === "boolean" ? on : DEFAULT_LAYERS[id]];
      }),
    ) as LayerChoices;
  },
  defaults: DEFAULT_LAYERS,
  name: "the route map layers",
};

export const loadLayerChoices = (): Promise<LayerChoices> => loadSaved(SAVED);
export const saveLayerChoices = (choices: LayerChoices): void => saveSaved(SAVED, choices);

const MIN_TILE_PIXELS = 96;

export interface TileRect extends Frame {
  map: InstanceId;
  tile: Tile;
}

export function tileRects(proj: Projection, maps: readonly MapRouting[]): TileRect[] {
  return maps.flatMap(({ manifest }) => {
    const { map } = manifest.scope;
    const size = manifest.frame.tilePixels;
    return manifest.tiles.flatMap(({ tile, state }) => {
      const [x, y] = tile;
      const a = state === "present" && proj.toView([x * size, y * size], map);
      const b = a && proj.toView([(x + 1) * size, (y + 1) * size], map);
      if (!a || !b) return [];
      return [{ map, tile, left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }];
    });
  });
}

export type LayerSearches = Partial<Record<SearchLayer, { map: InstanceId; search: LayerSearch }>>;

const KEPT_SEARCH_IDS = 32;
const searchIds = new Map<string, string>();
let madeIds = 0;
const searchId = (search: string) => {
  const id = searchIds.get(search) ?? (madeIds++).toString(36);
  keepNewest(searchIds, search, id, KEPT_SEARCH_IDS);
  return id;
};

export function layerSearches(
  plan: RoutePlan | null,
  mode: string | undefined,
  selected: { stop: number } | { leg: number } | null,
  journey: readonly (JourneyLeg | undefined)[] = [],
): LayerSearches {
  if (!plan || mode === undefined || !selected) return {};
  const ground = (leg: number) => leg >= 0 && leg < plan.legs.length && plan.stops[leg]!.instance === plan.stops[leg + 1]!.instance;
  const walks = Array.from(plan.legs, (_, i) => rideWalks(journey[i]));
  const searchOf = (leg: number, stop: number) => {
    const id = searchId(JSON.stringify([{ ...plan, id: undefined }, mode, leg, stop, walks]));
    return { map: plan.stops[leg]!.instance, search: { id, plan, mode, leg, stop, walks } };
  };
  if ("leg" in selected) return ground(selected.leg) ? { explored: searchOf(selected.leg, selected.leg) } : {};
  const leg = [selected.stop, selected.stop - 1].find(ground);
  return leg === undefined ? {} : { reachable: searchOf(leg, selected.stop) };
}

const routerLayers = (choices: LayerChoices): RouterLayer[] => ROUTER_CHOICES_BOTTOM_FIRST.flatMap(({ id }) => (choices[id] ? [id] : []));

function wantedTiles(
  tiles: readonly TileRect[],
  frame: Frame,
  pxPerPercent: number,
  choices: LayerChoices,
  maxSlope: number,
  searches: LayerSearches = {},
) {
  const layers = routerLayers(choices);
  const shown = tiles.filter(
    (t) =>
      t.width * pxPerPercent >= MIN_TILE_PIXELS &&
      t.left < frame.left + frame.width &&
      t.left + t.width > frame.left &&
      t.top < frame.top + frame.height &&
      t.top + t.height > frame.top,
  );
  if (!layers.length || !shown.length) return [];
  const cx = frame.left + frame.width / 2,
    cy = frame.top + frame.height / 2;
  const away = (t: TileRect) => Math.hypot(t.left + t.width / 2 - cx, t.top + t.height / 2 - cy);
  return shown
    .sort((a, b) => away(a) - away(b))
    .flatMap((rect) =>
      layers.flatMap((layer): (LayerTile & { rect: TileRect })[] => {
        const wanted = { map: rect.map, tile: rect.tile, layer, maxSlope, rect };
        if (!isSearchLayer(layer)) return [wanted];
        const found = searches[layer];
        return found?.map === rect.map ? [{ ...wanted, search: found.search }] : [];
      }),
    );
}

export function RouterLayers(props: {
  painter: LayerPainter;
  tiles: readonly TileRect[];
  frame: Frame;
  pxPerPercent: number;
  choices: LayerChoices;
  maxSlope: number;
  searches: LayerSearches;
}) {
  const { painter } = props;
  useSyncExternalStore(painter.subscribe, painter.version);
  const wanted = wantedTiles(props.tiles, props.frame, props.pxPerPercent, props.choices, props.maxSlope, props.searches);
  const keys = wanted.map(layerKey);
  const wish = keys.join(" ");
  const want = useEffectEvent(() => painter.want(wanted));
  useEffect(() => want(), [painter, wish]);
  const order = routerLayers(props.choices);
  const drawn = wanted.map((t, i) => ({ ...t, key: keys[i]!, url: painter.image(keys[i]!) }));
  drawn.sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
  return (
    <>
      {drawn.map(
        ({ key, url, rect, layer }) =>
          url && (
            <img
              key={key}
              className="router-layer"
              src={url}
              style={{
                "--at-x": `${rect.left}%`,
                "--at-y": `${rect.top}%`,
                "--size-w": `${(rect.width * layerCells(layer)) / CELLS}%`,
                "--size-h": `${(rect.height * layerCells(layer)) / CELLS}%`,
              }}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          ),
      )}
    </>
  );
}

export function LayersMenu(props: {
  choices: LayerChoices;
  searches: LayerSearches;
  hasInteriors: boolean;
  mobsLegend?: ReactNode;
  onChange: (choices: LayerChoices) => void;
}) {
  const { choices } = props;
  return (
    <PopoverMenu className="route-menu route-layers" label="Layers" description="Rides, and what the ground router sees">
      {CHOICES.map((choice) => {
        if ((choice.id === "plans" && !props.hasInteriors) || (choice.id === "mobs" && props.mobsLegend === undefined)) return null;
        const { id, label } = choice;
        const style: LayerStyle | undefined = isViewChoice(id) ? undefined : ROUTER_LAYERS[id];
        const need = "need" in choice && !props.searches[choice.id] ? choice.need : undefined;
        return (
          <div key={id}>
            <Checkbox label={label} checked={choices[id]} onChange={(e) => props.onChange({ ...choices, [id]: e.target.checked })} />
            {choices[id] && need && <p className="muted">{need}</p>}
            {choices[id] && id === "mobs" && props.mobsLegend}
            {choices[id] && !need && "leaves" in choice && <p className="muted">{choice.leaves}</p>}
            {choices[id] && !need && style?.colors && (
              <ul className="layer-legend">
                {style.colors.map((color, k) => (
                  <li key={k}>
                    <span className="layer-swatch" style={{ "--fill": rgbaColor(color) }} />
                    {style.classes[k + 1]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="muted">Router layers show when you zoom in.</p>
    </PopoverMenu>
  );
}
