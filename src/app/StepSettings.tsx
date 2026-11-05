import { useId, useMemo } from "react";
import { setCondition, setTag, TAGS, updateStepLine, type BodyLine, type GuideDocument, type TagLine } from "../guide/index.ts";
import { Described } from "./Described.tsx";
import { ConditionEditor, DraftField } from "./fields.tsx";
import type { Commit } from "./EditorDock.tsx";
import { useLayout } from "./layout.ts";
import { LineTextFields, LineTitle } from "./LineFields.tsx";
import { Checkbox } from "./ui/Checkbox.tsx";

const STEP_CONDITION = "Who sees the step: faction, race, class, mode, or a minimum level. Space is and, / is or, ! negates.";
const STEP_FLAGS = ["optional", "sticky", "loop", "hardcore", "softcore", "som", "era", "ssf", "ah"];

const STEP_VALUES: { name: string; placeholder?: string; list?: string }[] = [
  { name: "label", placeholder: "such as Gnolls" },
  { name: "completewith", placeholder: "such as next", list: "labels-next" },
  { name: "requires", placeholder: "such as Gnolls", list: "labels" },
  { name: "level", placeholder: "such as 20" },
  { name: "xprate", placeholder: "such as <1.5" },
  { name: "season", placeholder: "such as 0,1" },
  { name: "phase", placeholder: "such as 4-6" },
];

const FORM_TAGS = new Set([...STEP_FLAGS, ...STEP_VALUES.map((v) => v.name)]);

export function StepSettings(props: { doc: GuideDocument; step: number; lines: readonly BodyLine[]; commit: Commit }) {
  const { doc, step, lines, commit } = props;
  const condition = doc.steps[step]!.line.condition;
  const id = useId();
  return (
    <div className="form-grid">
      <StepTags lines={lines} step={step} commit={commit} />
      <Described text={STEP_CONDITION}>
        <span id={`${id}-condition`} className="form-label">
          Condition
        </span>
      </Described>
      <div role="group" aria-labelledby={`${id}-condition`}>
        <ConditionEditor
          label="Step condition"
          draftName="Step condition"
          description={STEP_CONDITION}
          condition={condition}
          onCommit={(text) => commit((d) => updateStepLine(d, step, (l) => setCondition(l, text)))}
        />
      </div>
      <LabelLists doc={doc} />
    </div>
  );
}

function StepTags(props: { lines: readonly BodyLine[]; step: number; commit: Commit }) {
  const { lines, step, commit } = props;
  const { showGuideSyntax } = useLayout();
  const tag = (name: string) => lines.find((l): l is TagLine => l.kind === "tag" && l.name === name);
  const editedByForm = (l: TagLine) => FORM_TAGS.has(l.name) && tag(l.name) === l;
  const others = lines.flatMap((l, i) => (l.kind === "tag" && !editedByForm(l) ? [i] : []));
  const title = (name: string) => TAGS.get(name)!.title;
  const id = useId();
  return (
    <>
      <span id={`${id}-tags`} className="form-label">
        Tags
      </span>
      <div className="tag-checks" role="group" aria-labelledby={`${id}-tags`}>
        {STEP_FLAGS.map((name) => (
          <Checkbox
            key={name}
            label={
              <span>
                <LineTitle title={title(name)} syntax={`#${name}`} />
              </span>
            }
            description={TAGS.get(name)?.description}
            checked={tag(name) !== undefined}
            onChange={(e) => commit((d) => setTag(d, step, name, e.target.checked ? "" : null))}
          />
        ))}
      </div>
      <span id={`${id}-values`} className="form-label">
        Values
      </span>
      <div className="tag-values" role="group" aria-labelledby={`${id}-values`}>
        {STEP_VALUES.map(({ name, placeholder, list }) => (
          <DraftField
            key={name}
            label={showGuideSyntax ? `${title(name)} #${name}` : title(name)}
            draftName={`#${name}`}
            description={TAGS.get(name)?.description}
            value={tag(name)?.value ?? ""}
            placeholder={placeholder}
            list={list}
            layout="stacked"
            mono
            onCommit={(value) => commit((d) => setTag(d, step, name, value.trim() || null))}
          />
        ))}
      </div>
      {others.length > 0 && <span className="form-label">Other tags</span>}
      <LineTextFields label="Other tag lines" lines={lines} indexes={others} step={step} commit={commit} />
    </>
  );
}

function LabelLists({ doc }: { doc: GuideDocument }) {
  const labels = useMemo(
    () => [
      ...new Set(
        doc.steps.flatMap((s) => s.body.filter((l): l is TagLine => l.kind === "tag" && l.name === "label").map((l) => l.value.trim())),
      ),
    ],
    [doc.steps],
  );
  return (
    <>
      <datalist id="labels">
        {labels.map((l) => (
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- A datalist option shows its value.
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="labels-next">
        {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- A datalist option shows its value. */}
        <option value="next" />
        {labels.map((l) => (
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- A datalist option shows its value.
          <option key={l} value={l} />
        ))}
      </datalist>
    </>
  );
}
