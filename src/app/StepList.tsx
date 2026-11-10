import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { deleteStep, insertStep, moveStep, type Step } from "../guide/index.ts";
import { GuideText } from "./GuideText.tsx";
import {
  describeGuideStatus,
  describeReason,
  formatLevelTarget,
  stepLabels,
  stepRow,
  stepSkipText,
  type FooterItem,
  type Profile,
  type RowNames,
  type SimState,
  type StepPreview,
  type StepSnapshot,
  type WhereItem,
} from "../rules/index.ts";
import { useEditor, useEditorStore, useGameData, useRowNames } from "./context.ts";
import { Described } from "./Described.tsx";
import { Icon, WarningMark } from "./icons.tsx";
import { useLayoutStore } from "./layout.ts";
import { IconButton } from "./ui/Button.tsx";
import { ArtButton } from "./ui/ItemButton.tsx";
import { Mono } from "./ui/Text.tsx";
import { Mark } from "./Mark.tsx";
import { useRoute } from "./preview/route.ts";
import { AddStepButton } from "./quests/AddStep.tsx";
import { useSettingsStore } from "./preview/settings.ts";
import { StateButton } from "./preview/StateButton.tsx";
import { StartPane } from "./StartPane.tsx";
import { useStepFilter } from "./preview/stepFilter.ts";
import { cardText, levelBands, shownSteps, stepXp, type LevelBand, type NoteNames, type SimCard } from "../rules/index.ts";
import { stepWarnings } from "./preview/warnings.ts";
import { useNoteNames } from "./simNotes.ts";
import { keyOptions, skipRuns, type SkipRun } from "./stepRuns.ts";

const DRAG_TYPE = "application/x-rxp-step";

