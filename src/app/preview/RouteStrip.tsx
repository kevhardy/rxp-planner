import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  describeGuideStatus,
  resolveStartLevel,
  shownSteps,
  startLevelWarning,
  startOf,
  type EarlierGuide,
  type GuideSimulation,
  type RouteView,
  type SimState,
} from "../../rules/index.ts";
import type { GameRules } from "../../data/index.ts";
import { useEditor, useGameData, useStores } from "../context.ts";
import { Described } from "../Described.tsx";
import { useDisclosure, usePendingAction, useWidth } from "../effects.ts";
import { guideMeta } from "../../rules/registration.ts";
import { Icon } from "../icons.tsx";
import { useLayout } from "../layout.ts";
import { routeContinents } from "./continents.ts";
import { characterName } from "./PreviewBar.tsx";
import { openOnRoute, useShownRoute } from "./route.ts";
import { fewestSlots, pageShowing, routePage, type PageInput, type RoutePage } from "./routePage.ts";
import { MAX_LEVEL, maxStartXp, usePreviewSettings, useSettingsStore } from "./settings.ts";
import { levelPercent } from "./StateButton.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Field, Input, Select } from "../ui/Field.tsx";
import { ItemButton } from "../ui/ItemButton.tsx";
import { Text } from "../ui/Text.tsx";
import "./chain.css";

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
const ABOUT = {
  startFrom: "Where the route starts. It follows #next to the open guide.",
  startLevel: "Auto uses the start guide's level range.",
  startXp: "XP into the start level. Auto is 0.",
};

const WIDTH = { card: 150, settings: 30, link: 38 };

const cardWidth = (width: number, fewest: number) =>
  Math.min(WIDTH.card, Math.floor((width - WIDTH.settings - (fewest - 1) * WIDTH.link) / fewest));
const slotsIn = (width: number, card: number) => 1 + Math.floor((width - card - WIDTH.settings) / (WIDTH.link + card));

export function RouteStrip() {
  const route = useShownRoute();
  const { current } = useEditor();
  if (!route || !current) return null;
  return (
    <section className="chain-strip" aria-label="Route">
      <Described text={`Group: ${current.group}`}>
        <span className="chain-group">{current.group}</span>
      </Described>
      <RouteCards route={route} />
    </section>
  );
}

const pageLabel = (page: RoutePage, count: number) => `Guides ${page.from + 1} to ${page.to + 1} of ${count}`;

