import { useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { LoadedWorldMap, WorldMapData } from "../../data/index.ts";
import type { Faction } from "../../rules/index.ts";
import { Described } from "../Described.tsx";
import { Icon } from "../icons.tsx";
import { Button, IconButton } from "../ui/Button.tsx";
import { ItemButton } from "../ui/ItemButton.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import type { Frame, Spawn } from "./MapCanvas.tsx";
import { MapIconImage } from "./MapIconImage.tsx";
import { PopoverMenu } from "./PopoverMenu.tsx";
import {
  CATEGORIES,
  drawsAsDot,
  LAYERS,
  layerCategories,
  showsCategory,
  STEP_SHOWS,
  useMapProfile,
  useMapSettings,
  useMapSettingsStore,
  type CategoryId,
  type LayerId,
  type MapSettings,
  type StepShow,
} from "./mapSettings.ts";
import type { ViewPoint } from "./points.ts";
import type { PlacedMarker } from "./questMarkers.ts";
import { iconOf, showsSide, type TerrainFeatures } from "./terrain.ts";
import { useFrame, type MapViewSource } from "./view.ts";
import { canvasToView } from "./viewport.ts";
import { wholeRowsHeight } from "./wholeRows.ts";

export const inFrame = (at: ViewPoint, f: Frame): boolean =>
  at.x >= f.left && at.x <= f.left + f.width && at.y >= f.top && at.y <= f.top + f.height;

function countsIn(
  features: TerrainFeatures,
  routes: readonly ViewPoint[][],
  frame: Frame,
  faction: Faction,
  allFactions: boolean,
): Map<CategoryId, number> {
  const counts = new Map<CategoryId, number>();
  const add = (id: CategoryId) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const p of features.pois) {
    if (inFrame(p.at, frame) && showsSide(p.poi, faction, allFactions)) add(p.category.key as CategoryId);
  }
  for (const p of features.places) if (inFrame(p.at, frame)) add(p.place.kind === "landmark" ? "landmarks" : "zones");
  for (const r of routes) if (r.some((at) => inFrame(at, frame))) add("routes");
  return counts;
}

