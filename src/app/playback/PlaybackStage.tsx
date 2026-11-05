import { memo, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { interiorAt } from "../../data/heightMap.ts";
import { frameOf, nativeToWorld, type NativeFrame } from "../../routing/frame.ts";
import type { WayView } from "../../routing/playback.ts";
import { DEFAULT_MAX_SLOPE, withHeight, type WorldStop } from "../../routing/plan.ts";
import { routeOf } from "../../routing/result.ts";
import { DatasetContext, useGameData, useStores } from "../context.ts";
import { Described } from "../Described.tsx";
import { Icon } from "../icons.tsx";
import { Button } from "../ui/Button.tsx";
import { useGuideMap, type MapExtras, type MapFocus, type GuideMapView } from "../map/MapPanel.tsx";
import type { ViewPoint } from "../map/points.ts";
import { jumpTo, usePlaybackRoute } from "../preview/route.ts";
import { previewDoc, type Activity } from "../../rules/index.ts";
import { insideOf, levelChip, levelOf, useSurfaces } from "../routing/Interiors.tsx";
import { legLines, lineView, projection, round, toScreen } from "../routing/lines.ts";
import { LayersMenu, RouterLayers, tileRects, type TileRect } from "../routing/MapLayers.tsx";
import { useRouteSettings, useRouteSettingsStore } from "../routing/settings.ts";
import type { MapRouting } from "../routing/engine.ts";
import { useRouting } from "../routing/routingStore.ts";
import { CharacterCard } from "./CharacterCard.tsx";
import { MobLegend, MobMarkers } from "./MobLayer.tsx";
import { usePlaybackNotice } from "./notice.tsx";
import { useCharacter, useCurrentStep, useMoment, usePlayable, usePlayback, usePlaybackStore } from "./store.ts";
import { Card } from "../ui/Card.tsx";

const tiles = new WeakMap<object, TileRect[]>();
function tilesOf(map: GuideMapView["map"], maps: readonly MapRouting[]): TileRect[] {
  let found = tiles.get(map);
  if (!found)
    tiles.set(
      map,
      (found = tileRects(
        projection(
          map,
          maps.map((m) => m.manifest),
        ),
        maps,
      )),
    );
  return found;
}

function routedStops({ plan, journey }: WayView, frames: readonly NativeFrame[]): WorldStop[] {
  const leg = journey?.legs[0];
  if (!plan || !leg) return [];
  const parts =
    leg.kind === "transport" ? leg.parts.flatMap((p) => (p.kind === "ground" ? [p] : [])) : [{ map: plan.stops[0]!.instance, result: leg }];
  return parts.flatMap(({ map, result }) => {
    const [route, frame] = [routeOf(result), frameOf(frames, map)];
    const heights = route?.heights;
    return heights && frame ? route.points.map((p, i) => withHeight(nativeToWorld(frame, p), heights[i]!)) : [];
  });
}

const FOLLOW_WIDTH = 1.2;
const FOLLOW_SLACK = 8;

interface Follow {
  on: boolean;
  at?: ViewPoint;
  again: number;
  zoomIn: boolean;
}

const zoomShown = (f: Follow): Follow => (f.on && f.at ? { ...f, zoomIn: false } : f);

export function PlaybackStage() {
  const data = useGameData();
  const route = usePlaybackRoute();
  const store = usePlaybackStore();
  const playback = usePlayable();
  const index = useCurrentStep();
  const step = playback?.timeline.steps[index];
  const record = step && route?.records[step.source];
  const character = useCharacter();
  const { load, painter } = useRouting("playback");
  const engine = load?.ok ? load.engine : null;
  const routeSettings = useRouteSettingsStore();
  const { layers } = useRouteSettings();
  const focus = useMemo((): MapFocus | null => {
    if (!step || !record || !route || !playback) return null;
    return {
      guide: { id: record.id, viewId: record.id, doc: previewDoc(record) },
      selection: { step: step.step, line: null },
      jumps: index,
      before: character ?? step.before,
      profile: { ...route.profile, soloSelfFound: true },
      select: (at) => {
        const i = at.step === null ? -1 : playback.indexOf(step.source, at.step);
        if (i >= 0) store.seekStep(i);
      },
      edit: null,
      numberedAhead: 1,
    };
  }, [step, record, route, playback, store, character, index]);
  const [follow, setFollow] = useState<Follow>({ on: true, again: 0, zoomIn: true });
  const here = useRef<ViewPoint>(undefined);
  const pauseFollow = () => setFollow((f) => (f.on ? { ...zoomShown(f), on: false } : f));
  const ways = useMemo(() => (playback ? playback.ways(index) : []), [playback, index]);
  const interiors = useContext(DatasetContext)?.data?.worldMap?.interiors;
  const frames = useMemo(() => engine?.maps.map((m) => m.manifest) ?? [], [engine]);
  const routed = useMemo(() => ways.flatMap((way) => routedStops(way, frames)), [ways, frames]);
  const place = () => store.moment()?.place;
  const near = useSyncExternalStore(store.subscribe, () => interiors && place() && interiorAt(interiors.list, place()!));
  const holding = useSyncExternalStore(
    store.subscribe,
    () => place() && insideOf(interiors, withHeight(place()!, place()!.height ?? null)),
  );
  useSurfaces(interiors, routed, near);
  const stand = useSyncExternalStore(store.subscribe, () => {
    const moment = store.moment();
    return moment && !walks(moment.activity) ? moment.place : undefined;
  });
  const extras: MapExtras = {
    scene: (view, frame) =>
      engine &&
      painter && (
        <RouterLayers
          painter={painter}
          tiles={tilesOf(view.map, engine.maps)}
          frame={frame}
          pxPerPercent={view.pxPerPercent}
          choices={layers}
          maxSlope={DEFAULT_MAX_SLOPE}
          searches={{}}
        />
      ),
    overlay: (view) => (
      <>
        <WayLines view={view} ways={ways} frames={frames} />
        {layers.mobs && <MobMarkers view={view} />}
        <CharacterMarker
          view={view}
          onAt={(at) => {
            here.current = at;
            if (!at) return;
            const far = (from: ViewPoint | undefined) => {
              if (!from) return true;
              const [dx, dy] = toScreen({ x: at.x - from.x, y: at.y - from.y }, view.pxPerPercent, view.surface.aspect);
              return Math.max(Math.abs(dx), Math.abs(dy)) > FOLLOW_SLACK;
            };
            if (follow.on && far(follow.at)) setFollow((f) => (f.on && far(f.at) ? { ...zoomShown(f), at } : f));
          }}
        />
      </>
    ),
    interior: holding ?? routed.map((stop) => insideOf(interiors, stop)).find(Boolean),
    view: follow.at && {
      id: `follow ${follow.again} ${follow.at.x},${follow.at.y}`,
      fit: { x: follow.at.x, y: follow.at.y, ...(follow.zoomIn && { width: FOLLOW_WIDTH }) },
      hold: !follow.on,
      zoomKeepsPoint: true,
    },
    onUserMove: (move) => {
      if (move === "reset") setFollow((f) => ({ ...f, on: false, zoomIn: true }));
      else if (move === "pan") pauseFollow();
    },
    foot: <CalculateRouting />,
    panel: <CharacterCard />,
    stand,
  };
  const map = useGuideMap(data, focus, extras);
  const notice = usePlaybackNotice();
  return (
    <section className="panel map-panel playback-stage" aria-label="Map">
      <div className="panel-head">
        <h2>Map</h2>
        {map?.controls}
        <Button
          variant="ghost"
          size={28}
          pressed={follow.on}
          onClick={() => {
            const at = here.current;
            if (follow.on) pauseFollow();
            else if (at) setFollow((f) => ({ ...f, on: true, at, again: f.again + 1 }));
          }}
          disabled={!follow.at}
        >
          Follow character
        </Button>
        <LayersMenu
          choices={layers}
          searches={{}}
          hasInteriors={!!data}
          mobsLegend={<MobLegend />}
          onChange={(choices) => routeSettings.set("layers", choices)}
        />
      </div>
      <NowDoing />
      <div className="map-body">
        {(!notice && map?.body) || <p className="empty">{notice?.problem ? "No guide steps loaded." : "Loading the map…"}</p>}
      </div>
    </section>
  );
}

function NowDoing() {
  const moment = useMoment();
  const route = usePlaybackRoute();
  const playback = usePlayable();
  const stores = useStores();
  const step = moment && playback?.timeline.steps[moment.step];
  const doing = moment?.doing || (playback ? "Route finished" : "");
  return (
    <div className="now-doing">
      <span className="now-doing-text" aria-hidden="true">
        {doing}
      </span>
      <span className="sr-only" aria-live="polite">
        {doing}
      </span>
      {step && route && (
        <Button
          variant="secondary"
          onClick={() => {
            stores.layout.update({ mode: "edit" });
            jumpTo(stores, route, step.source, { step: step.step, line: null });
          }}
        >
          Edit this step
        </Button>
      )}
    </div>
  );
}

function CalculateRouting() {
  const store = usePlaybackStore();
  const chain = usePlayback((s) => (s.status.kind === "ready" ? s.status.playback.chain : undefined));
  const reach = usePlayback((s) => s.reach);
  const captionId = useId();
  const later = chain?.filter((g) => g.through > reach) ?? [];
  const [next] = later;
  if (!next) return null;
  return (
    <Card className="playback-calculate" role="group" aria-labelledby={captionId}>
      <p className="playback-calculate-caption">
        <Icon name="route" size={12} />
        <span id={captionId}>Calculate routing</span>
        <span className="playback-calculate-left">{later.length === 1 ? "1 guide left" : `${later.length} guides left`}</span>
      </p>
      <div className="playback-calculate-actions">
        <Described text={`Calculate ${next.name}`}>
          <Button variant="primary" size={32} aria-label="Calculate next guide" onClick={() => store.extend(next.through)}>
            Next guide
          </Button>
        </Described>
        <Button variant="secondary" size={32} aria-label="Calculate all guides" onClick={() => store.extend(Infinity)}>
          All guides
        </Button>
      </div>
    </Card>
  );
}

const points = (view: ViewPoint[]) => view.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");

const WayLines = memo(function WayLines(props: { view: GuideMapView; ways: readonly WayView[]; frames: Parameters<typeof projection>[1] }) {
  const { view, ways, frames } = props;
  const lines = useMemo(() => {
    const proj = projection(view.map, frames);
    return ways.map((way) => {
      const straight = [way.from, way.to].flatMap((at) => view.surface.projectOutline(at) ?? []);
      if (!way.plan || !way.journey) return { look: "straight", view: straight, title: way.source ?? "" };
      const [line] = legLines(way.plan, way.journey, null);
      return { look: line?.look ?? "straight", view: line ? lineView(line, proj) : straight, title: way.source ?? "" };
    });
  }, [view.map, view.surface, ways, frames]);
  return (
    <svg className="route-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((line, i) => (
        <g key={i} className={`route-leg leg-${line.look}`}>
          <polyline className="leg-outline" points={points(line.view)} />
          <polyline className="leg-line" points={points(line.view)} />
        </g>
      ))}
    </svg>
  );
});