function RouteCards({ route }: { route: RouteView }) {
  const stores = useStores();
  const game = useGameData();
  const rules = game?.rules;
  const continents = useMemo(() => (game ? routeContinents(route, game) : []), [route, game]);
  const track = useRef<HTMLDivElement>(null);
  const width = useWidth(track);
  const guides = cards(route, rules);
  const count = guides.length;
  const open = route.preview.guides.findIndex((g) => g.source === route.open);
  const crossing = (at: number) => !!continents[at - 1] && !!continents[at] && continents[at - 1] !== continents[at];
  const key = `${route.records[startOf(route)]!.id} ${route.records[route.open]!.id}`;
  const fresh = { key, first: Math.max(0, open - 1), active: open, said: "" };
  const [nav, setNav] = useState(fresh);
  const state = nav.key === key ? nav : fresh;
  if (nav !== state) setNav(state);
  const places = { count, start: 0, open };
  const card = cardWidth(width, fewestSlots(places));
  const input: PageInput = { ...places, slots: slotsIn(width, card), first: state.first };
  const page = routePage(input);
  const { previous, next } = page;
  const focusing = useRef<true | null>(null);

  usePendingAction(focusing, () => track.current?.querySelector<HTMLElement>(`[data-at="${state.active}"]`)?.focus());

  const turn = (first: number) => setNav({ ...state, first, said: pageLabel(routePage({ ...input, first }), count) });
  const move = (at: number) => {
    const first = pageShowing(input, at);
    focusing.current = true;
    setNav({ ...state, first, active: at, said: first === state.first ? state.said : pageLabel(routePage({ ...input, first }), count) });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.target instanceof HTMLElement) || e.target.dataset.at === undefined) return;
    const at = Number(e.target.dataset.at);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: count - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(Math.max(0, Math.min(count - 1, to)));
  };
  const tabStop = page.shown.includes(state.active) ? state.active : open;

  return (
    <div
      ref={track}
      className="chain-track"
      style={{ "--strip-card": `${card}px`, "--strip-start": `${card + WIDTH.settings}px`, "--strip-link": `${WIDTH.link}px` }}
    >
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- The Tab stop is the focused card inside, as in the ARIA toolbar pattern. */}
      <div className="chain-bar" role="toolbar" aria-label="Guides on the route" onKeyDown={onKeyDown}>
        <ol className="chain-cards">
          {page.shown.map((at, i) => {
            const card = guides[at]!;
            const before = page.shown[i - 1];
            const name = `${card.name}, guide ${at + 1} of ${count}${at === open ? ", open guide" : ""}`;
            const common: CardButton = {
              "data-at": at,
              tabIndex: at === tabStop ? 0 : -1,
              "aria-current": at === open ? ("page" as const) : undefined,
              onFocus: () => {
                if (state.active !== at) setNav({ ...state, active: at });
              },
            };
            return (
              <li key={at === 0 ? "start" : card.id}>
                {before !== undefined &&
                  (before !== at - 1 ? (
                    <span className="chain-link gap" aria-hidden="true" />
                  ) : crossing(at) ? (
                    <SeaCrossing to={continents[at]!} />
                  ) : (
                    <span className="chain-link" aria-hidden="true" />
                  ))}
                {at === 0 ? (
                  <>
                    <StartCard route={route} card={card} name={name} button={common} />
                    {previous !== undefined && (
                      <>
                        <span className="chain-link gap" aria-hidden="true" />
                        <Pager count={page.earlier} side="earlier" onClick={() => turn(previous)} />
                      </>
                    )}
                  </>
                ) : (
                  <Described text={card.about}>
                    <ItemButton
                      className={`chain-card${card.status ? ` ${card.status.kind}` : ""}`}
                      aria-label={name}
                      {...common}
                      onClick={() => openOnRoute(stores, route, card.source)}
                    >
                      <CardName name={card.name} />
                    </ItemButton>
                  </Described>
                )}
              </li>
            );
          })}
        </ol>
        {next !== undefined && (
          <>
            <span className="chain-link gap" aria-hidden="true" />
            <Pager count={page.later} side="later" onClick={() => turn(next)} />
          </>
        )}
        <span className="sr-only" role="status">
          {state.said}
        </span>
      </div>
    </div>
  );
}

function Pager({ count, side, onClick }: { count: number; side: "earlier" | "later"; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className={`chain-pager ${side}`}
      tabIndex={-1}
      aria-label={`Show ${count} ${side} ${count === 1 ? "guide" : "guides"}`}
      onClick={onClick}
    >
      {side === "earlier" ? (
        <>
          <Icon name="chevronLeft" size={12} />
          {count} earlier
        </>
      ) : (
        <>
          {count} later
          <Icon name="chevronRight" size={12} />
        </>
      )}
    </Button>
  );
}

function SeaCrossing({ to }: { to: string }) {
  return (
    <span className="chain-sea" role="img" aria-label={`Sea crossing to ${to}`}>
      <svg viewBox="0 0 34 22" aria-hidden="true">
        <path
          d="M1 18c2.6-2.4 5.4 2.4 8 0s5.4 2.4 8 0 5.4 2.4 8 0 5.4 2.4 8 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path d="M9 12h17l-3.5 3.6H11.5z" fill="currentColor" />
        <path d="M16.5 3.5v8.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M17.3 4.2 22.6 11h-5.3z" fill="currentColor" />
      </svg>
    </span>
  );
}

interface CardButton {
  "data-at": number;
  tabIndex: number;
  "aria-current": "page" | undefined;
  onFocus: () => void;
}

function CardName({ name }: { name: string }) {
  const [, range, zone] = /^(\d+-\d+)\s*(.*)$/.exec(name) ?? [];
  return (
    <span className="chain-card-name">
      {range && <span className="chain-card-range">{range}</span>}
      <span className="chain-card-zone">{range ? zone : name}</span>
    </span>
  );
}