export function MapLegend(props: {
  terrain: { map: WorldMapData & Pick<LoadedWorldMap, "icons">; features: TerrainFeatures };
  quests: readonly PlacedMarker[] | null;
  spawns: readonly Spawn[];
  mapView: MapViewSource;
  stacks: boolean;
}) {
  const { terrain, quests } = props;
  const store = useMapSettingsStore();
  const settings = useMapSettings();
  const profile = useMapProfile();
  const frame = useFrame(props.mapView);
  const routes = useMemo(() => terrain.map.routes.map((r) => r.points.map(([x, y]) => canvasToView(terrain.map, { x, y }))), [terrain]);
  const counts = frame ? countsIn(terrain.features, routes, frame, profile.faction, settings.allFactions) : undefined;
  const questCounts = quests && frame ? countQuests(quests, frame) : undefined;
  const spawnCount = frame ? props.spawns.filter((s) => inFrame(s.at, frame)).length : undefined;
  const categories = useMemo(() => new Map(terrain.map.categories.map((c) => [c.key, c])), [terrain]);
  const shows = (id: CategoryId) => showsCategory(settings, id, profile);

  const body = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = body.current;
    const panel = el?.parentElement;
    const strip = el?.closest(".map-top");
    if (!el || !panel || !strip) return;
    const box = el.getBoundingClientRect();
    const panelPadding = panel.getBoundingClientRect().bottom - box.bottom;
    const room = Math.max(0, strip.getBoundingClientRect().bottom - box.top - panelPadding);
    el.style.maxHeight = `${room}px`;
    if (el.scrollHeight > el.clientHeight) el.style.maxHeight = `${wholeRowsHeight(el, LEGEND_ROWS, box.top, room)}px`;
    markRowsBelow(el);
  };
  useLayoutEffect(fit);
  useEffect(() => {
    // Row heights can change when the web fonts load.
    const fonts = "fonts" in document ? document.fonts : undefined;
    fonts?.addEventListener("loadingdone", fit);
    const strip = body.current?.closest(".map-top");
    const observer = strip && typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : undefined;
    if (strip) observer?.observe(strip);
    return () => {
      fonts?.removeEventListener("loadingdone", fit);
      observer?.disconnect();
    };
  }, []);

  const row = (id: CategoryId, name: string) => {
    const dot = drawsAsDot(CATEGORIES[id], id);
    return (
      <LegendRow
        key={id}
        name={name}
        icon={categories.has(id) && !dot ? iconOf(categories.get(id)!, terrain.map.icons) : undefined}
        iconClass={dot ? `dot-swatch poi-${CATEGORIES[id]}` : SWATCHES[id]}
        count={counts && id !== "guide" && id !== "references" ? (counts.get(id) ?? 0) : undefined}
        on={shows(id)}
        onToggle={() => store.setCategories([id], !shows(id))}
      />
    );
  };
  return (
    <details
      className="map-legend"
      open={settings.legendOpen}
      onToggle={(e) => {
        const open = e.currentTarget.open;
        if (open !== store.getState().legendOpen) store.update({ legendOpen: open });
      }}
    >
      <summary>
        Legend <Icon name="chevronDown" size={12} />
      </summary>
      <div ref={body} className="legend-body" onScroll={(e) => markRowsBelow(e.currentTarget)}>
        {LAYERS.map((layer) => {
          const ids = layerCategories(layer.id);
          const on = ids.filter(shows).length;
          const pressed = on === ids.length ? true : on === 0 ? false : "mixed";
          if (layer.id === "guide")
            return (
              <LegendGroup
                key={layer.id}
                name={layer.name}
                pressed={pressed}
                onToggle={() => store.setCategories(ids, on < ids.length)}
                action={
                  <PopoverMenu
                    className="step-display"
                    label="Step display"
                    icon="sliders"
                    description="How the steps before and after the selected one show"
                    beside=".map-legend"
                  >
                    {(close) => (
                      <>
                        <div className="step-display-head">
                          <span>Step display</span>
                          <IconButton icon="x" label="Close Step display" onClick={close} />
                        </div>
                        {STEP_SIDES.map(({ name, key }) => (
                          <StepShowSwitch key={key} name={name} show={settings[key]} onShow={(v) => store.update({ [key]: v })} />
                        ))}
                      </>
                    )}
                  </PopoverMenu>
                }
              >
                <StepRow side="selected" name="Selected step" />
                <StepRow side="optional" name="Optional point" />
                {STEP_SIDES.map(({ side, name, key }) => (
                  <StepRow key={key} side={side} name={name} show={settings[key]} />
                ))}
                <LegendRow
                  name="Objective spawns"
                  icon={undefined}
                  iconClass="spawn-swatch"
                  count={spawnCount}
                  on={shows("objective-spawns")}
                  onToggle={() => store.setCategories(["objective-spawns"], !shows("objective-spawns"))}
                />
              </LegendGroup>
            );
          if (layer.id === "quests") {
            const questRow = (id: CategoryId, name: string, icon: string, count: number | undefined) => (
              <LegendRow
                name={name}
                icon={icon}
                count={count}
                on={shows(id)}
                disabled={!quests}
                onToggle={() => store.setCategories([id], !shows(id))}
              />
            );
            return (
              <LegendGroup
                key={layer.id}
                name={layer.name}
                pressed={pressed}
                disabled={!quests}
                onToggle={() => store.setCategories(ids, on < ids.length)}
              >
                {questRow("quest-available", "Available", "quest-giver", questCounts?.available)}
                {questRow("quest-turn-in", "Turn-ins", "quest-turn-in", questCounts?.turnIns)}
                <LegendFilter
                  name="All quests"
                  icon="quest-giver"
                  description="Also show gray and not yet available quests, dimmed"
                  on={settings.allQuests}
                  disabled={!quests}
                  onToggle={() => store.update({ allQuests: !settings.allQuests })}
                />
              </LegendGroup>
            );
          }
          if (layer.id === "zones") {
            const labelIds = MAP_LABELS.flatMap(layerCategories);
            const labelsOn = labelIds.filter(shows).length;
            return (
              <LegendGroup
                key="labels"
                name="Map labels"
                pressed={labelsOn === labelIds.length ? true : labelsOn === 0 ? false : "mixed"}
                onToggle={() => store.setCategories(labelIds, labelsOn < labelIds.length)}
              >
                {row("zones", layer.name)}
                <LegendRow
                  name={LAYER_NAMES.zoneBorders}
                  icon={undefined}
                  iconClass="zone-border-swatch"
                  count={undefined}
                  on={shows("zone-borders")}
                  onToggle={() => store.setCategories(["zone-borders"], !shows("zone-borders"))}
                />
                {row("landmarks", LAYER_NAMES.landmarks)}
              </LegendGroup>
            );
          }
          if (MAP_LABELS.includes(layer.id)) return null;
          if (ids.length === 1) return row(ids[0]!, layer.name);
          return (
            <LegendGroup
              key={layer.id}
              layer={layer.id}
              name={layer.name}
              pressed={pressed}
              onToggle={() => store.setCategories(ids, on < ids.length)}
            >
              {ids.map((id) => categories.has(id) && row(id, categories.get(id)!.name))}
            </LegendGroup>
          );
        })}
        {props.stacks && (
          <LegendGroup name="Inside maps">
            <StackRow kind="two" name="2 levels stack here" />
            <StackRow kind="more" name="3 or more levels stack here" />
          </LegendGroup>
        )}
        <LegendGroup name="Filters">
          <LegendFilter
            name="All factions"
            description="Show NPCs friendly only to the other faction"
            on={settings.allFactions}
            onToggle={() => store.update({ allFactions: !settings.allFactions })}
          />
          <LegendFilter
            name="All classes"
            description="Show trainers for every class"
            on={settings.allClasses}
            onToggle={() => store.update({ allClasses: !settings.allClasses })}
          />
        </LegendGroup>
        <Button variant="secondary" className="legend-reset" onClick={() => store.resetLegend()}>
          Reset to defaults
        </Button>
      </div>
    </details>
  );
}

