import { Fragment, useId, useState, type ReactNode } from "react";
import type { EntityType, GameData, Quest, QuestPoint } from "../../data/index.ts";
import { moneyText } from "../../rules/money.ts";
import { questXp } from "../../rules/xp.ts";
import { EntityLink, ItemIcon } from "../EntityLink.tsx";
import { DisclosureIcon } from "../ui/Button.tsx";
import { ItemButton } from "../ui/ItemButton.tsx";
import { Mono } from "../ui/Text.tsx";
import "./questInfo.css";

const number = (n: number) => n.toLocaleString("en-US");

function questXpAt(quest: Quest, level: number | null, maxLevel: number): number | null {
  if (level !== null && level >= maxLevel) return 0;
  if (quest.baseXp === null) return null;
  if (quest.questLevel === null) return level === null ? quest.baseXp : null;
  return questXp(quest.baseXp, quest.questLevel, level);
}

const hasBriefRewards = (q: Quest) => !!(q.rewardItems?.length || q.rewardChoices?.length || q.rewardMoney);

export function QuestPreview(props: { data: GameData; quest: Quest; level: number | null; status?: string | undefined }) {
  const { data, quest, level } = props;
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="quest-preview">
      <QuestToggle open={open} controls={id} onToggle={setOpen}>
        <span className="quest-preview-name">{quest.name}</span>
        {quest.questLevel !== null && (
          <>
            {" "}
            <span className="muted">(level {quest.questLevel})</span>
          </>
        )}
      </QuestToggle>
      {props.status && <span className="quest-preview-status">{props.status}</span>}
      <QuestBrief quest={quest} xp={questXpAt(quest, level, data.maxLevel)} />
      {open && <QuestDetails id={id} data={data} quest={quest} level={level} />}
    </div>
  );
}

/** The button that opens a quest's details; `controls` names the details' ID, which exists only while open. */
export function QuestToggle(props: { open: boolean; controls: string; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <ItemButton
      className="quest-toggle"
      aria-expanded={props.open}
      aria-controls={props.open ? props.controls : undefined}
      onClick={() => props.onToggle(!props.open)}
    >
      <DisclosureIcon />
      {props.children}
    </ItemButton>
  );
}

export function QuestBrief(props: { quest: Quest; xp?: number | null }) {
  const { quest, xp } = props;
  const parts: ReactNode[] = [];
  if (xp !== undefined)
    parts.push(
      xp === null ? (
        "XP unknown"
      ) : (
        <>
          <Mono>{number(xp)}</Mono> XP
        </>
      ),
    );
  if (quest.rewardItems?.length) parts.push(<span className="quest-brief-items">{itemIcons(quest.rewardItems)}</span>);
  if (quest.rewardChoices?.length) parts.push(<span className="quest-brief-items">Choose {itemIcons(quest.rewardChoices)}</span>);
  if (quest.rewardMoney) parts.push(<Mono>{moneyText(quest.rewardMoney)}</Mono>);
  if (parts.length === 0) return null;
  return <p className="quest-brief">{joined(parts, " · ")}</p>;
}

const itemIcons = (rewards: readonly { item: number; count: number }[], named = false) =>
  rewards.map((r, i) => <ItemIcon key={i} id={r.item} count={r.count} named={named} />);

