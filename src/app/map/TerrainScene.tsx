import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { worldMapTilePath, type LoadedWorldMap, type WorldMapData, type WorldMapPoi } from "../../data/index.ts";
import { useAssets, useEventListener } from "../effects.ts";
import { ItemButton, MarkButton } from "../ui/ItemButton.tsx";
import type { Frame } from "./MapCanvas.tsx";
import { mapTiles } from "./mapAssets.ts";
import { MapIconImage } from "./MapIconImage.tsx";
import { isCategoryId, useMapProfile, useMapSettings, type CategoryId } from "./mapSettings.ts";
import {
  groupMarkers,
  showsSide,
  tileZoom,
  visibleTiles,
  zoomLevel,
  type PlacedPlace,
  type PlacedPoi,
  type TerrainFeatures,
} from "./terrain.ts";
import { clearLabels, labelShows, nameSide, pickLabels } from "./labels.ts";
import type { ViewPoint } from "./points.ts";
import { useMapView } from "./view.ts";
import { canvasSize, mapCover } from "./viewport.ts";

const CULL_MARGIN_PX = 128;
const LABEL_FONT_PX = 11;
const ICON_AND_GAP_PX = 32;
// The largest icon a caller passes in `icons`: the ride mark in a wide map.
const ICON_PX = 18;
const QUEST_ICON_PX = 16;

// A continent fills the map near level 1.5 and a zone near levels 4 to 6. From about level 3, the water that the tiles
// bake in along each coast shows as dark blocks against a lighter backdrop.
const SEA_LEVEL = 3;

const FULL: Frame = { left: 0, top: 0, width: 100, height: 100 };

const detail = (map: WorldMapData, pxPerPercent: number) => (pxPerPercent * 100) / canvasSize(map).width;

export function TerrainScene(props: { map: LoadedWorldMap; frame: Frame; pxPerPercent: number; attempt: number; onTileError: () => void }) {
  const { map, frame, pxPerPercent, attempt, onTileError } = props;
  const [failed, setFailed] = useState({ map, attempt, paths: new Set<string>() });
  const hidden = failed.map === map && failed.attempt === attempt ? failed.paths : undefined;
  const zoom = tileZoom(map, detail(map, pxPerPercent) * (globalThis.devicePixelRatio || 1));
  const tiles = visibleTiles(map, map.minZoom, FULL);
  if (zoom !== map.minZoom) tiles.push(...visibleTiles(map, zoom, frame));
  // Callers pass a new `onTileError` on each render, so the tiles read the latest one and keep their props through a pan.
  const notify = useRef(onTileError);
  notify.current = onTileError;
  const failTile = useCallback(
    (path: string) => {
      setFailed((f) => ({ map, attempt, paths: new Set(f.map === map && f.attempt === attempt ? f.paths : []).add(path) }));
      notify.current();
    },
    [map, attempt],
  );
  return (
    <>
      {zoomLevel(map, detail(map, pxPerPercent)) >= SEA_LEVEL && <span className="terrain-sea" hidden />}
      {tiles.map((t) => {
        const path = worldMapTilePath(t.area, t.zoom, t.x, t.y);
        if (hidden?.has(path)) return null;
        return (
          <TerrainTile
            key={`${t.area}/${t.zoom}/${t.y}/${t.x}`}
            map={map}
            path={path}
            onTileError={failTile}
            left={t.left}
            top={t.top}
            width={t.width}
            height={t.height}
          />
        );
      })}
    </>
  );
}

const TerrainTile = memo(function TerrainTile(props: {
  map: LoadedWorldMap;
  path: string;
  onTileError: (path: string) => void;
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  const { path, onTileError } = props;
  const [tile] = useAssets(
    mapTiles(props.map),
    useMemo(() => [path], [path]),
  );
  const notifyTileError = useEffectEvent(() => onTileError(path));
  useEffect(() => {
    if (tile?.kind === "failed") notifyTileError();
  }, [tile]);
  if (tile?.kind !== "ready") return null;
  return (
    <img
      className="tile"
      src={tile.value}
      style={{ "--at-x": `${props.left}%`, "--at-y": `${props.top}%`, "--size-w": `${props.width}%`, "--size-h": `${props.height}%` }}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => onTileError(path)}
    />
  );
});

