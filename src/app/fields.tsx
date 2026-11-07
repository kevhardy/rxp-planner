import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import type { FocusEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { conditionRows, conditionRowsText, type Condition, type ConditionLiteral } from "../guide/index.ts";
import { Described } from "./Described.tsx";
import { NO_DRAFT, readDraft, subscribeDrafts, writeDraft, type DraftOwner, type DraftState } from "./drafts.ts";
import { useEachFrame, usePendingAction } from "./effects.ts";
import { useOverlayRoot } from "./overlayRoot.ts";
import { Button, IconButton } from "./ui/Button.tsx";
import { Field, Input, Select } from "./ui/Field.tsx";

/** Owns the drafts of the fields below; see `drafts.ts`. Without one, drafts last as long as the field. */
export const DraftScope = createContext<DraftOwner | null>(null);

export function useDraft(name: string): [DraftState, (state: DraftState) => void] {
  const scope = useContext(DraftScope);
  const [local] = useState((): DraftOwner => ({ object: { unscoped: true }, guide: "" }));
  const owner = scope ?? local;
  const state = useSyncExternalStore(subscribeDrafts, () => readDraft(owner, name));
  return [state, (next) => writeDraft(owner, name, next)];
}

export function useDraftCommit(name: string, value: string, onCommit: (value: string) => string | null) {
  const [state, setState] = useDraft(name);
  const commit = () => {
    const { draft } = state;
    if (draft === null) return;
    setState(NO_DRAFT);
    const error = draft === value ? null : onCommit(draft);
    if (error) setState({ draft, error });
  };
  return [state, setState, commit] as const;
}

const inToolDialog = (next: Element, control: Element | null) => {
  const dialog = next.closest("dialog");
  return !!dialog && !dialog.contains(control);
};

export function commitOnLeave(control: RefObject<Element | null>, commit: () => void) {
  return (e: FocusEvent) => {
    // Ignore blurs inside a tool's dialog, which React passes up from its portal.
    if (!e.currentTarget.contains(e.target)) return;
    const next = e.relatedTarget;
    const stays = !!next && (e.currentTarget.contains(next) || !!control.current?.contains(next) || inToolDialog(next, control.current));
    if (!stays) commit();
  };
}

export interface Suggestion {
  key: string;
  label: ReactNode;
  value: string;
  /** Where the caret goes in `value`. */
  caret: number;
  /** Why the choice cannot be used; choosing it shows this as the field's error instead. */
  error?: string;
}

export interface Suggestions {
  options: readonly Suggestion[];
  status?: string;
}

export interface FieldText {
  /** The draft, else the value. */
  text: string;
  selection(): [start: number, end: number];
  /** Sets the draft, then focuses the input with the caret at `caret`. */
  replace(text: string, caret: number): void;
}

/**
 * A text input that keeps a draft and commits it on Enter or blur. `onCommit`
 * returns an error message to keep the draft and show the error; Escape
 * drops the draft. Drafts are kept under `draftName` with the current
 * `DraftScope` owner.
 *
 * With `suggest`, typing lists choices under the input, a combobox with no
 * choice made for the user: arrows move through them, and Enter or a click
 * puts the chosen text in the draft without committing it. The choices follow
 * the caret, and moving it clears the active choice. Escape closes the list
 * before it drops the draft. Like a description, the list renders in
 * `document.body`, or in the open dialog that holds the input, so no pane clips it; it stays inside the nearest
 * `data-tip-bounds` pane (`placePopup`) and closes when the pane scrolls
 * the input out of view.
 *
 * With `tools`, the input and its tools edit as one: focus moving between
 * them, or into a dialog a tool opens, keeps the draft, and focus leaving
 * them commits it. A dialog returns focus when it closes.
 *
 * An error stays until a commit succeeds or the draft is dropped, while the
 * draft changes by typing, a choice, or a tool.
 */
export function DraftField(props: {
  label: string;
  value: string;
  onCommit: (value: string) => string | null;
  /** Text after the input; a function receives the input's current text. */
  hint?: ReactNode | ((value: string) => ReactNode);
  description?: string | undefined;
  placeholder?: string | undefined;
  list?: string | undefined;
  className?: string;
  /** Visually hide the label; it stays the input's accessible name. */
  hideLabel?: boolean;
  layout?: "inline" | "stacked";
  mono?: boolean;
  /** Names the field's draft, unique in its scope, so a label change keeps it. */
  draftName: string;
  /** Choices for the text with the caret at `caret`, or undefined for none. */
  suggest?: ((text: string, caret: number) => Suggestions | undefined) | undefined;
  /** Controls after the field that may change its text; see above. */
  tools?: (field: FieldText) => ReactNode;
}) {
  const { label, value, onCommit, suggest } = props;
  const [{ draft, error }, setState, commit] = useDraftCommit(props.draftName, value, onCommit);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const tools = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLElement>(null);
  const overlayRoot = useOverlayRoot();
  const [listed, setListed] = useState(false);
  const [active, setActive] = useState(-1);
  const [caret, setCaret] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const text = draft ?? value;
  const hint = typeof props.hint === "function" ? props.hint(text) : props.hint;
  const at = caret ?? text.length;
  const suggestions = listed && suggest ? suggest(text, at) : undefined;
  const options = suggestions?.options ?? [];
  const current = active < options.length ? active : -1;
  const status = options.length === 0 ? suggestions?.status : undefined;
  const popped = options.length > 0 || !!status;

  usePendingAction(pendingCaret, (at) => {
    input.current!.focus();
    input.current!.setSelectionRange(at, at);
  });

  useEachFrame(() => {
    const anchor = input.current;
    const box = popup.current;
    if (!popped || !anchor || !box) return false;
    const at = anchor.getBoundingClientRect();
    const pane = anchor.closest("[data-tip-bounds]") ?? document.getElementById("app");
    const bounds = visible(pane?.getBoundingClientRect());
    if (anchor.closest("[inert]") || at.bottom < bounds.top || at.top > bounds.bottom) {
      setListed(false);
      return false;
    }
    const border = box.offsetHeight - box.clientHeight;
    const { left, top, width, maxHeight } = placePopup(at, box.scrollHeight + border, bounds);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
    if (box.style.maxHeight !== `${maxHeight}px`) {
      box.style.maxHeight = `${maxHeight}px`;
      revealActive(box);
    }
  });

  const choose = (option: Suggestion) => {
    setListed(false);
    setActive(-1);
    if (option.error) return setState({ draft: text, error: option.error });
    setState({ draft: option.value, error });
    setCaret(option.caret);
    pendingCaret.current = option.caret;
  };

  const field: FieldText = {
    text,
    selection: () => [input.current?.selectionStart ?? text.length, input.current?.selectionEnd ?? text.length],
    replace: (next, to) => {
      setState({ draft: next, error });
      setCaret(to);
      pendingCaret.current = to;
    },
  };

  const listId = `${id}-options`;
  const combobox = suggest && {
    role: "combobox",
    "aria-autocomplete": "list" as const,
    "aria-expanded": options.length > 0,
    "aria-controls": options.length > 0 ? listId : undefined,
    "aria-activedescendant": current >= 0 ? `${listId}-${current}` : undefined,
  };
  const control = (
    <Input
      ref={input}
      value={text}
      placeholder={props.placeholder}
      list={props.list}
      spellCheck={false}
      autoComplete="off"
      mono={props.mono ?? false}
      {...combobox}
      onChange={(e) => {
        setState({ draft: e.target.value, error });
        setListed(true);
        setActive(-1);
        setCaret(e.target.selectionStart);
      }}
      onSelect={(e) => {
        if (e.currentTarget.selectionStart === at) return;
        setCaret(e.currentTarget.selectionStart);
        setActive(-1);
      }}
      onBlur={(e) => {
        setListed(false);
        if (!tools.current?.contains(e.relatedTarget)) commit();
      }}
      onKeyDown={(e) => {
        const moved = !!suggest && e.currentTarget.selectionStart !== at;
        if (moved) {
          setCaret(e.currentTarget.selectionStart);
          setActive(-1);
        }
        if (suggest && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          if (options.length === 0 || moved) setListed(true);
          else setActive(moveActive(e.key, current, options.length));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (current >= 0) return moved ? undefined : choose(options[current]!);
          setListed(false);
          commit();
        } else if (e.key === "Escape" && suggestions) {
          e.preventDefault();
          setListed(false);
        } else if (e.key === "Escape" && draft !== null) {
          e.preventDefault();
          setState(NO_DRAFT);
        }
      }}
    />
  );

  return (
    <>
      <Field
        id={id}
        label={label}
        hint={hint}
        error={error}
        layout={props.layout ?? "inline"}
        hideLabel={props.hideLabel ?? false}
        description={props.description}
        popoverOpen={popped}
        className={props.className}
      >
        {control}
      </Field>
      {props.tools && (
        <span className="field-tools" ref={tools} onBlur={commitOnLeave(input, commit)}>
          {props.tools(field)}
        </span>
      )}
      {popped &&
        createPortal(
          options.length > 0 ? (
            <OptionList
              ref={popup as Ref<HTMLDivElement>}
              id={listId}
              label={label}
              options={options}
              active={current}
              onChoose={(i) => choose(options[i]!)}
              className="popup"
            />
          ) : (
            <span ref={popup} className="options options-status popup" role="status">
              {status}
            </span>
          ),
          overlayRoot,
        )}
    </>
  );
}

/** The next active option for ArrowDown or ArrowUp, wrapping around; -1 means none. */
export function moveActive(key: "ArrowDown" | "ArrowUp", active: number, count: number): number {
  if (key === "ArrowDown") return active < count - 1 ? active + 1 : 0;
  return active > 0 ? active - 1 : count - 1;
}

const GAP = 4;
const EDGE_MARGIN = 4;
const MIN_WIDTH = 300;
const MAX_HEIGHT = 260;

function visible(rect?: DOMRect) {
  return {
    top: Math.max(rect?.top ?? 0, 0),
    right: Math.min(rect?.right ?? innerWidth, innerWidth),
    bottom: Math.min(rect?.bottom ?? innerHeight, innerHeight),
    left: Math.max(rect?.left ?? 0, 0),
  };
}

/**
 * Where a suggestion list goes: under the anchor and left-aligned, at least
 * `MIN_WIDTH` wide, moved left or narrowed to stay inside the bounds. It
 * goes above when that has more room and the room below cannot show it
 * whole, and its height is cut to the room on its side.
 */
export function placePopup(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  height: number,
  bounds: Pick<DOMRect, "top" | "right" | "bottom" | "left">,
) {
  const width = Math.max(0, Math.min(Math.max(anchor.width, MIN_WIDTH), bounds.right - bounds.left - 2 * EDGE_MARGIN));
  const left = Math.max(bounds.left + EDGE_MARGIN, Math.min(anchor.left, bounds.right - EDGE_MARGIN - width));
  const below = bounds.bottom - EDGE_MARGIN - anchor.bottom - GAP;
  const above = anchor.top - GAP - bounds.top - EDGE_MARGIN;
  const up = below < Math.min(height, MAX_HEIGHT) && above > below;
  const maxHeight = Math.max(0, Math.min(MAX_HEIGHT, up ? above : below));
  const top = up ? anchor.top - GAP - Math.min(height, maxHeight) : anchor.bottom + GAP;
  return { left, top, width, maxHeight };
}

function revealActive(list: HTMLElement) {
  const option = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!option) return;
  if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
  else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }
}