const MAP_LABELS: readonly LayerId[] = ["zones", "zoneBorders", "landmarks"];
const LAYER_NAMES = Object.fromEntries(LAYERS.map((l) => [l.id, l.name])) as Record<LayerId, string>;

// The map draws these layers as text or lines, not as game icons.
const SWATCHES: Partial<Record<CategoryId, string>> = {
  references: "reference-swatch",
  zones: "label-swatch",
  landmarks: "label-swatch landmark",
  routes: "route-swatch",
};

const markRowsBelow = (body: HTMLElement) =>
  body.toggleAttribute("data-clipped", body.scrollTop + body.clientHeight < body.scrollHeight - 1);

// Leaves out headings, so the legend never ends on a heading with none of its rows.
const LEGEND_ROWS = ".legend-row, .legend-step, .legend-filter, .legend-body > button";
function countQuests(quests: readonly PlacedMarker[], frame: Frame): { available: number; turnIns: number } {
  let available = 0;
  let turnIns = 0;
  for (const { marker, at } of quests) {
    if (!inFrame(at, frame)) continue;
    if (marker.available.length > 0) available++;
    if (marker.turnIns.length > 0) turnIns++;
  }
  return { available, turnIns };
}

function LegendGroup(
  props: {
    name: string;
    layer?: string;
    disabled?: boolean;
    action?: ReactNode;
    children: ReactNode;
  } & ({ pressed: boolean | "mixed"; onToggle: () => void } | { pressed?: never; onToggle?: never }),
) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="legend-group" data-layer={props.layer}>
      <div className="legend-heading">
        <h3 id={id}>{props.name}</h3>
        {props.action}
        {props.onToggle && (
          <IconButton
            icon={props.pressed === false ? "eyeOff" : "eye"}
            label={props.name}
            description={`Show or hide all ${props.name}`}
            pressed={props.pressed}
            iconShowsPressed
            disabled={props.disabled}
            onClick={props.onToggle}
          />
        )}
      </div>
      {props.children}
    </div>
  );
}

function LegendRow(props: {
  name: string;
  icon: string | undefined;
  iconClass?: string | undefined;
  count: number | undefined;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { name, count } = props;
  return (
    <ItemButton
      className="legend-row"
      pressed={props.on}
      aria-label={count === undefined ? name : `${name}, ${count} in view`}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <MapIconImage icon={props.icon} size={16} {...(props.iconClass && { className: props.iconClass })} />
      <span className="legend-name">{name}</span>
      {count !== undefined && <span className="legend-count">{count}</span>}
      <Icon name={props.on ? "eye" : "eyeOff"} />
    </ItemButton>
  );
}

const SHOW_NAMES: Record<StepShow, string> = { hidden: "Hidden", dimmed: "Dimmed", shown: "Shown" };

const STEP_SIDES = [
  { side: "previous", name: "Previous", key: "previousSteps" },
  { side: "upcoming", name: "Upcoming", key: "upcomingSteps" },
] as const satisfies readonly { side: string; name: string; key: keyof MapSettings }[];

function StepRow(props: { side: "previous" | "selected" | "upcoming" | "optional"; name: string; show?: StepShow }) {
  return (
    <div className={`legend-step${props.show === "hidden" ? " off" : ""}`}>
      <span className={`step-swatch ${props.side}`} aria-hidden="true" />
      <span className="legend-name">{props.name}</span>
      {props.show && <span className="legend-state">{SHOW_NAMES[props.show]}</span>}
      {props.show === "hidden" ? <Icon name="eyeOff" className="off" /> : <Icon name="eye" />}
    </div>
  );
}

const SHOW_OPTIONS = STEP_SHOWS.map((value) => ({ value, label: SHOW_NAMES[value] }));

function StepShowSwitch(props: { name: string; show: StepShow; onShow: (show: StepShow) => void }) {
  const label = `${props.name} steps`;
  return (
    <div className="step-show">
      <span aria-hidden="true">{label}</span>
      <Segmented label={label} value={props.show} options={SHOW_OPTIONS} onChange={props.onShow} />
    </div>
  );
}

function StackRow(props: { kind: "two" | "more"; name: string }) {
  return (
    <div className="legend-step">
      <span className={`stack-swatch ${props.kind}`} aria-hidden="true" />
      <span className="legend-name">{props.name}</span>
    </div>
  );
}

/** `icon` draws the map icon, dimmed as the filter shows it, in the swatch column of rows with marks. */
function LegendFilter(props: { name: string; icon?: string; description: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <Described text={props.description}>
      <ItemButton
        className={props.icon ? "legend-row" : "legend-filter"}
        pressed={props.on}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        {props.icon && <MapIconImage icon={props.icon} size={16} className="dim" />}
        <span className="legend-name">{props.name}</span>
        <Icon name={props.on ? "eye" : "eyeOff"} />
      </ItemButton>
    </Described>
  );
}
