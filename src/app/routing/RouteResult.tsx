import { useId, type ReactNode } from "react";
import { routeOf, type Journey, type JourneyLeg } from "../../routing/journey.ts";
import type { Leg } from "../../routing/plan.ts";
import {
  fallLines,
  floorLines,
  formatDistance,
  formatSeconds,
  groundLabel,
  rideKinds,
  rideLabel,
  rideTime,
  shownTotal,
  summarizeJourney,
  type FloorLine,
  type JourneySummary,
  type LegSummary,
} from "../../routing/result.ts";
import type { TerrainRoute } from "../../routing/search.ts";
import { groundSeconds, transportSteps, type TransportLeg } from "../../routing/transport.ts";
import { Described } from "../Described.tsx";
import { Icon, type IconName } from "../icons.tsx";
import { Button, IconButton } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ArtButton, ItemButton } from "../ui/ItemButton.tsx";
import { MapPopover, useClippedBody } from "../map/MapPopover.tsx";
import { rideIcon } from "./rideIcons.ts";
import { PHASES, SEARCH_FAILED, type LegState, type SearchView } from "./routeSearch.ts";
import { Heading } from "../ui/Text.tsx";

export interface RouteStatus {
  text: string;
  tone?: "warn" | "error";
  busy?: boolean;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const both = (seconds: number, distance: number) => `${formatSeconds(seconds)} · ${formatDistance(distance)}`;

function journeyWords(journey: Journey, summary: JourneySummary) {
  const crossings = summary.crossings.length;
  const tiles = journey.legs.reduce((n, leg) => n + (leg.kind === "missing-coverage" ? leg.tiles.length : 0), 0);
  const total = shownTotal(summary);
  const notes = [
    ...(total !== summary.total ? [`skipped ${count(tiles, "tile")} without terrain data`] : []),
    ...(crossings ? [`not counting ${count(crossings, "crossing")} between continents`] : []),
  ];
  const sum = (key: "seconds" | "distance") => summary.legs.reduce((s, leg) => s + (leg.measure?.[key] ?? 0), 0);
  const failed = total.kind === "none" ? total.failed : [];
  const unrouted = failed.filter((f) => f.kind === "no-path").map((f) => f.leg + 1);
  const terrainless = journey.legs.flatMap((leg, i) =>
    leg.kind === "no-terrain" ? [`no terrain at the ${leg.endpoint} of leg ${i + 1}`] : [],
  );
  const problems = [
    ...(failed.length && tiles ? [`no terrain data for ${count(tiles, "nearby tile")}`] : []),
    ...(failed.some((f) => f.kind === "limit") ? ["search limit"] : []),
    ...terrainless,
    ...(unrouted.length ? [`no path on ${unrouted.length === 1 ? "leg" : "legs"} ${unrouted.join(", ")}`] : []),
  ];
  return {
    total,
    notes,
    problems,
    crossingsOnly: crossings === journey.legs.length,
    provisional: summary.legs.every((leg) => leg.measure || leg.kind === "crossing"),
    seconds: sum("seconds"),
    distance: sum("distance"),
  };
}

function journeyStatus(journey: Journey, summary: JourneySummary): RouteStatus {
  const words = journeyWords(journey, summary);
  const { total } = words;
  if (words.crossingsOnly) return { text: "No ground route between continents" };
  const notes = words.notes.map((note) => ` · ${note}`).join("");
  if (total.kind === "complete") return { text: both(total.seconds, total.distance) + notes };
  if (total.kind === "estimate")
    return { text: `about ${both(total.seconds, total.distance)} · ${count(total.straight.length, "straight leg")}${notes}`, tone: "warn" };
  const head = words.provisional ? `about ${both(words.seconds, words.distance)} · provisional` : "no route";
  return { text: [head, ...words.problems].join(" · ") + notes, tone: words.provisional ? "warn" : "error" };
}

export function routeStatus(view: SearchView, summary: JourneySummary | undefined): RouteStatus {
  if (view.kind === "calculating") return { text: view.phase, busy: true };
  if (view.kind === "cancelled") return { text: PHASES.cancelled };
  if (view.kind === "failed") return { text: SEARCH_FAILED, tone: "error" };
  if (!view.journey || !summary) return { text: "No movement modes to route.", tone: "error" };
  return journeyStatus(view.journey, summary);
}

const allow = (words: string) => ({ on: `allow ${words}`, off: `stop ${words}` });
export const legToggles = (leg: Leg) =>
  [
    { name: "followTerrain", label: "Follow terrain", on: "follow terrain", off: "use a straight line", enabled: true },
    { name: "downhill", label: "Downhill shortcuts", ...allow("downhill shortcuts"), enabled: leg.followTerrain },
    { name: "damagingFalls", label: "Allow damaging falls", ...allow("damaging falls"), enabled: leg.followTerrain && leg.downhill },
    {
      name: "fatalFalls",
      label: "Allow fatal falls",
      ...allow("fatal falls"),
      enabled: leg.followTerrain && leg.downhill && leg.damagingFalls,
    },
    { name: "hazards", label: "Allow lava and slime", ...allow("lava and slime"), enabled: leg.followTerrain },
    { name: "otherFaction", label: "Other faction's rides", ...allow("the other faction's rides"), enabled: true },
    { name: "flightPaths", label: "Allow Flight Paths", ...allow("flight paths"), enabled: true },
    { name: "shipPaths", label: "Allow Ship/Zeppelin Paths", ...allow("ship and zeppelin paths"), enabled: true },
  ] as const;

export function FloorLines(props: { lines: FloorLine[] }) {
  if (!props.lines.length) return null;
  return (
    <ul className="route-floors">
      {props.lines.map(({ text, warn }) => (
        <li key={text} className={warn ? "route-warn" : undefined}>
          {warn && (
            <span role="img" aria-label="Warning">
              <Icon name="warning" size={12} />
            </span>
          )}
          {text}
        </li>
      ))}
    </ul>
  );
}

function SteepDescents(props: { route: TerrainRoute; downhill: boolean }) {
  const { route } = props;
  const clipped = useClippedBody();
  if (!props.downhill) return "Off";
  if (!route.descents.length && !route.falls.length) return "None";
  const falls = fallLines(route);
  return (
    <>
      <span className="route-descents">
        Used
        <Described text="Assumes walking off, not jumping" pin>
          <ArtButton className="route-info" aria-label="About falls">
            <Icon name="info" size={12} />
          </ArtButton>
        </Described>
      </span>
      {falls.length > 0 && (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users scroll a long list from here.
        <ul className="route-falls" aria-label="Falls" tabIndex={falls.length > 5 && !clipped ? 0 : undefined}>
          {falls.map((fall, i) => (
            <li key={i}>
              <span>{fall.height}</span>
              <span className={fall.fatal ? "route-error" : "route-fall-damage"}>{fall.damage}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface StepNote {
  text: string;
  tone?: "warn" | "error";
}

export interface Step {
  icon: IconName;
  mode: string;
  text: string;
  time: string;
  notes: StepNote[];
}

function groundNotes(result: JourneyLeg): StepNote[] {
  const route = routeOf(result);
  if (!route) return [];
  return [
    ...(route.swims.length ? [{ text: `Swimming: ${formatDistance(route.swimDistance)}, ${formatSeconds(route.swimSeconds)}` }] : []),
    ...fallLines(route).map((fall) => ({ text: `Fall: ${fall.height}, ${fall.damage}`, ...(fall.fatal && { tone: "error" as const }) })),
    ...floorLines(route).map(({ text, warn }) => ({ text, ...(warn && { tone: "warn" as const }) })),
  ];
}

function legRideSteps(leg: TransportLeg, mode: string, end: string): Step[] {
  const steps = transportSteps(leg.parts);
  return steps.map((step, k): Step => {
    if (step.kind === "ground") {
      const seconds = groundSeconds(step.result);
      const next = steps.slice(k + 1).find((s) => s.kind === "ride");
      const estimate = step.result.kind === "straight" ? " (estimate)" : "";
      return {
        icon: "route",
        mode: "ground",
        text: groundLabel(mode, next?.kind === "ride" ? next.links[0] : undefined, end) + estimate,
        time: seconds === undefined ? "unknown" : formatSeconds(seconds),
        notes: groundNotes(step.result),
      };
    }
    const time = rideTime(step.links);
    const rideMode = step.links[0]!.mode;
    return {
      icon: rideIcon(rideMode),
      mode: rideMode,
      text: rideLabel(step.links),
      time: time.cost,
      notes: [...(time.spread ? [{ text: `Varies: ${time.spread}` }] : []), ...(time.note ? [{ text: time.note }] : [])],
    };
  });
}

const basisOf = (summary: LegSummary) =>
  summary.measure && summary.measure.basis !== "complete" && summary.kind !== "missing-coverage" ? ` (${summary.measure.basis})` : "";

const timeAndDistance = (seconds: number, distance: number, basis: string) => (
  <>
    <strong>{formatSeconds(seconds)}</strong> · {formatDistance(distance)}
    {basis}
  </>
);

export interface MapFocus {
  leg: number;
  step?: number;
}

interface Focusing {
  focus: MapFocus | null;
  onFocus: (focus: MapFocus) => void;
}

function StepList(props: Focusing & { steps: Step[]; leg: number; className: string; labelledBy?: string; label?: string }) {
  const id = useId();
  const { leg, focus } = props;
  return (
    <ol className={props.className} aria-labelledby={props.labelledBy} aria-label={props.label}>
      {props.steps.map((step, k) => (
        <li key={k} data-mode={step.mode}>
          <ItemButton
            className={step.mode === "ground" ? "route-step" : "route-step route-ride"}
            chosen={focus?.leg === leg && focus.step === k}
            aria-label={`Show step ${k + 1} of leg ${leg + 1} on the map: ${step.text}, ${step.time}`}
            aria-describedby={step.notes.length ? `${id}-${k}` : undefined}
            onClick={() => props.onFocus({ leg, step: k })}
          >
            <Icon name={step.icon} size={14} />
            <span>
              {step.text}
              {step.notes.length > 0 && (
                <span id={`${id}-${k}`} className="route-note-line">
                  {step.notes.map(({ text, tone }) => (
                    <span key={text} className={tone && `route-${tone}`}>
                      {text}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="route-step-time">{step.time}</span>
          </ItemButton>
        </li>
      ))}
    </ol>
  );
}

export function LegPopover(
  props: Focusing & {
    index: number;
    count: number;
    stops: string;
    end: string;
    leg: Leg;
    outcome: LegState;
    swimming: boolean;
    onMove: (index: number) => void;
    onShowSkipped: () => void;
    onChange: (change: Partial<Leg>) => void;
    disabled?: boolean;
    onClose: () => void;
    onEscape: () => boolean;
    returnFocus: () => void;
  },
) {
  const { leg, outcome, index } = props;
  const stepsId = useId();
  const facts: { label: string; value: ReactNode }[] = [{ label: "Stops", value: props.stops }];
  let floors: FloorLine[] = [];
  let steps: ReactNode;
  if (outcome.state === "pending") facts.push({ label: "Result", value: outcome.phase });
  else if (outcome.state === "failed") facts.push({ label: "Result", value: <span className="route-error">{outcome.reason}</span> });
  else {
    const { result, summary } = outcome;
    const route = routeOf(result);
    const skipped = result.kind === "missing-coverage" && route ? result.tiles.length : 0;
    const measure = summary.measure;
    if (result.kind !== "transport")
      facts.push({
        label: "Result",
        value: skipped ? (
          "Terrain route"
        ) : (
          <span
            className={
              summary.kind === "route" || summary.kind === "crossing" ? undefined : summary.source === "none" ? "route-error" : "route-warn"
            }
          >
            {summary.label}
          </span>
        ),
      });
    facts.push({ label: "Time", value: measure ? timeAndDistance(measure.seconds, measure.distance, basisOf(summary)) : "unknown" });
    if (result.kind === "transport")
      steps = (
        <div className="route-steps">
          <Heading level={4} size="small" tone="muted" id={stepsId}>
            Steps
          </Heading>
          <StepList
            steps={legRideSteps(result, outcome.mode, props.end)}
            leg={index}
            className="route-step-list"
            labelledBy={stepsId}
            focus={props.focus}
            onFocus={props.onFocus}
          />
        </div>
      );
    if (skipped)
      facts.push({
        label: "Note",
        value: (
          <>
            Skipped a possibly faster route through {count(skipped, "tile")} without terrain data.{" "}
            <Button variant="secondary" onClick={props.onShowSkipped}>
              Show on map
            </Button>
          </>
        ),
      });
    if (route) {
      facts.push(
        {
          label: "Swimming",
          value: !props.swimming
            ? "Off"
            : route.swims.length
              ? `${formatDistance(route.swimDistance)}, ${formatSeconds(route.swimSeconds)}`
              : "None",
        },
        {
          label: "Steep descents",
          value: <SteepDescents route={route} downhill={leg.downhill} />,
        },
      );
      floors = floorLines(route);
    }
  }
  // Disabled by aria-disabled, so a button keeps focus at the first or last leg.
  const move = (to: number, label: string, icon: IconName) => {
    const out = to < 0 || to >= props.count;
    return <IconButton icon={icon} label={label} aria-disabled={out || undefined} onClick={() => out || props.onMove(to)} />;
  };

  return (
    <MapPopover
      title={`Leg ${index + 1} of ${props.count}`}
      actions={
        <>
          {move(index - 1, "Previous leg", "chevronLeft")}
          {move(index + 1, "Next leg", "chevronRight")}
        </>
      }
      facts={facts}
      onClose={props.onClose}
      onEscape={props.onEscape}
      returnFocus={props.returnFocus}
    >
      {steps}
      <FloorLines lines={floors} />
      <LegSettings leg={leg} disabled={!!props.disabled} onChange={props.onChange} />
    </MapPopover>
  );
}

export function LegSettings(props: { leg: Leg; disabled?: boolean; onChange: (change: Partial<Leg>) => void }) {
  const { leg } = props;
  return (
    <div className="route-popover-settings">
      {legToggles(leg).map(({ name, label, enabled }) => (
        <Checkbox
          key={name}
          label={label}
          checked={leg[name]}
          disabled={props.disabled || !enabled}
          onChange={(e) => props.onChange({ [name]: e.target.checked })}
        />
      ))}
    </div>
  );
}

export interface StopPin {
  kind: "route-start" | "route-stop" | "route-end";
  text: string;
}

export interface RouteLeg {
  stops: string;
  pins: [StopPin, StopPin];
  end: string;
  outcome: LegState;
}

function legRow({ outcome, end }: RouteLeg): { time?: string; line: string; tone?: "warn" | "error"; warning?: string; steps: Step[] } {
  if (outcome.state === "pending") return { line: outcome.phase, steps: [] };
  if (outcome.state === "failed") return { line: outcome.reason, tone: "error", steps: [] };
  const { result, summary, mode } = outcome;
  const { measure } = summary;
  if (!measure) return { line: summary.label, ...(summary.kind !== "crossing" && { tone: "error" as const }), steps: [] };
  const distance = formatDistance(measure.distance) + basisOf(summary);
  const time = formatSeconds(measure.seconds);
  if (result.kind === "transport") return { time, line: `${rideKinds(result)} · ${distance}`, steps: legRideSteps(result, mode, end) };
  const failed = summary.kind !== "route" && summary.kind !== "straight" && summary.kind !== "missing-coverage";
  return { time, line: distance, ...(failed && { warning: summary.label }), steps: [] };
}

function totalFacts(legs: RouteLeg[], journey: Journey | undefined, phase: string): { label: string; value: ReactNode }[] {
  const outcomes = legs.map((leg) => leg.outcome);
  const failed = outcomes.find((o) => o.state === "failed");
  if (failed) return [{ label: "Result", value: <span className="route-error">{failed.reason}</span> }];
  if (!journey || outcomes.some((o) => o.state === "pending")) return [{ label: "Result", value: phase }];
  const words = journeyWords(journey, summarizeJourney(journey));
  if (words.crossingsOnly) return [{ label: "Result", value: "No ground route between continents" }];
  const { total } = words;
  const facts: { label: string; value: ReactNode }[] = [];
  if (total.kind === "complete") facts.push({ label: "Total", value: timeAndDistance(total.seconds, total.distance, "") });
  else if (total.kind === "estimate") facts.push({ label: "Total", value: timeAndDistance(total.seconds, total.distance, " (estimate)") });
  else {
    const tone = words.provisional ? "route-warn" : "route-error";
    const head = words.provisional ? "Provisional route" : "No route";
    facts.push(
      { label: "Result", value: <span className={tone}>{[head, ...words.problems].join(" · ")}</span> },
      { label: "Total", value: words.provisional ? timeAndDistance(words.seconds, words.distance, " (provisional)") : "unknown" },
    );
  }
  if (words.notes.length) facts.push({ label: "Note", value: capital(words.notes.join(" · ")) });
  return facts;
}

const capital = (text: string) => text[0]!.toUpperCase() + text.slice(1);

export function RoutePopover(
  props: Focusing & {
    stops: string;
    legs: RouteLeg[];
    journey: Journey | undefined;
    phase: string;
    onOpen: (leg: number) => void;
    onClose: () => void;
    onEscape: () => boolean;
    returnFocus: () => void;
  },
) {
  const { legs, journey, focus } = props;
  const id = useId();
  const facts = [
    { label: "Stops", value: props.stops },
    ...(journey ? [{ label: "Mode", value: journey.mode.name }] : []),
    ...totalFacts(legs, journey, props.phase),
  ];
  return (
    <MapPopover
      className="route-summary"
      title="Route"
      facts={facts}
      onClose={props.onClose}
      onEscape={props.onEscape}
      returnFocus={props.returnFocus}
    >
      <div className="route-legs">
        <Heading level={4} size="small" tone="muted" id={id}>
          Legs
        </Heading>
        <ol aria-labelledby={id}>
          {legs.map((leg, i) => {
            const row = legRow(leg);
            const pressed = focus?.leg === i && focus.step === undefined;
            return (
              <li key={i}>
                <div className={pressed ? "route-leg-row shown" : "route-leg-row"}>
                  <ItemButton
                    className="route-leg-show"
                    chosen={pressed}
                    aria-label={`Show leg ${i + 1} on the map: ${leg.stops.replace(" → ", " to ")}${row.time ? `, ${row.time}` : ""}`}
                    aria-describedby={`${id}-${i}`}
                    onClick={() => props.onFocus({ leg: i })}
                  >
                    <span className="route-leg-pins">
                      {leg.pins.map((pin, k) => (
                        <span key={k} className={`route-pin pin-${pin.kind}`}>
                          {pin.text}
                        </span>
                      ))}
                    </span>
                    <span className="route-leg-name">
                      {leg.stops}
                      <span id={`${id}-${i}`} className="route-note-line">
                        <span className={row.tone && `route-${row.tone}`}>{row.line}</span>
                        {row.warning && <span className="route-warn">{row.warning}</span>}
                      </span>
                    </span>
                    <span className="route-step-time">{row.time}</span>
                  </ItemButton>
                  <IconButton icon="chevronRight" label={`Open leg ${i + 1}`} onClick={() => props.onOpen(i)} />
                </div>
                {row.steps.length > 0 && (
                  <StepList
                    steps={row.steps}
                    leg={i}
                    className="route-step-list route-leg-steps"
                    label={`Steps of leg ${i + 1}`}
                    focus={focus}
                    onFocus={props.onFocus}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </MapPopover>
  );
}
