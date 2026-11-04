import { memo, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ClassName } from "../../data/races.ts";
import { rideLabel, rideTime } from "../../routing/result.ts";
import { Icon } from "../icons.tsx";
import { inFrame } from "../map/MapLegend.tsx";
import { MapPopover, useClippedBody } from "../map/MapPopover.tsx";
import { MarkButton } from "../ui/ItemButton.tsx";
import type { ViewPoint } from "../map/points.ts";
import { useFrame, useMapView } from "../map/view.ts";
import { lineView, ridePoints, round, type AtlasPaths, type Projection } from "./lines.ts";
import { rideIcon } from "./rideIcons.ts";
import { markTitle, whoRides, type RideMark } from "./rideStops.ts";
import type { Step } from "./RouteResult.tsx";

export interface PlacedMark {
  mark: RideMark;
  at: ViewPoint;
}

const SCROLL_AFTER = 6;
const SPACING = 20;
const STEPS = Array.from({ length: 9 }, (_, k) => (k - 4) * (SPACING / 2));
const OFFSETS = STEPS.flatMap((x) => STEPS.map((y) => ({ x, y }))).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

export function spread(marks: readonly PlacedMark[], stops: readonly ViewPoint[], pxPerPercent: number, aspect: number): ViewPoint[] {
  const screen = (p: ViewPoint) => ({ x: p.x * pxPerPercent, y: (p.y * pxPerPercent) / aspect });
  const taken = stops.map(screen);
  const free = (p: ViewPoint) => taken.every((q) => Math.abs(p.x - q.x) >= SPACING || Math.abs(p.y - q.y) >= SPACING);
  return marks.map(({ at }) => {
    const home = screen(at);
    const place = OFFSETS.map((d) => ({ x: home.x + d.x, y: home.y + d.y })).find(free) ?? home;
    taken.push(place);
    return { x: place.x / pxPerPercent, y: (place.y * aspect) / pxPerPercent };
  });
}

const points = (view: ViewPoint[]) => view.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");

export const RideLayer = memo(function RideLayer(props: {
  marks: readonly PlacedMark[];
  stops: readonly ViewPoint[];
  pxPerPercent: number;
  aspect: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  proj: Projection;
  atlas: AtlasPaths;
}) {
  const { marks, stops, pxPerPercent, aspect, selected, onSelect, proj, atlas } = props;
  const frame = useFrame(useMapView());
  const shownAt = useMemo(() => spread(marks, stops, pxPerPercent, aspect), [marks, stops, pxPerPercent, aspect]);
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  const icons = useRef(new Map<string, HTMLButtonElement>());
  const visible = (at: ViewPoint) => !frame || inFrame(at, frame);
  const shown = marks.filter((m) => visible(m.at));
  const tabStop = (shown.find((m) => m.mark.stop.id === lastFocused) ?? shown[0])?.mark.stop.id;
  const chosen = marks.find((m) => m.mark.stop.id === selected)?.mark;
  const ends = new Set(chosen?.rides.map((r) => r.ground.id));

  const move = (e: KeyboardEvent, id: string) => {
    const at = shown.findIndex((m) => m.mark.stop.id === id);
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[e.key];
    const next = to === undefined ? undefined : shown[Math.max(0, Math.min(shown.length - 1, to))];
    if (!next) return;
    e.preventDefault();
    icons.current.get(next.mark.stop.id)?.focus({ preventScroll: true });
  };

  return (
    <>
      {chosen && (
        <svg className="route-lines ride-preview" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {chosen.rides.map(({ link }, k) => {
            const view = points(lineView(ridePoints([link], atlas), proj));
            return (
              <g key={k}>
                <polyline className="leg-outline" points={view} />
                <polyline className="leg-line" points={view} />
                <polyline className="leg-ride" points={view} />
              </g>
            );
          })}
        </svg>
      )}
      <div className="ride-marks" role="group" aria-label="Rides">
        {marks.map(({ mark, at }, k) => {
          const id = mark.stop.id;
          const place = shownAt[k]!;
          return (
            <MarkButton
              key={id}
              ref={(el) => {
                if (el) icons.current.set(id, el);
                else icons.current.delete(id);
              }}
              label={mark.label}
              at={place}
              className={`ride-mark${mark.foreignFaction ? " ride-other" : ""}${ends.has(id) ? " ride-end" : ""}`}
              data-stop={id}
              data-mode={mark.mode}
              data-in-view={visible(at) || undefined}
              pressed={selected === id}
              tabIndex={id === tabStop ? 0 : -1}
              onFocus={() => setLastFocused(id)}
              onClick={() => onSelect(selected === id ? null : id)}
              onKeyDown={(e) => move(e, id)}
            >
              <Icon name={rideIcon(mark.mode)} size={12} />
              {mark.foreignFaction && (
                <span className="ride-faction" aria-hidden="true">
                  {mark.foreignFaction[0]}
                </span>
              )}
            </MarkButton>
          );
        })}
      </div>
    </>
  );
});

