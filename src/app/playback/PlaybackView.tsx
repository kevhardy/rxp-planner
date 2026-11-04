import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ChainGuide, EstimateReason, Playback, RoutingProgress } from "../../routing/playback.ts";
import {
  formatClock,
  noteFace,
  shownSeconds,
  stepActions,
  type Names,
  type MarkKind,
  type StepAction,
  type TimelineStep,
} from "../../rules/index.ts";
import { Described } from "../Described.tsx";
import { useEventListener } from "../effects.ts";
import { Icon, WarningMark } from "../icons.tsx";
import { IconButton } from "../ui/Button.tsx";
import { Field, Select, Slider } from "../ui/Field.tsx";
import { ItemButton } from "../ui/ItemButton.tsx";
import { Mono } from "../ui/Text.tsx";
import { LevelMark } from "../StepList.tsx";
import { Mark } from "../Mark.tsx";
import { useAttachPlayback } from "./input.ts";
import { GuideText } from "../GuideText.tsx";
import { PlaybackStage } from "./PlaybackStage.tsx";
import { PlaybackSettingsMenu } from "./PlaybackSettingsMenu.tsx";
import { usePlaybackRouter } from "./router.ts";
import { PlaybackNoticeText, usePlaybackNotice } from "./notice.tsx";
import { SPEEDS, stepBefore, useCurrentStep, usePlayable, usePlayback, usePlaybackStore, type HostRouting, type Speed } from "./store.ts";
import "./playback.css";

export function PlaybackView(props: { children?: ReactNode }) {
  const routing = usePlaybackRouter();
  useAttachPlayback(routing);
  return (
    <div className="playback">
      {props.children}
      <PlaybackSteps />
      <PlaybackStage />
      <TimelineDock routing={routing} />
    </div>
  );
}

const STEP_ACTIONS: Record<StepAction["kind"], { mark: MarkKind; verb: string }> = {
  accept: { mark: "accept", verb: "Accept" },
  turnin: { mark: "turnin", verb: "Turn in" },
  complete: { mark: "complete", verb: "Complete" },
  kill: { mark: "kill", verb: "Kill" },
  grind: { mark: "xp", verb: "Grind to" },
  train: { mark: "train", verb: "Train" },
  vendor: { mark: "vendor", verb: "Vendor" },
  home: { mark: "home", verb: "Set hearth" },
  fp: { mark: "fp", verb: "Get flight path" },
  fly: { mark: "fly", verb: "Fly to" },
  hearth: { mark: "hs", verb: "Hearth" },
  deathskip: { mark: "deathskip", verb: "Resurrect at" },
  goto: { mark: "goto", verb: "Go to" },
};

const BARS = [
  { key: "travel", label: "Travel" },
  { key: "kill", label: "Combat" },
  { key: "interact", label: "Interact" },
  { key: "wait", label: "Wait" },
] as const;

// The spaces between items separate them in the description that a screen
// reader reads; the grid does not render them.
function StepTimeLegend() {
  return (
    <span className="playback-legend">
      <span>Step time:</span>{" "}
      {BARS.map(({ key, label }) => (
        <Fragment key={key}>
          <span className="legend-item">
            <span className={`legend-swatch bar-${key}`} aria-hidden="true" />
            {label}
          </span>{" "}
        </Fragment>
      ))}
      <span className="legend-item">
        <span className="estimate-mark" aria-hidden="true">
          ≈
        </span>
        Straight-line estimate
      </span>
    </span>
  );
}

const ESTIMATE_REASONS: Record<EstimateReason, string> = {
  pending: "not routed yet",
  unavailable: "routing not available",
  "off-map": "off the routing maps",
  crossing: "crosses to another map",
  "no-path": "no path found",
  "interior-path-missing": "interior path missing",
  "door-line": "inside the building from the door",
  "steep-line": "from the nearest walkable ground",
  "flight-unknown": "flight path not known",
  failed: "routing failed",
  "no-terrain": "no terrain at a stop",
  "missing-coverage": "terrain data missing",
  limit: "search limit reached",
};

type PricedGuide = ChainGuide & { priced: NonNullable<ChainGuide["priced"]> };

const isPriced = (guide: ChainGuide): guide is PricedGuide => guide.priced !== undefined;

function legsText(progress: RoutingProgress): string {
  if (progress.pending > 0) return `Routing ${progress.routed} of ${progress.asked} legs`;
  return progress.routed < progress.asked ? `Routed ${progress.routed} of ${progress.asked} legs` : `Routed all ${progress.routed} legs`;
}