export function StepList(props: { libraryOpen?: boolean }) {
  const { current, selection } = useEditor();
  const store = useEditorStore();
  const data = useGameData();
  const filter = useStepFilter();
  // The live route, so a warning's step index is an index of the document that the rows show.
  const route = useRoute(true);
  const settingsStore = useSettingsStore();
  const layoutStore = useLayoutStore();
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null);
  const [keyed, setKeyed] = useState(false);
  // An open run is kept by the objects of its steps: an index moves when a step before it changes, and one edited step
  // of the run gets a new object.
  const [open, setOpen] = useState<{ guide: string | undefined; steps: ReadonlySet<Step> }>({ guide: undefined, steps: new Set() });
  const warnings = useMemo(() => {
    const source = route?.records.findIndex((r) => r.id === current?.id) ?? -1;
    return route && data && source >= 0 ? stepWarnings(route, data, source) : new Map<number, string[]>();
  }, [route, data, current?.id]);
  const names = useNoteNames();
  const rowNames = useRowNames();
  const docSteps = current?.doc.steps;
  const labelProfile = filter?.profile;
  const labels = useMemo(
    () => (docSteps && labelProfile ? stepLabels(docSteps, labelProfile) : new Map<string, number>()),
    [docSteps, labelProfile],
  );
  const select = useCallback(
    (step: number | null) => {
      store.select({ step, line: null });
      layoutStore.openEditor();
    },
    [store, layoutStore],
  );
  const latest = useRef<{ drop: typeof drop; move: (from: number, to: number) => void; remove: (at: number) => void }>(null);
  const dropRow = useCallback((from: number) => {
    const { drop, move } = latest.current!;
    if (!drop) return;
    const target = drop.after ? drop.index + 1 : drop.index;
    move(from, from < target ? target - 1 : target);
    setDrop(null);
  }, []);
  const deleteRow = useCallback((at: number) => latest.current!.remove(at), []);
  const dragOver = useCallback(
    (next: { index: number; after: boolean } | null) =>
      setDrop((prev) => (prev && next && prev.index === next.index && prev.after === next.after ? prev : next)),
    [],
  );

  const simulated = filter?.simulation !== undefined;

  const selected = selection.step;
  const selectedId = selected === null ? "step-header" : `step-${selected}`;
  const showSelected = useCallback(() => {
    document.getElementById(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);
  useEffect(showSelected, [showSelected, current?.id]);

  if (!current) return <StartPane libraryOpen={props.libraryOpen ?? false} />;

  const { doc } = current;
  const count = doc.steps.length;
  const hidden = filter?.guide.hidden && describeReason(filter.guide.hidden, filter.profile);
  const skipped = filter ? count - shownSteps(filter.guide) : 0;
  const guideStatus = filter && describeGuideStatus(filter.guide, filter.profile);
  const skipOf = (i: number) => skipReason(filter?.guide.steps[i], hidden || undefined, filter?.stepProfiles[i], rowNames, labels);
  const simulation = hidden ? undefined : filter?.simulation;
  const bands = simulation && data ? levelBands(data.rules, simulation) : [];
  const openSteps = open.guide === current.id ? open.steps : new Set<Step>();
  const runs =
    filter && !filter.showAll
      ? skipRuns(
          count,
          (i) => skipOf(i) !== undefined,
          selected,
          (i) => openSteps.has(doc.steps[i]!),
        )
      : new Map<number, SkipRun>();
  const toggle = (first: number, show: boolean) => {
    const last = runs.get(first)!.last;
    // Without the steps that an edit replaced, which would open their run again when an undo brings them back.
    const steps = new Set(doc.steps.filter((step) => openSteps.has(step)));
    for (const step of doc.steps.slice(first, last + 1)) {
      if (show) steps.add(step);
      else steps.delete(step);
    }
    setOpen({ guide: current.id, steps });
    if (!show && selected !== null && selected > first && selected <= last) store.select({ step: first, line: null });
  };
  const runOf = (step: number) => [...runs].find(([first, { last }]) => step >= first && step <= last);
  const options = keyOptions(count, runs);
  const addStep = () => {
    const at = selected === null ? 0 : selected + 1;
    store.edit((d) => insertStep(d, at), { step: at, line: null });
  };
  const remove = (at: number) => {
    const step = selected === null || selected < at ? selected : selected === at ? Math.min(at, count - 2) : selected - 1;
    store.edit((d) => deleteStep(d, at), { step, line: null });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= count || from === to) return;
    store.edit((d) => moveStep(d, from, to), { step: to, line: null });
  };
  latest.current = { drop, move, remove };

  const row = (i: number) => (
    <StepRow
      key={i}
      index={i}
      step={doc.steps[i]!}
      warnings={warnings.get(i)}
      preview={filter?.guide.steps[i]}
      guideHidden={hidden || undefined}
      profile={filter?.stepProfiles[i]}
      snapshot={simulation?.steps[i]}
      before={simulation?.steps[i]?.before}
      names={names}
      rowNames={rowNames}
      labels={labels}
      showAll={filter?.showAll ?? true}
      selected={selected === i}
      cardOpen={keyed && selected === i}
      drop={drop?.index === i ? (drop.after ? "after" : "before") : undefined}
      onSelect={select}
      onDrag={dragOver}
      onDrop={dropRow}
      onDelete={deleteRow}
    />
  );
  const rows: ReactNode[] = [];
  const bandRows = (first: number, last: number) =>
    bands.flatMap((b, k) => (b.after >= first && b.after <= last ? [<BandRow key={`band-${k}`} band={b} />] : []));
  for (let i = 0; i < count; i++) {
    const run = runs.get(i);
    if (!run) {
      rows.push(row(i), ...bandRows(i, i));
      continue;
    }
    const first = i;
    i = run.last;
    const fold = (
      <FoldRow
        key={`fold-${first}`}
        first={first}
        last={run.last}
        reasons={[...new Set(Array.from({ length: run.last - first + 1 }, (_, j) => skipOf(first + j)!))].join("; ")}
        folded={run.folded}
        selected={run.folded && selected === first}
        drop={drop?.index === first && !drop.after ? "before" : drop?.index === run.last && drop.after ? "after" : undefined}
        onSelect={select}
        onToggle={(show) => toggle(first, show)}
        onDrag={dragOver}
        onDrop={dropRow}
      />
    );
    if (run.folded) {
      rows.push(fold, ...bandRows(first, run.last));
      continue;
    }
    const steps: ReactNode[] = [fold];
    for (let j = first; j <= run.last; j++) steps.push(row(j));
    rows.push(
      <div key={`run-${first}`} role="group" aria-labelledby={`run-${first}`}>
        {steps}
      </div>,
      ...bandRows(first, run.last),
    );
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const at = selected === null ? -1 : options.indexOf(selected);
    const to = (at: number) => select(at < 0 || options.length === 0 ? null : options[Math.min(at, options.length - 1)]!);
    const run = selected === null ? undefined : runOf(selected);
    let handled = true;
    if (e.altKey && e.key === "ArrowUp" && selected !== null) move(selected, selected - 1);
    else if (e.altKey && e.key === "ArrowDown" && selected !== null) move(selected, selected + 1);
    else if (e.key === "ArrowUp") to(at - 1);
    else if (e.key === "ArrowDown") to(at + 1);
    else if (e.key === "PageUp") to(at - 20);
    else if (e.key === "PageDown") to(at + 20);
    else if (e.key === "Home") select(null);
    else if (e.key === "End") to(options.length - 1);
    else if (e.key === "ArrowRight" && run?.[1].folded) toggle(run[0], true);
    else if (e.key === "ArrowLeft" && run && !run[1].folded) toggle(run[0], false);
    else if (e.key === "Insert") addStep();
    else if (e.key === "Delete" && selected !== null) remove(selected);
    else if (e.key === "Enter" && current) layoutStore.revealEditor({ guide: current.viewId, selection, destination: "editor" });
    else handled = false;
    if (handled) e.preventDefault();
  };

  return (
    <section className="region-steps panel" data-region="steps" aria-label="Steps">
      <div className="panel-head">
        <h2>
          Steps{" "}
          {skipped > 0 ? (
            <Described text={`${skipped} skipped for the preview character`}>
              <span className="count">
                <Mono>{count - skipped}</Mono> of <Mono>{count}</Mono>
              </span>
            </Described>
          ) : (
            <span className="count">
              <Mono>{count}</Mono>
            </span>
          )}
        </h2>
        <span className="step-tools">
          <IconButton
            icon={filter?.showAll ? "eye" : "eyeOff"}
            label="Show skipped steps"
            description="Show what the preview character skips"
            pressed={filter?.showAll ?? false}
            onClick={() => settingsStore.update({ showAll: !filter?.showAll })}
          />
          {filter ? (
            <AddStepButton
              after={selected}
              skipped={selected !== null && skipOf(selected) !== undefined}
              simulation={filter.simulation}
              profile={filter.profile}
              onBlank={addStep}
            />
          ) : (
            <IconButton icon="plus" label="Add step" description="Add after the selected step (Insert)" onClick={addStep} />
          )}
          <IconButton
            icon="up"
            label="Move step up"
            description="Move step up (Alt+Up)"
            disabled={!selected}
            onClick={() => selected !== null && move(selected, selected - 1)}
          />
          <IconButton
            icon="down"
            label="Move step down"
            description="Move step down (Alt+Down)"
            disabled={selected === null || selected >= count - 1}
            onClick={() => selected !== null && move(selected, selected + 1)}
          />
          <StateButton />
        </span>
      </div>
      <div
        className={`panel-body step-list${simulated ? " simulated" : ""}`}
        data-tip-bounds
        role="listbox"
        aria-label={`Steps of ${current.name || "guide"}`}
        tabIndex={0}
        aria-activedescendant={selectedId}
        onFocus={(e) => e.target === e.currentTarget && e.target.matches(":focus-visible") && showSelected()}
        onKeyDown={(e) => {
          setKeyed(true);
          onKeyDown(e);
        }}
        onPointerDown={() => setKeyed(false)}
        onBlur={() => setKeyed(false)}
        onDragLeave={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setDrop(null);
        }}
      >
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- The listbox takes the keys and points at the active option. */}
        <div
          id="step-header"
          role="option"
          aria-selected={selected === null}
          className={`step-row header-row${selected === null ? " selected" : ""}`}
          onClick={() => select(null)}
        >
          <span className="step-no">H</span>
          <span className="step-main">
            <span className="step-note">Header · {current.name || "(no #name)"}</span>
            {guideStatus && <span className="step-skip">{guideStatus}</span>}
          </span>
        </div>
        {bandRows(-1, -1)}
        {rows}
      </div>
    </section>
  );
}

