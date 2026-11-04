import { useContext, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  argSpecAt,
  argumentEntities,
  argumentType,
  commandEntities,
  COMMANDS,
  describeLine,
  deleteLine,
  edited,
  findEntityReferences,
  guideText,
  hasEntityArguments,
  lineText,
  moveLine,
  parseLine,
  replaceLine,
  setCommandArgs,
  setCondition,
  setText,
  tagAllowedIn,
  TAGS,
  plainText,
  updateLine,
  type ArgKind,
  type BodyLine,
  type CommandLine,
  type CommandSpec,
  type EntityId,
  type LineHome,
  type LinePos,
  type TextLine,
  type TextMarker,
} from "../guide/index.ts";
import { RXP_ZONE_TOKENS, type GameData } from "../data/index.ts";
import { lineFace, lineQuest, parseLevelTarget } from "../rules/index.ts";
import { namedRow } from "../rules/completeRows.ts";
import { useEditorStore, useGameData, useRowNames } from "./context.ts";
import { Described } from "./Described.tsx";
import { EntityLink, useEntityNames } from "./EntityLink.tsx";
import { argumentSuggestions, InsertReference } from "./EntitySearch.tsx";
import { readDraft, subscribeDrafts } from "./drafts.ts";
import { ConditionEditor, DraftField, DraftScope, type FieldText } from "./fields.tsx";
import { GuideText } from "./GuideText.tsx";
import { MacroIcon } from "./IconPicker.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { useLayout } from "./layout.ts";
import { lineHasMapReference } from "./map/lineFocus.ts";
import { PopoverMenu } from "./map/PopoverMenu.tsx";
import { useWorldMapStore } from "./map/worldMapStore.ts";
import { useFaction } from "./preview/settings.ts";
import { Button, DisclosureIcon, IconButton } from "./ui/Button.tsx";
import { Select } from "./ui/Field.tsx";
import { RxpTextField } from "./RxpTextField.tsx";
import type { Commit } from "./EditorDock.tsx";
import type { Selection } from "./store.ts";
import { Mark } from "./Mark.tsx";

const LINE_CONDITION = "Same syntax as the step condition, for this line only.";

const FORM_COMMANDS = [
  "accept",
  "complete",
  "turnin",
  "goto",
  "target",
  "train",
  "trainer",
  "vendor",
  "hs",
  "fly",
  "fp",
  "collect",
  "use",
  "buy",
  "xp",
  "maxlevel",
] as const;

function isFormCommand(name: string): name is (typeof FORM_COMMANDS)[number] {
  return (FORM_COMMANDS as readonly string[]).includes(name);
}

const ARG_DESCRIPTIONS: Partial<Record<string, string>> = {
  zone: "Zone name, UI map ID, or mapId/instance for world coordinates.",
  x: "X coordinate; a map percentage for a zone, or world X for mapId/instance.",
  y: "Y coordinate; a map percentage for a zone, or world Y for mapId/instance.",
  radius: "Arrow radius in yards. 0 removes the radius; a negative value makes it dynamic.",
  objective: "Objective index in the quest, starting at 1.",
  npc: "NPC ID, name, or Name::id. A + before the first marks a parent objective.",
  text: "The >> text RXP shows for this line.",
  icon: "The icon's FileDataID. Choose icon lists the guide icons.",
};

export function LineTitle(props: { title: string; syntax: string }) {
  const { showGuideSyntax } = useLayout();
  return (
    <>
      {props.title}
      {showGuideSyntax && props.syntax && (
        <>
          {" "}
          <span className="syntax mono">{props.syntax}</span>
        </>
      )}
    </>
  );
}

