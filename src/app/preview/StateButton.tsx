import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { QUEST_LOG_SIZE, type GuideSimulation, type QuestProgress, type SimData, type SimQuest, type SimState } from "../../rules/index.ts";
import type { GameRules } from "../../data/index.ts";
import { xpToNextLevel } from "../../rules/xp.ts";
import { useEditor } from "../context.ts";
import { useLayout } from "../layout.ts";
import { useSimData } from "./route.ts";
import { usePreviewSettings } from "./settings.ts";
import { useStepFilter } from "./stepFilter.ts";
import { DisclosureIcon, IconButton } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Mono } from "../ui/Text.tsx";
import "./state.css";

export function levelPercent(rules: GameRules, state: Pick<SimState, "level" | "xp">): number | null {
  const need = xpToNextLevel(rules, state.level);
  return need > 0 ? Math.floor((state.xp / need) * 100) : null;
}

export function StateButton() {
  const filter = useStepFilter();
  const sim = useSimData(usePreviewSettings());
  const [open, setOpen] = useState(false);
  const windowId = useId();
  const button = useRef<HTMLButtonElement>(null);
  if (!filter?.simulation || !sim) return null;

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Catches Escape from the button and window inside.
    <span
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <IconButton
        ref={button}
        icon="user"
        label="State"
        description="Simulated character after the selected step"
        popoverOpen={open}
        aria-controls={open ? windowId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && <StateWindow id={windowId} anchor={button.current!} simulation={filter.simulation} sim={sim} onClose={close} />}
    </span>
  );
}

function StateWindow(props: { id: string; anchor: HTMLElement; simulation: GuideSimulation; sim: SimData; onClose: () => void }) {
  const { simulation, sim } = props;
  const { selection } = useEditor();
  const { stepsWidth } = useLayout();
  const [place, setPlace] = useState<{ x: string; y: string; w: string; h: string }>();

  useLayoutEffect(() => {
    const placeUnder = () => {
      const box = props.anchor.getBoundingClientRect();
      const width = Math.min(400, innerWidth - 16);
      const top = box.bottom + 8;
      setPlace({
        x: `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`,
        y: `${top}px`,
        w: `${width}px`,
        h: `${innerHeight - top - 8}px`,
      });
    };
    placeUnder();
    addEventListener("resize", placeUnder);
    return () => removeEventListener("resize", placeUnder);
  }, [props.anchor, stepsWidth]);

  const step = selection.step === null ? undefined : simulation.steps[selection.step];
  const state = step?.state ?? simulation.afterHeader;
  const need = xpToNextLevel(sim.rules, state.level);
  const log = [...state.log];
  const ready = log.filter(([, progress]) => progress.status === "complete").length;
  const started = simulation.afterHeader;
  const startedPercent = levelPercent(sim.rules, started);

  return (
    <Card
      as="section"
      layer
      id={props.id}
      className="panel state-panel"
      aria-label="Simulated state"
      vars={{ "--at-x": place?.x, "--at-y": place?.y, "--size-w": place?.w, "--size-h": place?.h }}
    >
      <div className="panel-head">
        <h2>State</h2>
        <span className="count">
          {step ? (
            <>
              after step <Mono>{step.step + 1}</Mono>
            </>
          ) : (
            "at the guide's start"
          )}
        </span>
        <IconButton icon="x" label="Close state" onClick={props.onClose} />
      </div>
      <div className="panel-body state-body">
        <dl className="state-stats">
          <div className="state-level">
            <dt>Level</dt>
            <dd className="mono">
              {need > 0
                ? `${state.level} · ${state.xp.toLocaleString("en-US")}/${need.toLocaleString("en-US")} xp`
                : `${state.level} · max level`}
            </dd>
            {need > 0 && <progress max={need} value={state.xp} aria-label={`XP through level ${state.level}`} />}
          </div>
          <div>
            <dt>Quest log</dt>
            <dd className="mono">
              {state.log.size}/{QUEST_LOG_SIZE}
            </dd>
          </div>
          <div>
            <dt>Ready to turn in</dt>
            <dd>{ready}</dd>
          </div>
          <div>
            <dt>Quests done</dt>
            <dd>{state.done.size}</dd>
          </div>
          <div>
            <dt>Guide started at</dt>
            <dd>{startedPercent === null ? started.level : `${started.level} · ${startedPercent}%`}</dd>
          </div>
        </dl>
        <QuestLog state={state} sim={sim} label="In the log" />
      </div>
    </Card>
  );
}

export function QuestLog({ state, sim, label }: { state: SimState; sim: SimData; label: ReactNode }) {
  const log = [...state.log];
  return (
    <details className="state-log">
      <summary>
        <DisclosureIcon /> {label}
      </summary>
      {log.length === 0 ? (
        <p className="empty">The quest log is empty.</p>
      ) : (
        <ul>
          {log.map(([id, progress]) => {
            const quest = sim.quest(id);
            const status = progressText(quest, progress);
            return (
              <li key={id}>
                <span className="state-quest">{quest?.name ?? `Quest ${id}`}</span>
                {status && <span className={`state-progress${progress.status === "complete" ? " ready" : ""}`}>{status}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

function progressText(quest: SimQuest | undefined, progress: QuestProgress): string {
  if (progress.status === "complete") return "ready";
  if (!quest) return "";
  return quest.objectives
    .flatMap((row, i) => {
      const done = progress.objectives[i];
      return done && !done.complete ? [row.count === null ? row.name : `${done.count}/${row.count} ${row.name}`] : [];
    })
    .join(", ");
}
