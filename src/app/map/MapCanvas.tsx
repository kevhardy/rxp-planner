import {
  Fragment,
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Icon } from "../icons.tsx";
import { MapIconImage } from "./MapIconImage.tsx";
import { IconButton } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { MarkButton } from "../ui/ItemButton.tsx";
import { MenuItem } from "../ui/MenuItem.tsx";
import type { ViewPoint } from "./points.ts";
import { crowdedNumbers } from "./pinNumbers.ts";
import { MapViewContext, type MapView, type UserMove, type ViewRequest } from "./view.ts";
import { clamp, mapCover, type Frame, type Inset } from "./viewport.ts";

export type { Fit, Frame } from "./viewport.ts";
export type { UserMove } from "./view.ts";

export type PinKind =
  | "goto"
  | "waypoint"
  | "previous"
  | "upcoming"
  | "start"
  | "end"
  | "both"
  | "objective"
  | "route-start"
  | "route-stop"
  | "route-end";

export interface Pin {
  key: string;
  at: ViewPoint;
  kind: PinKind;
  label: string;
  text?: string;
  /** How many steps the pin's step is from the selected step. Where ranked pins overlap, only the lowest rank prints its text. */
  rank?: number;
  chip?: string;
  selected?: boolean;
  fade?: number;
  fill?: string;
  icons?: string[];
  activate?: () => void;
  menu?: MapMenu;
  move?: ((to: ViewPoint) => void) | undefined;
  drag?: (to: ViewPoint | null) => void;
}

export type MapMenu = MapMenuGroup | { label: string; groups: MapMenuGroup[] };

export interface MapMenuGroup {
  title: ReactNode;
  items: MapMenuItem[];
}

export interface MapMenuItem {
  label: string;
  run: () => void;
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  content?: ReactNode;
  icon?: ReactNode;
  action?: string;
}

export type OpenMenu = (menu: MapMenu, button: HTMLElement) => void;

export interface Shape {
  key: string;
  points: ViewPoint[];
  closed: boolean;
  className: string;
  fade?: number;
  /** Draws a dark edge under the line, beneath every shape. */
  cased?: boolean;
}

export interface Spawn {
  key: string;
  at: ViewPoint;
  colors: string[];
}

export interface Area {
  key: string;
  color: string;
  d: string;
  state?: "focus" | "dim";
}

export function slices(colors: string[]): string {
  if (colors.length === 1) return colors[0]!;
  const slice = 100 / colors.length;
  return `conic-gradient(${colors.map((c, i) => `${c} ${i * slice}% ${(i + 1) * slice}%`).join(", ")})`;
}

const SpawnPaths = memo(function SpawnPaths({ spawns }: { spawns: Spawn[] }) {
  const groups = new Map<string, string>();
  for (const s of spawns) groups.set(s.colors[0]!, `${groups.get(s.colors[0]!) ?? ""}M${s.at.x} ${s.at.y}h0`);
  return (
    <svg className="spawns" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {[...groups].map(([color, d]) => (
        <g key={color} style={{ "--fill": color }}>
          <path className="edge" d={d} />
          <path d={d} />
        </g>
      ))}
    </svg>
  );
});

const AreaPaths = memo(function AreaPaths({ areas }: { areas: Area[] }) {
  return (
    <svg className="areas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {areas.map((a) => (
        <g key={a.key} className={a.state} style={{ "--fill": a.color }}>
          <path className="halo" d={a.d} />
          <path d={a.d} />
        </g>
      ))}
    </svg>
  );
});

const clampView = (p: ViewPoint): ViewPoint => ({ x: clamp(p.x, 0, 100), y: clamp(p.y, 0, 100) });

const WHOLE_STAGE: ViewRequest = {};

/**
 * The stage and its overlay lay out at the zoomed size instead of using a CSS
 * scale. Chrome snaps each tile to whole layout pixels, which a scale would
 * magnify, and misses clicks on elements that a counter-scale leaves under one
 * layout pixel.
 */
