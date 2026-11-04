import { useContext, useState } from "react";
import { argumentEntities, bodyIndent, describeLine, insertLine, luaNumber, type BodyLine, type GuideDocument } from "../guide/index.ts";
import {
  extraKillsLine,
  killXpSettings,
  lineKillParts,
  lineQuest,
  parseKillXpValue,
  setKillXpSetting,
  setSimValue,
  simDirectives,
  type KillXpKey,
  type SimDirective,
  type SimKey,
  type SimLinePos,
} from "../rules/index.ts";
import { namedRow } from "../rules/completeRows.ts";
import { useGameData } from "./context.ts";
import { Described } from "./Described.tsx";
import { NO_DRAFT, sectionOwner, type DraftState } from "./drafts.ts";
import { useEntityNames } from "./EntityLink.tsx";
import { argumentSuggestions } from "./EntitySearch.tsx";
import { DraftField, DraftScope, useDraft } from "./fields.tsx";
import { entityLinks, LineTextFields } from "./LineFields.tsx";
import { useStepFilter } from "./preview/stepFilter.ts";
import { useNoteNames } from "./simNotes.ts";
import type { Commit } from "./EditorDock.tsx";
import { LevelMark, SimCards } from "./StepList.tsx";
import { Button } from "./ui/Button.tsx";
import { ArtButton } from "./ui/ItemButton.tsx";

export function SimulationFields({ doc, step, commit }: { doc: GuideDocument; step: number | null; commit: Commit }) {
  const { directives } = simDirectives(doc, 0);
  const local = directives.filter((d) => d.at.step === (step ?? undefined));
  const multiplier = local.findLast((d) => d.key === "killmult");
  const exact = local.findLast((d) => d.key === "killxp");
  const inherited = killXpSettings(directives).multiplier ?? 1;
  const effective = killXpSettings(directives, step ?? undefined);
  const change = (key: KillXpKey, text: string) => {
    const value = text.trim() ? parseKillXpValue(key, text.trim()) : undefined;
    if (text.trim() && value === undefined)
      return key === "killxp" ? "Enter a whole number of zero or more." : "Enter a number of zero or more.";
    return commit((d) => setKillXpSetting(d, step, key, value));
  };
  return (
    <fieldset className="sim-settings">
      <legend>{step === null ? "Guide simulation defaults" : "Simulation"}</legend>
      <div className="tag-values">
        <DraftField
          label="Kill XP multiplier"
          draftName="Kill XP multiplier"
          layout="stacked"
          mono
          value={multiplier?.key === "killmult" ? String(multiplier.value) : ""}
          placeholder={String(step === null ? 1 : inherited)}
          description={`${
            step === null ? "Guide default. Blank is 1." : "Overrides the guide multiplier. Blank uses it."
          } Not applied to quest XP.`}
          onCommit={(text) => change("killmult", text)}
        />
        {step !== null && (
          <DraftField
            label="Exact XP per kill"
            draftName="Exact XP per kill"
            layout="stacked"
            mono
            value={exact?.key === "killxp" ? String(exact.value) : ""}
            placeholder="Automatic"
            description="Fixed XP per kill, zero allowed. Blank calculates it."
            onCommit={(text) => change("killxp", text)}
          />
        )}
      </div>
      {effective.exact !== undefined && <p className="muted">Multiplier off while exact XP is set.</p>}
      {step !== null && <KillFields doc={doc} step={step} directives={local} commit={commit} />}
      {step !== null && <SimulationLines lines={doc.steps[step]!.body} step={step} commit={commit} />}
    </fieldset>
  );
}

function SimulationLines(props: { lines: readonly BodyLine[]; step: number; commit: Commit }) {
  const indexes = props.lines.flatMap((line, i) => (describeLine(line, "step").home === "simulation" ? [i] : []));
  if (indexes.length === 0) return null;
  return (
    <div className="sim-kills">
      <span className="form-label">Simulation lines</span>
      <LineTextFields label="Simulation lines" {...props} indexes={indexes} />
    </div>
  );
}

const COUNT_ERROR = "Enter a whole number of zero or more.";