export function LineEditor(props: {
  line: BodyLine;
  pos: LinePos;
  last: boolean;
  indent: string;
  commit: Commit;
  open: (tab: LineHome) => void;
}) {
  const { line, pos, commit } = props;
  const store = useEditorStore();
  const names = useEntityNames();
  const guide = useContext(DraftScope)!.guide;
  const rowNames = useRowNames();
  const described = describeLine(line, pos.step === null ? "header" : "step");
  const at = (index: number | null): Selection => ({ step: pos.step, line: index });
  const replace = (update: (l: BodyLine) => BodyLine) => commit((d) => updateLine(d, pos, update), at(pos.index), pos.index);
  const text = line.kind === "text" || line.kind === "command" ? line.text : undefined;
  const rendered = text !== undefined && (plainText(text) !== text || findEntityReferences(text).length > 0);
  const home = described.home;

  const form = line.kind === "command" && (isFormCommand(line.name) || hasEntityArguments(line.name) || line.name === "macro");
  let editor;
  if (home !== "lines")
    editor = (
      <Button variant="secondary" onClick={() => props.open(home)}>
        Open {home === "settings" ? "Step settings" : "XP simulation"}
      </Button>
    );
  else if (form) editor = <CommandForm line={line} replace={replace} />;
  else if (line.kind === "text") editor = <TextForm line={line} replace={replace} />;
  else editor = <InlineLine line={line} pos={pos} indent={line.kind === "blank" ? props.indent : line.indent} commit={commit} />;

  return (
    <div data-line={pos.index} className="line-row" onFocus={() => store.select(at(pos.index))}>
      <div className="line-editor" role="group" aria-label={`Line ${pos.index + 1}, ${described.title}`}>
        <div className="line-heading">
          <h3 className="line-title">
            <Mark mark={lineFace(line, rowNames).mark} />
            <LineTitle title={described.title} syntax={described.syntax} />
          </h3>
          <p className="muted line-description">{described.description}</p>
          <span className="line-tools">
            <IconButton
              label="Move line up"
              icon="up"
              description="Move the line up."
              disabled={pos.index === 0}
              onClick={() => commit((d) => moveLine(d, pos, { ...pos, index: pos.index - 1 }), at(pos.index - 1))}
            />
            <IconButton
              label="Move line down"
              icon="down"
              description="Move the line down."
              disabled={props.last}
              onClick={() => commit((d) => moveLine(d, pos, { ...pos, index: pos.index + 1 }), at(pos.index + 1))}
            />
            <IconButton
              label="Delete line"
              icon="trash"
              description="Delete this line."
              onClick={() => commit((d) => deleteLine(d, pos), at(null))}
            />
          </span>
        </div>
        <DraftScope.Provider value={{ object: line, guide }}>{editor}</DraftScope.Provider>
        {home === "lines" && rendered && (
          <span className="shows-as">
            Shows as: <GuideText parts={guideText(text, (type, id) => names.lookup(type, id)?.name)} links="entity" />
          </span>
        )}
        {home === "lines" && lineHasMapReference(line) && <FocusOnMap line={line} pos={pos} />}
      </div>
    </div>
  );
}

function MoreOptions(props: { drafts: readonly string[]; summary: string; children: ReactNode }) {
  const owner = useContext(DraftScope)!;
  const failed = useSyncExternalStore(subscribeDrafts, () => props.drafts.some((name) => readDraft(owner, name).error !== null));
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = open || failed;
  return (
    <div className="more-options">
      <Button variant="ghost" expanded={shown} aria-controls={id} onClick={() => setOpen(!shown)}>
        <DisclosureIcon />
        More options
        {!shown && props.summary && <span className="muted"> · {props.summary}</span>}
      </Button>
      <div id={id} className="more-options-body" hidden={!shown}>
        {props.children}
      </div>
    </div>
  );
}

const LINE_CONDITION_DRAFT = "Line condition";

function LineCondition(props: { line: BodyLine; replace: (update: (l: BodyLine) => BodyLine) => string | null }) {
  return (
    <ConditionEditor
      compact
      label="Line condition"
      draftName={LINE_CONDITION_DRAFT}
      description={LINE_CONDITION}
      condition={props.line.condition}
      onCommit={(text) => props.replace((l) => setCondition(l, text))}
    />
  );
}

function ReadOnlyComment({ line }: { line: BodyLine }) {
  return line.comment === undefined ? null : <span className="comment mono">--{line.comment}</span>;
}

function moreOptionsSummary(line: BodyLine, advanced: readonly string[]): string {
  return [line.condition && `Condition ${line.condition.text}`, ...advanced, line.comment !== undefined && "Comment"]
    .filter(Boolean)
    .join(" · ");
}

function FocusOnMap(props: { line: BodyLine; pos: LinePos }) {
  const store = useEditorStore();
  const worldMap = useWorldMapStore();
  const [failed, setFailed] = useState<{ line: BodyLine; message: string } | null>(null);
  const focus = () => {
    const committed = store.getState().current!.doc;
    const result = worldMap.focus({ kind: "line", doc: committed, at: props.pos });
    setFailed(result.kind === "unavailable" ? { line: props.line, message: result.message } : null);
  };
  return (
    <span className="focus-on-map">
      <Described text="Center and mark this line on the map">
        <Button variant="secondary" onClick={focus}>
          <Icon name="pin" />
          Focus on map
        </Button>
      </Described>
      {failed?.line === props.line && (
        <span className="muted" role="status">
          {failed.message}
        </span>
      )}
    </span>
  );
}