export function TerrainMarkers(props: {
  map: WorldMapData;
  features: TerrainFeatures;
  shows: (category: CategoryId) => boolean;
  marked: { pois: PlacedPoi[]; places: PlacedPlace[] };
  onPick: (poi: WorldMapPoi) => void;
  frame: Frame;
  pxPerPercent: number;
  /** Where the caller draws map icons that zone labels move clear of, at a given scale. */
  icons?: (pxPerPercent: number) => readonly ViewPoint[];
  /** Where quest markers draw. A point's name moves to the other side of its icon to clear them. */
  quests?: readonly ViewPoint[];
}) {
  const { map, features, shows, frame, pxPerPercent, icons } = props;
  const { allFactions } = useMapSettings();
  const { faction } = useMapProfile();
  const k = detail(map, pxPerPercent);
  const level = zoomLevel(map, k);
  const on = map.categories.flatMap((c) => (isCategoryId(c.key) && shows(c.key) ? [c.key] : [])).join(" ");
  const marked = props.marked.pois;
  const rows = useMemo(() => {
    const shown = new Set(on.split(" "));
    const same = (a: PlacedPoi, b: PlacedPoi) => a.poi === b.poi && a.at.x === b.at.x && a.at.y === b.at.y;
    const pois = features.pois.filter(
      (p) => shown.has(p.category.key) && level >= p.poi.level && showsSide(p.poi, faction, allFactions) && !marked.some((m) => same(m, p)),
    );
    const aspect = canvasSize(map).width / canvasSize(map).height;
    const marginY = (CULL_MARGIN_PX * aspect) / pxPerPercent;
    // A mark paints over the marks before it, so named points come last and
    // their names read over unnamed points, while guide points still come later.
    return groupMarkers<Shown>(map, [...marked.map((p) => ({ ...p, marked: true as const })), ...pois], k)
      .map((row) => {
        const leader = row[0]!;
        const named = row.length === 1 && level >= (leader.category.labelMinZoom ?? 7);
        return {
          row,
          key: keyOf(leader),
          marked: row.some((p) => p.marked),
          named,
          marginX:
            Math.max(CULL_MARGIN_PX, named ? (leader.poi.label ?? leader.poi.name).length * LABEL_FONT_PX + ICON_AND_GAP_PX : 0) /
            pxPerPercent,
          marginY,
        };
      })
      .sort((a, b) => Number(a.named) - Number(b.named));
  }, [map, features.pois, marked, on, k, level, pxPerPercent, faction, allFactions]);
  const [retained, retain] = useState<string | null>(null);
  const [hovered, hover] = useState<string | null>(null);
  const visibleRows = rows.filter(({ row, key, marked, marginX: x, marginY: y }) => {
    if (marked || key === retained || key === hovered) return true;
    const { at } = row[0]!;
    return at.x >= frame.left - x && at.x <= frame.left + frame.width + x && at.y >= frame.top - y && at.y <= frame.top + frame.height + y;
  });
  const [zonesOn, landmarksOn] = [shows("zones"), shows("landmarks")];
  const places = useMemo(
    () => features.places.filter((p) => (p.place.kind === "landmark" ? landmarksOn : zonesOn) && labelShows(p.place, level)),
    [features.places, zonesOn, landmarksOn, level],
  );
  const [labels] = useState(() => new Map<PlacedPlace, HTMLElement>());
  const iconsAt = useMemo(() => icons?.(pxPerPercent) ?? [], [icons, pxPerPercent]);
  useLayoutEffect(() => {
    const aspect = canvasSize(map).width / canvasSize(map).height;
    const screen = (at: ViewPoint) => ({ x: at.x * pxPerPercent, y: (at.y * pxPerPercent) / aspect });
    const box = (p: PlacedPlace) => ({
      ...screen(p.at),
      width: labels.get(p)!.offsetWidth,
      height: labels.get(p)!.offsetHeight,
    });
    const parts = (p: PlacedPlace) => {
      const whole = box(p);
      const rank = p.place.kind === "capital" ? 0 : 1;
      const small = labels.get(p)!.querySelector("small");
      if (!small) return { rank, name: whole };
      const top = whole.y - whole.height / 2;
      const nameHeight = whole.height - small.offsetHeight;
      return {
        rank,
        name: { ...whole, y: top + nameHeight / 2, height: nameHeight },
        levels: { x: whole.x, y: top + nameHeight + small.offsetHeight / 2, width: small.offsetWidth, height: small.offsetHeight },
      };
    };
    const zones = places.filter((p) => p.place.kind !== "landmark");
    const zoneParts = zones.map(parts);
    const picked = pickLabels(zoneParts);
    const kept = zones.flatMap((p, i) => (picked[i]!.name ? [{ p, box: picked[i]!.levels ? box(p) : zoneParts[i]!.name }] : []));
    const moves = clearLabels(
      kept.map((z) => ({ ...z.box, mustShow: z.p.place.kind === "capital" })),
      [
        ...places.filter((p) => p.place.kind === "landmark").map(box),
        ...iconsAt.map((at) => ({ ...screen(at), width: ICON_PX, height: ICON_PX })),
      ],
    );
    zones.forEach((p, i) => {
      const el = labels.get(p)!;
      el.style.visibility = picked[i]!.name ? "" : "hidden";
      const small = el.querySelector("small");
      if (small) small.style.visibility = picked[i]!.levels ? "" : "hidden";
    });
    kept.forEach(({ p }, i) => {
      const el = labels.get(p)!;
      const move = moves[i];
      if (!move) el.style.visibility = "hidden";
      el.style.translate = move && (move.x || move.y) ? `calc(${move.x}px - 50%) calc(${move.y}px - 50%)` : "";
    });
  }, [labels, places, map, pxPerPercent, iconsAt]);
  const [names] = useState(() => new Map<HTMLElement, ViewPoint>());
  const [sided] = useState(() => ({ quests: props.quests, pxPerPercent, at: new WeakMap<HTMLElement, ViewPoint>() }));
  // No dependencies: names mount and unmount with the rows of every frame. A row keeps its `at` while its point stays, so
  // a name is measured again only when it mounts or moves, or when the quest markers or the scale change.
  useLayoutEffect(() => {
    if (sided.quests !== props.quests || sided.pxPerPercent !== pxPerPercent) {
      Object.assign(sided, { quests: props.quests, pxPerPercent, at: new WeakMap() });
    }
    const aspect = canvasSize(map).width / canvasSize(map).height;
    const screen = (at: ViewPoint) => ({ x: at.x * pxPerPercent, y: (at.y * pxPerPercent) / aspect });
    const quests = (props.quests ?? []).map((at) => ({ ...screen(at), width: QUEST_ICON_PX, height: QUEST_ICON_PX }));
    for (const [name, at] of names) {
      if (sided.at.get(name) === at) continue;
      sided.at.set(name, at);
      const icon = { ...screen(at), width: name.parentElement!.offsetWidth, height: name.parentElement!.offsetHeight };
      const side = nameSide(icon, { width: name.offsetWidth, height: name.offsetHeight }, quests);
      name.toggleAttribute("data-start", side === "start");
    }
  });
  return (
    <>
      {shows("routes") && (
        <svg className="routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {features.routes.map((r, i) => (
            <g key={i}>
              <polyline className="transport-casing" points={r.points} />
              <path className="transport-casing transport-end" d={r.ends} />
              <polyline className={`route-${r.vessel}`} points={r.points} />
              <path className="transport-end" d={r.ends} />
            </g>
          ))}
        </svg>
      )}
      {places.map((p) => (
        <PlaceLabel key={`${p.place.kind}:${p.place.name}:${p.place.x}:${p.place.y}`} placed={p} labels={labels} />
      ))}
      {visibleRows.map(({ row, key, named }) =>
        row.length === 1 ? (
          <Marker key={key} placed={row[0]!} at={row[0]!.at} named={named} names={names} onPick={props.onPick} retain={retain} />
        ) : (
          <MarkerRow key={key} row={row} at={row[0]!.at} onPick={props.onPick} retain={retain} hover={hover} />
        ),
      )}
      {props.marked.places.map((p, i) => (
        <PlaceLabel key={i} placed={p} />
      ))}
    </>
  );
}

