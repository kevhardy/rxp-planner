import { useContext, useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import type { Continent, GameData, MapLocation, WorldLocation, WorldMapPoi, Zone } from "../../data/index.ts";
import { insertionState, type Profile, type SimState } from "../../rules/index.ts";
import { insertIndex, type PointProblem, type StepPoints } from "../../rules/points.ts";
import { insertQuest } from "../../rules/questInsertion.ts";
import { bodyIndent, insertLine, setCommandArgs, updateLine, type CommandLine, type GuideDocument, type Step } from "../../guide/index.ts";
import { DatasetContext, useEditor, useEditorStore, useGameData } from "../context.ts";
import { Described } from "../Described.tsx";
import { Dialog } from "../Dialog.tsx";
import { Icon } from "../icons.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Select } from "../ui/Field.tsx";
import { OpenEditorButton } from "../EditorDock.tsx";
import { useLayoutStore } from "../layout.ts";
import { applyRawDraft, discardRawDraft, editSection, hasRawDraft, subscribeDrafts, type SectionEdit } from "../drafts.ts";
import { useSimData } from "../preview/route.ts";
import { useFaction, usePreviewSettings } from "../preview/settings.ts";
import { useStepFilter } from "../preview/stepFilter.ts";
import type { LockNames } from "../quests/lockText.ts";
import { RouteMap } from "../routing/RouteWorkspace.tsx";
import type { ClosedRoute } from "../routing/useRouteFit.ts";
import { CoordinateReadout, type ReadoutPoint } from "../routing/CoordinateReadout.tsx";
import { useZoneGrids, ZoneBorders } from "../routing/ZoneBorders.tsx";
import type { DocOp, EditorStore, Selection } from "../store.ts";
import { FeatureCard } from "./FeatureSearch.tsx";
import { stepArea, stepEntities, type Feature, type FeatureIndex } from "./features.ts";
import { resolveMapFocus } from "./lineFocus.ts";
import { MapSearch } from "./MapSearch.tsx";
import { spawnAreas } from "./areas.ts";
import { MapCanvas, type Frame, type MapMenu, type OpenMenu, type Pin, type Shape, type UserMove } from "./MapCanvas.tsx";
import { InsideMapBox, InteriorImage, useInteriorView } from "./InteriorLayer.tsx";
import type { LoadedWorldMap } from "../../data/index.ts";
import { MapLegend } from "./MapLegend.tsx";
import { showsCategory, useMapProfile, useMapSettings, type CategoryId } from "./mapSettings.ts";
import { movedArgs, questSpots, type AddCommand, type Placed, type QuestSpot, type ViewPoint } from "./points.ts";
import { questMarkers, shownMarkers, type PlacedMarker, type QuestAction, type QuestMarker } from "./questMarkers.ts";
import { QuestCard, QuestMarkers } from "./QuestMarkers.tsx";
import { followedMap, guideLayout, projectAreas, type StepPoint } from "./guideLayout.ts";
import { terrainSurface, type Surface } from "./surfaces.ts";
import { placeFeatures, type PlacedPoi } from "./terrain.ts";
import { useGuideView } from "./guideView.ts";
import { AZEROTH } from "./shownMap.ts";
import type { ViewRequest } from "./view.ts";
import { TerrainMarkers, TerrainScene } from "./TerrainScene.tsx";
import { useFeatures, useHighlight } from "./worldMapStore.ts";
import "./map.css";

const ZEPHRAS_ISLE = 2521;

export function MapColumn() {
  return (
    <div className="region-map" data-region="map">
      <MapPanel />
    </div>
  );
}

function MapPanel() {
  const data = useGameData();
  const dataset = useContext(DatasetContext);
  const { current, selection, jumps } = useEditor();
  const store = useEditorStore();
  const filter = useStepFilter();
  const step = selection.step;
  const focus: MapFocus | null = current
    ? {
        guide: current,
        selection,
        jumps,
        before: insertionState(filter?.simulation, step === null || step === 0 ? null : step - 1),
        profile: filter?.profile,
        select: (at) => store.select(at),
        edit: {
          store,
          skipped: step !== null && (!!filter?.guide.hidden || filter?.guide.steps[step]?.shown === false),
        },
      }
    : null;
  const [routes, setRoutes] = useState(false);
  const map = useGuideMap(data, focus, { onFocus: () => setRoutes(false) });
  const layoutStore = useLayoutStore();
  const found = map?.search;
  const search: SearchActions | undefined = found && {
    ...found,
    onAdd: (at, command) => {
      found.onAdd(at, command);
      layoutStore.openEditor();
    },
  };
  const closedRoute = useRef<ClosedRoute | null>(null);
  return (
    <section className="panel map-panel" aria-label="Map">
      <div className="panel-head">
        <h2>Map</h2>
        {!routes && map?.controls}
        <MapSearch search={search} hidden={routes} />
        <Described text="Plan routes on the terrain, without a guide">
          <Button variant="ghost" pressed={routes} onClick={() => setRoutes(!routes)}>
            <Icon name="route" /> Routes
          </Button>
        </Described>
        <OpenEditorButton />
      </div>
      <div className={routes && data ? "map-body routes" : "map-body"}>
        {routes && data ? (
          <RouteMap closed={closedRoute} />
        ) : (
          (map?.body ??
          (data ? (
            <EmptyState icon="map" title="No guide open" className="map-empty">
              Use Search to find a quest, NPC, or place, or Routes to plan a route.
            </EmptyState>
          ) : (
            <p className="empty">{dataset?.error ? "Game data unavailable." : "Loading game data…"}</p>
          )))
        )}
      </div>
    </section>
  );
}

export interface MapFocus {
  guide: { id: string; viewId: string; doc: GuideDocument };
  selection: Selection;
  jumps: number;
  before: SimState | undefined;
  profile: Profile | undefined;
  select: (selection: Selection) => void;
  edit: { store: EditorStore; skipped: boolean } | null;
  /** How many steps after the selected one print their number, as in `guideLayout`. Undefined numbers every step. */
  numberedAhead?: number | undefined;
}

export interface GuideMapView {
  map: LoadedWorldMap;
  surface: Surface;
  pxPerPercent: number;
  interiors: ReturnType<typeof useInteriorView>;
}

export interface MapExtras {
  scene?: (view: GuideMapView, frame: Frame) => ReactNode;
  overlay?: (view: GuideMapView) => ReactNode;
  view?: ViewRequest | undefined;
  onUserMove?: ((move: UserMove) => void) | undefined;
  onFocus?: (() => void) | undefined;
  interior?: Interior | undefined;
  foot?: ReactNode;
  panel?: ReactNode;
  /** Where the character stands still, which the guide's quest marks clear. */
  stand?: WorldLocation | undefined;
}

export interface SearchActions {
  index: FeatureIndex;
  step: number | null;
  area: string | undefined;
  onAdd: (location: MapLocation, command: AddCommand) => void;
}

const NO_SELECTION: Selection = { step: null, line: null };

export function useGuideMap(
  data: GameData | null,
  focus: MapFocus | null,
  extras: MapExtras = {},
): { controls: ReactNode; body: ReactNode; search: SearchActions | undefined } | null {
  const dataset = useContext(DatasetContext);
  const guide = focus?.guide;
  const selection = focus?.selection ?? NO_SELECTION;
  const jumps = focus?.jumps ?? 0;
  const edit = focus?.edit ?? null;
  const settings = useMapSettings();
  const profile = useMapProfile();
  const visible = (category: CategoryId) => showsCategory(settings, category, profile);
  const previewSettings = usePreviewSettings();
  const faction = useFaction();
  const world = dataset?.data?.worldMap;
  const index = useFeatures();
  const terrain = useMemo(() => {
    if (!data || !world) return null;
    const map = data.terrainMap(world);
    const features = placeFeatures(map);
    return {
      map,
      surface: terrainSurface(data, map, new WeakMap<Step, StepPoints<Placed>>()),
      features,
      byPoi: new Map(features.pois.map((p) => [p.poi, p])),
      maps: mapList(data),
    };
  }, [data, world]);
  const step = selection.step;
  const follow = `${guide?.id}:${step}`;
  const hovered = useHighlight(follow);
  const sim = useSimData(previewSettings);
  const view = useGuideView({
    outside: extras.view,
    receives: !!edit,
    resolve: (target, preferredMap) => {
      if (!data || !terrain || !index) return { kind: "unavailable", message: "The map is still loading." };
      const { surface, map } = terrain;
      return resolveMapFocus(target, { data, features: index, surface, map, faction, sim, preferredMap });
    },
    onFocus: () => {
      extras.onUserMove?.("pan");
      extras.onFocus?.();
    },
  });
  const { shown: shownMap, focus: focused } = view;
  const [message, setMessage] = useState<{ follow: string; text: string; error: boolean; draft?: boolean } | null>(null);
  const highlight = hovered ?? focused?.objective ?? null;
  const [card, setCard] = useState<Feature | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const pickPoi = useCallback((poi: WorldMapPoi) => {
    const feature = indexRef.current?.feature(poi);
    if (feature) setCard(feature);
  }, []);
  const [questCard, setQuestCard] = useState<readonly QuestMarker[] | null>(null);
  const addQuestRef = useRef<(action: QuestAction) => void>(null);
  const addQuestStep = useCallback((action: QuestAction) => addQuestRef.current?.(action), []);
  const stepObject = guide && step !== null ? guide.doc.steps[step] : undefined;
  const spots = useMemo(
    () => (data && stepObject ? questSpots(data, stepObject, faction, sim) : NO_SPOTS),
    [data, stepObject, faction, sim],
  );
  const before = focus?.before;
  const { allQuests } = settings;
  const questProfile = focus?.profile;
  const drawnSpots = visible("guide") ? spots : NO_SPOTS;
  const markers = useMemo(
    () =>
      data && sim && before && questProfile ? questMarkers(before, data, sim, questProfile, { all: allQuests, spots: drawnSpots }) : null,
    [data, sim, before, questProfile, allQuests, drawnSpots],
  );
  const [availableOn, turnInsOn] = [visible("quest-available"), visible("quest-turn-in")];
  const showQuests = useMemo(() => ({ available: availableOn, turnIns: turnInsOn }), [availableOn, turnInsOn]);
  const lockNames = useMemo<LockNames | null>(
    () =>
      data && {
        quest: (id) => data.quest(id, faction)?.name ?? `quest #${id}`,
        faction: (id) => data.factionName(id),
        rules: data.rules,
      },
    [data, faction],
  );
  const placed = useMemo(
    () =>
      markers && terrain
        ? markers.flatMap((marker): PlacedMarker[] => {
            const at = terrain.surface.project(marker);
            return at ? [{ marker, at }] : [];
          })
        : null,
    [markers, terrain],
  );
  const areas = useMemo(
    () =>
      spots
        .flatMap((s) => s.objectives ?? [])
        .map((o) => ({ key: o.key, color: o.color, rings: spawnAreas(o.spawns.map((p) => p.world)) })),
    [spots],
  );
  const outlines = useMemo(() => (terrain ? projectAreas(terrain.surface, areas) : []), [areas, terrain]);
  const rawWaits = useSyncExternalStore(subscribeDrafts, () => !!guide && !!stepObject && hasRawDraft(guide, step));
  const [tiles, setTiles] = useState({ failed: false, attempt: 0 });
  const interiors = useInteriorView(terrain?.map, view.mapView, extras.interior);
  const [plans, setPlans] = useState(false);
  const zoneGrids = useZoneGrids(terrain?.map, visible("zone-borders"));
  if (!data || !guide) return null;
  const doc = guide.doc;

  const say = (text: string | null, error = true) => setMessage(text === null ? null : { follow, text, error });

  const showOutcome = (result: SectionEdit) => {
    if (!result.ok && result.reason === "waits") return setMessage({ follow, text: result.error, error: true, draft: true });
    say(result.ok || result.reason === "opened" ? null : result.error);
  };
  const editPoints = (op: DocOp, at: Selection, line?: number) => {
    if (edit) showOutcome(editSection(edit.store, step, op, at, line));
  };
  const applyRaw = () => showOutcome(applyRawDraft(edit!.store, step));
  const discardRaw = () => {
    discardRawDraft(edit!.store, step);
    say(null);
  };

  const addPoint = (at: MapLocation | undefined, command: AddCommand) => {
    if (step === null) return say("Select a step to add points to it.");
    if (!at) return say("No zone map covers that point.");
    const body = doc.steps[step]!.body;
    const index = insertIndex(body, selection.line);
    const line: CommandLine = {
      kind: "command",
      indent: bodyIndent(doc),
      name: command,
      args: data.formatLocation(at),
    };
    editPoints((d) => insertLine(d, { step, index }, line), { step, line: index });
  };

  addQuestRef.current = ({ command, id, marker }) => {
    if (!edit) return;
    const request = { kind: "marker", command, id, marker, skipped: edit.skipped } as const;
    const insertion = insertQuest({ data, faction, doc, after: step }, request);
    editPoints(insertion.edit, { step: insertion.select, line: null });
  };

  const controls = (options: ReactNode, shownKey: string) => (
    <Select className="map-shown" aria-label="Map shown" value={shownKey} onChange={(e) => view.pick(Number(e.target.value.slice(1)))}>
      {options}
    </Select>
  );
  const search: SearchActions | undefined =
    index && edit
      ? {
          index,
          step,
          area: step === null ? undefined : stepArea(data, doc.steps[step]!),
          onAdd: addPoint,
        }
      : undefined;
  if (!terrain) {
    return {
      controls: controls(<option value="">Azeroth</option>, ""),
      body: (
        <>
          <p className="empty">Loading the terrain map…</p>
          {extras.panel && <div className="map-top">{extras.panel}</div>}
          {extras.foot && <div className="map-foot">{extras.foot}</div>}
        </>
      ),
      search,
    };
  }

  const messageNote = message?.follow === follow && (!message.draft || rawWaits) && (
    <p key="message" className={message.error ? "error" : undefined} role={message.error ? "alert" : undefined}>
      {message.text}
      {message.draft && (
        <>
          {" "}
          <Button variant="secondary" onClick={applyRaw}>
            Apply raw text
          </Button>{" "}
          <Button variant="secondary" onClick={discardRaw}>
            Discard raw text
          </Button>
        </>
      )}
    </p>
  );
  const problemNotes = (problems: PointProblem[]) =>
    problems.map((p) => (
      <p key={`problem${p.line}`} className="warn">
        Line {p.line + 1} (.{p.command}) is not on the map: {p.message}
      </p>
    ));
  const { map, features, surface } = terrain;
  view.follow({ guide: guide.viewId, jumps, step }, () => followedMap(surface, data, doc, selection, faction, sim));
  const listed = terrain.maps.flatMap(({ continent, zones }) => [mapKey(continent), ...zones.map(mapKey)]);
  const shownKey = listed.includes(`t${shownMap}`) || shownMap === ZEPHRAS_ISLE ? `t${shownMap}` : `t${AZEROTH}`;
  const movePoint = (i: number, p: StepPoint, to: ViewPoint) => {
    const line = doc.steps[i]!.body[p.line] as CommandLine;
    const target = surface.locate(to, p);
    if (!target) return say("No zone map covers that point.");
    const args = movedArgs(data, line, target);
    if (args.join(",") === line.args.join(",")) return;
    const pos = { step: i, index: p.line };
    editPoints((d) => updateLine(d, pos, (l) => setCommandArgs(l as CommandLine, args)), { step: i, line: p.line }, p.line);
  };
  const laid = guideLayout(surface, {
    data,
    doc,
    selection,
    spots,
    areas: outlines,
    highlight,
    showGuide: visible("guide"),
    previousSteps: settings.previousSteps,
    upcomingSteps: settings.upcomingSteps,
    numberedAhead: focus?.numberedAhead,
  });
  const pins = laid.pins.map(({ target, ...pin }): Pin => {
    if ("spot" in target) {
      if (!edit) return pin;
      return {
        ...pin,
        label: `${target.title}. Adds a point here.`,
        menu: addMenu(target.title, (command) => addPoint(target.spot, command)),
      };
    }
    const { step: i, line, drag } = target;
    return { ...pin, activate: () => focus.select({ step: i, line }), move: edit && drag ? (to) => movePoint(i, drag, to) : undefined };
  });
  const selectedPoint =
    step === null || selection.line === null ? undefined : surface.place(doc.steps[step]!).points.find((p) => p.line === selection.line);
  const readoutPoints: ReadoutPoint[] = selectedPoint ? [{ label: "Point", at: selectedPoint.world }] : [];
  const referenced =
    visible("references") && step !== null && index ? stepEntities(doc.steps[step]!).flatMap((e) => index.entity(e)?.locations ?? []) : [];
  const references = [...new Set(referenced.flatMap((l) => l.pois.flatMap((p) => terrain.byPoi.get(p) ?? [])))];
  const marks = focused?.marks ?? [];
  const spawnsOn = visible("guide") && visible("objective-spawns");
  const rings = focused?.objective && spawnsOn ? [] : marks.filter((m) => !m.place);
  const shown: PlacedPoi[] = marks.flatMap((m) => m.pois.map((p) => ({ ...terrain.byPoi.get(p)!, at: m.at })));
  const marked = {
    pois: [...references, ...shown.filter((s) => !references.some((r) => r.poi === s.poi && r.at.x === s.at.x && r.at.y === s.at.y))],
    places: marks.flatMap((m) => (m.place ? [{ place: m.place, at: m.at }] : [])),
  };
  const scene = (frame: Frame, pxPerPercent: number) => (
    <>
      <TerrainScene
        map={map}
        frame={frame}
        pxPerPercent={pxPerPercent}
        attempt={tiles.attempt}
        onTileError={() => setTiles((t) => (t.failed ? t : { ...t, failed: true }))}
      />
      {interiors.placed && interiors.inside && (
        <InteriorImage map={map} placed={interiors.placed} look={plans ? "plan" : "minimap"} pxPerPercent={pxPerPercent} />
      )}
      {extras.scene?.({ map, surface, pxPerPercent, interiors }, frame)}
    </>
  );
  const shownPlaced = placed && (showQuests.available || showQuests.turnIns) ? placed : null;
  const questIcons = shownPlaced && lockNames ? shownMarkers(shownPlaced, showQuests).map((p) => p.at) : [];
  const markSpots = pins.flatMap((p) => (p.rank ? [] : [p.at]));
  const terrainOverlay = (frame: Frame, pxPerPercent: number) => (
    <TerrainMarkers
      map={map}
      features={features}
      shows={visible}
      marked={marked}
      onPick={pickPoi}
      frame={frame}
      pxPerPercent={pxPerPercent}
      quests={questIcons}
      marks={markSpots}
    />
  );
  const options = (
    <>
      <option value={`t${AZEROTH}`}>Azeroth</option>
      {terrain.maps.map(({ continent, zones }) => (
        <optgroup key={continent.uiMapId} label={continent.name}>
          <option value={mapKey(continent)}>{continent.name} (continent)</option>
          {zones.map((z) => (
            <option key={z.id} value={mapKey(z)}>
              {z.name}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Zephras Isle">
        <option value={`t${ZEPHRAS_ISLE}`}>Zephras Isle</option>
      </optgroup>
    </>
  );
  const questLayer =
    shownPlaced &&
    lockNames &&
    ((pxPerPercent: number, openMenu: OpenMenu) => (
      <QuestMarkers
        placed={shownPlaced}
        show={showQuests}
        pxPerPercent={pxPerPercent}
        aspect={surface.aspect}
        lockNames={lockNames}
        onPick={setQuestCard}
        openMenu={openMenu}
        onAdd={edit ? addQuestStep : undefined}
      />
    ));
  const overlay = (frame: Frame, pxPerPercent: number, openMenu: OpenMenu) => (
    <>
      {zoneGrids && <ZoneBorders grids={zoneGrids.grids} proj={zoneGrids.proj} />}
      {terrainOverlay(frame, pxPerPercent)}
      {questLayer?.(pxPerPercent, openMenu)}
      {rings.map((m, i) => (
        <span key={i} className="focus-mark" style={{ "--at-x": `${m.at.x}%`, "--at-y": `${m.at.y}%` }} />
      ))}
      {extras.overlay?.({ map, surface, pxPerPercent, interiors })}
    </>
  );
  const focusPaths: Shape[] = (focused?.paths ?? []).map((path, i) => ({
    key: `focus${i}`,
    points: [...path.points],
    closed: path.closed,
    className: "focus-path",
  }));

  const notes = [
    messageNote,
    focused && (
      <p key="focus" className="focus-caption">
        {focused.caption}
      </p>
    ),
    ...problemNotes(laid.problems),
    tiles.failed && (
      <p key="tiles" className="error" role="alert">
        Some terrain tiles did not load.{" "}
        <Button
          variant="secondary"
          onClick={() => {
            setTiles((t) => ({ failed: false, attempt: t.attempt + 1 }));
          }}
        >
          Retry
        </Button>
      </p>
    ),
    edit && step !== null && laid.placed === 0 && laid.problems.length === 0 && (
      <p key="none">Step {step + 1} has no points. Right-click the map to add one.</p>
    ),
  ].filter(Boolean);

  return {
    controls: controls(options, shownKey),
    search,
    body: (
      <>
        <MapCanvas
          key={surface.key}
          aspect={surface.aspect}
          maxZoom={surface.maxZoom}
          scene={scene}
          overlay={overlay}
          pins={pins}
          shapes={[...laid.shapes, ...focusPaths]}
          areas={spawnsOn ? laid.areas : []}
          spawns={spawnsOn ? laid.dots : []}
          label={`Map of ${surface.name}.${!edit ? "" : step === null ? " Select a step to add points." : ` Right-click to add a point to step ${step + 1}.`}`}
          describe={laid.describe}
          menu={(at) => (edit ? addMenu(laid.describe(at), (command) => addPoint(surface.locate(at), command)) : undefined)}
          {...view.canvas(surface)}
          onUserMove={extras.onUserMove}
          stand={extras.stand && surface.projectOutline(extras.stand)}
        />
        <div ref={view.mapTop} className="map-top">
          {extras.panel}
          {interiors.placed && (
            <InsideMapBox
              interior={interiors.placed.interior}
              inside={interiors.inside}
              onInside={interiors.setInside}
              plans={{ on: plans, onChange: setPlans }}
            />
          )}
          {notes.length > 0 && <Card className="map-note">{notes}</Card>}
          <MapLegend terrain={terrain} quests={placed} spawns={laid.spawns} mapView={view.mapView} stacks={!!map.interiors} />
        </div>
        <div className="map-foot">
          {extras.foot}
          <div className="map-readout">
            <CoordinateReadout
              pointer={view.mapView}
              map={map}
              selection={edit ? readoutPoints : undefined}
              zones={zoneGrids?.grids ?? []}
            />
          </div>
        </div>
        {questCard && lockNames && (
          <Dialog title={questCard.length === 1 ? questCard[0]!.source : "Quests here"} onClose={() => setQuestCard(null)}>
            <QuestCard
              markers={questCard}
              show={showQuests}
              data={data}
              faction={faction}
              level={before?.level ?? null}
              lockNames={lockNames}
            />
          </Dialog>
        )}
        {card && (
          <Dialog title={card.name} onClose={() => setCard(null)}>
            <FeatureCard
              feature={card}
              area={step === null ? undefined : stepArea(data, doc.steps[step]!)}
              onShow={(location) => {
                setCard(null);
                view.show({ kind: "feature", feature: card, location });
              }}
              {...(edit && {
                add: {
                  step,
                  onAdd: (at, command) => {
                    setCard(null);
                    addPoint(at, command);
                  },
                },
              })}
            />
          </Dialog>
        )}
      </>
    ),
  };
}

const addMenu = (title: string, add: (command: AddCommand) => void): MapMenu => ({
  title,
  items: [
    { label: "Add .goto", run: () => add("goto") },
    { label: "Add .waypoint", run: () => add("waypoint") },
  ],
});

const NO_SPOTS: QuestSpot[] = [];

const mapKey = (map: Zone | Continent) => `t${map.uiMapId}`;

function mapList(data: GameData): { continent: Continent; zones: Zone[] }[] {
  return data.continents.map((continent) => ({
    continent,
    zones: data.zones
      .filter((z) => z.continent === continent && z.uiMapId !== undefined && data.mapBounds.has(z.uiMapId))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
