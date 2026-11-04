import { useId, useMemo, useState, type ReactNode } from "react";
import type { GameData, Quest } from "../../data/index.ts";
import type { SourceKey } from "../../../packages/data-contract/shared.ts";
import {
  defaultChoices,
  draftStep,
  draftSteps,
  insertQuest,
  objectiveIndices,
  type DraftChoices,
  type DraftPart,
  type QuestDraft,
} from "../../rules/questInsertion.ts";
import { bodyIndent, stepText, type Step } from "../../guide/index.ts";
import { useEditor, useEditorStore } from "../context.ts";
import { Button, DisclosureIcon } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Select } from "../ui/Field.tsx";
import { QuestDetails } from "./QuestInfo.tsx";
import { questDraft } from "./draft.ts";
import { useFaction } from "../preview/settings.ts";
import "./quests.css";

export function DraftView(props: { data: GameData; quest: Quest }) {
  const { data, quest } = props;
  const { current, selection } = useEditor();
  const store = useEditorStore();
  const faction = useFaction();
  const draft = useMemo(() => questDraft(data, quest, faction), [data, quest, faction]);
  const [choices, setChoices] = useState<DraftChoices>(() => defaultChoices(draft));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const set = (change: Partial<DraftChoices>) => setChoices((c) => ({ ...c, ...change }));

  const indent = current ? bodyIndent(current.doc) : "";
  const steps = draftSteps(draft, choices, indent);
  const one = (part: DraftPart) => draftStep(draft, choices, part, indent);
  const where = selection.step === null ? "at the start" : `after step ${selection.step + 1}`;

  const insert = () => {
    if (!current) return;
    const insertion = insertQuest({ data, faction, doc: current.doc, after: selection.step }, { kind: "draft", draft, choices });
    const result = store.edit(insertion.edit, { step: insertion.select, line: null });
    if (!result.ok && result.reason === "opened") setMessage(null);
    else
      setMessage(
        result.ok
          ? { text: `Inserted ${steps.length} ${plural(steps.length)} ${where}.`, error: false }
          : { text: result.error, error: true },
      );
  };

  return (
    <div className="panel-body quest-draft" data-tip-bounds>
      <QuestDetails data={data} quest={quest} level={null} />
      <QuestSources data={data} quest={quest} />

      <DraftPart
        title="Accept"
        checked={choices.accept}
        onToggle={(accept) => set({ accept })}
        points={draft.givers}
        point={choices.giver}
        onPoint={(giver) => set({ giver })}
        pointLabel="Accept at"
        step={one("accept")}
      />
      <DraftPart
        title="Objectives"
        checked={choices.complete}
        disabled={!objectiveIndices(draft)}
        onToggle={(complete) => set({ complete })}
        step={one("complete")}
        note={objectiveNote(data, draft)}
      >
        {!objectiveIndices(draft) && <CapturedObjectives data={data} quest={quest} />}
      </DraftPart>
      <DraftPart
        title="Turn in"
        checked={choices.turnin}
        onToggle={(turnin) => set({ turnin })}
        points={draft.enders}
        point={choices.ender}
        onPoint={(ender) => set({ ender })}
        pointLabel="Turn in at"
        step={one("turnin")}
      />

      <div className="draft-actions">
        <Button variant="primary" disabled={!current || steps.length === 0} onClick={insert}>
          Insert {steps.length} {plural(steps.length)} {where}
        </Button>
      </div>
      {message && (
        <p className={message.error ? "error" : "muted"} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function objectiveNote(data: GameData, draft: QuestDraft) {
  if (objectiveIndices(draft)) return undefined;
  const { quest } = draft;
  if (draft.objectives.length > 0) return "The data does not number every objective; add .complete lines by hand.";
  if (!quest.provenance) return "The data gives no numbered objectives for this quest.";
  const objectives = data.fieldOrigin(quest, "objectives");
  if (objectives)
    return `${data.sourceLabel(objectives.source)} gives no numbered objectives for this quest, so no .complete lines can be drafted.`;
  const changes = data.fieldOrigin(quest, "changes");
  return [
    "No source gives this quest's numbered objectives, so no .complete lines can be drafted.",
    changes &&
      quest.changes?.labels.includes("objectives_changed") &&
      `${data.sourceLabel(changes.source)} says the objectives changed, so the old layout is left out.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function CapturedObjectives({ data, quest }: { data: GameData; quest: Quest }) {
  const rows = quest.capturedObjectives ?? [];
  const text = quest.capturedObjectiveText;
  const from = (field: QuestField) => {
    const origin = data.fieldOrigin(quest, field);
    return origin ? ` from ${data.sourceLabel(origin.source)}` : "";
  };
  return (
    <>
      {rows.length > 0 && (
        <>
          <p className="muted">Objective rows{from("capturedObjectives")}, without indices:</p>
          <ul className="draft-captured" aria-label="Captured objective rows">
            {rows.map((row, i) => (
              <li key={i}>{row.text}</li>
            ))}
          </ul>
        </>
      )}
      {text && (
        <p className="muted">
          Objective text{from("capturedObjectiveText")}, cut at the page's first link or other inline element, so it may be partial:{" "}
          <q>{text.text}</q>
        </p>
      )}
    </>
  );
}

type QuestField = keyof NonNullable<Quest["provenance"]>["fields"];

const FIELD_LABELS: Record<QuestField, string> = {
  name: "name",
  questLevel: "level",
  requiredLevel: "required level",
  requiredRaceMask: "races",
  raceRequirement: "race label",
  requiredClassMask: "classes",
  classRequirement: "class label",
  requiredFaction: "faction",
  zoneIds: "zones",
  types: "types",
  preQuestGroup: "prerequisites (all)",
  preQuestSingle: "prerequisites (any)",
  nextQuestInChain: "next quest",
  exclusiveTo: "exclusive quests",
  parentQuest: "parent quest",
  requiredMaxLevel: "maximum level",
  requiredSkill: "required skill",
  requiredMinRep: "minimum reputation",
  requiredMaxRep: "maximum reputation",
  requiredSpecialization: "specialization",
  startPoints: "starts",
  endPoints: "ends",
  objectiveText: "objective text",
  objectives: "objectives",
  objectivePoints: "objective locations",
  capturedObjectives: "captured objective rows",
  capturedObjectiveText: "captured objective text",
  baseXp: "experience",
  rewardItems: "reward items",
  rewardChoices: "reward choices",
  rewardReputation: "reputation rewards",
  rewardMoney: "money",
  changes: "changes",
};

interface SourceGroup {
  source: SourceKey;
  fields: { label: string; reason?: string }[];
  evidence: Set<string>;
}

function sourceGroups(data: GameData, quest: Quest): SourceGroup[] {
  const groups = new Map<SourceKey, SourceGroup>();
  const group = (source: SourceKey) => {
    if (!groups.has(source)) groups.set(source, { source, fields: [], evidence: new Set() });
    return groups.get(source)!;
  };
  for (const [field, label] of Object.entries(FIELD_LABELS) as [QuestField, string][]) {
    const won = data.fieldOrigin(quest, field);
    if (!won) continue;
    won.evidence?.forEach((e) => group(won.source).evidence.add(e));
    group(won.source).fields.push(won.reason ? { label, reason: won.reason } : { label });
  }
  const rank = (key: SourceKey) => data.sources.findIndex((s) => s.source === key);
  return [...groups.values()].toSorted((a, b) => rank(a.source) - rank(b.source));
}

function QuestSources({ data, quest }: { data: GameData; quest: Quest }) {
  if (!quest.provenance) return <p className="muted">This data bundle does not record where each field came from.</p>;
  const groups = sourceGroups(data, quest);
  return (
    <details className="quest-sources">
      <summary>
        <DisclosureIcon /> Sources: {groups.map((g) => data.sourceLabel(g.source)).join(", ") || "none recorded"}
      </summary>
      <ul aria-label="Field sources">
        {groups.map((g) => {
          const set = data.sources.find((s) => s.source === g.source);
          return (
            <li key={g.source}>
              <details>
                <summary>
                  <DisclosureIcon /> <strong>{data.sourceLabel(g.source)}</strong>:{" "}
                  {g.fields.map((f) => (f.reason ? `${f.label} (${f.reason})` : f.label)).join(", ")}
                </summary>
                <dl className="mono">
                  <dt>Source</dt>
                  <dd>{g.source}</dd>
                  {g.evidence.size > 0 && <dt>Evidence</dt>}
                  {[...g.evidence].map((e) => (
                    <dd key={e}>{e}</dd>
                  ))}
                  {set && <Pins title="Pins" pins={set.pins} />}
                  {set?.derivedFrom?.map((ref) => (
                    <Pins
                      key={`${ref.source}:${ref.edition}`}
                      title={`Derived from ${data.sourceLabel(ref.source, ref.edition)}`}
                      pins={ref.pins}
                    />
                  ))}
                </dl>
              </details>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Pins({ title, pins }: { title: string; pins: Record<string, string> }) {
  return (
    <>
      <dt>{title}</dt>
      {Object.entries(pins).map(([name, pin]) => (
        <dd key={name}>
          {name} {pin}
        </dd>
      ))}
    </>
  );
}

const plural = (n: number) => (n === 1 ? "step" : "steps");

function DraftPart(props: {
  title: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
  step: Step | undefined;
  points?: QuestDraft["givers"];
  point?: number;
  onPoint?: (index: number) => void;
  pointLabel?: string;
  note?: string | undefined;
  children?: ReactNode;
}) {
  const { step, points } = props;
  const noteId = useId();
  return (
    <fieldset className={`draft-part${props.checked ? "" : " off"}`}>
      <legend>
        <Checkbox
          label={props.title}
          checked={props.checked}
          disabled={props.disabled}
          aria-describedby={props.note ? noteId : undefined}
          onChange={(e) => props.onToggle(e.target.checked)}
        />
      </legend>
      {points && (
        <Select
          className="draft-point"
          aria-label={props.pointLabel}
          value={props.point}
          onChange={(e) => props.onPoint!(Number(e.target.value))}
          disabled={!props.checked}
        >
          {points.map((p, i) => (
            <option key={i} value={i}>
              {p.label}
            </option>
          ))}
          <option value={-1}>{points.length === 0 ? "No mapped location in the data" : "No .goto"}</option>
        </Select>
      )}
      {props.note ? (
        <p className="muted" id={noteId}>
          {props.note}
        </p>
      ) : (
        step && (
          <pre className="mono" aria-label={`${props.title} step text`}>
            {stepText(step)}
          </pre>
        )
      )}
      {props.children}
    </fieldset>
  );
}
