import { useMemo, useState } from "react";
import type { Profile } from "../rules/index.ts";
import type { GuideRecord } from "../guide/index.ts";
import { useEditor, useEditorStore } from "./context.ts";
import { Described } from "./Described.tsx";
import { Icon } from "./icons.tsx";
import { copyGroups, copyOf, guideMeta, guidesByKey } from "../rules/registration.ts";
import { useLayout, useLayoutStore } from "./layout.ts";
import { builtinTree, type BuiltinGroup } from "./library.ts";
import { guideProfile, usePreviewSettings } from "./preview/settings.ts";
import type { CurrentGuide } from "./store.ts";
import { Button, DisclosureIcon, IconButton } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ItemButton } from "./ui/ItemButton.tsx";

const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const SOURCE_URL = "https://github.com/RestedXP/RXPGuides";

function useBuiltinTree(all: boolean): BuiltinGroup[] {
  const { builtins } = useEditor();
  const profile = useProfile();
  return useMemo(() => builtinTree(builtins, profile, all), [builtins, profile, all]);
}

function useCopies(): (builtin: GuideRecord) => GuideRecord | undefined {
  const { guides } = useEditor();
  const profile = useProfile();
  const byKey = useMemo(() => guidesByKey(guides.values()), [guides]);
  return (builtin) => copyOf(byKey, builtin, profile(builtin));
}

function useProfile(): (guide: GuideRecord) => Profile {
  const settings = usePreviewSettings();
  return useMemo(() => guideProfile(settings), [settings]);
}

/**
 * The library section of built-in guides. `expanded` holds the keys of the
 * open section, groups, and subgroups, which `onToggle` flips. Without
 * `onCustomize`, a group has no Customize action.
 */
export function BuiltinSection(props: {
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  currentId: string | undefined;
  onCustomize?: (group: string, ids: string[]) => void;
}) {
  const { expanded, onToggle, currentId, onCustomize } = props;
  const { builtins, builtinVersion } = useEditor();
  const [all, setAll] = useState(false);
  const groups = useBuiltinTree(all);
  const copyOf = useCopies();
  const store = useEditorStore();
  if (builtins.size === 0) return null;

  const open = expanded.has(BUILTIN_SECTION);
  return (
    <section className="lib-group lib-builtins" aria-label="RestedXP Guides">
      <div className="lib-row lib-group-head">
        <ItemButton className="lib-toggle" aria-expanded={open} onClick={() => onToggle(BUILTIN_SECTION)}>
          <DisclosureIcon />
          <span className="lib-name">RestedXP Guides</span> <span className="count">{builtinVersion}</span>
        </ItemButton>
      </div>
      {open && (
        <>
          <div className="lib-credit">
            <p>
              ©{" "}
              <Described text="The RestedXP addon and its guides">
                <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                  RestedXP
                </a>
              </Described>{" "}
              ·{" "}
              <Described text="The license of the built-in guides">
                <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                  CC BY-NC-SA 4.0
                </a>
              </Described>
            </p>
            <Described text="Also list guides hidden for the preview character">
              <Button variant="ghost" pressed={all} aria-label="Show all RestedXP guides" onClick={() => setAll(!all)}>
                Show all
              </Button>
            </Described>
          </div>
          {groups.length === 0 && (
            <EmptyState title="No RestedXP guides for this character">Choose Show all to list every RestedXP guide.</EmptyState>
          )}
          {groups.map((group) => {
            const key = `${BUILTIN_SECTION}\n${group.name}`;
            const ids = group.subgroups.flatMap((s) => s.guides.map((e) => e.guide.id));
            const groupOpen = expanded.has(key);
            return (
              <div key={group.name} className="lib-builtin-group">
                <div className="lib-row lib-group-head">
                  <Described text={group.name} clipped>
                    <ItemButton className="lib-toggle depth-1" aria-expanded={groupOpen} onClick={() => onToggle(key)}>
                      <DisclosureIcon />
                      <span className="lib-name">{group.name}</span>
                    </ItemButton>
                  </Described>
                  {onCustomize && (
                    <span className="row-actions">
                      <IconButton icon="copy" label={`Customize group ${group.name}`} onClick={() => onCustomize(group.name, ids)} />
                    </span>
                  )}
                </div>
                {groupOpen &&
                  group.subgroups.map((sub) => {
                    const entries = (depth: number) => (
                      <ul className="lib-guides">
                        {sub.guides.map((entry) => {
                          const copy = copyOf(entry.guide);
                          const current = entry.guide.id === currentId;
                          const name = entry.name || "(no #name)";
                          return (
                            <li
                              key={entry.guide.id}
                              className={`lib-row${current ? " current" : ""}${entry.reason ? " lib-left-out" : ""}`}
                            >
                              <Described text={entry.reason ? `${name}: ${entry.reason}` : name} clipped>
                                <ItemButton
                                  className={`lib-guide depth-${depth}`}
                                  aria-current={current ? "true" : undefined}
                                  onClick={() => store.open(entry.guide.id)}
                                >
                                  <span className="lib-name">{name}</span>{" "}
                                  {entry.reason && <span className="badge lib-reason">{entry.reason}</span>}
                                </ItemButton>
                              </Described>
                              {copy && (
                                <Described text={`Open your copy in “${guideMeta(copy).group}”`}>
                                  <Button
                                    variant="secondary"
                                    className="lib-copy"
                                    aria-label={`Open your copy of ${name}`}
                                    onClick={() => store.open(copy.id)}
                                  >
                                    copy
                                  </Button>
                                </Described>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    );
                    if (!sub.name) return <div key="">{entries(2)}</div>;
                    const subKey = `${key}\n${sub.name}`;
                    const subOpen = expanded.has(subKey);
                    return (
                      <div key={sub.name}>
                        <div className="lib-row">
                          <Described text={sub.name} clipped>
                            <ItemButton
                              className="lib-toggle lib-subgroup depth-2"
                              aria-expanded={subOpen}
                              onClick={() => onToggle(subKey)}
                            >
                              <DisclosureIcon />
                              <span className="lib-name">{sub.name}</span>
                            </ItemButton>
                          </Described>
                        </div>
                        {subOpen && entries(3)}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

export const BUILTIN_SECTION = "rxp";

export function BuiltinHint({ current }: { current: CurrentGuide }) {
  const copy = useCopies()(current.record);
  const profile = useProfile();
  const store = useEditorStore();
  const layoutStore = useLayoutStore();
  const { dismissedBuiltinHints } = useLayout();
  if (dismissedBuiltinHints.includes(current.id)) return null;
  return (
    <p className="builtin-hint">
      <Icon name="copy" />
      {copy ? (
        <>
          <span>You have a copy in “{guideMeta(copy).group}”.</span>
          <Button variant="secondary" onClick={() => store.open(copy.id)}>
            Open your copy
          </Button>
        </>
      ) : (
        <span>Your first edit saves a copy in “{copyGroups(current.record, profile(current.record))[0]}” and opens it.</span>
      )}
      <Button variant="secondary" onClick={() => layoutStore.update({ dismissedBuiltinHints: [...dismissedBuiltinHints, current.id] })}>
        Got it
      </Button>
    </p>
  );
}
