import type { ReactNode } from "react";
import { formatClock, QUEST_LOG_SIZE, type SimData, type SimState } from "../../rules/index.ts";
import { objectiveTargets } from "../../rules/killTargets.ts";
import { xpToNextLevel } from "../../rules/xp.ts";
import { useGameData } from "../context.ts";
import { useSimData } from "../preview/route.ts";
import { usePreviewSettings } from "../preview/settings.ts";
import { levelPercent, QuestLog } from "../preview/StateButton.tsx";
import { DisclosureIcon } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Mono } from "../ui/Text.tsx";
import { useMoment, usePlayback } from "./store.ts";

export function CharacterCard() {
  const moment = useMoment();
  const playhead = usePlayback((s) => s.playhead);
  const sim = useSimData(usePreviewSettings());
  const data = useGameData();
  if (!moment || !sim) return null;
  const state = moment.character;
  const need = xpToNextLevel(sim.rules, state.level);
  const percent = levelPercent(sim.rules, state);
  const hearth = moment.hearthReadyAt <= playhead ? "Ready" : `In ${formatClock(moment.hearthReadyAt - playhead)}`;
  const bind = state.bind && data?.zoneAt(state.bind)?.name;
  const items = itemsHeld(state, sim);
  const flights = [...state.flightPaths].map((node) => sim.flights.node(node).name);
  return (
    <Card as="aside" className="character-card" aria-label="Character">
      <div className="character-level state-level">
        <span className="character-level-no">Level {state.level}</span>
        <span className="character-xp">
          {percent === null ? "Max level" : `${state.xp.toLocaleString()}/${need.toLocaleString()} XP (${percent}%)`}
        </span>
        {need > 0 && <progress max={need} value={state.xp} aria-label={`XP through level ${state.level}`} />}
      </div>
      <dl className="character-stats">
        <div>
          <dt>Hearthstone</dt>
          <dd>{hearth}</dd>
        </div>
        <div>
          <dt>Bind</dt>
          <dd>{state.bind ? (bind ?? "Known") : "Unknown"}</dd>
        </div>
      </dl>
      <QuestLog state={state} sim={sim} label={<Counted label="Quest log" count={`${state.log.size}/${QUEST_LOG_SIZE}`} />} />
      <List label="Items held" empty="No quest items." items={items} />
      <List label="Flight paths" empty="No flight paths." items={flights.map((name) => ({ key: name, text: name }))} />
    </Card>
  );
}

function Counted(props: { label: string; count: ReactNode }) {
  return (
    <>
      {props.label}{" "}
      <span className="character-count">
        <Mono>{props.count}</Mono>
      </span>
    </>
  );
}

function List(props: { label: string; empty: string; items: readonly { key: string; text: string }[] }) {
  return (
    <details className="state-log">
      <summary>
        <DisclosureIcon /> <Counted label={props.label} count={props.items.length} />
      </summary>
      {props.items.length === 0 ? (
        <p className="empty">{props.empty}</p>
      ) : (
        <ul>
          {props.items.map((item) => (
            <li key={item.key}>{item.text}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function itemsHeld(state: SimState, sim: SimData) {
  return [...state.log].flatMap(([id, progress]) => {
    const quest = sim.quest(id);
    return (quest?.objectives ?? []).flatMap((row, i) => {
      const count = progress.objectives[i]?.count ?? 0;
      return objectiveTargets(row).items.length > 0 && count > 0
        ? [{ key: `${id}:${i}`, text: `${row.name} ${count}${row.count === null ? "" : `/${row.count}`}` }]
        : [];
    });
  });
}
