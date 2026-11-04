import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  coloredText,
  copyColoredText,
  editColoredText,
  RXP_COLORS,
  textureAt,
  unitBeside,
  writeTexture,
  writtenKey,
  type RxpColor,
  type RxpRange,
  type RxpTextChange,
  type RxpTextEdit,
  type TexturePiece,
} from "../guide/index.ts";
import { useGuideIcons } from "./context.ts";
import { Described } from "./Described.tsx";
import { NO_DRAFT } from "./drafts.ts";
import { useEventListener, usePendingAction } from "./effects.ts";
import { useDraft, type FieldText } from "./fields.tsx";
import { IconPicker, IconTool } from "./IconPicker.tsx";
import { readRxpSelection, renderRxpText, restoreRxpSelection, sourceRange } from "./rxpTextDom.ts";
import { Button } from "./ui/Button.tsx";

interface Snapshot {
  text: string;
  selection: RxpRange;
}

interface IconTarget extends Snapshot {
  texture: TexturePiece | undefined;
}

const oneLine = (text: string) => text.replace(/\r\n|[\r\n]/g, " ");

export function RxpTextField(props: {
  label: string;
  draftName: string;
  value: string;
  onCommit: (value: string) => string | null;
  description?: string | undefined;
  hideLabel?: boolean;
  tools?: (field: FieldText) => ReactNode;
}) {
  const { label, value, onCommit } = props;
  const [{ draft, error }, setState] = useDraft(props.draftName);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const source = draft ?? value;
  const text = useMemo(() => coloredText(source), [source]);
  const catalog = useGuideIcons();
  const shown = useRef<Snapshot>({ text: "", selection: [0, 0] });
  const pending = useRef<RxpRange | null>(null);
  const history = useRef({ value, undo: [] as Snapshot[], redo: [] as Snapshot[] });
  const composing = useRef<RxpRange | null>(null);
  // Bumped after composition, whose text the browser wrote into the DOM.
  const [rebuild, setRebuild] = useState(0);
  const [selected, setSelected] = useState<RxpRange | null>(null);
  const [picking, setPicking] = useState<IconTarget | null>(null);

  useLayoutEffect(() => {
    const el = root.current!;
    renderRxpText(el, text, catalog);
    const kept = shown.current.text === text.source ? shown.current.selection : null;
    shown.current = { text: text.source, selection: pending.current ?? kept ?? [text.source.length, text.source.length] };
    if (document.activeElement === el) restoreRxpSelection(el, shown.current.selection);
  }, [text, catalog, rebuild]);

  usePendingAction(pending, (at) => {
    const el = root.current!;
    el.focus();
    restoreRxpSelection(el, at);
  });

  const remember = (event: Event) => {
    const el = root.current!;
    const at = !composing.current && (event.type === "focusout" || document.activeElement === el) ? readRxpSelection(el) : null;
    if (!at) return;
    shown.current = { ...shown.current, selection: at };
    setSelected((last) => (last && last[0] === at[0] && last[1] === at[1] ? last : at));
  };
  useEventListener(() => document, "selectionchange", remember);
  // Tab can move focus before the queued selectionchange event arrives.
  useEventListener(() => root.current, "focusout", remember);

  const selection = (): RxpRange => {
    const el = root.current;
    const live = el && document.activeElement === el && !composing.current ? readRxpSelection(el) : null;
    return live ?? (shown.current.text === source ? shown.current.selection : [source.length, source.length]);
  };

  const log = () => {
    if (history.current.value !== value) history.current = { value, undo: [], redo: [] };
    return history.current;
  };

  const change = (next: RxpTextChange) => {
    if (next.text === source) {
      pending.current = next.selection;
      setRebuild((n) => n + 1);
      return;
    }
    const steps = log();
    steps.undo.push({ text: source, selection: selection() });
    steps.redo = [];
    pending.current = next.selection;
    setState({ draft: next.text, error });
  };

  const edit = (e: RxpTextEdit) => change(editColoredText(text, e));

  const travel = (direction: "undo" | "redo") => {
    const steps = log();
    const [from, to] = direction === "undo" ? [steps.undo, steps.redo] : [steps.redo, steps.undo];
    const last = from.pop();
    if (!last) return;
    to.push({ text: source, selection: selection() });
    pending.current = last.selection;
    setState({ draft: last.text, error });
  };

  const remove = (direction: "backward" | "forward", target?: RxpRange | null) => {
    const [start, end] = selection();
    const range = start !== end ? ([start, end] as const) : (target ?? unitBeside(text, start, direction));
    if (range && range[0] !== range[1]) edit({ kind: "replace", range, text: "" });
  };

  // Native, since React's onBeforeInput has no `inputType`.
  useEventListener(
    () => root.current,
    "beforeinput",
    (e) => {
      if (e.isComposing || e.inputType === "insertCompositionText") return;
      e.preventDefault();
      const backward = e.inputType.includes("Backward");
      if (e.inputType === "insertText" || e.inputType === "insertReplacementText") {
        const data = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
        edit({ kind: "replace", range: selection(), text: oneLine(data) });
      } else if (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward") {
        remove(backward ? "backward" : "forward");
      } else if (e.inputType.startsWith("delete")) {
        const [target] = e.getTargetRanges?.() ?? [];
        remove(backward ? "backward" : "forward", target && sourceRange(root.current!, target));
      } else if (e.inputType === "historyUndo") {
        travel("undo");
      } else if (e.inputType === "historyRedo") {
        travel("redo");
      }
    },
  );

  const commit = () => {
    if (draft === null) return;
    setState(NO_DRAFT);
    const message = draft === value ? null : onCommit(draft);
    if (message) setState({ draft, error: message });
  };

  const paint = (color: RxpColor | null) => {
    const range = selection();
    if (range[0] !== range[1]) edit({ kind: "color", range, color });
  };

  const pick = (texture: TexturePiece | undefined) => setPicking({ text: source, selection: selection(), texture });
  const before = selected ? textureAt(text, selected) : undefined;

  const closePicker = () => {
    if (!pending.current) {
      pending.current = picking!.selection;
      setRebuild((n) => n + 1);
    }
    setPicking(null);
  };

  const field: FieldText = {
    text: source,
    selection: () => [...selection()],
    replace: (next, caret) => change({ text: next, selection: [caret, caret] }),
  };

  const swatch = (spec: (typeof RXP_COLORS)[number] | null) => (
    <Described
      key={spec?.color ?? "clear"}
      text={spec ? `${spec.name} (${spec.code}). ${spec.description}` : "Remove RXP colors from the selection. Hex colors stay."}
    >
      <Button variant="ghost" className="rxp-swatch" onMouseDown={(e) => e.preventDefault()} onClick={() => paint(spec?.color ?? null)}>
        {spec && <span className="rxp-swatch-color" data-color={spec.color} aria-hidden="true" />}
        {spec?.name ?? "Clear"}
      </Button>
    </Described>
  );

  return (
    <div
      className="rxp-field"
      onBlur={(e) => {
        // Ignore blurs inside a tool's dialog, which React passes up from its portal.
        if (!e.currentTarget.contains(e.target)) return;
        const next = e.relatedTarget;
        const dialog = next?.closest("dialog");
        if (!(next && e.currentTarget.contains(next)) && !(dialog && !dialog.contains(root.current))) commit();
      }}
    >
      <span id={`${id}-label`} className={props.hideLabel ? "sr-only" : "ui-field-label"}>
        {label}
      </span>
      <Described text={props.description}>
        <span className="rxp-text-field">
          <div
            ref={root}
            id={id}
            role="textbox"
            contentEditable
            tabIndex={0}
            spellCheck={false}
            className="rxp-text"
            aria-labelledby={`${id}-label`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || composing.current) return;
              const key = e.key.toLowerCase();
              if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
                e.preventDefault();
                travel(key === "z" && !e.shiftKey ? "undo" : "redo");
              } else if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape" && draft !== null) {
                e.preventDefault();
                history.current = { value, undo: [], redo: [] };
                setState(NO_DRAFT);
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              edit({ kind: "replace", range: selection(), text: oneLine(e.clipboardData.getData("text/plain")) });
            }}
            onCopy={(e) => {
              e.preventDefault();
              e.clipboardData.setData("text/plain", copyColoredText(text, selection()));
            }}
            onCut={(e) => {
              e.preventDefault();
              const range = selection();
              e.clipboardData.setData("text/plain", copyColoredText(text, range));
              if (range[0] !== range[1]) edit({ kind: "replace", range, text: "" });
            }}
            onDrop={(e) => e.preventDefault()}
            onMouseUp={() => {
              const el = root.current!;
              const caret = document.getSelection();
              const node = caret?.anchorNode;
              const element = node instanceof Element ? node : node?.parentElement;
              if (composing.current || !caret?.isCollapsed || !element?.closest(".rxp-chip")) return;
              const at = readRxpSelection(el);
              // Chromium can place a clicked caret inside a non-editable chip, where typing sends no input event.
              if (at) restoreRxpSelection(el, at);
            }}
            onMouseDown={(e) => {
              const chip = e.target instanceof Element ? e.target.closest(".rxp-icon-chip") : null;
              if (e.button !== 0 || !(chip instanceof HTMLElement)) return;
              e.preventDefault();
              pick(textureAt(text, [Number(chip.dataset.from), Number(chip.dataset.to)]));
            }}
            onCompositionStart={() => {
              composing.current = selection();
            }}
            onCompositionEnd={(e) => {
              const range = composing.current;
              composing.current = null;
              setRebuild((n) => n + 1);
              if (range) edit({ kind: "replace", range, text: oneLine(e.data) });
            }}
          />
          {error && (
            <span id={`${id}-error`} className="ui-field-error" role="alert">
              {error}
            </span>
          )}
        </span>
      </Described>
      <span className="field-tools">
        {props.tools?.(field)}
        {before ? (
          <IconTool label="Replace icon" description="Replace the icon before the caret" onOpen={() => pick(before)} />
        ) : (
          <IconTool label="Insert icon" description="Insert a guide icon at the caret." onOpen={() => pick(undefined)} />
        )}
      </span>
      <div className="rxp-colors" role="group" aria-label={`${label} colors`}>
        {RXP_COLORS.map(swatch)}
        <span className="rxp-clear">{swatch(null)}</span>
      </div>
      {picking && (
        <IconPicker
          source="text"
          committed={value}
          draft={picking.text}
          replacing={picking.texture && { texture: picking.texture.texture, written: writtenKey(picking.text, picking.texture) }}
          onChoose={(entry) => {
            if (source !== picking.text) return "The text changed after the picker opened, so the picker changed nothing.";
            change(writeTexture(text, picking.texture ?? picking.selection, entry.id));
            return null;
          }}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