function skipReason(
  preview: StepPreview | undefined,
  guideHidden: string | undefined,
  profile: Profile | undefined,
  names: RowNames,
  labels: ReadonlyMap<string, number>,
): string | undefined {
  if (guideHidden !== undefined) return `the guide never runs (${guideHidden})`;
  return preview && !preview.shown && profile ? stepSkipText(preview.reason!, profile, names, labels) : undefined;
}

function FoldRow(props: {
  first: number;
  last: number;
  reasons: string;
  folded: boolean;
  selected: boolean;
  drop: "before" | "after" | undefined;
  onSelect: (index: number) => void;
  onToggle: (show: boolean) => void;
  onDrag: (drop: { index: number; after: boolean } | null) => void;
  onDrop: (from: number) => void;
}) {
  const { first, last, folded, selected, drop } = props;
  const range = `Steps ${first + 1}–${last + 1}`;
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Folded, an option of the listbox, which takes the keys.
    <div
      id={folded ? `step-${first}` : undefined}
      role={folded ? "option" : undefined}
      aria-selected={folded ? selected : undefined}
      className={`step-row step-fold${folded ? " step-skipped collapsed" : ""}${selected ? " selected" : ""}${drop ? ` drop-${drop}` : ""}`}
      onClick={folded ? () => props.onSelect(first) : undefined}
      onDragOver={
        folded
          ? (e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              props.onDrag(e.clientY > box.top + box.height / 2 ? { index: last, after: true } : { index: first, after: false });
            }
          : undefined
      }
      onDrop={
        folded
          ? (e) => {
              const from = e.dataTransfer.getData(DRAG_TYPE);
              if (from === "") return;
              e.preventDefault();
              props.onDrop(Number(from));
            }
          : undefined
      }
    >
      <span className="step-no">
        <IconButton
          icon="disclosure"
          label={range}
          description={folded ? "Show each step (Right)" : "Fold the steps (Left)"}
          className="fold-toggle"
          tabIndex={-1}
          aria-hidden={folded || undefined}
          expanded={!folded}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle(folded);
          }}
        />
      </span>
      <span className="step-main">
        <Described text={`${range} skipped · ${props.reasons}`} clipped>
          <span className="step-skip" id={folded ? undefined : `run-${first}`}>
            {range} skipped · {props.reasons}
          </span>
        </Described>
        {/* An option's content is plain text to screen readers, so it names the key instead of the toggle. */}
        {folded && <span className="sr-only"> · Right arrow shows each step</span>}
      </span>
    </div>
  );
}