const SHORT_ARGS: ReadonlySet<ArgKind> = new Set(["questId", "itemId", "spellId", "x", "y", "radius", "number", "flags"]);

function groupShortFields(indexes: readonly number[], short: (i: number) => boolean): number[][] {
  const out: number[][] = [];
  for (const i of indexes) {
    const last = out.at(-1);
    if (last && short(i) && short(last.at(-1)!)) last.push(i);
    else out.push([i]);
  }
  return out;
}

function argFieldCount(spec: CommandSpec, count: number): number {
  if (spec.repeat) return Math.max(spec.args.length, count) + 1;
  if (isFormCommand(spec.name) && spec.name !== "collect") return Math.max(spec.args.length, count);
  const required = spec.args.filter((a) => !a.optional).length;
  return Math.max(required, count, Math.min(spec.args.length, count + 1));
}

function withArg(args: readonly string[], i: number, value: string): string[] {
  const next = [...args];
  while (next.length < i) next.push("");
  next[i] = value;
  return next;
}

function CommandForm(props: { line: CommandLine; replace: (update: (l: BodyLine) => BodyLine) => string | null }) {
  const { line, replace } = props;
  const data = useGameData();
  const faction = useFaction();
  const names = useEntityNames();
  const spec = COMMANDS.get(line.name)!;

  const setArg = (i: number, value: string) => {
    const args = [...line.args];
    while (args.length <= i) args.push("");
    args[i] = value.trim();
    while (args.at(-1) === "") args.pop();
    if (args.includes("")) return "Fill in the earlier arguments first; RXP drops empty ones.";
    return replace((l) => (l.kind === "command" ? setCommandArgs(l, args) : l));
  };

  const hintFor = (i: number, value: string) => {
    if (line.name === "complete" && i === 1) {
      const id = lineQuest(line)?.questId;
      const quest = id === undefined ? undefined : data?.quest(id, faction);
      return (quest && namedRow(quest, Number(value))?.objective.name) ?? null;
    }
    if (line.name === "xp" && i === 0) return levelHint(value);
    return entityLinks(argumentEntities(line.name, withArg(line.args, i, value), i), data);
  };

  const placed = line.name === "goto" && data ? data.locateGoto(line.args) : undefined;
  const isIcon = (i: number) => line.name === "macro" && argSpecAt(spec, i)?.name === "icon";
  const short = (i: number) => isIcon(i) || SHORT_ARGS.has(argSpecAt(spec, i)?.kind ?? "text");
  const field = (i: number) => {
    const arg = argSpecAt(spec, i);
    const searchable = argumentType(line.name, line.args, i) !== undefined;
    const description = arg && (ARG_DESCRIPTIONS[arg.name] ?? arg.note);
    const icon = isIcon(i);
    return (
      <DraftField
        key={i}
        label={arg ? arg.name : `arg ${i + 1}`}
        placeholder={arg?.optional ? "optional" : undefined}
        draftName={argDraft(i)}
        description={searchable ? `${description ? `${description} ` : ""}Search by name or ID.` : description}
        value={line.args[i] ?? ""}
        list={arg?.kind === "zone" ? "zone-names" : undefined}
        layout="stacked"
        mono
        className={short(i) ? "arg-short" : "arg-grow"}
        hint={(value) => hintFor(i, value)}
        suggest={searchable ? (value, caret) => argumentSuggestions(names, line.name, withArg(line.args, i, value), i, caret) : undefined}
        {...(icon && { tools: (field: FieldText) => <MacroIcon field={field} committed={line.args[i] ?? ""} /> })}
        onCommit={(value) => setArg(i, value)}
      />
    );
  };
  const fields = (list: readonly number[]) =>
    groupShortFields(list, short).map((run) =>
      short(run[0]!) ? (
        <span key={run[0]} className="arg-run" style={{ "--run": run.length }}>
          {run.map(field)}
        </span>
      ) : (
        field(run[0]!)
      ),
    );
  const indexes = Array.from({ length: argFieldCount(spec, line.args.length) }, (_, i) => i);
  const advanced = indexes.filter((i) => argSpecAt(spec, i)?.advanced);
  const setAdvanced = advanced.flatMap((i) => (line.args[i] ? [`${argSpecAt(spec, i)!.name} ${line.args[i]}`] : []));
  return (
    <>
      <div className="command-form">
        {fields(indexes.filter((i) => !advanced.includes(i)))}
        <RxpTextField
          label=">> text"
          draftName=">> text"
          description={ARG_DESCRIPTIONS.text}
          value={line.text ?? ""}
          tools={(field) => <InsertReference field={field} />}
          onCommit={(value) => replace((l) => (l.kind === "command" ? setText(l, value.trim() ? value : undefined) : l))}
        />
        {placed && !placed.ok && <span className="warn">{placed.message}</span>}
      </div>
      <MoreOptions drafts={[...advanced.map(argDraft), LINE_CONDITION_DRAFT]} summary={moreOptionsSummary(line, setAdvanced)}>
        {advanced.length > 0 && <div className="command-form">{fields(advanced)}</div>}
        <LineCondition line={line} replace={replace} />
        <ReadOnlyComment line={line} />
      </MoreOptions>
    </>
  );
}

