import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Entity, GameData, GameRules, Quest, QuestPoint } from "../../data/index.ts";
import { bodyIndent, insertStep, newStep, type BodyLine } from "../../guide/index.ts";
import {
  formatLevelTarget,
  grindEstimate,
  grindMobChoice,
  insertionKillXp,
  insertionState,
  type MarkKind,
  objectiveInfo,
  parseLevelTarget,
  QUEST_LOG_SIZE,
  stateZone,
  suggestQuests,
  type GuideSimulation,
  type ObjectiveInfo,
  type Profile,
  type QuestSuggestion,
  type SimData,
  type SimState,
  type SuggestionSort,
} from "../../rules/index.ts";
import { insertCheckpoint, insertQuest, questPointAt } from "../../rules/questInsertion.ts";
import { targetXp, totalXp, xpToNextLevel, type KillXpSettings, type LevelTarget, type PartySize } from "../../rules/xp.ts";
import { useEditor, useEditorStore, useGameData } from "../context.ts";
import { editSection } from "../drafts.ts";
import { useOutsidePress } from "../effects.ts";
import { EntityLink, ItemIcon, useEntityNames } from "../EntityLink.tsx";
import { moveActive, OptionList } from "../fields.tsx";
import { Icon } from "../icons.tsx";
import { Mark } from "../Mark.tsx";
import { Button, IconButton } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Field, Input, Select } from "../ui/Field.tsx";
import { Tab } from "../ui/Tab.tsx";
import { Heading, Mono } from "../ui/Text.tsx";
import { useSimData } from "../preview/route.ts";
import { MAX_LEVEL, usePreviewSettings } from "../preview/settings.ts";
import type { DocOp, Selection } from "../store.ts";
import { lockText, type LockNames } from "./lockText.ts";
import { joined, PointLink, prerequisiteLinks, QuestBrief, QuestDetails, QuestToggle } from "./QuestInfo.tsx";
import "./addStep.css";

const ROW_LIMIT = 50;

const number = (n: number) => n.toLocaleString("en-US");

export function AddStepButton(props: {
  after: number | null;
  skipped: boolean;
  simulation: GuideSimulation | undefined;
  profile: Profile;
  onBlank: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useOutsidePress(open, wrap, () => setOpen(false));

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Catches Escape and focus leaving from the button and popover inside.
    <span
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <IconButton
        ref={button}
        icon="plus"
        label="Add step"
        description="Suggested steps after the selected one (Insert adds a blank step)"
        popoverOpen={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <AddStepPopover
          id={popoverId}
          anchor={button.current!}
          after={props.after}
          skipped={props.skipped}
          simulation={props.simulation}
          profile={props.profile}
          onBlank={() => {
            props.onBlank();
            close();
          }}
          onDone={close}
        />
      )}
    </span>
  );
}

type Tab = "quests" | "grind" | "checkpoint" | "blank";

const TAB_NAMES: Record<Tab, string> = { quests: "Quests", grind: "Grind", checkpoint: "Checkpoint", blank: "Blank step" };

interface Simulated {
  state: SimState;
  data: GameData;
  sim: SimData;
  killXp: KillXpSettings;
  party: PartySize;
}

