import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { bodyIndent, describeLine, getLines, insertLine, type BodyLine, type GuideDocument, type LineHome } from "../guide/index.ts";
import { BuiltinHint } from "./BuiltinGuides.tsx";
import { lineFace, type RowNames } from "../rules/index.ts";
import { useEditor, useEditorStore, useGameData, useRowNames } from "./context.ts";
import {
  applyRawDraft,
  changeRawDraft,
  discardRawDraft,
  editSection,
  hasRawDraft,
  RAW_DRAFT,
  sectionOwner,
  subscribeDrafts,
} from "./drafts.ts";
import { usePendingAction } from "./effects.ts";
import { DraftScope, useDraft } from "./fields.tsx";
import { CopyTextButton, GuideSource } from "./GuideSource.tsx";
import { GuideText } from "./GuideText.tsx";
import { Icon } from "./icons.tsx";
import { EDITOR_TABS, useEditorPanel, useLayout, useLayoutStore, type DockTab, type EditorNavigation } from "./layout.ts";
import { AddLineMenu, LineEditor, LineTitle } from "./LineFields.tsx";
import { objectiveColor, stepObjectives, type StepObjective } from "./map/points.ts";
import { useWorldMapStore, type HighlightBy } from "./map/worldMapStore.ts";
import { useFaction } from "./preview/settings.ts";
import { sectionText } from "./sections.ts";
import { SimulationFields } from "./SimulationFields.tsx";
import { StepSettings } from "./StepSettings.tsx";
import { Button, IconButton } from "./ui/Button.tsx";
import { Checkbox } from "./ui/Checkbox.tsx";
import { TextArea } from "./ui/Field.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ItemButton } from "./ui/ItemButton.tsx";
import { Tab } from "./ui/Tab.tsx";
import { Mono } from "./ui/Text.tsx";
import type { DocOp, Selection } from "./store.ts";

export type Commit = (op: DocOp, selection?: Selection, line?: number) => string | null;

interface PanelProps {
  doc: GuideDocument;
  step: number | null;
  selectedLine: number | null;
}

const PANELS: Record<DockTab, (props: PanelProps) => ReactNode> = {
  lines: LinesPanel,
  settings: SettingsPanel,
  simulation: SimulationPanel,
  raw: RawEditor,
  guide: GuideTextPanel,
};

const tabId = (tab: DockTab) => `dock-tab-${tab}`;
const OPEN_EDITOR_ID = "open-editor";

export function EditorDock() {
  const { current, selection } = useEditor();
  const layoutStore = useLayoutStore();
  const layout = useLayout();
  const body = useRef<HTMLDivElement>(null);
  const step = selection.step;
  const tabs = EDITOR_TABS.filter((t) => step !== null || t.header);
  const tab = tabs.some((t) => t.id === layout.dockTab) ? layout.dockTab : "lines";
  const rawWaits = useSyncExternalStore(subscribeDrafts, () => !!current && hasRawDraft(current, step));

  useLayoutEffect(() => {
    const navigation = layoutStore.takeEditorNavigation();
    if (navigation && body.current && current && navigation.guide === current.viewId) navigate(body.current, navigation, selection);
  }, [layoutStore, layout, current, selection]);

  const choose = (to: DockTab, focus = false) => {
    layoutStore.update({ dockTab: to });
    if (focus) document.getElementById(tabId(to))?.focus();
  };
  const close = () => {
    flushSync(() => layoutStore.closeEditor());
    document.getElementById(OPEN_EDITOR_ID)?.focus();
  };
  const onTabKey = (e: KeyboardEvent) => {
    const at = tabs.findIndex((t) => t.id === tab);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    choose(tabs[(to + tabs.length) % tabs.length]!.id, true);
  };

  if (!current) return null;
  const Panel = PANELS[tab];
  return (
    <section className="editor-dock panel" data-region="editor" aria-label="Editor">
      <div className="panel-head dock-head">
        <h2>
          {step === null ? (
            "Header"
          ) : (
            <>
              Step <Mono>{step + 1}</Mono>{" "}
              <span className="count">
                of <Mono>{current.doc.steps.length}</Mono>
              </span>
            </>
          )}
        </h2>
        <div className="dock-tabs" role="tablist" aria-label="Editor sections">
          {tabs.map((t) => (
            <Tab
              key={t.id}
              id={tabId(t.id)}
              selected={t.id === tab}
              controls="step-detail"
              size={32}
              aria-describedby={t.id === "raw" && rawWaits ? "dock-raw-waits" : undefined}
              onClick={() => choose(t.id)}
              onKeyDown={onTabKey}
            >
              {t.label}
              {t.id === "raw" && rawWaits && <span className="draft-mark" aria-hidden="true" />}
            </Tab>
          ))}
        </div>
        {rawWaits && (
          <span id="dock-raw-waits" className="sr-only">
            Raw draft not applied
          </span>
        )}
        <span className="spacer" />
        <Checkbox
          label="Syntax"
          aria-label="Show guide syntax"
          description="Show syntax, such as .goto, beside each name"
          checked={layout.showGuideSyntax}
          onChange={(e) => layoutStore.update({ showGuideSyntax: e.target.checked })}
        />
        <IconButton icon="x" label="Close editor" onClick={close} />
        {current.builtin && <BuiltinHint current={current} />}
      </div>
      <div
        ref={body}
        id="step-detail"
        className={`panel-body dock-body${tab === "guide" ? " text-view" : tab === "lines" ? " lines-view" : ""}`}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        data-tip-bounds
      >
        <DraftScope.Provider value={{ object: sectionOwner(current.doc, step), guide: current.id }}>
          <Panel key={`${current.viewId}:${step}`} doc={current.doc} step={step} selectedLine={selection.line} />
        </DraftScope.Provider>
      </div>
    </section>
  );
}