type Shown = PlacedPoi & { marked?: true };

const keyOf = ({ poi, at, marked }: Shown) => `${marked ? "marked:" : ""}${poi.category}:${poi.entity?.id ?? poi.name}:${at.x},${at.y}`;

const rowIcons = (row: Shown[]) => [...new Map(row.map((p) => [p.marked ? keyOf(p) : p.category.icon, p])).values()];

const labelOf = ({ poi, category }: PlacedPoi) => `${poi.name}: ${category.name}${poi.levels ? ` (${poi.levels})` : ""}`;

const PlaceLabel = memo(function PlaceLabel({ placed, labels }: { placed: PlacedPlace; labels?: Map<PlacedPlace, HTMLElement> }) {
  const { place, at } = placed;
  return (
    <span
      ref={(el) => {
        if (!labels || !el) return;
        labels.set(placed, el);
        return () => void labels.delete(placed);
      }}
      className={`place place-${place.kind}`}
      style={{ "--at-x": `${at.x}%`, "--at-y": `${at.y}%` }}
      aria-hidden="true"
    >
      {place.name}
      {place.levels && <small>{place.levels}</small>}
    </span>
  );
});

const Marker = memo(function Marker(props: {
  placed: Shown;
  /** Where the point draws, which can move off `placed.at` to clear a mark. */
  at: ViewPoint;
  named: boolean;
  names: Map<HTMLElement, ViewPoint>;
  onPick: (poi: WorldMapPoi) => void;
  retain: (key: string) => void;
}) {
  const { placed, at, named, names } = props;
  const { poi, layer, category, marked } = placed;
  const label = labelOf(placed);
  const withName = marked || named;
  return (
    <MarkButton
      label={label}
      at={at}
      className={`poi poi-${layer}${withName ? " named" : ""}${marked ? " marked" : ""}`}
      data-category={category.key}
      onFocus={() => props.retain(keyOf(placed))}
      onContextMenu={() => props.retain(keyOf(placed))}
      onClick={() => {
        props.retain(keyOf(placed));
        props.onPick(poi);
      }}
    >
      <MapIconImage icon={placed.icon} className="poi-icon" />
      {withName && (
        <span
          ref={(el) => {
            if (!el) return;
            names.set(el, at);
            return () => void names.delete(el);
          }}
          className="poi-name"
          aria-hidden="true"
        >
          {poi.label ?? poi.name}
        </span>
      )}
    </MarkButton>
  );
});

