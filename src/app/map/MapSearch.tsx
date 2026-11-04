import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GameData, Quest } from "../../data/index.ts";
import { DatasetContext, useGameData } from "../context.ts";
import { Described } from "../Described.tsx";
import { useOutsidePress } from "../effects.ts";
import { EntityLink } from "../EntityLink.tsx";
import { Icon } from "../icons.tsx";
import { Button, DisclosureIcon } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Input, Select } from "../ui/Field.tsx";
import { ItemButton } from "../ui/ItemButton.tsx";
import { useFaction } from "../preview/settings.ts";
import { DraftView } from "../quests/QuestDraft.tsx";
import { FeatureCard, featureDetails } from "./FeatureSearch.tsx";
import type { SearchActions } from "./MapPanel.tsx";
import { searchAll, type SearchGroup, type SearchResult } from "./search.ts";
import { mapCover } from "./viewport.ts";
import { useWorldMapStore } from "./worldMapStore.ts";
import { Heading, Mono } from "../ui/Text.tsx";

const FIRST_ROWS = 8;
const MAX_ROWS = 100;
const BOTTOM_GAP = 8;

interface Filters {
  text: string;
  zoneId: string;
  minLevel: string;
  maxLevel: string;
}

const NO_FILTERS: Filters = { text: "", zoneId: "", minLevel: "", maxLevel: "" };