export function MapCanvas(props: {
  mapView: MapView;
  aspect: number;
  maxZoom: (w: number) => number;
  scene: (frame: Frame, pxPerPercent: number) => ReactNode;
  overlay?: ((frame: Frame, pxPerPercent: number, openMenu: OpenMenu) => ReactNode) | undefined;
  pins: Pin[];
  shapes: Shape[];
  areas: Area[];
  spawns: Spawn[];
  label: string;
  describe: (at: ViewPoint) => string;
  menu: (at: ViewPoint, pxPerPercent: number) => MapMenu | undefined;
  onClick?: ((at: ViewPoint, pxPerPercent: number) => void) | undefined;
  view?: ViewRequest | undefined;
  cover?: () => Inset;
  onUserMove?: ((move: UserMove) => void) | undefined;
}) {
  const { mapView, aspect, pins, shapes } = props;
  const snapshot = useSyncExternalStore(mapView.subscribe, mapView.getSnapshot);
  const { zoom, frame, pxPerPercent, maxZoom } = snapshot;
  const [moving, setMoving] = useState<{ key: string; at: ViewPoint } | null>(null);
  const [opened, setOpened] = useState<{
    x: number;
    y: number;
    at?: ViewPoint;
    pin?: string;
    menu?: MapMenu;
    button?: HTMLElement;
  } | null>(null);
  const drag = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const hintId = useId();

  const [, catchUp] = useState(snapshot);
  // useSyncExternalStore subscribes in a passive effect, so this renders what MapView publishes before then.
  useLayoutEffect(() => mapView.subscribe(() => catchUp(mapView.getSnapshot())), [mapView]);

  useLayoutEffect(() => {
    mapView.committed(snapshot, {
      aspect,
      maxZoom: props.maxZoom,
      request: props.view ?? WHOLE_STAGE,
      cover: props.cover,
      onClick: props.onClick,
      onUserMove: props.onUserMove,
      closeMenu: () => setOpened(null),
      openPointMenu: setOpened,
    });
  }, [mapView, snapshot, aspect, props.maxZoom, props.view, props.cover, props.onClick, props.onUserMove]);

  const toView = (e: { clientX: number; clientY: number }) => clampView(mapView.toStage(e));

  const place = (pin: Pin, at: ViewPoint) => {
    setMoving(null);
    pin.move!(at);
  };
  const preview = (pin: Pin, at: ViewPoint | null) => {
    setMoving(at && { key: pin.key, at });
    pin.drag?.(at);
  };

  const openPin = (key: string, button: HTMLButtonElement) =>
    setOpened({ ...under(button, mapView.getSnapshot().viewport!), pin: key, button });
  const openMenu = useCallback<OpenMenu>(
    (menu, button) => setOpened({ ...under(button, mapView.getSnapshot().viewport!), menu, button }),
    [mapView],
  );
  const menu = opened?.menu ?? (opened?.at ? props.menu(opened.at, pxPerPercent) : pins.find((p) => p.key === opened?.pin)?.menu);
  const polyline = (points: ViewPoint[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
  const outline = (s: Shape, className: string, key: string) => {
    const Line = s.closed ? "polygon" : "polyline";
    return <Line key={key} className={className} opacity={s.fade} points={polyline(s.points)} />;
  };
  const movingPin = moving && pins.find((p) => p.key === moving.key);
  const crowded = crowdedNumbers(pins, pxPerPercent, aspect);
  // Crowded pins come first, so their dots draw under the numbers they make way for.
  const drawn = [...pins.filter((p) => crowded.has(p.key)), ...pins.filter((p) => !crowded.has(p.key))];
  const [paths, shared] = useMemo(
    () => [props.spawns.filter((s) => s.colors.length === 1), props.spawns.filter((s) => s.colors.length > 1)],
    [props.spawns],
  );
  const [marginX, marginY] = [4 / pxPerPercent, (4 * aspect) / pxPerPercent];
  const inView = ({ at }: Spawn) =>
    at.x >= frame.left - marginX &&
    at.x <= frame.left + frame.width + marginX &&
    at.y >= frame.top - marginY &&
    at.y <= frame.top + frame.height + marginY;

  return (
    <MapViewContext.Provider value={mapView}>
      <div
        ref={mapView.attach}
        className="map-viewport"
        data-tip-bounds
        role="group"
        aria-label={props.label}
        style={{ "--zoom": zoom.s, "--aspect": aspect }}
      >
        <div className={`map-stage${zoom.s > 1 ? " zoomed" : ""}`} style={{ "--pan": `translate(${zoom.tx}px, ${zoom.ty}px)` }}>
          {props.scene(frame, pxPerPercent)}
        </div>
        <div className="map-overlay" style={{ "--pan": `translate(${zoom.tx}px, ${zoom.ty}px)` }}>
          {props.overlay?.(frame, pxPerPercent, openMenu)}
          <AreaPaths areas={props.areas} />
          <SpawnPaths spawns={paths} />
          {shared.filter(inView).map((s) => (
            <span key={s.key} className="spawn" style={{ "--at-x": `${s.at.x}%`, "--at-y": `${s.at.y}%`, "--fill": slices(s.colors) }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {shapes.filter((s) => s.cased).map((s) => outline(s, `${s.className} casing`, `casing:${s.key}`))}
            {shapes.map((s) => outline(s, s.className, s.key))}
          </svg>
          {drawn.map((pin) => {
            const at = moving?.key === pin.key ? moving.at : pin.at;
            return (
              <Fragment key={pin.key}>
                <MarkButton
                  label={pin.label}
                  at={at}
                  vars={{ "--fade": pin.fade, "--fill": pin.fill }}
                  className={`pin pin-${pin.kind}${pin.selected ? " selected" : ""}${moving?.key === pin.key ? " moving" : ""}${crowded.has(pin.key) ? " crowded" : ""}`}
                  aria-describedby={pin.move ? hintId : undefined}
                  aria-haspopup={!pin.activate && pin.menu ? "menu" : undefined}
                  tabIndex={pin.kind === "previous" || pin.kind === "upcoming" ? -1 : 0}
                  onPointerDown={(e) => {
                    dragged.current = false;
                    if (e.button !== 0 || !pin.move) return;
                    drag.current = { key: pin.key, x: e.clientX, y: e.clientY, moved: false };
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (d?.key !== pin.key || (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3)) return;
                    d.moved = true;
                    preview(pin, toView(e));
                  }}
                  onPointerUp={(e) => {
                    const d = drag.current;
                    drag.current = null;
                    if (d?.key !== pin.key || !d.moved) return;
                    dragged.current = true;
                    place(pin, toView(e));
                  }}
                  onPointerCancel={() => {
                    if (drag.current?.key !== pin.key) return;
                    drag.current = null;
                    preview(pin, null);
                  }}
                  onClick={(e) => {
                    if (dragged.current) dragged.current = false;
                    else if (pin.activate) pin.activate();
                    else if (pin.menu) openPin(pin.key, e.currentTarget);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pin.menu) openPin(pin.key, e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (!pin.move) return;
                    const mine = moving?.key === pin.key ? moving : null;
                    const d = (e.shiftKey ? 1 : 0.2) / zoom.s;
                    const delta = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
                    if (delta) {
                      const from = mine?.at ?? pin.at;
                      preview(pin, clampView({ x: from.x + delta[0]!, y: from.y + delta[1]! }));
                    } else if (e.key === "Enter" && mine) place(pin, mine.at);
                    else if (e.key === "Escape" && mine) preview(pin, null);
                    else return;
                    e.preventDefault();
                  }}
                  onBlur={() => {
                    if (moving?.key === pin.key) place(pin, moving.at);
                  }}
                >
                  {pin.text && !crowded.has(pin.key) && <span aria-hidden="true">{pin.text}</span>}
                  {pin.icons?.map((icon, i) => (
                    <MapIconImage key={i} icon={icon} size={18} />
                  ))}
                </MarkButton>
                {pin.chip && (
                  <span className="pin-chip" style={{ "--at-x": `${at.x}%`, "--at-y": `${at.y}%` }} aria-hidden="true">
                    {pin.chip}
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="map-zoom">
          <IconButton
            icon="zoomIn"
            label="Zoom in"
            description="Zoom in (wheel)"
            size={32}
            disabled={zoom.s >= maxZoom}
            onClick={() => mapView.zoomBy(1.5)}
          />
          <IconButton
            icon="zoomOut"
            label="Zoom out"
            description="Zoom out (wheel)"
            size={32}
            disabled={zoom.s <= 1}
            onClick={() => mapView.zoomBy(1 / 1.5)}
          />
          <IconButton
            icon="fit"
            label="Reset zoom"
            description="Show the whole map"
            size={32}
            disabled={zoom.s <= 1}
            onClick={() => mapView.reset()}
          />
        </div>
        {opened && menu && (
          <ContextMenu
            menu={menu}
            x={opened.x}
            y={opened.y}
            onClose={(refocus) => {
              setOpened(null);
              if (refocus) opened.button?.focus({ preventScroll: true });
            }}
          />
        )}
        <span id={hintId} className="sr-only">
          Drag, or use the arrow keys (Shift for larger steps) and Enter to place; Escape cancels.
        </span>
        <span className="sr-only" aria-live="polite">
          {movingPin ? `Moving to ${props.describe(moving.at)}` : ""}
        </span>
      </div>
    </MapViewContext.Provider>
  );
}

function under(button: HTMLElement, viewport: HTMLElement): { x: number; y: number } {
  const [r, v] = [button.getBoundingClientRect(), viewport.getBoundingClientRect()];
  return { x: r.left + r.width / 2 - v.left, y: r.bottom - v.top };
}

function ContextMenu(props: { menu: MapMenu; x: number; y: number; onClose: (refocus: boolean) => void }) {
  const { menu } = props;
  const groups = "groups" in menu ? menu.groups : [menu];
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useLayoutEffect(() => {
    const el = ref.current!;
    const room = el.parentElement!;
    el.style.left = `${clamp(props.x, 0, Math.max(0, room.clientWidth - el.offsetWidth))}px`;
    el.style.top = `${clamp(props.y, 0, Math.max(0, room.clientHeight - mapCover(room) - el.offsetHeight))}px`;
    el.querySelector<HTMLElement>("button[role^=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) onClose.current(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [props.x, props.y]);

  return (
    <Card
      layer
      ref={ref}
      className="map-menu"
      role="menu"
      tabIndex={-1}
      {...("groups" in menu ? { "aria-label": menu.label } : { "aria-labelledby": `${titleId}-0` })}
      onKeyDown={(e) => {
        const items = [...ref.current!.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)")];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
        if (to !== undefined) items[(to + items.length) % items.length]!.focus();
        else if (e.key === "Escape") props.onClose(true);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) props.onClose(false);
      }}
    >
      {groups.map((group, i) => {
        const body = (
          <>
            <p id={`${titleId}-${i}`} className="map-menu-title">
              {group.title}
            </p>
            {group.items.map((item) => (
              <MapMenuItemButton key={item.label} item={item} onRun={() => props.onClose(false)} />
            ))}
          </>
        );
        return "groups" in menu ? (
          <div key={i} role="group" className="map-menu-group" aria-labelledby={`${titleId}-${i}`}>
            {body}
          </div>
        ) : (
          <Fragment key={i}>{body}</Fragment>
        );
      })}
    </Card>
  );
}

function MapMenuItemButton({ item, onRun }: { item: MapMenuItem; onRun: () => void }) {
  const run = (
    <MenuItem
      {...(item.checked === undefined ? {} : { checked: item.checked, radio: item.radio ?? false })}
      disabled={item.disabled}
      aria-label={item.content === undefined ? undefined : item.label}
      onClick={() => {
        onRun();
        item.run();
      }}
    >
      {item.content === undefined && item.label}
    </MenuItem>
  );
  if (item.content === undefined) return run;
  return (
    <div role="none" className="map-menu-row">
      {item.icon}
      <span className="map-menu-text">{item.content}</span>
      {item.action && <span className="map-menu-action">{item.action}</span>}
      <Icon name="plus" size={14} />
      {run}
    </div>
  );
}