function StepList(props: { steps: Step[]; labelledBy: string }) {
  return (
    <ol className="route-step-list ride-steps" aria-labelledby={props.labelledBy}>
      {props.steps.map((step, k) => (
        <li key={k} data-mode={step.mode}>
          <Icon name={step.icon} size={14} />
          <span>
            {step.text}
            {step.notes.length > 0 && (
              <span className="route-note-line">
                {step.notes.map(({ text }) => (
                  <span key={text}>{text}</span>
                ))}
              </span>
            )}
          </span>
          <span className="route-step-time">{step.time}</span>
        </li>
      ))}
    </ol>
  );
}

function RideScroll(props: { labelledBy: string; children: ReactNode }) {
  const clipped = useClippedBody();
  return (
    <div className="ride-scroll" role="group" aria-labelledby={props.labelledBy} tabIndex={clipped ? undefined : 0}>
      {props.children}
    </div>
  );
}

export function RidePopover(props: {
  mark: RideMark;
  character: { race: string; class: ClassName };
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { mark, character } = props;
  const id = useId();
  const flight = mark.mode === "flight";
  const { sharedRequires } = mark;
  const barred = mark.rides.every(
    ({ rideRequires: r }) => (r.race && r.race !== character.race) || (r.class && r.class !== character.class),
  );
  const steps = [...mark.rides]
    .sort((a, b) => a.ground.name.localeCompare(b.ground.name, "en"))
    .map((ride): Step => {
      const { link } = ride;
      const time = rideTime([link]);
      return {
        icon: rideIcon(link.mode),
        mode: link.mode,
        text: sharedRequires ? rideLabel([link]) : `${rideLabel([link])} (${whoRides(ride.rideRequires)})`,
        time: time.cost,
        notes: [...(time.spread ? [{ text: `Varies: ${time.spread}` }] : []), ...(time.note ? [{ text: time.note }] : [])],
      };
    });
  const scrolls = steps.length > SCROLL_AFTER;
  return (
    <MapPopover
      className="ride-popover"
      title={markTitle(mark)}
      facts={[{ label: "Who can ride", value: sharedRequires ? whoRides(sharedRequires) : `Varies by ${flight ? "flight" : "ride"}` }]}
      onClose={props.onClose}
      returnFocus={props.returnFocus}
    >
      {mark.foreignFaction && <p className="muted">The other faction's ride. A leg takes it only with Other faction's rides on.</p>}
      {barred && <p className="muted">The preview character cannot take this ride, so routes leave it out.</p>}
      <div className="route-steps">
        <h4 id={id}>{flight ? "Direct flights" : "Rides"}</h4>
        {scrolls ? (
          <RideScroll labelledBy={id}>
            <StepList steps={steps} labelledBy={id} />
          </RideScroll>
        ) : (
          <StepList steps={steps} labelledBy={id} />
        )}
        {!flight && <p className="muted ride-note">Each time is the average wait and ride.</p>}
      </div>
    </MapPopover>
  );
}