const argDraft = (i: number) => `arg ${i}`;

const MARKERS: TextMarker[] = [">>", "+", "*"];

function menuLabel(line: BodyLine, syntax: boolean): string {
  const described = describeLine(line, "step");
  return syntax ? `${described.title} (${described.syntax})` : described.title;
}

function TextForm(props: { line: TextLine; replace: (update: (l: BodyLine) => BodyLine) => string | null }) {
  const { line, replace } = props;
  const { showGuideSyntax } = useLayout();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="command-form">
        <Select
          aria-label="Text kind"
          value={line.marker}
          onChange={(e) => {
            const marker = MARKERS.find((m) => m === e.target.value);
            if (!marker) return;
            setError(
              replace((l) => {
                if (l.kind !== "text") return l;
                const { prefix: _prefix, ...rest } = edited(l);
                return marker === ">>" && line.prefix ? { ...rest, marker, prefix: line.prefix } : { ...rest, marker };
              }),
            );
          }}
        >
          {MARKERS.map((m) => (
            <option key={m} value={m}>
              {menuLabel({ ...line, marker: m }, showGuideSyntax)}
            </option>
          ))}
        </Select>
        <RxpTextField
          label="Text"
          draftName="Text"
          hideLabel
          value={line.text}
          tools={(field) => <InsertReference field={field} />}
          onCommit={(value) => replace((l) => (l.kind === "text" ? setText(l, value) : l))}
        />
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
      <MoreOptions drafts={[LINE_CONDITION_DRAFT]} summary={moreOptionsSummary(line, [])}>
        <LineCondition line={line} replace={replace} />
        <ReadOnlyComment line={line} />
      </MoreOptions>
    </>
  );
}

function InlineLine(props: { line: BodyLine; pos: LinePos; indent: string; commit: Commit }) {
  const { line, pos, indent, commit } = props;
  const text = lineText(line).slice(line.indent.length);
  const data = useGameData();
  return (
    <DraftField
      label="Line text"
      draftName="Line text"
      hideLabel
      value={text}
      list="catalog"
      mono
      className="line-text"
      placeholder=".command args >> text"
      hint={(value) => catalogHint(value, pos.step === null ? "header" : "step", data)}
      onCommit={(value) => {
        const next = parseLine(indent + value.trimStart());
        if (next.kind === "step") return "A step line starts a new step; use Add step instead.";
        return commit((d) => replaceLine(d, pos, next), { step: pos.step, line: pos.index }, pos.index);
      }}
    />
  );
}

function levelHint(value: string): string | null {
  const text = value.replaceAll(" ", "");
  const target = parseLevelTarget(text.replace(/^</, ""));
  if (!target) return null;
  const { level } = target;
  const words =
    target.kind === "level"
      ? `Level ${level}`
      : target.kind === "fraction"
        ? `${Math.round(target.fraction * 100)}% into level ${level}`
        : `${target.xp.toLocaleString("en-US")} XP ${target.kind === "plus" ? "into" : "short of"} level ${level}`;
  return text.startsWith("<") ? `${words}, reversed` : words;
}

export function entityLinks(entities: EntityId[], data: GameData | null): ReactNode {
  if (entities.length === 0) return null;
  const name = ({ type, id }: EntityId) => (type === "npc" ? data?.npcName(id) : undefined);
  return entities.map((entity, i) => [i > 0 && ", ", <EntityLink key={i} type={entity.type} id={entity.id} name={name(entity)} />]);
}

