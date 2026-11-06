import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { TextPart } from "../../guide/index.ts";
import { addSimDone, type Warning, type WarningKind } from "../../rules/index.ts";
import { DatasetContext, useEditor, useEditorStore, useGameData, useStores } from "../context.ts";
import { Described } from "../Described.tsx";
import { editSection } from "../drafts.ts";
import { useDisclosure } from "../effects.ts";
import { GuideText } from "../GuideText.tsx";
import { Icon } from "../icons.tsx";
import { Button, DisclosureIcon } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ItemButton } from "../ui/ItemButton.tsx";
import { Mono } from "../ui/Text.tsx";
import { isCurrent, jumpTo, useRoute } from "./route.ts";
import { markDoneParts, placeParts, prerequisiteFixes, warningParts, type RouteView } from "../../rules/index.ts";
import { KIND_LABELS, KIND_ORDER, routeWarnings } from "./warnings.ts";
import "./warnings.css";

interface Fix {
  ids: number[];
  text: TextPart[];
}

interface GuideWarnings {
  guide: number;
  total: number;
  kinds: { kind: WarningKind; items: { warning: Warning; text: TextPart[]; fixes: Fix[] }[] }[];
}

const ITEM_LIMIT = 10;

export function WarningsPanel() {
  const route = useRoute();
  const data = useGameData();
  const dataset = useContext(DatasetContext);
  const { open, toggle, close, button, wrap } = useDisclosure();
  const panelId = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const store = useEditorStore();
  const body = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | null>(null);

  const groups = useMemo(() => {
    if (!route || !data) return null;
    const lookup = (id: number) => data.quest(id);
    const byGuide = new Map<number, GuideWarnings>();
    for (const warning of routeWarnings(route, data)) {
      const guide = warning.at.guide;
      let entry = byGuide.get(guide);
      if (!entry) byGuide.set(guide, (entry = { guide, total: 0, kinds: [] }));
      let kind = entry.kinds.find((k) => k.kind === warning.kind);
      if (!kind) entry.kinds.push((kind = { kind: warning.kind, items: [] }));
      const fixes =
        warning.kind === "prerequisite" && route.simulation
          ? prerequisiteFixes(warning).map((ids) => ({ ids, text: markDoneParts(ids, lookup) }))
          : [];
      kind.items.push({ warning, text: warningParts(warning, lookup, (g) => route.names[g]!), fixes });
      entry.total++;
    }
    for (const entry of byGuide.values()) entry.kinds.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    return [...byGuide.values()];
  }, [route, data]);

  useEffect(() => {
    const at = refocus.current;
    if (at === null || !groups) return;
    refocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    const items = body.current?.querySelectorAll<HTMLElement>(".warn-item");
    (items?.[Math.min(at, items.length - 1)] ?? button.current)?.focus();
  }, [groups, button]);

  const applyFix = (button: HTMLElement, guide: number, fix: Fix) => {
    const items = [...body.current!.querySelectorAll(".warn-item")];
    refocus.current = items.indexOf(button.closest("li")!.querySelector(".warn-item")!);
    editSection(store, null, (doc) => addSimDone(doc, fix.ids), undefined, undefined, route!.records[guide]!.id);
  };

  if (!route) return null;
  const total = groups?.reduce((n, g) => n + g.total, 0) ?? 0;
  const message = !groups ? (dataset?.error ? "Quest data unavailable." : "Loading quest data…") : null;

  return (
    <span {...wrap} className="warnings-menu">
      <Described text="Route warnings by guide" popoverOpen={open}>
        <Button
          ref={button}
          variant="ghost"
          size={32}
          popoverOpen={open}
          aria-controls={panelId}
          aria-label={groups ? `Warnings, ${total}` : "Warnings"}
          onClick={toggle}
        >
          <span className={total > 0 ? "warnings-total warn" : "warnings-total"}>
            <Icon name="warning" />
            {groups ? total : null}
          </span>
        </Button>
      </Described>
      <Card as="section" layer id={panelId} className="warnings popover" aria-label="Warnings" hidden={!open}>
        <div className="panel-head">
          <h2>Warnings</h2>
          <span className={`count${total > 0 ? " warn" : ""}`}>{groups && <Mono>{total}</Mono>}</span>
        </div>
        <div ref={body} className="panel-body warnings-body" data-tip-bounds>
          {message ? (
            <p className="empty">{message}</p>
          ) : groups!.length === 0 ? (
            <EmptyState title="No warnings on this route">Each edit checks the route again.</EmptyState>
          ) : (
            groups!.map((group) => (
              <details key={group.guide} className="warn-guide" open>
                <summary>
                  <DisclosureIcon />
                  {route.names[group.guide]}{" "}
                  <span className="count">
                    <Mono>{group.total}</Mono>
                  </span>
                </summary>
                {group.kinds.map(({ kind, items }) => {
                  const key = `${group.guide}:${kind}`;
                  const shown = expanded.has(key) ? items : items.slice(0, ITEM_LIMIT);
                  return (
                    <details key={kind} className="warn-kind" open>
                      <summary>
                        <DisclosureIcon />
                        {KIND_LABELS[kind]}{" "}
                        <span className="count">
                          <Mono>{items.length}</Mono>
                        </span>
                      </summary>
                      <ul>
                        {shown.map((item, i) => (
                          <li key={i} className={item.fixes.length > 0 ? "warn-row" : undefined}>
                            <WarningItem route={route} guide={group.guide} {...item} onSelect={close} />
                            {item.fixes.map((fix) => (
                              <Described
                                key={fix.ids.join()}
                                text={`Counts ${fix.ids.join(", ")} as turned in, with -- @sim done= in the header of ${route.names[group.guide]}`}
                              >
                                <Button
                                  variant="secondary"
                                  wrap
                                  className="warn-fix"
                                  onClick={(e) => applyFix(e.currentTarget, group.guide, fix)}
                                >
                                  <span>
                                    <GuideText parts={fix.text} links="plain" />
                                  </span>
                                </Button>
                              </Described>
                            ))}
                          </li>
                        ))}
                        {shown.length < items.length && (
                          <li>
                            <Button
                              variant="ghost"
                              className="warn-more"
                              onClick={(e) => {
                                const list = e.currentTarget.closest("ul")!;
                                flushSync(() => setExpanded(new Set(expanded).add(key)));
                                list.querySelectorAll<HTMLElement>(".warn-item")[ITEM_LIMIT]?.focus();
                              }}
                            >
                              {items.length - shown.length} more
                            </Button>
                          </li>
                        )}
                      </ul>
                    </details>
                  );
                })}
              </details>
            ))
          )}
        </div>
      </Card>
    </span>
  );
}

function WarningItem(props: { route: RouteView; guide: number; warning: Warning; text: TextPart[]; onSelect: () => void }) {
  const { route, guide, warning } = props;
  const editor = useEditor();
  const stores = useStores();
  const { step, line } = warning.at;
  const [lead, rest] = placeParts(warning.at);
  const stale = !isCurrent(route, guide, editor);
  const selected =
    route.records[guide]!.id === editor.current?.id && (step ?? null) === editor.selection.step && (line ?? null) === editor.selection.line;
  return (
    <Described text={stale ? "Updating after the edit" : undefined}>
      <ItemButton
        className="warn-item"
        aria-current={!stale && selected ? "location" : undefined}
        aria-disabled={stale || undefined}
        onClick={() => {
          if (stale) return;
          jumpTo(stores, route, guide, { step: step ?? null, line: line ?? null });
          props.onSelect();
        }}
      >
        <span className="warn-place">
          <GuideText parts={lead} links="plain" />
          {rest.length > 0 && (
            <span className="muted">
              <GuideText parts={rest} links="plain" />
            </span>
          )}
        </span>{" "}
        <span>
          <GuideText parts={props.text} links="plain" />
        </span>
      </ItemButton>
    </Described>
  );
}