export function OpenEditorButton() {
  const layoutStore = useLayoutStore();
  const panel = useEditorPanel();
  if (panel !== "closed") return null;
  const open = () => {
    flushSync(() => layoutStore.openEditor());
    document.querySelector<HTMLElement>('.dock-tabs [aria-selected="true"]')?.focus();
  };
  return (
    <Button id={OPEN_EDITOR_ID} variant="ghost" onClick={open}>
      <Icon name="pen" /> Open editor
    </Button>
  );
}

function navigate(root: HTMLElement, navigation: EditorNavigation, selection: Selection) {
  const { step, line } = navigation.selection;
  const stale = step !== selection.step || line !== selection.line;
  if (stale) return;
  if (navigation.destination === "outline")
    root.querySelector(line === null ? ".outline [data-line]" : `.outline [data-line="${line}"]`)?.scrollIntoView?.({ block: "nearest" });
  else
    (
      root.querySelector<HTMLElement>(`.line-pane :is(input, select, textarea, [contenteditable="true"])`) ??
      root.querySelector<HTMLElement>(".line-pane button, .outline-add button")
    )?.focus();
}

/** Render outside the dock, so a closed editor never hides a notice. */
export function EditorNotices() {
  const { notice } = useEditor();
  if (!notice) return null;
  return (
    <div className="editor-notices">
      <p className="notice warn" role="status">
        {notice}
      </p>
    </div>
  );
}

function useCommit(step: number | null): Commit {
  const store = useEditorStore();
  return (op, selection, line) => {
    const result = editSection(store, step, op, selection, line);
    if (result.ok) return null;
    return result.reason === "opened" ? result.notice : result.error;
  };
}

function useObjectivePreview(owner: string) {
  const worldMap = useWorldMapStore();
  useEffect(
    () => () => {
      worldMap.unhighlight("hovered", owner);
      worldMap.unhighlight("focused", owner);
    },
    [worldMap, owner],
  );
  return (objective: StepObjective | undefined) => {
    if (!objective) return {};
    const on = (by: HighlightBy) => () => worldMap.highlight(by, owner, objective.key);
    const off = (by: HighlightBy) => () => worldMap.unhighlight(by, owner, objective.key);
    return {
      objective: objectiveColor(objective.color),
      onPointerEnter: on("hovered"),
      onPointerLeave: off("hovered"),
      onFocus: on("focused"),
      onBlur: off("focused"),
    };
  };
}

function OutlineSummary({ line, names }: { line: BodyLine; names: RowNames }) {
  const { mark, text } = lineFace(line, names);
  return (
    <span className="outline-summary">
      {"icon" in mark && <GuideText parts={[mark.icon]} links="plain" />}
      <span className="outline-text">
        <GuideText parts={text} links="plain" />
      </span>
    </span>
  );
}

