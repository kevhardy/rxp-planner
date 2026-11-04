import { useContext, useId, useMemo, useState, useSyncExternalStore } from "react";
import { textureKey, type TextureKey } from "../../packages/data-contract/guideIcons.ts";
import type { GuideIconEntry, GuideIconSheet } from "../data/guideIcons.ts";
import { coloredText, guideTextures, isMacroIconId, shownTexts, textureNames, type GuideRecord, type RxpTexture } from "../guide/index.ts";
import { GuideIconsContext, StoresContext } from "./context.ts";
import { Dialog } from "./Dialog.tsx";
import { moveActive, OptionList, type FieldText } from "./fields.tsx";
import { iconLook, textureIcon } from "./guideIcon.ts";
import { GuideIcon } from "./GuideText.tsx";
import { Button, IconButton } from "./ui/Button.tsx";
import { Checkbox } from "./ui/Checkbox.tsx";
import { Field, Input } from "./ui/Field.tsx";
import { Segmented } from "./ui/Segmented.tsx";

/**
 * Where a field holds icons: texture escapes in guide text, or a `.macro`
 * icon argument, which is a bare FileDataID.
 */
export type IconSource = "text" | "macro";

function keysIn(text: string, source: IconSource): TextureKey[] {
  if (source === "text") {
    return coloredText(text).pieces.flatMap((piece) => (piece.kind === "opaque" && piece.lexeme === "texture" && piece.texture.key) || []);
  }
  const arg = text.trim();
  const key = isMacroIconId(arg) ? textureKey(arg) : undefined;
  return key ? [key] : [];
}

function useGuideIconsInUse(source: IconSource, committed: string, draft: string): Set<GuideIconEntry> {
  const { catalog } = useContext(GuideIconsContext);
  const doc = useContext(StoresContext)?.editor.getState().current?.doc;
  return useMemo(() => {
    const counts = new Map<TextureKey, number>();
    const add = (key: TextureKey, n: number) => counts.set(key, (counts.get(key) ?? 0) + n);
    if (doc) {
      for (const [key, uses] of guideTextures(doc).uses) add(key, uses.escapes + uses.macros);
      for (const key of keysIn(committed, source)) add(key, -1);
    }
    for (const key of keysIn(draft, source)) add(key, 1);
    return new Set([...counts].flatMap(([key, n]) => (n > 0 && catalog.get(key)) || []));
  }, [catalog, doc, source, committed, draft]);
}

const builtinNames = new WeakMap<ReadonlyMap<string, GuideRecord>, Map<TextureKey, string[]>>();

function useGuideIconNames(draft: string): Map<GuideIconEntry, string[]> {
  const { catalog } = useContext(GuideIconsContext);
  const state = useContext(StoresContext)?.editor.getState();
  const doc = state?.current?.doc;
  const builtins = state?.builtins;
  return useMemo(() => {
    if (builtins && !builtinNames.has(builtins)) {
      builtinNames.set(builtins, textureNames([...builtins.values()].flatMap((guide) => shownTexts(guide.text))));
    }
    return catalog.iconNames(textureNames([draft, ...(doc ? shownTexts(doc) : [])]), (builtins && builtinNames.get(builtins)) ?? new Map());
  }, [catalog, doc, builtins, draft]);
}

const noSheet = () => () => {};

function SheetStatus(props: { sheet: GuideIconSheet | undefined }) {
  const { sheet } = props;
  const state = useSyncExternalStore(sheet?.subscribe ?? noSheet, () => sheet?.state);
  if (state === "loading") return <p className="muted">Loading the icon images…</p>;
  if (state !== "failed") return null;
  return (
    <p className="error">
      The icon images did not load. The icons show as outlines.{" "}
      <Button variant="secondary" onClick={() => sheet!.retry()}>
        Retry
      </Button>
    </p>
  );
}

function IconOption(props: { entry: GuideIconEntry; names: readonly string[] }) {
  const { entry } = props;
  const [label, ...others] = props.names;
  const { catalog } = useContext(GuideIconsContext);
  const look = iconLook(catalog, entry, { width: 32, height: 32 });
  return (
    <>
      <GuideIcon look={look} aria-hidden="true" />{" "}
      <span className="option-text">
        <span className="option-name">{label ?? entry.name}</span>{" "}
        {others.length > 0 && (
          <>
            <span className="entity-sub">
              {others.slice(0, 2).join(", ")}
              {others.length > 2 && ` +${others.length - 2}`}
            </span>{" "}
          </>
        )}
        {label && (
          <>
            <span className="entity-sub">{entry.name}</span>{" "}
          </>
        )}
        <span className="entity-sub">{entry.category}</span>
      </span>{" "}
      <span className="option-id">#{entry.id}</span>
    </>
  );
}

