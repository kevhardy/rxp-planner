import { useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { GuideRecord } from "../guide/index.ts";
import { OpenImportContext, useEditor, useEditorStore } from "./context.ts";
import { Described } from "./Described.tsx";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { sourceLabel, type FoundGuide, type ImportReader, type ImportSource } from "./importReader.ts";
import { Button } from "./ui/Button.tsx";
import { Checkbox, Radio } from "./ui/Checkbox.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Field, FileInput, TextArea } from "./ui/Field.tsx";
import { guideKey, guideMeta } from "../rules/registration.ts";
import type { NewGuide } from "./store.ts";

interface EntryChoice {
  include?: boolean;
  choice?: "replace" | "keep";
}

type Entry = FoundGuide & { include: boolean; choice?: "replace" | "keep" | undefined };

type Clash = { stored: string } | { entry: string };

export function ImportDialog(props: { reader: ImportReader; onClose: () => void }) {
  const { reader } = props;
  const store = useEditorStore();
  const { guides } = useEditor();
  const { sources, done, found, errors } = useSyncExternalStore(reader.subscribe, reader.getState);
  const [picks, setPicks] = useState<Readonly<Record<string, EntryChoice>>>({});
  const [pasted, setPasted] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const reading = done < sources.length;
  const onClose = () => {
    reader.close();
    props.onClose();
  };

  const entries = useMemo(
    () => found.map((f): Entry => ({ ...f, include: picks[f.key]?.include ?? !f.matchesBuiltin, choice: picks[f.key]?.choice })),
    [found, picks],
  );

  const clashes = useMemo(() => {
    const holders = new Map<string, Clash>();
    const keyOf = (g: GuideRecord) => {
      const meta = guideMeta(g);
      return meta.name ? guideKey(meta) : undefined;
    };
    for (const g of guides.values()) {
      const k = keyOf(g);
      if (k && !holders.has(k)) holders.set(k, { stored: g.id });
    }
    const out = new Map<string, Clash>();
    for (const entry of entries) {
      const k = entry.include ? keyOf(entry.probe) : undefined;
      if (!k) continue;
      const holder = holders.get(k);
      if (holder) out.set(entry.key, holder);
      holders.set(k, { entry: entry.key });
    }
    return out;
  }, [guides, entries]);

  const included = entries.filter((e) => e.include);
  const conflicts = included.filter((e) => clashes.has(e.key));
  const undecided = conflicts.filter((e) => !e.choice).length;
  const pick = (keys: readonly string[], change: EntryChoice) =>
    setPicks((p) => ({ ...p, ...Object.fromEntries(keys.map((key) => [key, { ...p[key], ...change }])) }));
  const chooseAll = (choice: "replace" | "keep") => pick([...clashes.keys()], { choice });

  const submit = () => {
    const out = new Map<string, NewGuide>();
    for (const e of included) {
      const guide: NewGuide = { text: e.guide.text };
      if (e.fileName !== undefined) guide.fileName = e.fileName;
      if (e.guide.registerArgs) guide.registerArgs = e.guide.registerArgs;
      const clash = clashes.get(e.key);
      if (clash && e.choice === "replace") {
        if ("stored" in clash) guide.replaceId = clash.stored;
        else {
          const replaceId = out.get(clash.entry)?.replaceId;
          out.delete(clash.entry);
          if (replaceId) guide.replaceId = replaceId;
        }
      }
      out.set(e.key, guide);
    }
    store.addGuides([...out.values()]);
    onClose();
  };

  return (
    <Dialog title="Import guide" onClose={onClose} className="wide">
      <div className="import-sources">
        <Button variant="secondary" size={32} data-autofocus onClick={() => fileInput.current?.click()}>
          Choose files…
        </Button>
        <span className="muted">Addon zip, guides.lua, or text files.</span>
        <FileInput
          ref={fileInput}
          multiple
          aria-label="Import files"
          accept=".zip,.lua,.txt,application/zip,text/plain"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            reader.add(files);
          }}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          reader.add([{ text: pasted }]);
          setPasted("");
        }}
      >
        <Field label="Guide text" layout="stacked">
          <TextArea rows={4} spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" size={32} className="import-add-text" disabled={!pasted.trim()}>
          Add text
        </Button>
      </form>
      {errors.map((e) => (
        <p key={e.source} className="error" role="alert">
          {e.label}: {e.message}
        </p>
      ))}
      {sources.length === 0 && (
        <EmptyState title="Add guides to import">
          Choose files or drop them on the planner, or paste guide text and choose Add text.
        </EmptyState>
      )}
      {entries.length > 0 && (
        <div className="import-table-wrap">
          <table className="import-table">
            <thead>
              <tr>
                <th scope="col">
                  <Checkbox
                    aria-label="Import all"
                    checked={included.length === entries.length}
                    onChange={(e) =>
                      pick(
                        found.map((f) => f.key),
                        { include: e.target.checked },
                      )
                    }
                  />
                </th>
                <th scope="col">Guide</th>
                <th scope="col">Group</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const meta = guideMeta(entry.probe);
                const name = meta.name || "(no #name)";
                const conflict = clashes.get(entry.key);
                return (
                  <tr key={entry.key}>
                    <td>
                      <Checkbox
                        aria-label={`Import ${name}`}
                        checked={entry.include}
                        onChange={(e) => pick([entry.key], { include: e.target.checked })}
                      />
                    </td>
                    <td>{name}</td>
                    <td>{meta.group}</td>
                    <td>
                      {entry.guide.errors.map((error) => (
                        <span key={error} className="error">
                          {error}{" "}
                        </span>
                      ))}
                      {entry.matchesBuiltin && (
                        <Described text="Loads instead of the built-in guide with this group and name">
                          <span className="badge">Built in</span>
                        </Described>
                      )}
                      {conflict ? (
                        <fieldset className="choice">
                          <legend>{"stored" in conflict ? "Name taken in your guides:" : "Name taken in this import:"}</legend>
                          <Radio
                            label="Replace"
                            name={`choice-${entry.key}`}
                            checked={entry.choice === "replace"}
                            onChange={() => pick([entry.key], { choice: "replace" })}
                          />
                          <Radio
                            label="Keep both"
                            name={`choice-${entry.key}`}
                            checked={entry.choice === "keep"}
                            onChange={() => pick([entry.key], { choice: "keep" })}
                          />
                        </fieldset>
                      ) : (
                        entry.guide.errors.length === 0 && !entry.matchesBuiltin && <span className="muted">New</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="dialog-actions">
        <p className="muted import-status" aria-live="polite">
          {status(sources, done, entries.length)}
        </p>
        {conflicts.length > 0 && (
          <>
            <span className="muted">
              {conflicts.length} {conflicts.length === 1 ? "name is" : "names are"} taken:
            </span>
            <Button variant="secondary" size={32} onClick={() => chooseAll("replace")}>
              Replace all
            </Button>
            <Button variant="secondary" size={32} onClick={() => chooseAll("keep")}>
              Keep both for all
            </Button>
          </>
        )}
        <Button variant="primary" size={32} disabled={reading || included.length === 0 || undecided > 0} onClick={submit}>
          {included.length === 0 ? "Import" : `Import ${count(included.length, "guide", "guides")}`}
        </Button>
      </div>
    </Dialog>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function status(sources: readonly ImportSource[], done: number, found: number) {
  if (sources.length === 0) return "";
  if (done < sources.length) return `Reading ${sourceLabel(sources[done]!)}…`;
  const files = sources.filter((s) => s instanceof File).length;
  const texts = sources.length - files;
  const read = [files && count(files, "file", "files"), texts && count(texts, "pasted text", "pasted texts")].filter(Boolean).join(" and ");
  return `Found ${count(found, "guide", "guides")} in ${read}.`;
}

export function ImportGuideButton() {
  const open = useContext(OpenImportContext);
  return (
    open && (
      <Button variant="secondary" size={28} onClick={open}>
        <Icon name="import" />
        Import guide
      </Button>
    )
  );
}