/**
 * A combobox's listbox. The input keeps focus and points at the active
 * option with `aria-activedescendant`, whose ID is `${id}-${index}`. A press
 * on an option keeps focus in the input.
 */
export function OptionList(props: {
  id: string;
  label: string;
  options: readonly { key: string; label: ReactNode }[];
  active: number;
  onChoose: (index: number) => void;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const { id, active } = props;
  useEffect(() => {
    const list = document.getElementById(id);
    if (list) revealActive(list);
  }, [id, active]);
  return (
    <div ref={props.ref} id={id} role="listbox" aria-label={props.label} className={`options ${props.className ?? ""}`}>
      {props.options.map((option, i) => (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- The combobox input keeps focus and takes the keys.
        <div
          key={option.key}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.onChoose(i)}
        >
          {option.label}
        </div>
      ))}
    </div>
  );
}

const CONDITION_TOKENS = {
  Faction: ["Alliance", "Horde"],
  Race: ["Human", "Dwarf", "NightElf", "Gnome", "Orc", "Undead", "Tauren", "Troll"],
  Class: ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"],
  Mode: ["sod", "era", "skip"],
} as const;

const categoryOf = (token: string) =>
  Object.entries(CONDITION_TOKENS)
    .find(([, tokens]) => (tokens as readonly string[]).includes(token))?.[0]
    .toLowerCase() ?? "other";

