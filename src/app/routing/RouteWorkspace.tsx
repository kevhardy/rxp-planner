import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { errorText } from "../../data/errorText.ts";
import { interiorAt } from "../../data/heightMap.ts";
import type { InstanceId, LoadedWorldMap, WorldLocation } from "../../data/index.ts";
import type { WorldPoint } from "../../../packages/data-contract/geometry.ts";
import { raceToken } from "../../rules/profile.ts";
import { committedPlan, type Floors } from "../../routing/editor.ts";
import {
  addDestination,
  addStart,
  createPlan,
  formatWorldPoint,
  insertWaypoint,
  moveStop,
  removeWaypoint,
  reverse,
  setLeg,
  withHeight,
  type Leg,
  type RoutePlan,
  type WorldStop,
} from "../../routing/plan.ts";
import { frameOf, insideFrame } from "../../routing/frame.ts";
import { DatasetContext, useGameData, useStores } from "../context.ts";
import { usePreviewSettings } from "../preview/settings.ts";
import { Described } from "../Described.tsx";
import { Dialog } from "../Dialog.tsx";
import { usePendingAction, useRetain, useTimeout } from "../effects.ts";
import { Icon } from "../icons.tsx";
import { Button, DisclosureIcon } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Select } from "../ui/Field.tsx";
import { MapCanvas, type Frame, type MapMenu, type MapMenuGroup, type MapMenuItem, type Pin } from "../map/MapCanvas.tsx";
import { showsCategory, useMapProfile, useMapSettings, type CategoryId } from "../map/mapSettings.ts";
import type { ViewPoint } from "../map/points.ts";
import { InsideMapBox, InteriorImage, useInteriorView } from "../map/InteriorLayer.tsx";
import { terrainSurface, type Surface } from "../map/surfaces.ts";
import { placeFeatures } from "../map/terrain.ts";
import { TerrainMarkers, TerrainScene } from "../map/TerrainScene.tsx";
import { MapView } from "../map/view.ts";
import { PopoverMenu } from "../map/PopoverMenu.tsx";
import { summarizeJourney } from "../../routing/result.ts";
import { CoordinateDialog } from "./CoordinateDialog.tsx";
import { CoordinateReadout, type ReadoutPoint } from "./CoordinateReadout.tsx";
import { legReport, readRoute, writeRoute } from "../../routing/share.ts";
import { legLines, lineView, nearestLine, projection, skippedTiles, tileCornerViews } from "./lines.ts";
import { layerSearches, LayersMenu, RouterLayers, tileRects, type LayerChoices } from "./MapLayers.tsx";
import { NewLegsMenu } from "./newLegs.tsx";
import { RideLayer, RidePopover, spread, type PlacedMark } from "./RideLayer.tsx";
import { vesselPaths } from "./vesselRoutes.ts";
import { rideMarks } from "./rideStops.ts";
import { LegPopover, legToggles, RoutePopover, routeStatus, type MapFocus } from "./RouteResult.tsx";
import { RouteChip } from "./RouteChip.tsx";
import { legName, levelOptions, onLevel, pinLabel, stopLabel, stopName, stopPin, yards } from "./stopNames.ts";
import { StopPopover } from "./StopPopover.tsx";
import { RouteFocus } from "./RouteFocus.tsx";
import { RouteLayer } from "./RouteLayer.tsx";
import { levelChip, levelOf, useSurfaces } from "./Interiors.tsx";
import { legStates } from "./routeSearch.ts";
import { CopyRouteDialog, ImportRouteDialog } from "./RouteTextDialogs.tsx";
import { SkippedTiles } from "./SkippedTiles.tsx";
import { SlopeField } from "./slope.tsx";
import { useRouteChoices } from "./useRouteChoices.ts";
import { RouteSession } from "./routeSession.ts";
import { useRouteFit, type ClosedRoute } from "./useRouteFit.ts";
import { useSelection, type Selected } from "./useSelection.ts";
import { useRouting } from "./routingStore.ts";
import { ZoneBorders } from "./ZoneBorders.tsx";
import "./routing.css";

interface Entry {
  title: string;
  value: WorldPoint | undefined;
  instance: InstanceId;
  apply: (p: WorldPoint) => void;
}

export function RouteMap(props: { closed: RefObject<ClosedRoute | null> }) {
  const data = useGameData();
  const world = useContext(DatasetContext)?.data?.worldMap;
  const terrain = useMemo(() => {
    if (!data || !world) return null;
    const map = data.terrainMap(world);
    return { map, surface: terrainSurface(data, map, new WeakMap()) };
  }, [data, world]);
  if (!terrain) return <p className="empty">Loading the terrain map…</p>;
  return <RouteWorkspace map={terrain.map} surface={terrain.surface} closed={props.closed} />;
}

const NO_MARKS = { pois: [], places: [] };
const LABELS: readonly CategoryId[] = ["zones", "landmarks"];

