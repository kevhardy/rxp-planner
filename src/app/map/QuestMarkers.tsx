import { memo, useMemo } from "react";
import type { GameData } from "../../data/index.ts";
import type { Faction } from "../../rules/index.ts";
import { EntityLink } from "../EntityLink.tsx";
import { Icon } from "../icons.tsx";
import type { LockNames } from "../quests/lockText.ts";
import { QuestPreview } from "../quests/QuestInfo.tsx";
import type { MapMenuItem, OpenMenu } from "./MapCanvas.tsx";
import { MapIconImage } from "./MapIconImage.tsx";
import { inFrame } from "./MapLegend.tsx";
import { MarkButton } from "../ui/ItemButton.tsx";
import type { ViewPoint } from "./points.ts";
import {
  actionVerb,
  dimmed,
  markerLabel,
  questActions,
  questRows,
  shownMarkers,
  type PlacedMarker,
  type QuestAction,
  type QuestMarker,
  type QuestShow,
} from "./questMarkers.ts";
import { groupOnScreen } from "./terrain.ts";
import { useFrame, useMapView } from "./view.ts";
import { Heading } from "../ui/Text.tsx";

export const QuestMarkers = memo(function QuestMarkers(props: {
  placed: PlacedMarker[];
  show: QuestShow;
  pxPerPercent: number;
  aspect: number;
  lockNames: LockNames;
  onPick: (markers: readonly QuestMarker[]) => void;
  openMenu: OpenMenu;
  onAdd: ((action: QuestAction) => void) | undefined;
}) {
  const { placed, show, pxPerPercent, aspect, lockNames, onPick, openMenu, onAdd } = props;
  const frame = useFrame(useMapView());
  const groups = useMemo(() => {
    const screen = (at: ViewPoint) => ({ x: at.x * pxPerPercent, y: (at.y * pxPerPercent) / aspect });
    const shown = shownMarkers(placed, show);
    shown.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
    return groupOnScreen(shown, screen).map((group) => ({ at: group[0]!.at, markers: group.map((p) => p.marker) }));
  }, [placed, show, pxPerPercent, aspect]);
  return groups.map(({ at, markers }) => (
    <QuestGroup
      key={markers[0]!.key}
      at={at}
      markers={markers}
      show={show}
      focusable={!!frame && inFrame(at, frame)}
      lockNames={lockNames}
      onPick={onPick}
      openMenu={openMenu}
      onAdd={onAdd}
    />
  ));
});

const QuestGroup = memo(function QuestGroup(props: {
  at: ViewPoint;
  markers: readonly QuestMarker[];
  show: QuestShow;
  focusable: boolean;
  lockNames: LockNames;
  onPick: (markers: readonly QuestMarker[]) => void;
  openMenu: OpenMenu;
  onAdd: ((action: QuestAction) => void) | undefined;
}) {
  const { at, markers, show, onAdd } = props;
  const giver = show.available && markers.some((m) => m.available.length > 0);
  const ender = show.turnIns && markers.some((m) => m.turnIns.length > 0);
  const label = markerLabel(markers, show, props.lockNames);
  return (
    <MarkButton
      label={label}
      at={at}
      className="quest-marker"
      aria-haspopup="dialog"
      aria-keyshortcuts="Shift+F10"
      tabIndex={props.focusable ? 0 : -1}
      onClick={() => props.onPick(markers)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onAdd) return;
        const actions = questActions(markers, show);
        const groups = markers
          .map((m) => ({ title: sourceTitle(m), items: actions.filter((a) => a.marker === m).map((a) => actionItem(a, onAdd)) }))
          .filter((g) => g.items.length > 0);
        props.openMenu(groups.length === 1 ? groups[0]! : { label: "Quests here", groups }, e.currentTarget);
      }}
    >
      {giver && <MapIconImage icon="quest-giver" size={16} className={markers.every((m) => m.available.every(dimmed)) ? "dim" : ""} />}
      {ender && <MapIconImage icon="quest-turn-in" size={16} className={markers.some(turnInDone) ? "" : "incomplete"} />}
    </MarkButton>
  );
});

const sourceTitle = (marker: QuestMarker) => (
  <>
    {marker.entity?.type !== "object" && <Icon name="user" size={12} />}
    {marker.entity ? (
      <EntityLink type={marker.entity.type} id={marker.entity.id} menuItem>
        {marker.source}
      </EntityLink>
    ) : (
      marker.source
    )}
  </>
);

const actionItem = (action: QuestAction, onAdd: (action: QuestAction) => void): MapMenuItem => {
  const accept = action.command === "accept";
  return {
    label: action.label,
    run: () => onAdd(action),
    icon: (
      <MapIconImage
        icon={accept ? "quest-giver" : "quest-turn-in"}
        size={14}
        className={action.muted ? (accept ? "dim" : "incomplete") : ""}
      />
    ),
    content: (
      <>
        <EntityLink type="quest" id={action.id} menuItem>
          {action.name}
        </EntityLink>
        {action.tagged && ` (#${action.id})`}
        {action.note && <span className="map-menu-note">{action.note}</span>}
      </>
    ),
    action: actionVerb(action),
  };
};

export function QuestCard(props: {
  markers: readonly QuestMarker[];
  show: QuestShow;
  data: GameData;
  faction: Faction;
  level: number | null;
  lockNames: LockNames;
}) {
  const { markers, show, data, lockNames } = props;
  const rows = markers.map((m) => questRows(m, show, lockNames));
  const count = rows.reduce((n, r) => n + r.length, 0);
  return (
    <>
      <p>
        {count} {count === 1 ? "quest" : "quests"}
        {markers.length > 1 && ` at ${markers.length} places`}
      </p>
      {markers.map((m, i) => (
        <section key={m.key} className="quest-card">
          {markers.length > 1 && (
            <Heading level={3} size="body">
              {m.source}
            </Heading>
          )}
          <ul>
            {rows[i]!.map((row) => {
              const quest = data.quest(row.id, props.faction);
              const status = `${row.role}${row.notes ? `: ${row.notes}` : ""}`;
              return (
                <li key={`${row.role}:${row.id}`}>
                  {quest ? <QuestPreview data={data} quest={quest} level={props.level} status={status} /> : `${status}: ${row.name}`}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

const turnInDone = (marker: QuestMarker) => marker.turnIns.some((q) => q.complete);