/** The name links to Wowhead, whose tooltip adds the quest's own text on hover. */
export function QuestDetails(props: { data: GameData; quest: Quest; level: number | null; id?: string }) {
  const { data, quest, level } = props;
  const who = [...forWhom(quest), quest.classRequirement !== "Any class" && quest.classRequirement].filter(Boolean).join(" · ");
  const objectives = objectiveItems(quest);
  const starts = pointLinks(quest.startPoints);
  const ends = pointLinks(quest.endPoints);
  const after = prerequisiteLinks(quest);
  return (
    <div className="quest-details" id={props.id}>
      <p className="quest-details-name">
        <EntityLink type="quest" id={quest.id} name={quest.name} />{" "}
        <span className="muted">
          <Mono>{quest.id}</Mono>
        </span>
      </p>
      <p className="muted">
        Level {quest.questLevel ?? "unknown"}, requires {quest.requiredLevel ?? "unknown"}
        {quest.requiredMaxLevel !== undefined && ` to ${quest.requiredMaxLevel}`} · {who}
      </p>
      {quest.objectiveText.length > 0 && <p>{quest.objectiveText.join(" ")}</p>}
      <dl>
        {objectives.length > 0 && (
          <>
            <dt>Objectives</dt>
            <dd>
              <ul>
                {objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>Experience</dt>
        <dd>{xpText(quest, level, data.maxLevel)}</dd>
        <dt>Rewards</dt>
        <dd>
          {hasBriefRewards(quest) || quest.rewardReputation?.length ? (
            <ul>
              {itemIcons(quest.rewardItems ?? [], true).map((icon, i) => (
                <li key={`i${i}`}>{icon}</li>
              ))}
              {quest.rewardChoices?.length ? (
                <li>
                  Choose one:
                  <ul className="quest-details-choices">
                    {itemIcons(quest.rewardChoices, true).map((icon, i) => (
                      <li key={i}>{icon}</li>
                    ))}
                  </ul>
                </li>
              ) : null}
              {quest.rewardMoney ? (
                <li>
                  <Mono>{moneyText(quest.rewardMoney)}</Mono>
                </li>
              ) : null}
              {(quest.rewardReputation ?? []).map((r) => (
                <li key={`r${r.faction}`}>{reputationText(r, data)}</li>
              ))}
            </ul>
          ) : (
            <span className="muted">The data lists none besides XP.</span>
          )}
        </dd>
        {starts.length > 0 && (
          <>
            <dt>Starts</dt>
            <dd>{joined(starts, ", ")}</dd>
          </>
        )}
        {ends.length > 0 && (
          <>
            <dt>Ends</dt>
            <dd>{joined(ends, ", ")}</dd>
          </>
        )}
        {after !== null && (
          <>
            <dt>After</dt>
            <dd>{after}</dd>
          </>
        )}
        {quest.nextQuestInChain ? (
          <>
            <dt>Leads to</dt>
            <dd>
              <EntityLink type="quest" id={quest.nextQuestInChain} />
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function forWhom(quest: Quest): string[] {
  const { requiredFaction: faction, raceRequirement: races } = quest;
  if (!faction || races === faction) return [races];
  return races === "Any race" ? [faction] : [faction, races];
}

function xpText(quest: Quest, level: number | null, maxLevel: number): string {
  const full = questXpAt(quest, null, maxLevel);
  const at = level === null ? full : questXpAt(quest, level, maxLevel);
  if (full === null) return "Unknown";
  if (at === null) return `${number(full)} in full; unknown at level ${level}`;
  return at === full ? number(full) : `${number(at)} at level ${level}, ${number(full)} in full`;
}

const reputationText = (r: { faction: number; value: number }, data: GameData) =>
  `${r.value < 0 ? "−" : "+"}${Math.abs(r.value)} ${data.factionName(r.faction)}`;

function objectiveItems(quest: Quest): ReactNode[] {
  const count = (n: number | undefined) => (n === undefined ? "" : ` ×${n}`);
  if (quest.textObjectives?.length)
    return quest.textObjectives.map((o) => (
      <>
        {o.link ? (
          <EntityLink type={o.link.kind} id={o.link.id} name={o.name}>
            {o.name}
          </EntityLink>
        ) : (
          o.name
        )}
        {count(o.count)}
        {o.need === "providedItem" && <span className="muted"> (provided)</span>}
      </>
    ));
  return quest.objectives.map((o) => {
    const type = Object.hasOwn(OBJECTIVE_TYPES, o.type) ? OBJECTIVE_TYPES[o.type] : undefined;
    const name =
      type && o.id !== null ? (
        <EntityLink type={type} id={o.id} name={o.name}>
          {o.name}
        </EntityLink>
      ) : (
        o.name
      );
    return (
      <>
        {name}
        {count(o.count)}
      </>
    );
  });
}

const OBJECTIVE_TYPES: Partial<Record<string, EntityType>> = { monster: "npc", item: "item", object: "object", spell: "spell" };

/**
 * The quests that must be turned in first, linked, as the details' "After"
 * line words them: one quest, "one of" a single list, or a group joined by
 * "and". Null when the quest has none.
 */
export function prerequisiteLinks(quest: Quest): ReactNode {
  const single = quest.preQuestSingle ?? [];
  if (single.length === 1) return <EntityLink type="quest" id={single[0]!} />;
  if (single.length) return <>one of {joined(questLinks(single), ", ")}</>;
  return quest.preQuestGroup?.length ? joined(questLinks(quest.preQuestGroup), " and ") : null;
}

function pointLinks(points: readonly QuestPoint[]): ReactNode[] {
  const seen = new Map<string, QuestPoint>();
  for (const p of points) seen.set(`${p.sourceType}:${p.sourceId ?? p.sourceName}`, p);
  return [...seen.values()].map((p, i) => <PointLink key={i} point={p} />);
}

export function PointLink({ point: p }: { point: QuestPoint }) {
  const type = POINT_TYPES[p.sourceType];
  return type && p.sourceId !== undefined ? (
    <EntityLink type={type} id={p.sourceId} name={p.sourceName}>
      {p.sourceName}
    </EntityLink>
  ) : (
    p.sourceName
  );
}

const POINT_TYPES: Partial<Record<string, EntityType>> = { npc: "npc", object: "object", item: "item" };

const questLinks = (ids: readonly number[]) => ids.map((id, i) => <EntityLink key={i} type="quest" id={id} />);

export function joined(parts: readonly ReactNode[], separator: string): ReactNode[] {
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && separator}
      {part}
    </Fragment>
  ));
}