/**
 * Edits a `<<` condition as text, and as alternatives of faction, race,
 * class, and mode tokens when the expression has that shape. `onCommit`
 * receives the new text, or undefined to remove the condition. `label` names
 * the text field for assistive technology; the caller shows any visible label.
 */
export function ConditionEditor(props: {
  label: string;
  draftName: string;
  condition: Condition | undefined;
  onCommit: (text: string | undefined) => string | null;
  description?: string | undefined;
  compact?: boolean;
}) {
  const { condition, onCommit } = props;
  const [open, setOpen] = useState(!props.compact);
  const [error, setError] = useState<string | null>(null);
  const rows = condition ? conditionRows(condition.expr) : [];
  const commitText = (text: string) => {
    setError(null);
    return onCommit(text.trim() || undefined);
  };
  const commitRows = (next: ConditionLiteral[][]) => setError(commitText(conditionRowsText(next)));

  return (
    <div className={`condition${props.compact ? " compact" : ""}`}>
      <span className="condition-text">
        <DraftField
          label={props.label}
          draftName={props.draftName}
          value={condition?.text ?? ""}
          onCommit={commitText}
          description={props.description}
          placeholder="none"
          hideLabel
          mono
        />
        {props.compact && (
          <IconButton
            icon="sliders"
            label={`${open ? "Hide" : "Show"} ${props.label.toLowerCase()} filters`}
            description="Condition filters"
            expanded={open}
            onClick={() => setOpen(!open)}
          />
        )}
      </span>
      {open &&
        (rows === null ? (
          <p className="muted">This condition uses groups; edit it as text.</p>
        ) : (
          <div className="alternatives" role="group" aria-label={`${props.label} filters`}>
            {rows.map((row, r) => (
              <div key={r} className="alternative">
                {r > 0 && <span className="or">or</span>}
                {row.map((lit, t) => (
                  <span key={t} className={`token token-${categoryOf(lit.token)}`}>
                    <Described text={lit.not ? "Negated with !" : "Negate with !"}>
                      <Button
                        variant="ghost"
                        pressed={lit.not}
                        aria-label={`Negate ${lit.token}`}
                        onClick={() =>
                          commitRows(rows.map((x, i) => (i === r ? x.map((l, j) => (j === t ? { ...l, not: !l.not } : l)) : x)))
                        }
                      >
                        {lit.not ? "not " : ""}
                        {lit.token}
                      </Button>
                    </Described>
                    <IconButton
                      icon="x"
                      label={`Remove ${lit.token}`}
                      onClick={() => commitRows(rows.map((x, i) => (i === r ? x.filter((_, j) => j !== t) : x)))}
                    />
                  </span>
                ))}
                <TokenPicker
                  label={row.length === 0 ? "Add filter" : "and…"}
                  onPick={(token) => commitRows(rows.map((x, i) => (i === r ? [...x, { token, not: false }] : x)))}
                />
              </div>
            ))}
            <TokenPicker
              label={rows.length === 0 ? "Add filter" : "or…"}
              onPick={(token) => commitRows([...rows, [{ token, not: false }]])}
            />
          </div>
        ))}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function TokenPicker(props: { label: string; onPick: (token: string) => void }) {
  return (
    <Select
      aria-label={props.label}
      value=""
      onChange={(e) => {
        if (e.target.value) props.onPick(e.target.value);
      }}
    >
      <option value="">{props.label}</option>
      {Object.entries(CONDITION_TOKENS).map(([group, tokens]) => (
        <optgroup key={group} label={group}>
          {tokens.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