const NO_STOPS: readonly WorldStop[] = [];

// The character moves through these activities, so its place is new on each frame. Playback keeps one place for each
// other activity.
const walks = (activity: Activity | undefined) =>
  activity?.kind === "travel" ||
  activity?.kind === "flight" ||
  ((activity?.kind === "kill" || activity?.kind === "grind") && !!activity.walk);

function CharacterMarker(props: { view: GuideMapView; onAt: (at: ViewPoint | undefined) => void }) {
  const { view, onAt } = props;
  const moment = useMoment();
  const place = moment?.place;
  const at = place && view.surface.projectOutline(place);
  const interiors = view.map.interiors;
  useSurfaces(interiors, NO_STOPS, place && interiors && interiorAt(interiors.list, place));
  const where = place && levelOf(interiors, withHeight(place, place.height ?? null));
  const chip = where && levelChip(where);
  useLayoutEffect(() => {
    onAt(at);
  });
  if (!at) return null;
  const [x, y] = toScreen(at, view.pxPerPercent, view.surface.aspect);
  return (
    <div
      className="character-marker"
      style={{ "--at-x": `${x}px`, "--at-y": `${y}px` }}
      role="img"
      aria-label={chip ? `Character on ${chip}` : "Character"}
    >
      {chip && <span className="character-chip">{chip}</span>}
    </div>
  );
}