function LinesPanel({ doc, step, selectedLine }: PanelProps) {
  const commit = useCommit(step);
  const store = useEditorStore();
  const layoutStore = useLayoutStore();
  const lines = getLines(doc, step);
  const data = useGameData();
  const rowNames = useRowNames();
  const faction = useFaction();
  const stepObject = step === null ? undefined : doc.steps[step];
  const objectives = useMemo(
    () => (data && stepObject ? stepObjectives(data, stepObject, faction) : undefined),
    [data, stepObject, faction],
  );
  const preview = useObjectivePreview(`${useContext(DraftScope)!.guide}:${step}`);
  const focusLine = useRef<number | null>(null);
  const pane = useRef<HTMLDivElement>(null);

  usePendingAction(focusLine, (at) =>
    pane.current?.querySelector<HTMLElement>(`[data-line="${at}"] :is(input, select, textarea, [contenteditable="true"])`)?.focus(),
  );

  const section = step === null ? "header" : "step";
  const rows = lines.map((line, index) => ({ line, index, described: describeLine(line, section) }));
  const shown = selectedLine ?? rows.find((r) => r.described.home === "lines")?.index ?? null;
  const row = shown === null ? undefined : rows[shown];
  const indent = step === null ? "" : bodyIndent(doc);
  const insert = (at: number) => (make: (indent: string) => BodyLine) => {
    const error = commit((d) => insertLine(d, { step, index: at }, make(indent)), { step, line: at });
    if (!error) focusLine.current = at;
    return error;
  };
  const open = (tab: LineHome) => layoutStore.update({ dockTab: tab });
  const homes = new Set(rows.map((r) => r.described.home));

  return (
    <div className="lines-panel">
      <div className="outline">
        <ol aria-label={step === null ? "Header lines" : "Lines"}>
          {rows.map(({ line, index, described }) => (
            <li key={index} data-line={index}>
              <AddLineMenu
                className="outline-gap"
                icon="plus"
                label={index === 0 ? "Insert a line first" : `Insert a line before line ${index + 1}`}
                description="Insert a line here."
                onAdd={insert(index)}
              />
              <ItemButton
                className="outline-row"
                aria-current={index === shown ? "true" : undefined}
                onClick={() => store.select({ step, line: index })}
                {...preview(objectives?.get(index))}
              >
                <span className="outline-title">
                  <LineTitle title={described.title} syntax={described.syntax} />
                </span>
                <OutlineSummary line={line} names={rowNames} />
              </ItemButton>
            </li>
          ))}
        </ol>
        <AddLineMenu
          className="outline-add"
          label="Add line"
          description={`Add a line at the end of the ${section}.`}
          onAdd={insert(lines.length)}
        />
      </div>
      <div className="line-pane" ref={pane}>
        {row ? (
          <LineEditor
            key={row.index}
            line={row.line}
            pos={{ step, index: row.index }}
            last={row.index === lines.length - 1}
            indent={indent}
            commit={commit}
            open={open}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={`No lines in this ${section}`} className="line-pane-empty">
            Choose Add line to add one.
          </EmptyState>
        ) : (
          <EmptyState
            title="This step has only settings or simulation lines"
            className="line-pane-empty"
            action={
              <>
                {homes.has("settings") && (
                  <Button variant="secondary" onClick={() => open("settings")}>
                    Open Step settings
                  </Button>
                )}
                {homes.has("simulation") && (
                  <Button variant="secondary" onClick={() => open("simulation")}>
                    Open XP simulation
                  </Button>
                )}
              </>
            }
          >
            Open them in their own tab.
          </EmptyState>
        )}
        {step === null && <SimulationFields doc={doc} step={null} commit={commit} />}
      </div>
    </div>
  );
}

function SettingsPanel({ doc, step }: PanelProps) {
  const commit = useCommit(step);
  return step === null ? null : (
    <div className="step-form">
      <StepSettings doc={doc} step={step} lines={getLines(doc, step)} commit={commit} />
    </div>
  );
}

function SimulationPanel({ doc, step }: PanelProps) {
  const commit = useCommit(step);
  return (
    <div className="step-form">
      <SimulationFields doc={doc} step={step} commit={commit} />
    </div>
  );
}

function GuideTextPanel({ doc, step }: PanelProps) {
  const { current } = useEditor();
  if (!current) return null;
  return (
    <>
      <div className="text-actions">
        <CopyTextButton text={current.record.text} />
        <span className="muted">Read only. The highlighted lines are {step === null ? "the header" : `step ${step + 1}`}.</span>
      </div>
      <GuideSource text={current.record.text} doc={doc} step={step} />
    </>
  );
}

function RawEditor({ doc, step }: PanelProps) {
  const store = useEditorStore();
  const original = sectionText(doc, step);
  const [{ draft, error }] = useDraft(RAW_DRAFT);
  const label = step === null ? "Raw header text" : `Raw text of step ${step + 1}`;

  const apply = () => {
    applyRawDraft(store, step);
  };
  const revert = () => discardRawDraft(store, step);

  return (
    <div className="raw-editor">
      <TextArea
        aria-label={label}
        aria-invalid={error ? true : undefined}
        spellCheck={false}
        value={draft ?? original}
        rows={Math.min(30, Math.max(8, (draft ?? original).split("\n").length + 2))}
        onChange={(e) => changeRawDraft(store, step, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            revert();
          }
        }}
      />
      <div className="raw-actions">
        <Button variant="primary" onClick={apply} disabled={draft === null}>
          Apply
        </Button>
        <Button variant="secondary" onClick={revert} disabled={draft === null}>
          Revert
        </Button>
        <span className="muted">Ctrl+Enter applies. {step === null ? "" : "Several step lines split the step."}</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