function StartCard({ route, card, name, button: cardButton }: { route: RouteView; card: GuideCard; name: string; button: CardButton }) {
  const stores = useStores();
  const { mode } = useLayout();
  const { open, toggle, button, wrap } = useDisclosure({ focus: (wrap) => wrap.querySelector(".popover button, .popover select") });
  const popoverId = useId();
  const start = startOf(route);
  const warning = startLevelWarning(route);
  const { unreached } = route;
  const flagged = !!warning || unreached !== undefined;

  return (
    <span {...wrap} className={`chain-card start${flagged ? " flagged" : ""}${card.status ? ` ${card.status.kind}` : ""}`}>
      <Described text={card.about}>
        <ItemButton
          className="chain-start-name"
          aria-label={name}
          {...cardButton}
          onClick={() => card.source !== route.open && openOnRoute(stores, route, card.source)}
        >
          <CardName name={card.name} />
        </ItemButton>
      </Described>
      <Described text="Start guide and level" popoverOpen={open}>
        <Button
          ref={button}
          variant="ghost"
          className="chain-start-settings"
          aria-label={`Start settings${flagged ? ", with a warning" : ""}`}
          popoverOpen={open}
          aria-controls={popoverId}
          onClick={toggle}
        >
          {flagged && <Icon name="warning" size={12} className="warn" />}
          <Icon name="chevronDown" size={12} />
        </Button>
      </Described>
      <Card as="section" layer id={popoverId} className="popover chain-start-popover" aria-label="Route start" hidden={!open}>
        <p className="chain-start-guide">
          <Text size="small" tone="muted">
            Start guide
          </Text>{" "}
          <b>{route.names[start]}</b>
        </p>
        <div className="chain-start-fields">
          <StartFrom route={route} />
          <StartLevel route={route} />
        </div>
        <StartLevelWarning route={route} />
        {unreached !== undefined && (
          <p className="notice warn">
            {mode === "playback"
              ? `Solo self-found, the route from ${route.names[unreached]} does not reach ${route.names[route.open]}, so Playback starts at ${route.names[route.open]}.`
              : `The route from ${route.names[unreached]} does not reach ${route.names[route.open]}, so the route starts at ${route.names[route.open]}.`}
          </p>
        )}
      </Card>
    </span>
  );
}

function StartLevelWarning({ route }: { route: RouteView }) {
  const settingsStore = useSettingsStore();
  const warning = startLevelWarning(route);
  if (!warning) return null;
  const { level, start, range, earlier } = warning;
  const where = start === route.open ? "this guide's range" : `the range of ${route.names[start]}`;
  return (
    <div className="notice warn start-level-warning">
      <p>
        Level {level} is below {where}, {range.min} to {range.max}.
      </p>
      <Button
        variant="secondary"
        onClick={(e) => {
          e.currentTarget.closest(".popover")?.querySelector<HTMLSelectElement>('select[name="startLevel"]')?.focus();
          settingsStore.update({ startLevel: "auto" });
        }}
      >
        Use Auto (level {resolveStartLevel("auto", range).level})
      </Button>
      {earlier !== undefined && (
        <Button
          variant="secondary"
          onClick={(e) => {
            e.currentTarget.closest(".popover")?.querySelector<HTMLSelectElement>('select[name="start"]')?.focus();
            settingsStore.update({ start: route.records[earlier]!.id });
          }}
        >
          Start from {route.names[earlier]}
        </Button>
      )}
    </div>
  );
}

function StartFrom({ route }: { route: RouteView }) {
  const settings = usePreviewSettings();
  const settingsStore = useSettingsStore();
  const start = startOf(route);
  const option = ({ source, distance }: EarlierGuide) => (
    <option key={source} value={route.records[source]!.id}>
      {route.names[source]} ({distance} {distance === 1 ? "guide" : "guides"} earlier)
    </option>
  );
  const own = route.earlier.filter((e) => e.isDefault);
  const other = route.earlier.filter((e) => !e.isDefault);
  return (
    <Field label="Start from" description={ABOUT.startFrom} className="preview-field">
      <Select
        name="start"
        value={start === route.open ? "" : route.records[start]!.id}
        onChange={(e) => settingsStore.update({ start: e.target.value || null })}
      >
        <option value="">This guide ({route.names[route.open]})</option>
        {own.length > 0 && other.length > 0 ? (
          <>
            <optgroup label={`Default for ${characterName(settings)}`}>{own.map(option)}</optgroup>
            <optgroup label="For other characters">{other.map(option)}</optgroup>
          </>
        ) : (
          route.earlier.map(option)
        )}
      </Select>
    </Field>
  );
}