const StepRow = memo(function StepRow(props: {
  index: number;
  step: Step;
  warnings: readonly string[] | undefined;
  preview: StepPreview | undefined;
  guideHidden: string | undefined;
  profile: Profile | undefined;
  snapshot: StepSnapshot | undefined;
  before: SimState | undefined;
  names: NoteNames;
  rowNames: RowNames;
  labels: ReadonlyMap<string, number>;
  showAll: boolean;
  selected: boolean;
  cardOpen: boolean;
  drop: "before" | "after" | undefined;
  onSelect: (index: number) => void;
  onDrag: (drop: { index: number; after: boolean } | null) => void;
  onDrop: (from: number) => void;
  onDelete: (index: number) => void;
}) {
  const { index, step, warnings, selected, drop, preview, guideHidden, profile, showAll, rowNames, labels } = props;
  const skip = skipReason(preview, guideHidden, profile, rowNames, labels);
  const collapsed = skip !== undefined && !showAll;
  const warned = !collapsed && warnings !== undefined;
  const snapshot = skip === undefined ? props.snapshot : undefined;
  const row = useMemo(
    () =>
      stepRow(step, {
        names: rowNames,
        character: preview && profile ? { preview, profile } : undefined,
        labels,
        showSkipped: showAll,
        checkpoints: (snapshot?.checkpoints ?? []).flatMap(({ at: { line }, kind, target }) =>
          kind === "level" && line !== undefined ? [{ line, level: formatLevelTarget(target) }] : [],
        ),
      }),
    [step, rowNames, preview, profile, labels, showAll, snapshot],
  );
  const { does, where, notes, footer } = row;
  const waypointCount = (n: number) => `${n} waypoint${n === 1 ? "" : "s"}`;
  const items = (list: readonly WhereItem[]) =>
    list.map((item, i) => [i > 0 && ", ", <Skippable key={item.line} className="where-item" item={item} content={item.label} />]);
  const hasWhere =
    where.places.length + where.waypoints.shown + where.waypoints.skipped.length + where.targets.length + where.mobs.length > 0;
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- The listbox takes the keys and points at the active option.
    <div
      id={`step-${index}`}
      role="option"
      aria-selected={selected}
      className={`step-row${selected ? " selected" : ""}${drop ? ` drop-${drop}` : ""}${skip ? " step-skipped" : ""}${collapsed ? " collapsed" : ""}`}
      draggable
      onClick={() => props.onSelect(index)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(index));
        e.dataTransfer.effectAllowed = "move";
        props.onSelect(index);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        props.onDrag({ index, after: e.clientY > box.top + box.height / 2 });
      }}
      onDragEnd={() => props.onDrag(null)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(DRAG_TYPE);
        if (from === "") return;
        e.preventDefault();
        props.onDrop(Number(from));
      }}
    >
      <Described text={skip !== undefined && !collapsed ? `Skipped: ${skip}` : undefined}>
        <span className="step-no">{index + 1}</span>
      </Described>
      <span className="step-side">
        {snapshot && props.before && (
          <XpRing step={step} before={props.before} snapshot={snapshot} names={props.names} cardOpen={props.cardOpen} />
        )}
        {warned && <WarningBadge warnings={warnings} />}
        {/* An option's content is plain text to screen readers; they use the Delete key instead. */}
        <IconButton
          icon="trash"
          label={`Delete step ${index + 1}`}
          description="Delete step"
          className="step-delete"
          tabIndex={-1}
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete(index);
          }}
        />
      </span>
      <span className="step-main">
        {collapsed ? (
          <Described text={`Skipped · ${skip}`} clipped>
            <span className="step-skip">Skipped · {skip}</span>
          </Described>
        ) : (
          skip !== undefined && <span className="sr-only">Skipped: {skip}</span>
        )}
        {!collapsed && does.length > 0 && (
          <span className="step-does">
            {does.map((line) => (
              <Skippable
                key={line.line}
                className="row-line"
                item={line}
                content={
                  <>
                    <Mark mark={line.mark} />
                    <span className="row-text">
                      <GuideText parts={line.text} links="plain" />
                    </span>
                  </>
                }
              />
            ))}
          </span>
        )}
        {!collapsed && hasWhere && (
          <span className="step-where">
            {where.places.length > 0 && (
              <WherePart mark={<Mark mark={{ kind: "goto" }} />} verb="Go to ">
                {where.places.map((place, i) => [
                  i > 0 && " →\u00a0",
                  <Skippable
                    key={place.line}
                    className="where-item"
                    item={place}
                    content={<GuideText parts={place.text} links="plain" />}
                  />,
                ])}
              </WherePart>
            )}
            {where.waypoints.shown + where.waypoints.skipped.length > 0 && (
              <WherePart mark={<Icon name="route" size={13} />}>
                {where.waypoints.shown > 0 && waypointCount(where.waypoints.shown)}
                {where.waypoints.skipped.map(({ reason, line, count }, i) => [
                  (where.waypoints.shown > 0 || i > 0) && ", ",
                  <Skippable
                    key={line}
                    className="where-item"
                    item={{ skipped: reason }}
                    content={where.waypoints.shown > 0 ? `${count} skipped` : waypointCount(count)}
                  />,
                ])}
              </WherePart>
            )}
            {where.targets.length > 0 && (
              <WherePart mark={<Mark mark={{ kind: "target" }} />} verb="Target ">
                {items(where.targets)}
              </WherePart>
            )}
            {where.mobs.length > 0 && (
              <WherePart mark={<Mark mark={{ kind: "kill" }} />} verb="Mobs ">
                {items(where.mobs)}
              </WherePart>
            )}
          </span>
        )}
        {!collapsed && notes.length > 0 && (
          <span className="step-notes">
            {notes.map((note) => (
              <Skippable
                key={note.line}
                className="row-line"
                item={note}
                content={
                  <>
                    <Mark mark={note.mark} />
                    <span className="row-text">
                      <GuideText parts={note.text} links="plain" />
                    </span>
                  </>
                }
              />
            ))}
          </span>
        )}
        {!collapsed && footer.length > 0 && <StepFooter items={footer} />}
        {warned && (
          <span className="sr-only">
            {" "}
            · {warningCount(warnings.length)}: {warnings.join("; ")}
          </span>
        )}
      </span>
    </div>
  );
});

