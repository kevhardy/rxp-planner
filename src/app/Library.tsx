import { useEffect, useMemo, useRef, useState } from "react";
import { BuiltinSection } from "./BuiltinGuides.tsx";
import { useEditor, useEditorStore } from "./context.ts";
import { Described } from "./Described.tsx";
import { ConfirmDialog, PromptDialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { ImportGuideButton } from "./ImportDialog.tsx";
import { customGroup, guideMeta } from "../rules/registration.ts";
import { copyLabels, libraryGroups, type LibraryGroup } from "./library.ts";
import { PopoverMenu } from "./map/PopoverMenu.tsx";
import type { EditResult } from "./store.ts";
import { Button, DisclosureIcon, IconButton } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ItemButton } from "./ui/ItemButton.tsx";
import type { Version } from "./version.ts";

const errorOf = (result: EditResult) => (result.ok ? null : result.error);

type LibraryDialog =
  | { kind: "newGroup" }
  | { kind: "newGuide"; group: string }
  | { kind: "renameGuide"; id: string; what?: string }
  | { kind: "renameGroup"; group: string }
  | { kind: "duplicate"; ids: string[]; what: string; group: string }
  | { kind: "delete"; ids: string[]; what: string }
  | { kind: "customize"; ids: string[]; group: string };

const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

export function LibraryDrawer(props: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;

  useEffect(() => {
    const drawer = ref.current!;
    if (!props.open) return;
    drawer.querySelector("nav")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.getElementById("app")?.hasAttribute("inert")) return;
      const target = e.target;
      if (target instanceof Node && drawer.parentElement!.contains(target) && !drawer.contains(target)) return;
      e.preventDefault();
      closeRef.current();
    };
    const onTab = (e: KeyboardEvent) => {
      const target = e.target;
      if (e.key !== "Tab" || !(target instanceof Node)) return;
      const items = [...drawer.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
        (el) => el.tabIndex >= 0 && !el.matches(":disabled") && !el.closest("[hidden]"),
      );
      if (items.some((el) => (e.shiftKey ? follows(el, target) : follows(target, el)))) return;
      e.preventDefault();
      (e.shiftKey ? items.at(-1) : items[0])?.focus();
    };
    document.addEventListener("keydown", onKey);
    drawer.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onKey);
      drawer.removeEventListener("keydown", onTab);
    };
  }, [props.open]);

  return (
    <div ref={ref} className="drawer" id="library-drawer">
      <Library onClose={props.onClose} />
    </div>
  );
}