function guideStatus(guide: PricedGuide, routable: boolean): string {
  return routable ? legsText(guide.priced.routing) : "Straight-line travel";
}

function GuideProgress({ guide }: { guide: PricedGuide }) {
  const { asked, pending } = guide.priced.routing;
  return <progress aria-label={`Routing ${guide.name}`} max={asked} value={asked - pending} />;
}

function estimateOf(playback: Playback, index: number): string {
  const reasons = new Set(playback.ways(index).flatMap((way) => (way.estimate ? [ESTIMATE_REASONS[way.estimate]] : [])));
  return [...reasons].join(", ");
}

function PlaybackSteps() {
  const playback = useDeferredValue(usePlayable());
  const notice = usePlaybackNotice();
  const current = useCurrentStep();
  const store = usePlaybackStore();
  const list = useRef<HTMLDivElement>(null);
  const onSeek = useCallback((index: number) => store.seekStep(index), [store]);
  const timeline = playback?.timeline;
  const warnings = useMemo(() => {
    const byStep = new Map<string, string[]>();
    for (const w of timeline?.warnings ?? []) {
      const key = `${w.source} ${w.step}`;
      byStep.set(key, [...(byStep.get(key) ?? []), w.message]);
    }
    return byStep;
  }, [timeline]);
  const estimates = useMemo(() => playback?.timeline.steps.map((_, i) => estimateOf(playback, i)), [playback]);
  const chain = playback?.chain;
  const heads = useMemo(() => new Map(chain?.flatMap((g) => (isPriced(g) && g.priced.count ? [[g.priced.first, g]] : []))), [chain]);
  const scrolledTo = useRef<Element>(null);
  useEffect(() => {
    const row = list.current?.querySelector(`[data-index="${current}"]`);
    if (!row || row === scrolledTo.current) return;
    scrolledTo.current = row;
    row.scrollIntoView?.({ block: "nearest" });
  }, [current, timeline]);
  if (notice || !playback)
    return (
      <section className="panel playback-steps" aria-label="Steps">
        {notice && <PlaybackNoticeText notice={notice} />}
      </section>
    );
  const { steps, names } = playback.timeline;
  return (
    <section className="panel playback-steps" aria-label="Steps">
      <div className="panel-head">
        <h2>Steps</h2>
        <IconButton icon="info" label="Step time colors" description={<StepTimeLegend />} pin className="playback-legend-button" />
        {current >= 0 && (
          <span className="count">
            <span aria-hidden="true">
              <Mono>
                {current + 1}/{steps.length}
              </Mono>
            </span>
            <span className="sr-only">
              {current + 1} of {steps.length} steps
            </span>
          </span>
        )}
      </div>
      <div ref={list} className="panel-body">
        <ol className="playback-step-list">
          {steps.map((step, i) => {
            return (
              <PlaybackStepRow
                key={i}
                step={step}
                names={names}
                index={i}
                heading={heads.get(i)}
                current={i === current}
                estimate={estimates![i]!}
                warnings={warnings.get(`${step.source} ${step.step}`)}
                onSeek={onSeek}
              />
            );
          })}
        </ol>
      </div>
    </section>
  );
}