const warningCount = (n: number) => `${n} warning${n === 1 ? "" : "s"}`;

function WarningBadge({ warnings }: { warnings: readonly string[] }) {
  return (
    <Described text={warnings.join("\n")} pin>
      <ArtButton
        className="step-warn-badge"
        tabIndex={-1}
        aria-hidden
        aria-label={warningCount(warnings.length)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <WarningMark />
      </ArtButton>
    </Described>
  );
}

function Skippable(props: { className: string; item: { skipped?: string }; content: ReactNode; description?: string | undefined }) {
  const reason = props.item.skipped;
  return (
    <Described text={reason === undefined ? props.description : `Skipped: ${reason}`}>
      <span className={reason === undefined ? props.className : `${props.className} line-skipped`}>
        {props.content}
        {reason !== undefined && <span className="sr-only"> (skipped: {reason})</span>}
      </span>
    </Described>
  );
}

function StepFooter({ items }: { items: readonly FooterItem[] }) {
  const settings = items.every((item) => item.kind === "setting");
  return (
    <span className={`step-footer${settings ? " only-settings" : ""}`}>
      <span className="foot-text">
        {items.map((item, i) => (
          <Skippable
            key={`${item.kind}-${item.line}`}
            className={`foot-item foot-${item.kind}`}
            item={item}
            description={item.hint}
            content={
              <>
                {i > 0 && (
                  <span className="foot-sep">
                    <span className="sr-only">, </span>
                    <span aria-hidden="true">·</span>
                  </span>
                )}
                <GuideText parts={item.text} links="plain" />
              </>
            }
          />
        ))}
      </span>
    </span>
  );
}

function WherePart(props: { mark: ReactNode; verb?: string; children: ReactNode }) {
  return (
    <span className="where-part">
      <span className="where-mark">{props.mark}</span>
      <span className="where-text">
        {props.verb && <span className="sr-only">{props.verb}</span>}
        {props.children}
      </span>
    </span>
  );
}

function XpRing(props: { step: Step; before: SimState; snapshot: StepSnapshot; names: NoteNames; cardOpen: boolean }) {
  const rules = useGameData()?.rules;
  if (!rules) return null;
  const xp = stepXp(rules, props.before, props.snapshot, props.names, props.step);
  const arcs = ringArcs([
    ["before", xp.before],
    ["earned", xp.earned],
    ["jump", xp.jump],
  ]);
  return (
    <>
      <Described text={<SimCards cards={[xp.card, ...xp.notes]} />} open={props.cardOpen} pin>
        <ArtButton
          className={`sim-ring${xp.dinged ? " dinged" : ""}`}
          tabIndex={-1}
          aria-hidden
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="sim-arcs" viewBox="0 0 24 24">
            <circle className="track" cx="12" cy="12" r="9" />
            {xp.dinged && <circle className="fill" cx="12" cy="12" r="7" />}
            {arcs.map(({ kind, from, to }) => (
              <circle
                key={kind}
                className={kind}
                cx="12"
                cy="12"
                r="9"
                pathLength={100}
                strokeDasharray={`${to - from} 100`}
                strokeDashoffset={-from}
              />
            ))}
          </svg>
          <span className="sim-level">{xp.level}</span>
          {xp.checkpoint && <Icon name="upToBar" size={12} className="sim-jump" />}
          {xp.mark && <span className={`sim-mark ${xp.mark}`}>{xp.mark === "killsLater" && "!"}</span>}
        </ArtButton>
      </Described>
      <span className="sr-only"> · {xp.label} · </span>
      {xp.notes.length > 0 && <span className="sr-only">{xp.notes.map(cardText).join("\n")} · </span>}
      <LevelMark level={xp.dinged ? xp.level : undefined} showLevel={false} />
    </>
  );
}

type ArcKind = "before" | "earned" | "jump";

/** The tuned shortest arc, in percent of the ring: shorter arcs read as a notch. */
const MIN_ARC = 6;

/**
 * Lays the ring's arcs end to end, in percent of the ring, from their shares
 * of the level. An arc shorter than `MIN_ARC` keeps its end and takes the
 * length from the arc before it, so the ring's total stays true and never
 * drops from one step to the next. Only a total below `MIN_ARC` grows. A
 * first arc left shorter than `MIN_ARC` joins the arc after it.
 */
export function ringArcs(shares: readonly (readonly [ArcKind, number])[]) {
  const arcs: { kind: ArcKind; from: number; to: number }[] = [];
  let at = 0;
  for (const [kind, share] of shares) {
    if (share > 0) arcs.push({ kind, from: at * 100, to: (at + share) * 100 });
    at += share;
  }
  let next = Infinity;
  for (let i = arcs.length - 1; i >= 0; i--) {
    const arc = arcs[i]!;
    arc.to = Math.min(Math.max(arc.to, MIN_ARC), next);
    arc.from = Math.max(0, Math.min(arc.from, arc.to - MIN_ARC));
    next = arc.from;
  }
  const shown = arcs.filter((arc) => arc.to > arc.from);
  const [first, second] = shown;
  if (first && second && first.to - first.from < MIN_ARC) {
    second.from = first.from;
    shown.shift();
  }
  return shown;
}

function BandRow({ band }: { band: LevelBand }) {
  const rest = 1 - band.segments.reduce((sum, s) => sum + s.share, 0);
  return (
    <div className="level-band" aria-hidden="true">
      <span className="band-head">
        <span className="band-level">
          Level <Mono>{band.level}</Mono>
        </span>
        {band.detail.length > 0 && (
          <span className="band-detail">
            <GuideText parts={band.detail} links="plain" />
          </span>
        )}
      </span>
      <span className="band-bar">
        {band.segments.map((s, i) => (
          <Described key={i} text={s.text}>
            <span className={`band-part ${s.kind}`} style={{ "--share": s.share }} />
          </Described>
        ))}
        {rest > 0.001 && <span className="band-part rest" style={{ "--share": rest }} />}
      </span>
    </div>
  );
}

export function SimCards({ cards }: { cards: readonly SimCard[] }) {
  return (
    <span className="sim-cards">
      <span className="sr-only">{cards.map(cardText).join("\n")}</span>
      {cards.map((card, i) => (
        <span key={i} className="sim-card" aria-hidden="true">
          <span className="sim-card-head">
            <strong>{card.title}</strong>
            {card.value && (
              <span className="sim-card-value">
                <GuideText parts={card.value} links="plain" />
              </span>
            )}
          </span>
          {card.mobs && card.mobs.length > 0 && (
            <span className="sim-card-mobs">
              {card.mobs.map((m, j, mobs) => (
                <Fragment key={j}>
                  <span>{m.name === mobs[j - 1]?.name ? "" : m.name}</span>
                  <span className="sim-card-muted">Lv {m.level}</span>
                  <span className="sim-card-count">{m.kills !== undefined && `×${m.kills.toLocaleString("en-US")}`}</span>
                </Fragment>
              ))}
            </span>
          )}
          {card.rows.length > 0 && (
            <span className="sim-card-rows">
              {card.rows.map((r, j) => (
                <Fragment key={j}>
                  <span className="sim-card-muted">{r.label}</span>
                  <span>
                    <GuideText parts={r.value} links="plain" />
                  </span>
                </Fragment>
              ))}
            </span>
          )}
          {card.levels?.map((l) => (
            <span key={l.level} className="sim-card-level">
              <LevelMark level={l.level} /> {l.at}
            </span>
          ))}
          {card.note && <span className="sim-card-muted">{card.note}</span>}
        </span>
      ))}
    </span>
  );
}

export function LevelMark({ level, showLevel = true }: { level: number | undefined; showLevel?: boolean }) {
  if (level === undefined) return null;
  return (
    <span className="level-mark">
      <span aria-hidden="true">{showLevel ? `DING ${level}` : "DING"}</span>
      <span className="sr-only"> · reaches level {level}</span>
    </span>
  );
}