const capital = (text: string) => text[0]!.toUpperCase() + text.slice(1);

type RouteCanvas = Omit<ComponentProps<typeof MapCanvas>, "mapView" | "aspect" | "maxZoom" | "scene" | "shapes" | "areas" | "spawns">;

export function RouteWorkspace(props: {
  map: LoadedWorldMap;
  surface: Pick<Surface, "aspect" | "maxZoom">;
  closed?: RefObject<ClosedRoute | null> | undefined;
}) {
  const { map } = props;
  const { aspect } = props.surface;
  const settings = useMapSettings();
  const profile = useMapProfile();
  const features = useMemo(() => placeFeatures(map), [map]);
  const { load: routing, placed } = useRouting("routes");
  const [problem, setProblem] = useState<string | null>(null);
  const [focus, setFocus] = useState<(MapFocus & { selected: Selected; plan: RoutePlan | null; mode: string }) | null>(null);
  const [summaryClosed, setSummaryClosed] = useState<RoutePlan | null>(null);
  const summaryButton = useRef<HTMLButtonElement>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copyText, setCopyText] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useTimeout(() => setCopied(null), copied ? 2000 : null, copied);
  const [borders, setBorders] = useState(false);
  const [tiles, setTiles] = useState({ failed: false, attempt: 0 });
  const legLayer = useRef<SVGSVGElement>(null);
  const mapArea = useRef<HTMLDivElement>(null);
  const measureStrip = useCallback((strip: HTMLDivElement | null) => {
    const map = strip?.parentElement;
    if (!strip || !map || typeof ResizeObserver === "undefined") return;
    const measure = () => map.style.setProperty("--strip-h", `${strip.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => {
      observer.disconnect();
      map.style.removeProperty("--strip-h");
    };
  }, []);
  const { reopened, reopenedView, fitted, fitStops, fitPoints, fitRequest, cover, keepClosed } = useRouteFit(props.closed, mapArea, aspect);
  const [mapView] = useState(() => new MapView(reopened?.kept));
  const focusAfter = useRef<(() => void) | null>(null);
  usePendingAction(focusAfter, (focus) => focus());

  const stores = useStores();
  const [session] = useState(
    () =>
      new RouteSession(stores.routing, stores.routeSettings, {
        reopen: reopened,
        opened: (p) => {
          if (!reopened || reopened.plan !== (p?.id ?? null)) fitStops(p?.stops ?? []);
        },
        problem: setProblem,
      }),
  );
  useRetain(session, "open");
  const { editor } = session;
  const { history, pending, loading, plans } = useSyncExternalStore(editor.subscribe, editor.get);
  const plan = history?.plan ?? null;
  const committed = committedPlan(history);
  const { loadNote, saveError, view, cancel, retry } = useSyncExternalStore(session.subscribe, session.getState);
  const { maxSlope, changeSlope, newLegs, changeNewLegs, modeName, changeMode, layers, changeLayers: saveLayers } = useRouteChoices(editor);

  const engine = routing?.ok ? routing.engine : null;
  const { race } = usePreviewSettings();
  const atlas = useMemo(() => vesselPaths(map, engine?.maps.map((m) => m.manifest) ?? [], placed), [map, engine, placed]);
  const zones = useMemo(() => (routing?.ok ? routing.engine.maps.flatMap((m) => m.zones ?? []) : []), [routing]);

  const artifactFrames = useMemo(() => engine?.maps.map((m) => m.manifest) ?? [], [engine]);
  const proj = useMemo(() => engine && projection(map, artifactFrames), [map, engine, artifactFrames]);
  const routeStops = useMemo(() => committed?.stops ?? [], [committed]);
  const failure = !routing
    ? null
    : !routing.ok
      ? routing.reason
      : !map.areas.some((a) => a.map === routing.engine.manifest.scope.map)
        ? `The world map has no area on map ${routing.engine.manifest.scope.map} of the routing data.`
        : null;
  const waiting = !routing ? "Loading routing…" : !plans ? "Loading saved routes…" : null;
  const ready = !failure && !waiting && proj && engine && routing?.ok;
  const interiors = useInteriorView(ready ? map : undefined, mapView);
  const keepOnClose = useEffectEvent(() => {
    const kept = mapView.kept();
    if (ready && kept) keepClosed(plan?.id ?? null, kept);
  });
  useEffect(() => () => keepOnClose(), []);
  useSurfaces(map.interiors, routeStops, interiors.placed?.interior);
  const levelAt = (i: number) => {
    const stop = plan?.stops[i];
    return stop && levelOf(map.interiors, stop);
  };
  const { selected, select, selectLeg, selectRide, selectAfterEdit, dropRide } = useSelection(editor, map, interiors.setInside);
  const changeLayers = (choices: LayerChoices) => {
    saveLayers(choices);
    if (!choices.rides) dropRide();
  };
  const open = (plan: RoutePlan | null, fit = true) => {
    if (!editor.open(plan)) return;
    if (fit) fitStops(plan?.stops ?? []);
    select(null);
    setProblem(null);
  };
  const clearRoute = () => {
    if (!session.clear()) return;
    select(null);
    setProblem(null);
  };

  const layerTiles = useMemo(() => (proj && engine?.layers ? tileRects(proj, engine.maps) : []), [proj, engine]);
  const routedJourney = view.kind === "routed" ? view.journey : undefined;
  const summary = useMemo(() => routedJourney && summarizeJourney(routedJourney), [routedJourney]);
  const shown = view.kind === "failed" ? undefined : view.journey;
  const states = useMemo(() => legStates(view, plan, summary), [view, plan, summary]);
  const pendingLabels = useMemo(
    () =>
      view.kind === "calculating"
        ? view.searchingRides
        : view.kind === "cancelled"
          ? new Map(states.flatMap((leg, i) => (leg.state === "pending" ? [[i, leg.phase] as const] : [])))
          : undefined,
    [view, states],
  );
  const lines = useMemo(
    () => (plan ? legLines(plan, shown, dragged, pendingLabels, atlas) : []),
    [plan, shown, dragged, pendingLabels, atlas],
  );
  const views = useMemo(
    () =>
      proj
        ? lines.map((l) => ({
            ...l,
            view: lineView(l, proj),
            ...(l.indoor && { indoorViews: l.indoor.map((part) => lineView(part, proj)) }),
            ...(l.rides && {
              rideViews: l.rides.map((ride) => ({
                mode: ride.mode,
                view: lineView(ride, proj),
                ends: [0, ride.points.length - 1].map((k) => proj.toView(ride.points[k]!, ride.maps[k]!)),
              })),
            }),
          }))
        : [],
    [lines, proj],
  );
  const legNames = useMemo(() => plan?.legs.map((_, i) => legName(i, plan.stops.length - 1)) ?? [], [plan]);
  const shownMode = shown?.mode.name ?? plan?.settings.modes[0]?.name;
  const searches = useMemo(
    () => layerSearches(plan, shownMode, selected && "ride" in selected ? null : selected, shown?.legs),
    [plan, shownMode, selected, shown?.legs],
  );
  const otherRides = !!plan?.legs.some((l) => l.otherFaction);
  const marks = useMemo(
    (): PlacedMark[] =>
      layers.rides && proj
        ? rideMarks(placed, profile.faction, otherRides).flatMap((mark) => {
            const at = proj.toView(mark.stop.point, mark.stop.map);
            return at ? [{ mark, at }] : [];
          })
        : [],
    [layers.rides, proj, placed, profile.faction, otherRides],
  );
  const stopViews = useMemo(() => {
    const at = [...(plan?.stops ?? []), ...(pending ? [pending] : [])];
    return proj ? at.flatMap((stop) => proj.stopView(stop) ?? []) : [];
  }, [proj, plan, pending]);
  const rideSpots = useCallback((pxPerPercent: number) => spread(marks, stopViews, pxPerPercent, aspect), [marks, stopViews, aspect]);

  const visible = (category: CategoryId) => LABELS.includes(category) && showsCategory(settings, category, profile);
  const scene = (frame: Frame, pxPerPercent: number) => (
    <>
      {layers.image && (
        <TerrainScene
          map={map}
          frame={frame}
          pxPerPercent={pxPerPercent}
          attempt={tiles.attempt}
          onTileError={() => setTiles((t) => (t.failed ? t : { ...t, failed: true }))}
        />
      )}
      {interiors.placed && interiors.inside && (
        <InteriorImage map={map} placed={interiors.placed} look={layers.plans ? "plan" : "minimap"} pxPerPercent={pxPerPercent} />
      )}
      {engine?.layers && (
        <RouterLayers
          painter={engine.layers}
          tiles={layerTiles}
          frame={frame}
          pxPerPercent={pxPerPercent}
          choices={layers}
          maxSlope={maxSlope}
          searches={searches}
        />
      )}
    </>
  );
  const labels = (frame: Frame, pxPerPercent: number) => (
    <TerrainMarkers
      map={map}
      features={features}
      shows={visible}
      marked={NO_MARKS}
      onPick={() => {}}
      frame={frame}
      pxPerPercent={pxPerPercent}
      icons={rideSpots}
    />
  );

  const last = plan ? plan.stops.length - 1 : 0;
  const selectedLeg = selected && "leg" in selected && plan && selected.leg < plan.legs.length ? selected.leg : null;
  const selectedStop = selected && "stop" in selected && plan && selected.stop <= last ? selected.stop : null;
  const selectedRide = selected && "ride" in selected ? marks.find((m) => m.mark.stop.id === selected.ride)?.mark : undefined;
  const summaryShown = !!committed && selectedStop === null && selectedLeg === null && !selectedRide && summaryClosed !== committed;
  const workspace = (side: ReactNode, canvas: RouteCanvas, onKeyDown?: (e: KeyboardEvent) => void, strip?: ReactNode) => (
    <div className="route-workspace">
      {side}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Tab from a stop or leg bubbles here; the div itself takes no focus. */}
      <div ref={mapArea} className="route-map" onKeyDown={onKeyDown}>
        <MapCanvas
          aspect={aspect}
          maxZoom={props.surface.maxZoom}
          scene={scene}
          shapes={[]}
          areas={[]}
          spawns={[]}
          {...canvas}
          mapView={mapView}
          view={reopenedView ?? canvas.view}
        />
        <div className="route-map-notices">
          {interiors.placed && (
            <InsideMapBox
              interior={interiors.placed.interior}
              inside={interiors.inside}
              onInside={interiors.setInside}
              plans={{ on: layers.plans, onChange: (plans) => changeLayers({ ...layers, plans }) }}
            />
          )}
          {tiles.failed && (
            <p className="route-note route-tile-error error" role="alert">
              Some terrain tiles did not load.{" "}
              <Button variant="secondary" onClick={() => setTiles((t) => ({ failed: false, attempt: t.attempt + 1 }))}>
                Retry
              </Button>
            </p>
          )}
        </div>
        {strip}
      </div>
    </div>
  );
  if (!ready) {
    return workspace(<div className="route-panel">{failure ? <RoutingFailed reason={failure} /> : <p>{waiting}</p>}</div>, {
      overlay: labels,
      pins: [],
      label: "Route map",
      describe: () => "",
      menu: () => undefined,
    });
  }

  const describe = (at: ViewPoint) => {
    const p = proj.toStop(at);
    return p ? yards(p) : "outside the routing area";
  };
  const firstMap = engine.manifest.scope.map;
  const checkInside = (stop: WorldLocation) => {
    const frame = frameOf(artifactFrames, stop.instance);
    if (!frame || !insideFrame(frame, stop))
      throw new RangeError(`${formatWorldPoint(stop)} on map ${stop.instance} is outside the routing area.`);
  };
  const finish = (start: WorldStop, end: WorldStop) => {
    try {
      open(createPlan(start, end, new Date().toISOString(), newLegs), false);
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  const edited = (selection: Selected) => {
    selectAfterEdit(selection);
    setProblem(null);
  };
  const edit = (change: (plan: RoutePlan) => RoutePlan, label: string, selection: Selected = null) => {
    try {
      if (editor.edit(change, label)) edited(selection);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const changeLeg = (i: number, change: Partial<Leg>) => {
    const [name, on] = Object.entries(change)[0] as [keyof Leg, boolean];
    const toggle = legToggles(plan!.legs[i]!).find((t) => t.name === name)!;
    edit((p) => setLeg(p, i, change), `${on ? toggle.on : toggle.off} on leg ${i + 1}`, { leg: i });
  };
  const swap = (i: number) => edit(reverse, i === 0 ? "swap to destination" : "swap to start", { stop: last - i });
  const newStart = (at: WorldStop) => edit((q) => addStart(q, at, newLegs), "add a start", { stop: 0 });
  const newDestination = (at: WorldStop) => edit((q) => addDestination(q, at, newLegs), "add a destination", { stop: last + 1 });
  const stopFloors: Floors = { interiors: map.interiors, inside: interiors.inside };
  const placeNew = (p: WorldLocation, place: (at: WorldStop) => void, before?: WorldStop) =>
    editor.place(stopFloors, p, before, (at) => {
      setProblem(null);
      act(() => place(at))();
    });
  const putOn = (i: number, height: number | null, what: string) =>
    edit((q) => moveStop(q, i, withHeight(q.stops[i]!, height)), `put ${stopName(i, last)} on ${what}`, { stop: i });
  const levelChoices = (i: number): MapMenuItem[] => {
    const where = levelAt(i);
    const top = where?.surfaces.at(-1);
    if (!where || !top) return [];
    const world = where.onWorldMap;
    if (where.surfaces.length === 1)
      return [
        { label: "World map", checked: world, run: () => (world ? putOn(i, top.height, top.place) : putOn(i, null, "the world map")) },
      ];
    return levelOptions(where).map(({ shown, checked, height, what }) => ({
      label: shown,
      checked,
      radio: true,
      run: () => {
        if (!checked) putOn(i, height, what);
      },
    }));
  };

  const stopActions = (i: number): MapMenuItem[] => {
    if (i === 0) return [{ label: "Swap to destination", run: () => swap(i) }];
    if (i === last) return [{ label: "Swap to start", run: () => swap(i) }];
    return [
      { label: "Remove", run: () => edit((p) => removeWaypoint(p, i), `remove waypoint ${i}`) },
      {
        label: "Edit coordinates…",
        run: () =>
          ask({
            title: `Edit coordinates of ${stopName(i, last)}`,
            value: plan!.stops[i]!,
            instance: plan!.stops[i]!.instance,
            apply: (p) => {
              const stop = plan!.stops[i]!;
              if (formatWorldPoint(p) === formatWorldPoint(stop)) return;
              editor.move(
                stopFloors,
                i,
                { instance: stop.instance, x: p.x, y: p.y },
                `edit ${stopName(i, last)}`,
                act(() => edited({ stop: i })),
              );
            },
          }),
      },
    ];
  };
  const stopMenu = (i: number): MapMenuGroup => ({
    title: `${onLevel(i, last, levelAt(i))} · ${yards(plan!.stops[i]!)}`,
    items: [...stopActions(i), ...levelChoices(i)],
  });

  const pins: Pin[] = plan
    ? plan.stops.flatMap((p, i) => {
        const at = proj.stopView(p);
        if (!at) return [];
        const label = `move ${stopName(i, last)}`;
        const actions = stopMenu(i);
        const where = levelAt(i);
        const selectedPin = !!selected && "stop" in selected && selected.stop === i;
        const chip = selectedPin && where && levelChip(where);
        const pin: Pin = {
          key: `stop${i}`,
          at,
          ...stopPin(i, last),
          label: pinLabel(i, last, p, where),
          ...(chip && { chip }),
          selected: selectedPin,
          activate: () => select({ stop: i }),
          menu: { ...actions, items: actions.items.map((item) => ({ ...item, disabled: !!loading })) },
        };
        if (!loading) {
          pin.drag = (to: ViewPoint | null) => {
            const point = to && proj.toStop(to);
            if (!to) {
              if (editor.cancelDrag()) setDragged(null);
            } else if (point && editor.drag(i, point, label)) setDragged(i);
          };
          pin.move = (to: ViewPoint) => {
            const now = editor.get().history?.plan;
            if (editor.busy || !now) return;
            const point = proj.toStop(to);
            setDragged(null);
            select({ stop: i });
            editor.move(stopFloors, i, point ?? now.stops[i]!, label, () => {
              setProblem(null);
              if (!point) setProblem("That point is outside the routing area, so the stop stays at the last point inside it.");
            });
          };
        }
        return [pin];
      })
    : [];
  const pendingAt = pending && proj.stopView(pending);
  if (pending && pendingAt) {
    pins.push({
      key: "pending",
      at: pendingAt,
      kind: "route-start",
      text: "A",
      label: `Start of the new route at ${yards(pending)}`,
      menu: { title: "New route", items: [{ label: "Cancel the new route", disabled: !!loading, run: () => editor.setPending(null) }] },
    });
  }

  const menu = (at: ViewPoint, pxPerPercent: number): MapMenu | undefined => {
    if (editor.busy) return undefined;
    const p = proj.toStop(at);
    const title = p ? capital(yards(p)) : "";
    if (!plan) {
      if (!p) return undefined;
      return pending
        ? {
            title,
            items: [
              { label: "End the route here", run: () => placeNew(p, (at) => finish(pending, at), pending) },
              { label: "Start the route here instead", run: () => placeNew(p, (at) => editor.setPending(at)) },
            ],
          }
        : { title, items: [{ label: "Start a route here", run: () => placeNew(p, (at) => editor.setPending(at)) }] };
    }
    const leg = nearestLine(
      views.map((v) => v.view),
      at,
      pxPerPercent,
      aspect,
    );
    if (leg !== undefined) {
      const settings = plan.legs[leg]!;
      return {
        title: legName(leg, last),
        items: [
          ...(p
            ? [
                {
                  label: "Insert waypoint here",
                  run: () =>
                    placeNew(
                      p,
                      (at) => edit((q) => insertWaypoint(q, leg, at), `insert waypoint ${leg + 1}`, { stop: leg + 1 }),
                      plan.stops[leg],
                    ),
                },
              ]
            : []),
          ...legToggles(settings).map(({ name, label, enabled }) => ({
            label,
            checked: settings[name],
            disabled: !enabled,
            run: () => changeLeg(leg, { [name]: !settings[name] }),
          })),
        ],
      };
    }
    if (!p || !selected || !("stop" in selected)) return undefined;
    if (selected.stop === 0)
      return {
        title,
        items: [{ label: "Add point and start here", run: () => placeNew(p, newStart) }],
      };
    if (selected.stop === last)
      return {
        title,
        items: [{ label: "Add destination here", run: () => placeNew(p, newDestination, plan.stops[last]) }],
      };
    return undefined;
  };

  const click = (at: ViewPoint, pxPerPercent: number) => {
    const leg = nearestLine(
      views.map((v) => v.view),
      at,
      pxPerPercent,
      aspect,
    );
    select(leg === undefined ? null : { leg });
    setFocus(null);
  };

  const ask = (next: Entry) => {
    if (!editor.busy) setEntry(next);
  };
  const enter = (title: string, apply: (p: WorldStop) => void, before?: WorldStop) => {
    const shown = mapView.getSnapshot().shown?.frame;
    const at = shown ? proj.toStop({ x: shown.left + shown.width / 2, y: shown.top + shown.height / 2 }) : undefined;
    const instance = at?.instance ?? firstMap;
    ask({ title, value: at, instance, apply: ({ x, y }) => placeNew({ instance, x, y }, apply, before) });
  };
  const actions = plan
    ? [
        { label: "Add point and start there…", run: () => enter("Add a new start", newStart) },
        { label: "Add destination…", run: () => enter("Add a destination", newDestination, plan.stops[last]) },
      ]
    : pending
      ? [
          { label: "Set destination…", run: () => enter("Set the destination", (p) => finish(pending, p), pending) },
          { label: "Cancel the new route", run: () => editor.setPending(null) },
        ]
      : [{ label: "Set start…", run: () => enter("Set the start", (p) => editor.setPending(p)) }];

  const fitView = fitRequest(fitted.length ? fitted.flatMap((stop) => proj.stopView(stop) ?? []) : tileCornerViews(engine.maps, proj));
  const skipped = skippedTiles(
    selectedLeg === null ? undefined : shown?.legs[selectedLeg],
    proj,
    selectedLeg === null ? firstMap : plan!.stops[selectedLeg]!.instance,
    engine.manifest.frame.tilePixels,
  );
  const stale = focus && (focus.selected !== selected || focus.plan !== plan || focus.mode !== modeName);
  if (stale) setFocus(null);
  const focused = stale ? null : focus;
  const focusView = (f: MapFocus | null) => {
    if (!f) return undefined;
    if (f.step === undefined) return views[f.leg]?.view;
    const step = lines[f.leg]?.steps?.[f.step];
    return step && lineView(step, proj);
  };
  const focusOn = (to: MapFocus) => {
    if (focused && focused.leg === to.leg && focused.step === to.step) return setFocus(null);
    setFocus({ ...to, selected, plan, mode: modeName });
    const view = focusView(to);
    if (view) fitPoints(view);
  };
  const unfocus = () => {
    if (!focused) return false;
    setFocus(null);
    return true;
  };
  const readoutPoints: ReadoutPoint[] = [];
  if (selectedStop !== null) {
    readoutPoints.push({ label: stopLabel(selectedStop, last), at: plan!.stops[selectedStop]! });
  }
  const routeLayer = (frame: Frame, pxPerPercent: number) => (
    <>
      {borders && <ZoneBorders grids={zones} proj={proj} />}
      {labels(frame, pxPerPercent)}
      <SkippedTiles tiles={skipped} />
      <RouteFocus view={focusView(focused)} />
      {marks.length > 0 && (
        <RideLayer
          marks={marks}
          stops={stopViews}
          pxPerPercent={pxPerPercent}
          aspect={aspect}
          selected={selectedRide?.stop.id ?? null}
          onSelect={selectRide}
          proj={proj}
          atlas={atlas}
        />
      )}
      <RouteLayer
        layer={legLayer}
        lines={views}
        names={legNames}
        selected={selectedLeg}
        onSelect={selectLeg}
        pxPerPercent={pxPerPercent}
        aspect={aspect}
      />
    </>
  );

  const keyboardReaches = (el: HTMLElement | SVGElement) => el.tabIndex === 0 || el.dataset.inView !== undefined;
  const focusOnMap = (target: HTMLElement | SVGElement | null | undefined) => {
    if (target && keyboardReaches(target)) return target.focus();
    const zoom = mapArea.current?.querySelectorAll<HTMLButtonElement>(".map-zoom button:not(:disabled)");
    zoom?.[zoom.length - 1]?.focus();
  };
  const act =
    <T,>(run: () => T) =>
    (): T => {
      focusAfter.current = () => {
        if (document.activeElement && document.activeElement !== document.body) return;
        focusOnMap(mapArea.current?.querySelector<HTMLElement>(".pin.selected"));
      };
      return run();
    };
  const followRoute = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || e.defaultPrevented || !plan) return;
    const area = mapArea.current!;
    const pins = new Map([...area.querySelectorAll<HTMLElement>(".pin")].map((pin) => [pin.getAttribute("aria-label"), pin]));
    const order = plan.stops
      .flatMap((p, i) => [
        pins.get(pinLabel(i, last, p, levelAt(i))),
        area.querySelector<SVGElement>(`.route-leg[data-leg="${i}"][data-in-view]`),
      ])
      .filter((el): el is HTMLElement | SVGElement => !!el);
    const at = order.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? undefined : order[at + (e.shiftKey ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const noLevel =
    plan && map.interiors && view.kind !== "failed"
      ? view.journey?.legs.flatMap((result, i) => {
          if (result.kind !== "no-path" || !result.endpoint) return [];
          const j = result.endpoint === "end" ? i + 1 : i;
          const interior = plan.stops[j]!.height === null && interiorAt(map.interiors!.list, plan.stops[j]!);
          return interior
            ? [
                `${capital(stopName(j, last))} has no level in ${interior.label}. To route to a level, right-click ${stopName(j, last)} and choose a level.`,
              ]
            : [];
        })[0]
      : undefined;
  const copyRoute = () => {
    if (!plan) return;
    const artifacts = Object.fromEntries(
      [...new Set(plan.stops.map((stop) => stop.instance))].flatMap((m) => {
        const id = engine.maps.find((loaded) => loaded.manifest.scope.map === m)?.manifest.id;
        return id ? [[m, id]] : [];
      }),
    );
    const results = states.map((leg) =>
      leg.state === "routed"
        ? legReport(leg.result)
        : leg.state === "failed"
          ? { status: "failed" as const, reason: leg.reason }
          : { status: "calculating" as const },
    );
    const text = writeRoute(plan, { artifacts, maxSlope, ...(shown && { mode: shown.mode.name }), results });
    // `navigator.clipboard` is missing outside secure contexts.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setCopied("Copied the route as text"),
        () => setCopyText(text),
      );
  };
  const popoverActions = (i: number): MapMenuItem[] => [
    ...stopActions(i),
    ...(i < last
      ? [
          {
            label: `Add stop after ${stopName(i, last)}…`,
            run: () =>
              enter(
                `Add a stop after ${stopName(i, last)}`,
                (p) => edit((q) => insertWaypoint(q, i, p), `insert waypoint ${i + 1}`, { stop: i + 1 }),
                plan!.stops[i],
              ),
          },
        ]
      : []),
  ];
  const routePopover = () => (
    <RoutePopover
      stops={`${stopLabel(0, last)} → ${stopLabel(last, last)}`}
      legs={plan!.legs.map((_, i) => ({
        stops: `${stopLabel(i, last)} → ${stopLabel(i + 1, last)}`,
        pins: [stopPin(i, last), stopPin(i + 1, last)],
        end: stopName(i + 1, last),
        outcome: states[i]!,
      }))}
      journey={shown}
      phase={routeStatus(view, summary).text}
      focus={focused}
      onFocus={focusOn}
      onOpen={selectLeg}
      onEscape={unfocus}
      onClose={() => setSummaryClosed(committed)}
      returnFocus={() => summaryButton.current?.focus()}
    />
  );
  const legPopover = (i: number) => (
    <LegPopover
      index={i}
      count={plan!.legs.length}
      onMove={selectLeg}
      focus={focused}
      onFocus={focusOn}
      onEscape={unfocus}
      stops={`${stopLabel(i, last)} → ${stopLabel(i + 1, last)}`}
      end={stopName(i + 1, last)}
      leg={plan!.legs[i]!}
      outcome={states[i]!}
      swimming={plan!.settings.swimming.enabled}
      onShowSkipped={() => fitPoints(skipped.outlines.flat(), 3)}
      disabled={!!loading}
      onChange={(change) => changeLeg(i, change)}
      onClose={() => select(null)}
      returnFocus={() => focusOnMap(legLayer.current?.querySelector<SVGElement>(`[data-leg="${i}"]`))}
    />
  );

  return (
    <>
      {workspace(
        <fieldset className="route-bar" role="region" aria-label="Route tools" disabled={!!loading}>
          <Select
            aria-label="Route plan"
            value={plan?.id ?? ""}
            onChange={(e) => open(plans?.find((p) => p.id === e.target.value) ?? null)}
          >
            {!plan && <option value="">New route</option>}
            {plans?.map((p, n) => (
              <option key={p.id} value={p.id}>
                {`Route ${n + 1}`}
              </option>
            ))}
          </Select>
          <PopoverMenu
            className="route-menu"
            align="start"
            label="Route"
            description="Start, clear, extend, copy, import, or delete a route"
          >
            {(close) =>
              [
                { label: "New route", run: () => open(null, false), disabled: !plan },
                { label: "Clear route", run: clearRoute, disabled: !plan },
                ...actions.map((action) => ({ ...action, disabled: false })),
                { label: "Copy route as text", run: copyRoute, disabled: !plan },
                { label: "Import route text…", run: () => setImporting(true), disabled: false },
                { label: "Delete route…", run: () => setDeleting(true), disabled: !plan },
              ].map((item) => (
                <Button
                  key={item.label}
                  variant="ghost"
                  disabled={item.disabled}
                  onClick={() => {
                    if (editor.busy) return;
                    close();
                    item.run();
                  }}
                >
                  {item.label}
                </Button>
              ))
            }
          </PopoverMenu>
          <Described text={history?.past.length ? `Undo ${history.past.at(-1)!.label}` : undefined}>
            <Button
              variant="ghost"
              onClick={() => {
                if (editor.undo()) select(null);
              }}
              disabled={!history?.past.length}
            >
              Undo
            </Button>
          </Described>
          <SlopeField value={maxSlope} onChange={changeSlope} />
          <NewLegsMenu leg={newLegs} onChange={changeNewLegs} />
          {zones.length > 0 && (
            <Described text="Show the routing zone edges">
              <Button variant="ghost" size={28} pressed={borders} onClick={() => setBorders(!borders)}>
                Zone borders
              </Button>
            </Described>
          )}
          <LayersMenu choices={layers} searches={searches} hasInteriors={!!map.interiors} onChange={changeLayers} />
          <span className="status" role="status">
            {copied}
          </span>
        </fieldset>,
        {
          overlay: routeLayer,
          pins,
          label:
            "Route map. Right-click a stop or a leg for its actions; select the start or destination, then right-click the ground to extend the route.",
          describe,
          menu,
          onClick: click,
          view: fitView,
          cover,
        },
        followRoute,
        <div ref={measureStrip} className="map-top route-strip">
          <div className="map-top-bound" />
          {selectedStop !== null && (
            <StopPopover
              plan={plan!}
              index={selectedStop}
              where={levelAt(selectedStop)}
              legs={states}
              actions={popoverActions(selectedStop)}
              disabled={!!loading}
              onLevel={(height, what) => putOn(selectedStop, height, what)}
              act={act}
              onClose={() => select(null)}
              returnFocus={() => focusOnMap(mapArea.current?.querySelector<HTMLElement>(".pin.selected"))}
            />
          )}
          {selectedLeg !== null && legPopover(selectedLeg)}
          {selectedRide && (
            <RidePopover
              mark={selectedRide}
              character={{ race: raceToken(race), class: profile.class }}
              onClose={() => select(null)}
              returnFocus={() => focusOnMap(mapArea.current?.querySelector<HTMLElement>(`.ride-mark[data-stop="${selectedRide.stop.id}"]`))}
            />
          )}
          {summaryShown && routePopover()}
          <div className="route-foot">
            <div className="route-corner">
              {[loadNote, noLevel, saveError, problem].map(
                (text, i) =>
                  text && (
                    <p key={i} className={i < 2 ? "route-note" : "route-note route-error"} role={i < 2 ? undefined : "alert"}>
                      {text}
                    </p>
                  ),
              )}
              <RouteChip
                status={
                  loading
                    ? { text: `Loading the levels of ${loading.label}…`, busy: true }
                    : !plan
                      ? {
                          text: pending
                            ? "Right-click where the route ends, or set the destination in the Route menu."
                            : "Right-click the map to start a route, or set the start in the Route menu.",
                        }
                      : history?.dragging
                        ? { text: "Release to place the stop and route again." }
                        : routeStatus(view, summary)
                }
                disabled={!!loading}
                mode={plan ? { names: plan.settings.modes.map((m) => m.name), value: modeName, change: changeMode } : undefined}
                search={cancel ? { label: "Cancel search", run: cancel } : retry ? { label: "Search again", run: retry } : undefined}
                summary={
                  committed
                    ? {
                        shown: summaryShown,
                        button: summaryButton,
                        toggle: () => {
                          if (summaryShown) return setSummaryClosed(committed);
                          select(null);
                          setSummaryClosed(null);
                        },
                      }
                    : undefined
                }
              />
            </div>
            <div className="map-readout">
              <CoordinateReadout pointer={mapView} map={map} selection={readoutPoints} zones={zones} />
            </div>
          </div>
        </div>,
      )}
      {entry && (
        <CoordinateDialog
          title={entry.title}
          value={entry.value}
          onApply={(p) => {
            checkInside({ instance: entry.instance, ...p });
            setEntry(null);
            act(() => entry.apply(p))();
          }}
          onClose={() => setEntry(null)}
        />
      )}
      {copyText !== null && <CopyRouteDialog text={copyText} onClose={() => setCopyText(null)} />}
      {importing && (
        <ImportRouteDialog
          onImport={(text) => {
            if (editor.busy) return;
            const imported = readRoute(text, new Date().toISOString());
            imported.stops.forEach(checkInside);
            setImporting(false);
            open(imported);
          }}
          onClose={() => setImporting(false)}
        />
      )}
      {deleting && plan && (
        <Dialog title="Delete this route?" onClose={() => setDeleting(false)}>
          <p>The route and its stops leave this browser. Undo cannot restore them.</p>
          <div className="dialog-actions">
            <Button
              variant="danger"
              size={32}
              onClick={() => {
                if (editor.busy) return;
                setDeleting(false);
                session.delete(plan, () => open(null, false));
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function RoutingFailed({ reason }: { reason: string }) {
  return (
    <div className="route-failed" role="alert">
      <EmptyState
        title={
          <>
            <Icon name="warning" className="route-error" />
            Routes did not load
          </>
        }
        action={
          <Button variant="secondary" onClick={() => location.reload()}>
            Reload page
          </Button>
        }
      >
        Reload the page to try again.
      </EmptyState>
      <details>
        <summary>
          <DisclosureIcon /> Details
        </summary>
        <p>{reason}</p>
      </details>
    </div>
  );
}