const PlaybackStepRow = memo(function PlaybackStepRow(props: {
  step: TimelineStep;
  names: Names;
  index: number;
  heading: PricedGuide | undefined;
  current: boolean;
  estimate: string;
  warnings: readonly string[] | undefined;
  onSeek: (index: number) => void;
}) {
  const { step, index, current, estimate } = props;
  const title = noteFace(step.title);
  const actions = stepActions(step, props.names);
  const byNpc = step.kills ?? [];
  const kills = byNpc.reduce((n, k) => n + k.count, 0);
  const killText = `${kills} ${kills === 1 ? "kill" : "kills"}`;
  const mobs = byNpc.map((k) => (byNpc.length > 1 ? `${k.name} ×${k.count}` : k.name)).join(", ");
  const shown = shownSeconds(step);
  const parts = BARS.flatMap(({ key, label }) => (shown[key] > 0 ? [`${label} ${formatClock(shown[key])}`] : [])).join(" · ");
  const tip = (
    <>
      {parts}
      {estimate && (
        <>
          <br />≈ Straight-line travel: {estimate}
        </>
      )}
    </>
  );
  return (
    <li data-index={index} className={current ? "playback-step current" : "playback-step"}>
      {props.heading && (
        <div className="playback-guide">
          <h3>{props.heading.name}</h3>
          <span className="muted">
            Level {props.heading.levels.start}–{props.heading.levels.end}
          </span>
        </div>
      )}
      <ItemButton aria-current={current ? "step" : undefined} onClick={() => props.onSeek(index)}>
        <span className="playback-gutter">
          <span className="playback-no">
            <span className="sr-only">Step </span>
            {step.step + 1}
          </span>
          <span className="playback-time">{formatClock(step.start)}</span>
        </span>
        <span className="playback-main">
          <span className="playback-head">
            <Mark mark={title.mark} />
            <Described text={current ? undefined : <GuideText parts={title.text} links="plain" />} clipped>
              <span className="playback-title-text">
                <GuideText parts={title.text} links="plain" />
              </span>
            </Described>
            {step.party > 1 && <span className="playback-duo">Duo</span>}
            {step.levelAfter > step.levelBefore && <LevelMark level={step.levelAfter} />}
            {shown.total > 0 && (
              <Described text={tip}>
                <span className={estimate ? "playback-length estimate" : "playback-length"}>
                  <span>
                    {estimate && (
                      <span className="estimate-mark" aria-hidden="true">
                        ≈{" "}
                      </span>
                    )}
                    {formatClock(shown.total)}
                  </span>
                  <span className="step-bars" aria-hidden="true">
                    {BARS.map(({ key }) => (
                      <span
                        key={key}
                        className={`step-bar bar-${key}${key === "travel" && estimate ? " estimate" : ""}`}
                        style={{ "--size-w": `${(step.seconds[key] / step.seconds.total) * 100}%` }}
                      />
                    ))}
                  </span>
                  <span className="sr-only">
                    {" "}
                    ({parts}
                    {estimate && `; straight-line travel, ${estimate}`})
                  </span>
                </span>
              </Described>
            )}
          </span>
          {(actions.length > 0 || kills > 0) && (
            <span className="step-does playback-actions">
              {actions.map((action) => {
                const { mark, verb } = STEP_ACTIONS[action.kind];
                return (
                  <span key={`${action.kind} ${action.label}`} className="row-line">
                    <Mark mark={{ kind: mark }} />
                    <span className="row-text">
                      {verb} {action.label}
                    </span>
                  </span>
                );
              })}
              {kills > 0 && (
                <Described text={`${killText} · ${mobs}`} clipped>
                  <span className="row-line playback-kills">
                    <Mark mark={{ kind: "kill" }} />
                    <span className="row-text playback-kills-text">
                      {killText} · {mobs}
                    </span>
                  </span>
                </Described>
              )}
            </span>
          )}
          {props.warnings && (
            <span className="playback-warnings">
              {props.warnings.map((message) => (
                <span key={message} className="row-line playback-warning">
                  <WarningMark />
                  <span className="row-text">{message}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      </ItemButton>
    </li>
  );
});

const SPACE_TARGETS = [
  "a[href]",
  "button",
  "input:not([type=range])",
  "select",
  "textarea",
  "summary",
  "[contenteditable]",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=tab]",
  "[role=option]",
  "[role^=menuitem]",
  "[role=dialog]",
  "dialog",
  ".drawer",
].join(", ");

const playbackSpace = (e: KeyboardEvent) =>
  e.key === " " &&
  !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) &&
  !e.defaultPrevented &&
  !document.getElementById("app")?.hasAttribute("inert") &&
  !(e.target instanceof Element && e.target.closest(SPACE_TARGETS));

function TimelineDock({ routing }: { routing: HostRouting | undefined }) {
  const store = usePlaybackStore();
  const playback = usePlayable();
  const stale = usePlayback((s) => s.status.kind === "ready" && s.status.stale);
  const playhead = usePlayback((s) => s.playhead);
  const playing = usePlayback((s) => s.playing);
  const speed = usePlayback((s) => s.speed);
  const reach = usePlayback((s) => s.reach);
  const current = useCurrentStep();

  useEventListener(
    () => window,
    "keydown",
    (e) => {
      if (!playbackSpace(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (store.getState().playing) store.pause();
      else store.play();
    },
  );
  // A focused button activates when Space comes up, so the keyup is prevented too.
  useEventListener(
    () => window,
    "keyup",
    (e) => {
      if (playbackSpace(e)) e.preventDefault();
    },
  );

  const unavailable = routing && !routing.router ? routing.unavailable : undefined;
  useEffect(() => {
    if (unavailable) console.error("Routing did not load", unavailable);
  }, [unavailable]);

  const before = playback ? stepBefore(playback.timeline.steps, current) : -1;
  const total = playback?.timeline.totals.seconds ?? 0;
  const marks = useMemo(
    () => (playback ? playback.timeline.steps.flatMap((_, i) => playback.ways(i).filter((way) => way.estimate)) : []),
    [playback],
  );
  const progress = playback?.routing;
  const estimates = progress ? Object.entries({ ...(progress.pending > 0 && { pending: progress.pending }), ...progress.straight }) : [];
  const why = estimates.map(([reason, n]) => `${n} ${ESTIMATE_REASONS[reason as EstimateReason]}`).join(", ");
  const routingText = !routing
    ? "Loading routing…"
    : !routing.router
      ? "Routing did not load, so travel times use straight lines. Reload the page to try again."
      : progress
        ? legsText(progress)
        : "";
  const chain = playback?.chain ?? [];
  const priced = chain.filter(isPriced);
  const calculating = chain.find((g) => !g.priced && g.through <= reach);
  const play = playing ? "Pause" : "Play";
  return (
    <div className="playback-dock" role="group" aria-label="Timeline">
      <div className="playback-transport">
        <IconButton icon="skipBack" label="Previous step" size={32} onClick={() => store.seekStep(before)} disabled={before < 0} />
        <IconButton
          icon={playing ? "pause" : "play"}
          label={play}
          description={`${play} (Space)`}
          variant="primary"
          size={32}
          className="playback-play"
          aria-keyshortcuts="Space"
          onClick={() => (playing ? store.pause() : store.play())}
          disabled={!playback}
        />
        <IconButton
          icon="skipForward"
          label="Next step"
          size={32}
          onClick={() => store.seekStep(current + 1)}
          disabled={!playback || current >= (playback?.timeline.steps.length ?? 0) - 1}
        />
      </div>
      <span className="playback-clock">
        {formatClock(playhead)} <span className="muted">/ {formatClock(total)}</span>
      </span>
      <div className="playback-scrubber">
        <div className="playback-track" style={{ "--played": total > 0 ? Math.min(1, playhead / total) : 0 }}>
          <Slider
            aria-label="Playhead"
            aria-valuetext={`${formatClock(playhead)} of ${formatClock(total)}`}
            min={0}
            max={Math.max(1, Math.ceil(total))}
            step={1}
            value={Math.round(playhead)}
            disabled={!playback}
            onChange={(e) => store.seek(Number(e.target.value))}
          />
          <div className="playback-marks" aria-hidden="true">
            {total > 0 &&
              marks.map((way, i) => (
                <span
                  key={i}
                  className="playback-mark"
                  style={{ "--at-x": `${(way.start / total) * 100}%`, "--size-w": `${Math.max(0.2, (way.seconds / total) * 100)}%` }}
                />
              ))}
            {total > 0 &&
              priced
                .slice(1)
                .map((guide) => (
                  <span key={guide.source} className="playback-guide-mark" style={{ "--at-x": `${(guide.priced.start / total) * 100}%` }} />
                ))}
          </div>
        </div>
        <ol className="playback-chain" aria-label="Guides">
          {priced.map((guide) => {
            const { start, seconds } = guide.priced;
            const status = guideStatus(guide, !!routing?.router);
            const left = total > 0 ? (start / total) * 100 : 0;
            return (
              <li
                key={guide.source}
                className={seconds > 0 ? "playback-chain-guide" : "playback-chain-guide boundary"}
                style={{ "--at-x": `${left}%`, "--size-w": seconds > 0 ? `${(seconds / total) * 100}%` : undefined }}
              >
                <Described text={`Level ${guide.levels.start} to ${guide.levels.end} · ${formatClock(seconds)} · ${status}`}>
                  <ItemButton onClick={() => store.seek(start)}>
                    <span className="playback-chain-name">{guide.name}</span>
                    {guide.priced.done ? <Icon name="check" size={12} /> : <GuideProgress guide={guide} />}
                    <span className="sr-only">: {status}</span>
                  </ItemButton>
                </Described>
              </li>
            );
          })}
        </ol>
      </div>
      <Field label="Speed" className="playback-speed">
        <Select value={speed} onChange={(e) => store.setSpeed(Number(e.target.value) as Speed)}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </Select>
      </Field>
      <PlaybackSettingsMenu />
      <div className="playback-routing">
        <span role="status">{stale ? (calculating ? `Calculating ${calculating.name}…` : "Updating after the edit") : routingText}</span>
        {marks.length > 0 && (
          <Described text={why && `Straight-line legs: ${why}`}>
            <span className="playback-estimates">
              <span className="estimate-swatch" aria-hidden="true" />
              Straight-line estimate
            </span>
          </Described>
        )}
      </div>
    </div>
  );
}