function StartLevel({ route }: { route: RouteView }) {
  const settings = usePreviewSettings();
  const settingsStore = useSettingsStore();
  const game = useGameData();
  const fixed = settings.startLevel === "auto" ? null : settings.startLevel;
  const autoLevel = resolveStartLevel("auto", guideMeta(route.records[startOf(route)]!).range).level;
  const maxXp = game && fixed ? maxStartXp(game.rules, fixed.level) : 0;
  const [draft, setDraft] = useState<{ text: string; level: number; xp: number } | null>(null);
  const xpText = draft && draft.level === fixed?.level && draft.xp === fixed.xp ? draft.text : null;
  const xpValid = (text: string) => /^\d+$/.test(text) && Number(text) <= maxXp;
  const xpError = xpText !== null && !xpValid(xpText) ? `Enter a whole number from 0 to ${maxXp.toLocaleString("en-US")}.` : undefined;
  return (
    <>
      <Field label="Start level" description={ABOUT.startLevel} className="preview-field">
        <Select
          name="startLevel"
          value={fixed?.level ?? "auto"}
          onChange={(e) => {
            const { value } = e.target;
            settingsStore.update({ startLevel: value === "auto" ? "auto" : { level: Number(value), xp: fixed?.xp ?? 0 } });
            setDraft(null);
          }}
        >
          <option value="auto">Auto ({autoLevel})</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Start XP" description={ABOUT.startXp} error={xpError} className="preview-field">
        <Input
          type="number"
          mono
          className="start-xp"
          required
          disabled={!game || !fixed}
          min={0}
          max={maxXp}
          step={1}
          value={xpText ?? fixed?.xp ?? 0}
          onChange={(e) => {
            if (!fixed) return;
            const text = e.target.value;
            const startLevel = xpValid(text) ? { level: fixed.level, xp: Number(text) } : fixed;
            setDraft({ text, ...startLevel });
            if (startLevel !== fixed) settingsStore.update({ startLevel });
          }}
        />
      </Field>
    </>
  );
}

interface GuideCard {
  id: string;
  source: number;
  name: string;
  status?: { kind: "hidden" | "inactive"; text: string };
  about: string;
}

function cards(route: RouteView, rules: GameRules | undefined): GuideCard[] {
  const { preview, profile, records, names, simulation } = route;
  return preview.guides.map((guide, i) => {
    const shown = shownSteps(guide);
    const total = guide.doc.steps.length;
    const text = describeGuideStatus(guide, profile);
    const status = text && { kind: guide.hidden ? ("hidden" as const) : ("inactive" as const), text };
    const levels = simulation && rules && !guide.hidden ? guideLevels(rules, simulation.guides, i) : undefined;
    const about = [
      `${shown} of ${total} steps`,
      levels && `Level ${levels.start} to ${levels.end}`,
      levels?.behind && `${names[levels.behind.source]} starts higher, at ${levelLabel(rules!, levels.behind.afterHeader)}`,
      text,
    ]
      .filter(Boolean)
      .join(" · ");
    return { id: records[guide.source]!.id, source: guide.source, name: names[guide.source]!, ...(status && { status }), about };
  });
}

function levelLabel(rules: GameRules, state: SimState): string {
  const percent = levelPercent(rules, state);
  return state.xp > 0 && percent !== null ? `${state.level} (${percent}%)` : String(state.level);
}

function guideLevels(rules: GameRules, guides: readonly GuideSimulation[], i: number) {
  const { afterHeader, end } = guides[i]!;
  const next = guides.slice(i + 1).find((g) => !g.hidden);
  const behind = next && (end.level - next.afterHeader.level || end.xp - next.afterHeader.xp) < 0 ? next : undefined;
  return { start: levelLabel(rules, afterHeader), end: levelLabel(rules, end), behind };
}