function Library(props: { onClose: () => void }) {
  const { guides, builtins, current } = useEditor();
  const store = useEditorStore();
  const groups = useMemo(() => libraryGroups(guides.values()), [guides]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<LibraryDialog | null>(null);
  const close = () => setDialog(null);

  const groupNames = new Set(groups.map((g) => g.name));
  const namesIn = (group: string) => new Set(groups.find((g) => g.name === group)?.guides.map((g) => guideMeta(g).name));
  const newGroupError = (name: string) => (groupNames.has(name) ? "A group with that name exists." : null);
  const flip = (name: string) => (set: ReadonlySet<string>) => {
    const next = new Set(set);
    if (!next.delete(name)) next.add(name);
    return next;
  };

  return (
    <nav className="region-library panel" data-region="library" aria-label="Library" tabIndex={-1}>
      <div className="panel-head">
        <h2>Library</h2>
        <Described text="Group for your own guides">
          <Button variant="ghost" onClick={() => setDialog({ kind: "newGroup" })}>
            <Icon name="folder" />
            New group
          </Button>
        </Described>
        <IconButton icon="x" label="Close library" description="Close library (Escape)" onClick={props.onClose} />
      </div>
      <div className="panel-body lib" data-tip-bounds>
        {groups.length === 0 && (
          <EmptyState title="Your guides" action={<ImportGuideButton />}>
            {builtins.size > 0
              ? "Import a guide, start one with New group, or edit a RestedXP guide to save a copy."
              : "Import a guide, or start one with New group."}
          </EmptyState>
        )}
        {groups.map((group) => (
          <GroupItem
            key={group.name}
            group={group}
            currentId={current?.id}
            collapsed={collapsed.has(group.name)}
            onToggle={() => setCollapsed(flip(group.name))}
            onDialog={setDialog}
          />
        ))}
        <BuiltinSection
          expanded={expanded}
          onToggle={(key) => setExpanded(flip(key))}
          currentId={current?.id}
          onCustomize={(group, ids) => setDialog({ kind: "customize", ids, group })}
        />
      </div>
      <LibraryFooter />

      {dialog?.kind === "newGroup" && (
        <PromptDialog
          title="New group"
          label="Group name"
          submitLabel="Create"
          onClose={close}
          onSubmit={(name) => newGroupError(name) ?? errorOf(store.createGuide(name, "New guide"))}
        />
      )}
      {dialog?.kind === "newGuide" && (
        <PromptDialog
          title={`New guide in ${dialog.group}`}
          label="Guide name (#name)"
          submitLabel="Create"
          onClose={close}
          onSubmit={(name) =>
            namesIn(dialog.group).has(name) ? "A guide with that name exists in the group." : errorOf(store.createGuide(dialog.group, name))
          }
        />
      )}
      {dialog?.kind === "renameGuide" && (
        <PromptDialog
          title={dialog.what ? `Rename ${dialog.what}` : "Rename guide"}
          label="Guide name (#name)"
          initial={guideMeta(guides.get(dialog.id)!).name}
          submitLabel="Rename"
          onClose={close}
          onSubmit={(name) => {
            const meta = guideMeta(guides.get(dialog.id)!);
            if (name === meta.name) return null;
            if (namesIn(meta.group).has(name)) return "A guide with that name exists in the group.";
            return errorOf(store.renameGuide(dialog.id, name));
          }}
        />
      )}
      {dialog?.kind === "renameGroup" && (
        <PromptDialog
          title="Rename group"
          label="Group name (#group)"
          initial={dialog.group}
          submitLabel="Rename"
          onClose={close}
          onSubmit={(name) => {
            if (name === dialog.group) return null;
            return newGroupError(name) ?? errorOf(store.renameGroup(dialog.group, name));
          }}
        />
      )}
      {dialog?.kind === "duplicate" && (
        <PromptDialog
          title={`Duplicate ${dialog.what}`}
          label="New group name"
          initial={`${dialog.group} (copy)`}
          submitLabel="Duplicate"
          onClose={close}
          onSubmit={(name) => {
            return newGroupError(name) ?? errorOf(store.duplicate(dialog.ids, name));
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.what}?`}
          message="This removes it from the library. Undo restores it."
          confirmLabel="Delete"
          onClose={close}
          onConfirm={() => store.deleteGuides(dialog.ids)}
        />
      )}
      {dialog?.kind === "customize" && (
        <ConfirmDialog
          title={`Customize ${dialog.group}?`}
          message={`This copies its ${dialog.ids.length} listed ${dialog.ids.length === 1 ? "guide" : "guides"} into “${customGroup(dialog.group)}”, where you can edit them, and opens the first. Guides you have copied already stay as they are.`}
          confirmLabel="Customize"
          confirmVariant="primary"
          onClose={close}
          onConfirm={() => errorOf(store.duplicate(dialog.ids, customGroup(dialog.group)))}
        />
      )}
    </nav>
  );
}

/** The source link stays in view because AGPL section 13 requires the site to offer its source. */
function LibraryFooter() {
  const app = JSON.parse(import.meta.env.VITE_APP_VERSION) as Version;
  const dataset = import.meta.env.VITE_DATASET_VERSION ? (JSON.parse(import.meta.env.VITE_DATASET_VERSION) as Version) : undefined;
  const datasetName = dataset?.name.replace(/^data-/, "");
  return (
    <footer className="lib-about">
      <a href={app.url} target="_blank" rel="noreferrer" aria-label="Source code">
        Source
      </a>
      <PopoverMenu className="lib-versions" label="About" description="Planner and dataset versions" align="start">
        <dl>
          <dt>Planner</dt>
          <dd>
            <a href={app.url} target="_blank" rel="noreferrer">
              {app.name}
            </a>
          </dd>
          {dataset && (
            <>
              <dt>Dataset</dt>
              <dd>
                {dataset.url ? (
                  <a href={dataset.url} target="_blank" rel="noreferrer">
                    {datasetName}
                  </a>
                ) : (
                  datasetName
                )}
              </dd>
            </>
          )}
        </dl>
      </PopoverMenu>
    </footer>
  );
}

function GroupItem(props: {
  group: LibraryGroup;
  currentId: string | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onDialog: (dialog: LibraryDialog) => void;
}) {
  const { group, currentId, collapsed, onDialog } = props;
  const store = useEditorStore();
  const ids = group.guides.map((g) => g.id);
  const copies = copyLabels(group.guides);
  const what = `group “${group.name}” (${ids.length} ${ids.length === 1 ? "guide" : "guides"})`;
  return (
    <section className="lib-group" aria-label={`Group ${group.name}`}>
      <div className="lib-row lib-group-head">
        <Described text={group.name} clipped>
          <ItemButton className="lib-toggle" aria-expanded={!collapsed} onClick={props.onToggle}>
            <DisclosureIcon />
            <Icon name="folder" />
            <span className="lib-name">{group.name}</span>
          </ItemButton>
        </Described>
        <span className="row-actions">
          <IconButton icon="plus" label={`New guide in ${group.name}`} onClick={() => onDialog({ kind: "newGuide", group: group.name })} />
          <IconButton
            icon="pen"
            label={`Rename group ${group.name}`}
            onClick={() => onDialog({ kind: "renameGroup", group: group.name })}
          />
          <IconButton
            icon="copy"
            label={`Duplicate group ${group.name}`}
            onClick={() => onDialog({ kind: "duplicate", ids, what: `group “${group.name}”`, group: group.name })}
          />
          <IconButton icon="trash" label={`Delete group ${group.name}`} onClick={() => onDialog({ kind: "delete", ids, what })} />
        </span>
      </div>
      {!collapsed && (
        <ul className="lib-guides">
          {group.guides.map((guide) => {
            const name = guideMeta(guide).name || "(no #name)";
            const copy = copies.get(guide);
            const label = copy ? `${name} (${copy})` : name;
            const quoted = copy ? `“${name}” (${copy})` : `“${name}”`;
            const about = guide.fileName ? `${label}, from ${guide.fileName}` : label;
            return (
              <li key={guide.id} className={`lib-row${guide.id === currentId ? " current" : ""}`}>
                <Described text={copy ? `${about}. Another guide here has this name.` : about} clipped={about === name}>
                  <ItemButton
                    className="lib-guide"
                    aria-current={guide.id === currentId ? "true" : undefined}
                    onClick={() => store.open(guide.id)}
                  >
                    <span className="lib-name">{name}</span>
                    {copy && <span className="badge warn">{copy}</span>}
                  </ItemButton>
                </Described>
                <span className="row-actions">
                  <IconButton
                    icon="pen"
                    label={`Rename ${label}`}
                    onClick={() => {
                      const dialog: LibraryDialog = { kind: "renameGuide", id: guide.id };
                      if (copy) dialog.what = quoted;
                      onDialog(dialog);
                    }}
                  />
                  <IconButton
                    icon="copy"
                    label={`Duplicate ${label}`}
                    onClick={() => onDialog({ kind: "duplicate", ids: [guide.id], what: quoted, group: group.name })}
                  />
                  <IconButton
                    icon="trash"
                    label={`Delete ${label}`}
                    onClick={() => onDialog({ kind: "delete", ids: [guide.id], what: quoted })}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