/**
 * Finds a guide icon by its name, the item names that guides write after it,
 * its category, or its ID, and whether the open guide shows it. Every match
 * is listed. `replacing` is the texture a choice replaces, and `written` its
 * key as the guide writes it. `onChoose` returns an error message to keep the
 * dialog open.
 */
export function IconPicker(props: {
  source: IconSource;
  committed: string;
  draft: string;
  replacing?: { texture: RxpTexture; written: string } | undefined;
  onChoose: (entry: GuideIconEntry) => string | null;
  onClose: () => void;
}) {
  const { replacing, onClose } = props;
  const { catalog, sheet } = useContext(GuideIconsContext);
  const inGuide = useGuideIconsInUse(props.source, props.committed, props.draft);
  const names = useGuideIconNames(props.draft);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [onlyGuide, setOnlyGuide] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const found = catalog
    .search(query, names)
    .filter((entry) => (category === null || entry.category === category) && (!onlyGuide || inGuide.has(entry)));
  const current = found.length > 0 ? Math.min(active, found.length - 1) : -1;
  const action = props.source === "macro" ? "Choose" : replacing ? "Replace" : "Insert";

  const choose = (entry: GuideIconEntry) => {
    const message = props.onChoose(entry);
    if (message) setError(message);
    else onClose();
  };
  const filter = (apply: () => void) => {
    apply();
    setActive(0);
    setError(null);
  };

  const listId = `${id}-options`;
  const shown = replacing && textureIcon(catalog, replacing.texture, replacing.written);
  if (catalog.all.length === 0) {
    return (
      <Dialog title={`${action} icon`} onClose={onClose} className="icon-picker">
        <p className="muted" role="status">
          This dataset release has no guide icons. You can still write a texture escape, such as |T134414:0|t, in the text.
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" size={32} onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={`${action} icon`} onClose={onClose} className="icon-picker">
      {shown && (
        <p className="icon-current">
          Replacing <GuideIcon look={shown.look} role="img" aria-label={shown.name} /> {shown.name}
        </p>
      )}
      <SheetStatus sheet={sheet} />
      <Field label="Icon name or ID" layout="stacked">
        <Input
          size={32}
          data-autofocus
          value={query}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={found.length > 0}
          aria-controls={found.length > 0 ? listId : undefined}
          aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
          onChange={(e) => filter(() => setQuery(e.target.value))}
          onKeyDown={(e) => {
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && found.length > 0) {
              e.preventDefault();
              setActive(moveActive(e.key, current, found.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (current >= 0) choose(found[current]!);
            }
          }}
        />
      </Field>
      <Segmented
        label="Category"
        size={32}
        className="icon-categories"
        value={category}
        options={[null, ...catalog.categories].map((c) => ({ value: c, label: c ?? "All" }))}
        onChange={(c) => filter(() => setCategory(c))}
      />
      <Checkbox label="In this guide" checked={onlyGuide} onChange={(e) => filter(() => setOnlyGuide(e.target.checked))} />
      <p className="muted" role="status">
        {found.length === 0 ? "No icons match." : found.length === 1 ? "1 icon" : `${found.length} icons`}
      </p>
      {found.length > 0 && (
        <OptionList
          id={listId}
          label="Icons"
          options={found.map((entry) => ({ key: String(entry.id), label: <IconOption entry={entry} names={names.get(entry) ?? []} /> }))}
          active={current}
          onChoose={(i) => choose(found[i]!)}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="primary" size={32} disabled={current < 0} onClick={() => choose(found[current]!)}>
          {action}
        </Button>
      </div>
    </Dialog>
  );
}

export function IconTool(props: { label: string; description: string; onOpen: () => void }) {
  return <IconButton icon="image" label={props.label} description={props.description} aria-haspopup="dialog" onClick={props.onOpen} />;
}

export function MacroIcon(props: { field: FieldText; committed: string }) {
  const { field } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconTool label="Choose icon" description="Pick the macro's icon" onOpen={() => setOpen(true)} />
      {open && (
        <IconPicker
          source="macro"
          committed={props.committed}
          draft={field.text}
          onChoose={(entry) => {
            field.replace(String(entry.id), String(entry.id).length);
            return null;
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