export function MapSearch(props: { search: SearchActions | undefined; hidden: boolean }) {
  const { search } = props;
  const data = useGameData();
  const dataset = useContext(DatasetContext);
  const faction = useFaction();
  const worldMap = useWorldMapStore();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [chosen, setChosen] = useState<SearchResult | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [chosenIn, setChosenIn] = useState(data);
  if (chosenIn !== data) {
    setChosenIn(data);
    setChosen(null);
  }
  const panelId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  const close = (focusButton: boolean) => {
    setOpen(false);
    restore.current = focusButton;
  };
  useEffect(() => {
    if (open) field.current?.focus();
    else if (restore.current) button.current?.focus();
    restore.current = false;
  }, [open]);
  useEffect(() => {
    if (chosen) back.current?.focus();
  }, [chosen]);

  useLayoutEffect(() => {
    const el = panel.current!;
    const body = el.closest(".map-panel")?.querySelector(".map-body");
    if (!open || !body) return;
    const fit = () => {
      el.style.maxHeight = `${Math.max(0, body.getBoundingClientRect().bottom - mapCover(body) - BOTTOM_GAP - el.getBoundingClientRect().top)}px`;
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit);
    observer?.observe(body);
    const uncoveredStrip = body.querySelector(".map-top");
    if (uncoveredStrip) observer?.observe(uncoveredStrip);
    window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [open]);

  useOutsidePress(open, wrap, () => close(false));

  const levels = filters.minLevel !== "" || filters.maxLevel !== "";
  const index = search?.index ?? null;
  const groups = useMemo(
    () =>
      data &&
      searchAll(data, index, {
        text: filters.text,
        faction,
        ...(filters.zoneId && { zoneId: Number(filters.zoneId) }),
        ...(filters.minLevel && { minLevel: Number(filters.minLevel) }),
        ...(filters.maxLevel && { maxLevel: Number(filters.maxLevel) }),
      }),
    [data, index, filters, faction],
  );
  const setFilter = (change: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...change }));
    setExpanded(new Set());
  };

  const quest = chosen?.kind === "quest" ? (data?.quest(chosen.quest.id, faction) ?? null) : null;
  const feature = chosen?.kind === "feature" && search ? chosen.feature : null;
  const showing = data && (quest || feature);
  const toResults = () => {
    setChosen(null);
    field.current?.focus();
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Catches Escape and focus leaving from the field and panel inside.
    <span
      ref={wrap}
      className="map-search"
      hidden={props.hidden}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) close(false);
      }}
    >
      {open ? (
        <span className="search-field">
          <Icon name="search" />
          <Input
            ref={field}
            type="search"
            aria-label="Search quests, NPCs, items, and places"
            aria-controls={panelId}
            placeholder="Name or ID"
            value={filters.text}
            onChange={(e) => {
              setFilter({ text: e.target.value });
              setChosen(null);
            }}
          />
        </span>
      ) : (
        <Described text="Find quests, NPCs, items, dungeons, transports, and places">
          <Button ref={button} variant="ghost" popoverOpen={false} aria-controls={panelId} onClick={() => setOpen(true)}>
            <Icon name="search" /> Search
          </Button>
        </Described>
      )}
      <Card as="section" ref={panel} id={panelId} className="search-panel" aria-label="Search" hidden={!open} data-tip-bounds>
        {!data ? (
          <p className="empty">{dataset?.error ? "Game data unavailable." : "Loading game data…"}</p>
        ) : (
          <>
            {showing && (
              <div className="search-chosen">
                <Button ref={back} variant="ghost" className="back" onClick={toResults}>
                  <Icon name="chevronLeft" /> Back to results
                </Button>
                {quest && <DraftView key={`${quest.id}:${faction}`} data={data} quest={quest} />}
                {feature && search && (
                  <FeatureCard
                    feature={feature}
                    area={search.area}
                    onShow={(location) => {
                      close(true);
                      worldMap.focus({ kind: "feature", feature, location });
                    }}
                    add={{ step: search.step, onAdd: search.onAdd }}
                  />
                )}
              </div>
            )}
            <div className="search-results" hidden={!!showing}>
              <SearchFilters data={data} filters={filters} onChange={setFilter} />
              {levels && <p className="muted">Levels apply to quests only, so only quests show.</p>}
              {!groups ? (
                <EmptyState title="Find quests, NPCs, items, and places">
                  Search by name or ID, or choose a zone or levels under Filters.
                </EmptyState>
              ) : (
                <>
                  <p className="sr-only" role="status">
                    {groups.length === 0 ? "Nothing matches." : groups.map((g) => `${g.results.length} ${g.title}`).join(", ")}
                  </p>
                  {groups.length === 0 && (
                    <EmptyState title="Nothing matches">Check the spelling, search by ID, or change the filters.</EmptyState>
                  )}
                  {groups.map((group) => (
                    <ResultGroup
                      key={group.title}
                      data={data}
                      group={group}
                      all={expanded.has(group.title)}
                      onAll={() => setExpanded((e) => new Set(e).add(group.title))}
                      onChoose={setChosen}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </Card>
    </span>
  );
}

function SearchFilters(props: { data: GameData; filters: Filters; onChange: (change: Partial<Filters>) => void }) {
  const { data, filters, onChange } = props;
  const zones = useMemo(() => data.zones.filter((z) => z.category !== "other").toSorted((a, b) => a.name.localeCompare(b.name)), [data]);
  const levels = filters.minLevel || filters.maxLevel ? `levels ${filters.minLevel || "1"}–${filters.maxLevel || data.maxLevel}` : "";
  const scope = [filters.zoneId && data.zone(Number(filters.zoneId))?.name, levels].filter(Boolean).join(" · ");
  return (
    <details className="search-filters">
      <summary>
        <DisclosureIcon /> Filters{scope && <span className="muted"> · {scope}</span>}
      </summary>
      <div className="search-filter-fields">
        <Select aria-label="Zone" value={filters.zoneId} onChange={(e) => onChange({ zoneId: e.target.value })}>
          <option value="">Any zone</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
        <span className="levels">
          <Input
            type="number"
            mono
            aria-label="Minimum quest level"
            placeholder="min"
            min={1}
            max={data.maxLevel}
            value={filters.minLevel}
            onChange={(e) => onChange({ minLevel: e.target.value })}
          />
          <span aria-hidden="true">–</span>
          <Input
            type="number"
            mono
            aria-label="Maximum quest level"
            placeholder="max"
            min={1}
            max={data.maxLevel}
            value={filters.maxLevel}
            onChange={(e) => onChange({ maxLevel: e.target.value })}
          />
        </span>
      </div>
    </details>
  );
}

function ResultGroup(props: {
  data: GameData;
  group: SearchGroup;
  all: boolean;
  onAll: () => void;
  onChoose: (result: SearchResult) => void;
}) {
  const { group, all } = props;
  const count = group.results.length;
  return (
    <section className="search-group">
      <Heading level={3} size="small" tone="muted">
        {group.title}{" "}
        <span className="count">
          <Mono>{count}</Mono>
        </span>
      </Heading>
      <ul aria-label={group.title}>
        {group.results.slice(0, all ? MAX_ROWS : FIRST_ROWS).map((result) =>
          result.kind === "quest" ? (
            <QuestRow key={`quest:${result.quest.id}`} data={props.data} quest={result.quest} onChoose={() => props.onChoose(result)} />
          ) : (
            <li key={result.feature.key}>
              <ItemButton className="search-row" onClick={() => props.onChoose(result)}>
                <span className="search-name">{result.feature.name}</span>{" "}
                <span className="search-meta">{featureDetails(result.feature).join(" · ")}</span>
              </ItemButton>
            </li>
          ),
        )}
      </ul>
      {!all && count > FIRST_ROWS && (
        <Button variant="ghost" className="search-more" onClick={props.onAll}>
          {count > MAX_ROWS ? `Show ${MAX_ROWS} of ${count}` : `Show all ${count}`}
        </Button>
      )}
      {all && count > MAX_ROWS && (
        <p className="muted">
          Showing {MAX_ROWS} of {count}. Narrow the search to see the rest.
        </p>
      )}
    </section>
  );
}

function QuestRow(props: { data: GameData; quest: Quest; onChoose: () => void }) {
  const { data, quest: q } = props;
  const zone = q.zoneIds.map((id) => data.zone(id)?.name).find(Boolean) ?? "";
  return (
    <li>
      <ItemButton className="search-row" onClick={props.onChoose}>
        <span className="search-level">{q.questLevel ?? "?"}</span>
        <span className="search-name">{q.name}</span>
        <span className="search-meta">
          {q.id} · {zone}
          {q.raceRequirement !== "Any race" && ` · ${q.raceRequirement}`}
          {q.classRequirement !== "Any class" && ` · ${q.classRequirement}`}
        </span>
      </ItemButton>
      <EntityLink type="quest" id={q.id} name={q.name} className="search-wowhead">
        <Icon name="external" size={12} />
        <span className="sr-only">{q.name} on Wowhead</span>
      </EntityLink>
    </li>
  );
}