const SHARED_MOB = "This line's mob= also names its extra kills. In Raw, move extra= and mob= to a comment line of their own first.";

function wholeNumber(text: string): number | undefined {
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(n) ? n : undefined;
}

function KillFields(props: { doc: GuideDocument; step: number; directives: readonly SimDirective[]; commit: Commit }) {
  const { doc, step, directives, commit } = props;
  const filter = useStepFilter();
  const names = useNoteNames();
  const data = useGameData();
  const [count, setCount] = useDraft("staged extra count");
  const [mob, setMob] = useDraft("staged extra mob");
  const stage = (set: (state: DraftState) => void, text: string) => (set(text ? { draft: text, error: null } : NO_DRAFT), null);
  const [error, setError] = useState<string | null>(null);
  const simulation = filter?.simulation;
  const snapshot = simulation && !simulation.hidden ? simulation.steps[step] : undefined;
  const shown = snapshot?.preview.shown ? snapshot : undefined;
  const guide = useContext(DraftScope)!.guide;
  const pos = (line: number | undefined): SimLinePos => (line === undefined ? { step } : { step, index: line });
  const objectives = doc.steps[step]!.body.flatMap((line, i) => (line.kind === "command" && line.name === "complete" ? [{ line, i }] : []));
  const shares = (line: number | undefined) =>
    line !== undefined && objectives.some((o) => o.i === line) && directives.some((d) => d.key === "extra" && d.at.line === line);
  const set = (line: number | undefined, key: SimKey, value: number | undefined) =>
    shares(line) && key !== "extra" ? SHARED_MOB : commit((d) => setSimValue(d, pos(line), key, value), undefined, line);

  const extras = directives.filter((d): d is Extract<SimDirective, { key: "extra" }> => d.key === "extra");

  const add = () => {
    const kills = wholeNumber(count.draft?.trim() ?? "");
    const npc = wholeNumber(mob.draft?.trim() ?? "");
    if (kills === undefined) return setError(`Count: ${COUNT_ERROR}`);
    if (!npc) return setError("Mob: choose an NPC.");
    const line = extraKillsLine(kills, npc, bodyIndent(doc));
    setCount(NO_DRAFT);
    setMob(NO_DRAFT);
    const failed = commit((d) => insertLine(d, { step, index: d.steps[step]!.body.length }, line));
    setError(failed);
    if (failed) {
      setCount(count);
      setMob(mob);
    }
  };
  const remove = (line: number | undefined) => {
    const shared = directives.some((d) => d.key === "kills" && d.at.line === line);
    const failed = commit(
      (d) => {
        const cleared = setSimValue(d, pos(line), "extra", undefined);
        return shared ? cleared : setSimValue(cleared, pos(line), "mob", undefined);
      },
      undefined,
      line,
    );
    setError(failed);
  };

  return (
    <>
      {objectives.map(({ line, i }) => {
        const own = directives.filter((d) => d.at.line === i);
        const kills = own.flatMap((d) => (d.key === "kills" ? [d.count] : []))[0];
        const mob = own.flatMap((d) => ((d.key === "kills" || d.key === "mob") && d.mob !== undefined ? [d.mob] : []))[0];
        const applies = !!shown?.preview.lines[i];
        const counted = applies ? shown.kills.find((k) => k.objective && k.at.line === i) : undefined;
        const parts = applies ? lineKillParts(shown, i, names) : undefined;
        const questId = lineQuest(line)?.questId;
        const quest = questId === undefined ? undefined : data?.quest(questId);
        const obj = luaNumber(line.args[1] ?? "");
        const objective = quest && obj !== undefined ? namedRow(quest, obj)?.objective.name : undefined;
        const title = `Line ${i + 1}: ${quest?.name ?? `.complete ${line.args.join(",")}`}${objective ? `, ${objective}` : ""}`;
        return (
          <DraftScope.Provider key={i} value={{ object: line, guide }}>
            <div className="sim-kills" role="group" aria-label={title}>
              <span className="form-label">{title}</span>
              <div className="sim-kill-fields">
                <DraftField
                  label="Kills here"
                  layout="stacked"
                  draftName="kills"
                  className="arg-short"
                  mono
                  value={kills === undefined ? "" : String(kills)}
                  placeholder={applies ? String(counted?.count ?? 0) : "Automatic"}
                  hint={parts?.count}
                  description="Kills counted at this line. Blank counts them automatically."
                  onCommit={(text) => {
                    if (!text.trim()) return set(i, "kills", undefined);
                    const n = wholeNumber(text.trim());
                    return n === undefined ? COUNT_ERROR : set(i, "kills", n);
                  }}
                />
                <MobField
                  draftName="mob"
                  value={mob === undefined ? "" : String(mob)}
                  placeholder={counted ? counted.mobs.map((m) => names.npc(m.npcId)).join(", ") : "Automatic"}
                  description="NPC killed for this objective. Blank uses .mob, .target, or quest data."
                  source={parts?.mob}
                  onCommit={(id) => set(i, "mob", id)}
                />
                {parts && (
                  <Described text={<SimCards cards={parts.cards} />} pin>
                    <ArtButton className="sim-kill-xp">
                      <span className="act-xp">+{parts.xp.toLocaleString("en-US")} xp</span>
                      <LevelMark level={parts.level} />
                    </ArtButton>
                  </Described>
                )}
              </div>
            </div>
          </DraftScope.Provider>
        );
      })}
      <div className="sim-kills" role="group" aria-label="Extra kills">
        <span className="form-label">Extra kills</span>
        {extras.map((e) => {
          const line = e.at.line;
          const owner = line === undefined ? sectionOwner(doc, step) : doc.steps[step]!.body[line]!;
          return (
            <DraftScope.Provider key={line ?? "step"} value={{ object: owner, guide }}>
              <div
                className="sim-kill-fields"
                role="group"
                aria-label={`Extra kills, ${line === undefined ? "step line" : `line ${line + 1}`}`}
              >
                <DraftField
                  label="Count"
                  layout="stacked"
                  draftName="extra count"
                  className="arg-short"
                  mono
                  value={String(e.count)}
                  onCommit={(text) => {
                    const n = wholeNumber(text.trim());
                    return n === undefined ? COUNT_ERROR : set(line, "extra", n);
                  }}
                />
                <MobField
                  draftName="extra mob"
                  value={String(e.mob)}
                  description="The NPC killed."
                  onCommit={(id) => (id === undefined ? "Extra kills need a mob." : set(line, "mob", id))}
                />
                <Button variant="secondary" onClick={() => remove(line)}>
                  Remove
                </Button>
              </div>
            </DraftScope.Provider>
          );
        })}
        <div className="sim-kill-fields" role="group" aria-label="New extra kills">
          <DraftField
            label="Count"
            layout="stacked"
            draftName="new extra count"
            className="arg-short"
            mono
            value={count.draft ?? ""}
            onCommit={(text) => stage(setCount, text)}
          />
          <MobField
            draftName="new extra mob"
            value={mob.draft ?? ""}
            description="The NPC killed."
            onCommit={(id) => stage(setMob, id === undefined ? "" : String(id))}
          />
          <Button variant="secondary" onClick={add}>
            Add
          </Button>
        </div>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
    </>
  );
}

function MobField(props: {
  draftName: string;
  value: string;
  placeholder?: string;
  description: string;
  source?: string | undefined;
  onCommit: (id: number | undefined) => string | null;
}) {
  const names = useEntityNames();
  const data = useGameData();
  return (
    <DraftField
      label="Mob"
      layout="stacked"
      draftName={props.draftName}
      className="arg-grow"
      mono
      value={props.value}
      placeholder={props.placeholder}
      description={`${props.description} Search by name or ID.`}
      hint={(value) => entityLinks(argumentEntities("mob", [value], 0), data) ?? props.source}
      suggest={(value, caret) => argumentSuggestions(names, "mob", [value], 0, caret)}
      onCommit={(text) => {
        if (!text.trim()) return props.onCommit(undefined);
        const id = wholeNumber(text.trim());
        return id ? props.onCommit(id) : "Enter an NPC ID, or type a name and choose it.";
      }}
    />
  );
}