function AddStepPopover(props: {
  id: string;
  anchor: HTMLElement;
  after: number | null;
  skipped: boolean;
  simulation: GuideSimulation | undefined;
  profile: Profile;
  onBlank: () => void;
  onDone: () => void;
}) {
  const { id, anchor, after, skipped, profile, onDone } = props;
  const { current } = useEditor();
  const store = useEditorStore();
  const data = useGameData();
  const sim = useSimData(usePreviewSettings());
  const doc = current!.doc;
  const state = insertionState(props.simulation, after);
  const simulated: Simulated | undefined =
    state && props.simulation && data && sim
      ? { state, data, sim, killXp: insertionKillXp(props.simulation, doc), party: props.simulation.party }
      : undefined;
  const tabs: Tab[] = simulated ? ["quests", "grind", "checkpoint", "blank"] : ["grind", "checkpoint", "blank"];
  const [chosen, setTab] = useState<Tab>(tabs[0]!);
  const tab = tabs.includes(chosen) ? chosen : tabs[0]!;
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState<{ x: string; y: string; w: string; h: string }>();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const placeUnder = () => {
      const box = anchor.getBoundingClientRect();
      const width = Math.min(640, innerWidth - 16);
      const top = box.bottom + 8;
      const left = Math.max(8, Math.min(box.right - width, innerWidth - width - 8));
      setPlace({ x: `${left}px`, y: `${top}px`, w: `${width}px`, h: `${innerHeight - top - 8}px` });
    };
    placeUnder();
    ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    addEventListener("resize", placeUnder);
    return () => removeEventListener("resize", placeUnder);
  }, [anchor]);

  const indent = bodyIndent(doc);
  const at = after === null ? 0 : after + 1;
  const apply = (op: DocOp, selection: Selection) => {
    const result = editSection(store, after, op, selection);
    if (result.ok || result.reason === "opened") onDone();
    else setError(result.error);
  };

  const onTabKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(tab);
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to]!);
    document.getElementById(`${id}-tab-${tabs[to]}`)?.focus();
  };

  return (
    <Card
      layer
      ref={ref}
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="add-popover"
      vars={{ "--at-x": place?.x, "--at-y": place?.y, "--size-w": place?.w, "--size-h": place?.h }}
    >
      <p className="add-head">
        <strong id={`${id}-title`}>{after === null ? "Add at the start" : `Add after step ${after + 1}`}</strong>
        {simulated && <span className="muted"> · {stateSummary(simulated)}</span>}
      </p>
      <div role="tablist" aria-label="Add" className="add-tabs">
        {tabs.map((t) => (
          <Tab key={t} id={`${id}-tab-${t}`} selected={t === tab} controls={`${id}-panel`} onClick={() => setTab(t)} onKeyDown={onTabKey}>
            {TAB_NAMES[t]}
          </Tab>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="add-panel">
        {!simulated && tab !== "blank" && (
          <p className="muted add-note">The simulation is not ready, so there are no quest suggestions or XP estimates.</p>
        )}
        {tab === "quests" && simulated && (
          <QuestsPanel
            {...simulated}
            profile={profile}
            onAdd={(s) => {
              const target = { data: simulated.data, faction: profile.faction, doc, after };
              const insertion = insertQuest(target, { kind: "suggestion", suggestion: s, skipped });
              if (insertion) apply(insertion.edit, { step: insertion.select, line: null });
            }}
          />
        )}
        {tab === "grind" && (
          <GrindPanel
            simulated={simulated}
            initialMob={current && sim ? grindMobChoice(current.doc, after, sim) : undefined}
            onAdd={(target, mob) => {
              const body: BodyLine[] = [{ kind: "command", indent, name: "xp", args: [formatLevelTarget(target)] }];
              if (mob) body.push({ kind: "command", indent, name: "mob", args: [`${mob.name}::${mob.id}`] });
              apply((d) => insertStep(d, at, { ...newStep(), body }), { step: at, line: null });
            }}
          />
        )}
        {tab === "checkpoint" && (
          <CheckpointPanel
            state={simulated?.state}
            after={after}
            skipped={skipped}
            onAdd={(target) => {
              const insertion = insertCheckpoint(doc, after, skipped, target);
              apply(insertion.edit, insertion.select);
            }}
          />
        )}
        {tab === "blank" && (
          <div className="add-form">
            <p className="add-wide muted">Adds an empty step, as Insert does.</p>
            <div className="add-actions">
              <Button variant="primary" onClick={props.onBlank}>
                Add
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

function stateSummary({ state, data }: Simulated): ReactNode {
  const where = stateZone(data, state)?.name ?? (state.position ? "outside any zone map" : "no position yet");
  return (
    <>
      Level <Mono>{state.level}</Mono>
      {state.level < MAX_LEVEL && (
        <>
          {" "}
          (
          <Mono>
            {number(state.xp)}/{number(xpToNextLevel(data.rules, state.level))}
          </Mono>
          )
        </>
      )}
      {` · ${where} · log `}
      <Mono>
        {state.log.size}/{QUEST_LOG_SIZE}
      </Mono>
    </>
  );
}

const GROUPS: [QuestSuggestion["kind"], string][] = [
  ["turnin", "Ready to turn in"],
  ["objective", "Open objectives"],
  ["accept", "Can accept"],
];

const GROUP_MARKS = { turnin: "turnin", objective: "complete", accept: "accept" } as const satisfies Record<
  QuestSuggestion["kind"],
  MarkKind
>;

const SORTS: [SuggestionSort, string][] = [
  ["distance", "Nearest"],
  ["level", "Level"],
  ["xp", "XP"],
];

function QuestsPanel(props: Simulated & { profile: Profile; onAdd: (s: QuestSuggestion) => void }) {
  const { state, data, sim, profile } = props;
  const zone = stateZone(data, state);
  const [allZones, setAllZones] = useState(false);
  const [sort, setSort] = useState<SuggestionSort>("distance");
  const id = useId();
  const list = useMemo(
    () => suggestQuests(state, data, sim, profile, { zone: allZones || !zone ? null : zone.id, sort }),
    [state, data, sim, profile, zone, allZones, sort],
  );
  const lockNames: LockNames = {
    quest: (q) => data.quest(q, profile.faction)?.name ?? `quest #${q}`,
    faction: (id) => data.factionName(id),
    rules: data.rules,
  };

  return (
    <>
      <div className="add-filters">
        <Field label="Zone">
          <Select value={allZones || !zone ? "all" : "here"} onChange={(e) => setAllZones(e.target.value === "all")}>
            {zone && <option value="here">{zone.name}</option>}
            <option value="all">All zones</option>
          </Select>
        </Field>
        <Field label="Sort">
          <Select value={sort} onChange={(e) => setSort(e.target.value as SuggestionSort)}>
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {list.length === 0 && <p className="muted add-note">No quests to suggest{zone && !allZones ? ` in ${zone.name}` : ""}.</p>}
      {list.length > 0 && (
        <div className="add-row add-cols" aria-hidden="true">
          <span />
          <span>Quest</span>
          <span>Requires</span>
          <span className="add-num">Distance</span>
          <span className="add-num">XP</span>
        </div>
      )}
      {GROUPS.map(([kind, title]) => {
        const rows = list.filter((s) => s.kind === kind).sort((a, b) => Number(!!lockReasons(a)) - Number(!!lockReasons(b)));
        if (rows.length === 0) return null;
        return (
          <section key={kind} className="add-group" aria-labelledby={`${id}-${kind}`}>
            <Heading level={3} size="micro" tone="muted" id={`${id}-${kind}`}>
              {title}
            </Heading>
            <ul>
              {rows.slice(0, ROW_LIMIT).map((s) => {
                const quest = data.quest(s.questId, profile.faction);
                const others = lockReasons(s)?.filter((r) => r.kind !== "prerequisite") ?? [];
                const place = s.kind === "objective" && s.location ? data.zoneAt(s.location) : undefined;
                return (
                  <SuggestionRow
                    key={s.kind === "objective" ? `${s.questId}:${s.objective.row}` : `${s.questId}:`}
                    suggestion={s}
                    data={data}
                    quest={quest}
                    level={state.level}
                    npc={suggestionNpc(s, quest)}
                    objective={s.kind === "objective" ? objectiveInfo(state, sim, s, props.party) : undefined}
                    sim={sim}
                    place={place && place !== zone ? place.name : undefined}
                    lockText={others.length > 0 ? lockText(others, lockNames) : undefined}
                    onAdd={() => props.onAdd(s)}
                  />
                );
              })}
            </ul>
            {rows.length > ROW_LIMIT && (
              <p className="muted add-note">
                Showing {ROW_LIMIT} of {number(rows.length)}. Choose a zone or sort to see others.
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

function SuggestionRow(props: {
  suggestion: QuestSuggestion;
  data: GameData;
  sim: SimData;
  /** The quest's record; undefined when the data lacks it. */
  quest: Quest | undefined;
  level: number;
  npc: QuestPoint | undefined;
  objective: ObjectiveInfo | undefined;
  /** For an objective: its zone, when that is not the character's. */
  place: string | undefined;
  lockText: string | undefined;
  onAdd: () => void;
}) {
  const { suggestion: s, quest, npc, objective } = props;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const locked = !!lockReasons(s);
  const canAdd = !locked && (s.kind !== "objective" || s.objective.index !== null);
  const label = suggestionLabel(s, npc);
  const sub: ReactNode[] = [];
  if (objective?.need) sub.push(needText(objective.need, props.sim));
  if (props.place) sub.push(props.place);
  if (s.kind === "objective" && s.objective.index === null) sub.push("no .complete index");
  if (props.lockText)
    sub.push(
      <span className="add-locked">
        <Icon name="lock" size={12} />
        {props.lockText}
      </span>,
    );
  return (
    <li className={`add-row add-${s.kind}${locked ? " locked" : ""}`}>
      <Mark mark={{ kind: GROUP_MARKS[s.kind] }} />
      <span className="add-name">
        {quest ? (
          <QuestToggle open={open} controls={detailsId} onToggle={setOpen}>
            {s.name}
          </QuestToggle>
        ) : (
          s.name
        )}
        {s.kind === "objective" ? (
          <>
            : <ObjectiveName name={s.objective.name} target={objective?.target} />
          </>
        ) : (
          npc && (
            <>
              {s.kind === "turnin" ? " → " : " · "}
              <PointLink point={npc} />
            </>
          )
        )}
      </span>
      <span>{quest && <PrerequisiteChip quest={quest} missing={s.prerequisiteMissing} />}</span>
      <span className="add-num">
        {s.distance === null ? (
          "—"
        ) : (
          <>
            <Mono>{number(Math.round(s.distance))}</Mono> yd
          </>
        )}
      </span>
      <span className="add-num add-xp">
        {s.xp === null ? "—" : <Mono>{`${s.kind === "accept" ? "" : "+"}${number(s.xp)}`}</Mono>}
        <span className="sr-only"> xp</span>
      </span>
      <IconButton icon="plus" label={`Add ${label}`} disabled={!canAdd} onClick={props.onAdd} />
      {(sub.length > 0 || s.kind === "accept" || open) && (
        <div className="add-more">
          {sub.length > 0 && <p className="add-sub">{joined(sub, " · ")}</p>}
          {quest && s.kind === "accept" && <QuestBrief quest={quest} />}
          {quest && open && <QuestDetails id={detailsId} data={props.data} quest={quest} level={props.level} />}
        </div>
      )}
    </li>
  );
}

function ObjectiveName(props: { name: string; target: ObjectiveInfo["target"] }) {
  const { name, target } = props;
  if (target?.kind === "item") return <ItemIcon id={target.id} name={name} named />;
  if (target?.kind === "npc")
    return (
      <EntityLink type="npc" id={target.id} name={name}>
        {name}
      </EntityLink>
    );
  return name;
}

function needText(need: NonNullable<ObjectiveInfo["need"]>, sim: SimData): ReactNode {
  if (need.kind !== "kills") return need.kind === "bought" ? "bought, no kills" : "from objects, no kills";
  const mobs = need.mobs.map((id) => {
    const levels = sim.npc(id)?.levels;
    return (
      <>
        <EntityLink type="npc" id={id} />
        {levels && ` (Lv ${levels.min === levels.max ? levels.min : `${levels.min}–${levels.max}`})`}
      </>
    );
  });
  return (
    <>
      {number(need.kills)} {need.kills === 1 ? "kill" : "kills"} · {joined(mobs, ", ")}
      {need.drops && (need.mobs.length === 1 ? " drops it" : " drop it")}
    </>
  );
}

function PrerequisiteChip(props: { quest: Quest; missing: boolean }) {
  const after = prerequisiteLinks(props.quest);
  if (after === null) return null;
  return props.missing ? (
    <span className="add-chip">
      <Icon name="lock" size={12} />
      <span>after {after}</span>
    </span>
  ) : (
    <span className="add-chip done">
      <Icon name="check" size={12} />
      <span>
        <span className="sr-only">after </span>
        {after}
        <span className="sr-only">, done</span>
      </span>
    </span>
  );
}

const lockReasons = (s: QuestSuggestion) => (s.kind === "accept" ? s.locked : undefined);

function suggestionNpc(s: QuestSuggestion, quest: Quest | undefined): QuestPoint | undefined {
  if (s.kind === "objective" || !quest) return undefined;
  const points = s.kind === "turnin" ? quest.endPoints : quest.startPoints;
  return questPointAt(points, s.location) ?? points[0];
}

function suggestionLabel(s: QuestSuggestion, npc: QuestPoint | undefined): string {
  if (s.kind === "objective") return `${s.name}: ${s.objective.name}`;
  if (!npc) return s.name;
  return s.kind === "turnin" ? `${s.name} → ${npc.sourceName}` : `${s.name} · ${npc.sourceName}`;
}

const nextLevel = (state: SimState | undefined) => (state ? String(Math.min(state.level + 1, MAX_LEVEL)) : "");

function useTarget(state: SimState | undefined) {
  const [text, setText] = useState(() => nextLevel(state));
  const target = parseLevelTarget(text.replaceAll(" ", ""));
  const error = text.trim() && !target ? "Enter a level from 1 to 60, as 8, 8+1200, or 8.5." : undefined;
  return { text, setText, target, error };
}

const gapTo = (rules: GameRules, state: SimState, target: LevelTarget) => targetXp(rules, target) - totalXp(rules, state.level, state.xp);

function GrindPanel(props: {
  simulated: Simulated | undefined;
  initialMob: number | undefined;
  onAdd: (target: LevelTarget, mob: Entity | undefined) => void;
}) {
  const { simulated } = props;
  const names = useEntityNames();
  const { text, setText, target, error } = useTarget(simulated?.state);
  const initial = props.initialMob === undefined ? undefined : (names.lookup("npc", props.initialMob) ?? undefined);
  const [query, setQuery] = useState(initial?.name ?? "");
  const [mob, setMob] = useState<Entity | undefined>(initial);
  const [active, setActive] = useState(0);
  const id = useId();
  const found = (!mob && query.trim() && names.search("npc", query, 20)) || [];
  const current = found.length > 0 ? Math.min(active, found.length - 1) : -1;
  const choose = (entity: Entity) => {
    setMob(entity);
    setQuery(entity.name);
  };
  const levels = mob && simulated?.sim.npc(mob.id)?.levels;
  const estimate = simulated && target && mob ? grindEstimate(simulated.state, target, mob.id, simulated.sim, simulated.killXp) : undefined;
  const listId = `${id}-options`;

  return (
    <div className="add-form">
      <Field label="Target .xp" error={error}>
        <Input mono value={text} spellCheck={false} autoComplete="off" onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Mob">
        <Input
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="NPC name or ID"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={found.length > 0}
          aria-controls={found.length > 0 ? listId : undefined}
          aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setMob(undefined);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && found.length > 0) {
              e.preventDefault();
              setActive(moveActive(e.key, current, found.length));
            } else if (e.key === "Enter" && current >= 0) {
              e.preventDefault();
              choose(found[current]!);
            }
          }}
        />
      </Field>
      {found.length > 0 && (
        <OptionList
          id={listId}
          label="NPC results"
          className="add-wide"
          options={found.map((entity) => ({
            key: String(entity.id),
            label: (
              <>
                <span className="option-name">{entity.name}</span> <span className="option-id">#{entity.id}</span>
              </>
            ),
          }))}
          active={current}
          onChoose={(i) => choose(found[i]!)}
        />
      )}
      {!mob && query.trim() && found.length === 0 && <p className="muted add-wide">{names.status("npc") ?? "No NPC matches."}</p>}
      <p className="add-wide" role="status">
        {simulated && target && (
          <>
            {mob && `${mob.name}${levels ? ` (Lv ${levels.min === levels.max ? levels.min : `${levels.min}–${levels.max}`})` : ""}: `}
            {number(estimate?.xpNeeded ?? Math.max(0, gapTo(simulated.sim.rules, simulated.state, target)))} xp
            {estimate && (estimate.kills === null ? " · kills unknown for this mob" : ` · about ${number(estimate.kills)} kills`)}
            {!mob && " · choose a mob to count kills"}
          </>
        )}
      </p>
      {estimate?.xpPerKill && (
        <p className="add-wide muted">
          {number(estimate.xpPerKill.min)}
          {estimate.xpPerKill.max !== estimate.xpPerKill.min ? `–${number(estimate.xpPerKill.max)}` : ""} XP per kill at your current level.
          {simulated?.killXp.multiplier !== undefined && ` Guide multiplier: × ${simulated.killXp.multiplier}.`}
        </p>
      )}
      <p className="add-wide muted">Adds a step with the .xp line{mob ? " and the mob" : ""}.</p>
      <div className="add-actions">
        <Button variant="primary" disabled={!target} onClick={() => target && props.onAdd(target, mob)}>
          Add
        </Button>
      </div>
    </div>
  );
}

function CheckpointPanel(props: {
  state: SimState | undefined;
  after: number | null;
  skipped: boolean;
  onAdd: (target: LevelTarget) => void;
}) {
  const { state } = props;
  const rules = useGameData()?.rules;
  const { text, setText, target, error } = useTarget(state);
  const id = useId();
  const gap = state && target && rules ? gapTo(rules, state, target) : undefined;
  const to = target && formatLevelTarget(target);
  return (
    <div className="add-form">
      <Field label={<Mono>-- @sim level=</Mono>} error={error}>
        <Input
          mono
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={error ? undefined : `${id}-note`}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <p id={`${id}-note`} className="add-wide" role="status">
        {gap === undefined
          ? "Jumps the simulated level to the target and reports the gap."
          : gap > 0
            ? `Jumps to ${to} and reports the gap: ${number(gap)} xp not accounted for.`
            : gap < 0
              ? `${to} is ${number(-gap)} xp behind the simulated level; the simulation reports it.`
              : `The simulated level is already ${to}.`}
      </p>
      <p className="add-wide muted">
        Adds the line{" "}
        {props.after === null
          ? "to the header"
          : props.skipped
            ? `in a new step: the character skips step ${props.after + 1}`
            : `at the end of step ${props.after + 1}`}
        .
      </p>
      <div className="add-actions">
        <Button variant="primary" disabled={!target} onClick={() => target && props.onAdd(target)}>
          Add
        </Button>
      </div>
    </div>
  );
}