function catalogHint(text: string, section: "header" | "step", data: GameData | null) {
  const line = parseLine(text);
  if (line.kind === "command") {
    const spec = COMMANDS.get(line.name);
    if (!spec) return <span className="warn">.{line.name} is not in the catalog; RXP may not know it.</span>;
    const args = spec.args.map((a) => (a.optional ? `${a.name}?` : a.name));
    if (spec.repeat) args.push(`${spec.repeat.map((a) => a.name).join(", ")}…`);
    const entities = commandEntities(line.name, line.args);
    return (
      <>
        <code>
          .{spec.name} {args.join(", ")}
        </code>{" "}
        {spec.description}
        {spec.noHandler && <span className="warn"> RXP has no handler for it.</span>}
        {entities.length > 0 && <> · {entityLinks(entities, data)}</>}
      </>
    );
  }
  if (line.kind === "tag") {
    const spec = TAGS.get(line.name);
    if (!spec) return <span className="warn">#{line.name} is not in the catalog; RXP may not know it.</span>;
    if (spec.misspellingOf)
      return (
        <span className="warn">
          RXP ignores #{spec.name}; use #{spec.misspellingOf}.
        </span>
      );
    if (!tagAllowedIn(spec, section))
      return (
        <span className="warn">
          #{spec.name} belongs in the {section === "step" ? "header" : "steps"}.
        </span>
      );
    return spec.description;
  }
  return null;
}

const LINE_TEMPLATES: { key: string; label: (syntax: boolean) => string; make: (indent: string) => BodyLine }[] = [
  ...FORM_COMMANDS.map((name) => {
    const make = (indent: string): BodyLine => ({ kind: "command", indent, name, args: [] });
    return { key: name, label: (syntax: boolean) => menuLabel(make(""), syntax), make };
  }),
  ...MARKERS.map((marker) => {
    const make = (indent: string): BodyLine => ({ kind: "text", indent, marker, text: "" });
    return { key: marker, label: (syntax: boolean) => menuLabel(make(""), syntax), make };
  }),
  { key: "other", label: () => "Other line (type it)", make: (): BodyLine => ({ kind: "blank", indent: "" }) },
];

export function AddLineMenu(props: {
  label: string;
  description: string;
  icon?: IconName;
  className: string;
  onAdd: (make: (indent: string) => BodyLine) => string | null;
}) {
  const [key, setKey] = useState("accept");
  const [error, setError] = useState<string | null>(null);
  const { showGuideSyntax } = useLayout();
  return (
    <PopoverMenu className={props.className} label={props.label} icon={props.icon} description={props.description} align="start">
      {(close) => (
        <div className="add-line">
          <Select aria-label="New line type" value={key} onChange={(e) => setKey(e.target.value)}>
            {LINE_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label(showGuideSyntax)}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            size={28}
            onClick={() => {
              const failed = props.onAdd(LINE_TEMPLATES.find((t) => t.key === key)!.make);
              setError(failed);
              if (!failed) close();
            }}
          >
            Insert
          </Button>
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>
      )}
    </PopoverMenu>
  );
}

export function Datalists() {
  return (
    <>
      <datalist id="zone-names">
        {RXP_ZONE_TOKENS.map((name) => (
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- A datalist option shows its value.
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="catalog">
        {[...COMMANDS.values()].map((c) => (
          <option key={c.name} value={`.${c.name}`}>
            {c.description}
          </option>
        ))}
        {[...TAGS.values()].map((t) =>
          t.misspellingOf ? null : (
            <option key={t.name} value={`#${t.name}`}>
              {t.description}
            </option>
          ),
        )}
      </datalist>
    </>
  );
}

export function LineTextFields(props: {
  label: string;
  lines: readonly BodyLine[];
  indexes: readonly number[];
  step: number;
  commit: Commit;
}) {
  const { lines, step, commit } = props;
  const guide = useContext(DraftScope)!.guide;
  if (props.indexes.length === 0) return null;
  return (
    <div className="line-text-fields" role="group" aria-label={props.label}>
      {props.indexes.map((index) => {
        const line = lines[index]!;
        return (
          <DraftScope.Provider key={index} value={{ object: line, guide }}>
            <div role="group" aria-label={`Line ${index + 1}, ${describeLine(line, "step").title}`}>
              <InlineLine line={line} pos={{ step, index }} indent={line.indent} commit={commit} />
            </div>
          </DraftScope.Provider>
        );
      })}
    </div>
  );
}
