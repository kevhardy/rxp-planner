import { useId, useMemo, useState } from "react";
import { addonFolderName, exportAddon } from "../io/index.ts";
import { useEditor } from "./context.ts";
import { Dialog } from "./Dialog.tsx";
import { Button } from "./ui/Button.tsx";
import { Checkbox } from "./ui/Checkbox.tsx";
import { Field, Input } from "./ui/Field.tsx";
import { Mono } from "./ui/Text.tsx";
import { guideMeta, registrationClashes } from "../rules/registration.ts";
import { libraryGroups } from "./library.ts";

export function ExportDialog(props: { onClose: () => void }) {
  const { guides, current } = useEditor();
  const groups = useMemo(() => libraryGroups(guides.values()), [guides]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(groups.find((g) => g.name === current?.group)?.guides.map((g) => g.id) ?? []),
  );
  const [title, setTitle] = useState(current?.group ?? "");
  const [name, setName] = useState("");
  const stepsId = useId();

  const selected = useMemo(() => groups.flatMap((g) => g.guides).filter((g) => chosen.has(g.id)), [groups, chosen]);
  // RXP loads only one guide per group and name; the user picks which.
  const clashes = useMemo(() => registrationClashes(selected), [selected]);
  const clashing = new Set(clashes.flat());
  const folder = name.trim() ? addonFolderName(name) : addonFolderName(title);
  const setMany = (ids: string[], on: boolean) =>
    setChosen((set) => {
      const next = new Set(set);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const download = () => {
    const addon = exportAddon(
      title.trim(),
      selected.map((g) => (g.registerArgs ? { text: g.text, registerArgs: g.registerArgs } : g.text)),
      { name },
    );
    const url = URL.createObjectURL(new Blob([addon.zip], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${addon.folder}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    props.onClose();
  };

  return (
    <Dialog title="Export guide" onClose={props.onClose} className="wide">
      <div className="export-grid">
        <fieldset className="export-guides">
          <legend>Guides</legend>
          {groups.map((group) => {
            const ids = group.guides.map((g) => g.id);
            const count = ids.filter((id) => chosen.has(id)).length;
            return (
              <div key={group.name} className="export-group">
                <Checkbox
                  className="export-group-name"
                  label={
                    <>
                      {group.name}{" "}
                      <span className="count">
                        <Mono>{ids.length}</Mono>
                      </span>
                    </>
                  }
                  checked={count === ids.length}
                  indeterminate={count > 0 && count < ids.length}
                  onChange={(e) => {
                    setMany(ids, e.target.checked);
                    if (e.target.checked && !title.trim()) setTitle(group.name);
                  }}
                />
                <ul>
                  {group.guides.map((g) => (
                    <li key={g.id}>
                      <Checkbox
                        label={
                          <>
                            {guideMeta(g).name || "(no #name)"}
                            {clashing.has(g) && <span className="badge warn">same name</span>}
                          </>
                        }
                        checked={chosen.has(g.id)}
                        onChange={(e) => setMany([g.id], e.target.checked)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </fieldset>
        <div className="export-options">
          <Field label="Addon title" layout="stacked">
            <Input size={32} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Addon name (folder)" layout="stacked">
            <Input size={32} value={name} placeholder={addonFolderName(title)} onChange={(e) => setName(e.target.value)} />
          </Field>
          <p className="muted">
            {selected.length} {selected.length === 1 ? "guide" : "guides"} →{" "}
            <code>
              {folder}/{folder}.toc
            </code>
            , <code>{folder}/guides.lua</code>.
          </p>
          <h3 id={stepsId}>Install in game</h3>
          <ol className="muted" aria-labelledby={stepsId}>
            <li>Install the RestedXP Guides addon.</li>
            <li>
              Unzip the download into <code>Interface/AddOns</code>.
            </li>
            <li>Restart the game.</li>
            <li>Right-click the RestedXP guide window and choose the guide. It lists only guides for your character.</li>
          </ol>
          {clashes.length > 0 && (
            <div className="error" role="alert">
              <p>RXP loads only one guide per group and name. Choose one of each pair, or rename one:</p>
              <ul>
                {clashes.map(([a, b]) => (
                  <li key={`${a.id} ${b.id}`}>
                    {guideMeta(a).group} / {guideMeta(a).name}
                    {guideMeta(b).name !== guideMeta(a).name && ` and ${guideMeta(b).name}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        <Button variant="primary" size={32} disabled={selected.length === 0 || clashes.length > 0} onClick={download}>
          Download {folder}.zip
        </Button>
      </div>
    </Dialog>
  );
}