const ROW_ICONS = 4;
const EDGE_MARGIN = 4;
const LIST_WIDTH = 320;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

const MarkerRow = memo(function MarkerRow(props: {
  row: Shown[];
  /** Where the row draws, which can move off its first point to clear a mark. */
  at: ViewPoint;
  onPick: (poi: WorldMapPoi) => void;
  retain: (key: string) => void;
  hover: (key: string | null) => void;
}) {
  const { row, at } = props;
  const rowButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const icons = rowIcons(row);
  const named = row.filter((p) => p.marked);
  const key = keyOf(row[0]!);
  const items = () => [...list.current!.querySelectorAll("button")];
  const mapView = useMapView();
  const viewport = useSyncExternalStore(mapView.subscribe, () => mapView.getSnapshot().viewport);
  const stop = (e: Event) => e.stopPropagation();
  useEventListener(() => list.current, "wheel", stop);
  useEventListener(() => list.current, "pointerdown", stop);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  const snapshot = useSyncExternalStore(mapView.subscribe, () => (open ? mapView.getSnapshot() : null));
  const cover = useRef<HTMLDivElement>(null);
  const place = useEffectEvent(() => {
    const el = list.current;
    if (!snapshot || !el) return;
    const view = el.parentElement!.getBoundingClientRect();
    const shown = {
      top: view.top + EDGE_MARGIN,
      bottom: view.bottom - mapCover(el.parentElement!) - EDGE_MARGIN,
      left: view.left + EDGE_MARGIN,
      right: view.right - EDGE_MARGIN,
    };
    el.style.maxWidth = `${Math.max(0, Math.min(LIST_WIDTH, shown.right - shown.left))}px`;
    const row = rowButton.current!;
    const at = row.getBoundingClientRect();
    const keyboard = row.matches(":focus-visible") || el.querySelector(":focus-visible") !== null;
    const reach = (keyboard && parseFloat(getComputedStyle(row).getPropertyValue("--mark-reach"))) || 0;
    const natural = el.scrollHeight + el.offsetHeight - el.clientHeight;
    const below = shown.bottom - at.bottom - reach;
    const above = at.top - reach - shown.top;
    const down = below >= natural || below >= above;
    const height = Math.max(0, Math.min(natural, down ? below : above, shown.bottom - shown.top));
    const top = clamp(down ? at.bottom + reach : at.top - reach - height, shown.top, shown.bottom - height);
    const left = clamp(at.left, shown.left, shown.right - el.offsetWidth);
    el.style.maxHeight = `${height}px`;
    el.style.top = `${top - view.top}px`;
    el.style.left = `${left - view.left}px`;
  });
  useLayoutEffect(() => place());
  useLayoutEffect(() => {
    const row = rowButton.current!;
    const ring = () => place();
    row.addEventListener("focus", ring);
    row.addEventListener("keydown", ring);
    return () => {
      row.removeEventListener("focus", ring);
      row.removeEventListener("keydown", ring);
    };
  }, []);
  useLayoutEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(cover.current!);
    return () => observer.disconnect();
  }, [open]);
  const move = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Tab") {
      if (e.shiftKey) e.preventDefault();
      rowButton.current!.focus({ preventScroll: true });
      return;
    }
    const all = items();
    const i = all.indexOf(e.currentTarget);
    const to =
      e.key === "ArrowDown"
        ? all[(i + 1) % all.length]
        : e.key === "ArrowUp"
          ? all.at(i - 1)
          : e.key === "Escape"
            ? rowButton.current
            : null;
    if (!to) return;
    e.preventDefault();
    to.focus({ preventScroll: to === rowButton.current });
  };
  return (
    <div
      className={`poi-group${named.length > 0 ? " marked" : ""}`}
      style={{ "--at-x": `${at.x}%`, "--at-y": `${at.y}%` }}
      onPointerEnter={() => {
        setHovered(true);
        props.hover(key);
      }}
      onPointerLeave={() => {
        setHovered(false);
        props.hover(null);
      }}
      onFocus={() => {
        setFocused(true);
        props.retain(key);
      }}
      onContextMenu={() => props.retain(key)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !list.current?.contains(e.relatedTarget) && setFocused(false)}
    >
      <MarkButton
        ref={rowButton}
        className="poi-row"
        label={`${row.length} markers: ${row.map((p) => p.poi.name).join(", ")}`}
        popoverOpen={open}
        aria-controls={listId}
        onClick={() => {
          props.retain(key);
          items()[0]!.focus();
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          items()[0]!.focus();
        }}
      >
        {icons.slice(0, ROW_ICONS).map((p, i) => (
          <MapIconImage key={i} icon={p.icon} className={`poi-icon poi-${p.layer}${p.marked ? " marked" : ""}`} />
        ))}
        {icons.length > ROW_ICONS && (
          <span className="poi-more" aria-hidden="true">
            +{icons.length - ROW_ICONS}
          </span>
        )}
        {named.length > 0 && (
          <span className="poi-name" aria-hidden="true">
            {named.map((p) => p.poi.label ?? p.poi.name).join(", ")}
          </span>
        )}
      </MarkButton>
      {open && <div ref={cover} className="poi-cover" />}
      {viewport &&
        createPortal(
          <ul ref={list} id={listId} className={`poi-list${open ? " open" : ""}`}>
            {row.map((p) => (
              <li key={keyOf(p)}>
                <ItemButton
                  className={`poi-item${p.marked ? " marked" : ""}`}
                  tabIndex={-1}
                  aria-label={labelOf(p)}
                  data-category={p.category.key}
                  onClick={() => {
                    rowButton.current!.focus({ preventScroll: true });
                    props.onPick(p.poi);
                  }}
                  onKeyDown={move}
                >
                  <MapIconImage icon={p.icon} size={16} />
                  <span>{p.poi.label ?? p.poi.name}</span>
                  <small>{p.category.name}</small>
                </ItemButton>
              </li>
            ))}
          </ul>,
          viewport,
        )}
    </div>
  );
});
