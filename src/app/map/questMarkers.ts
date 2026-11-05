import type { GameData, MapLocation, Quest, QuestPoint, WorldLocation } from "../../data/index.ts";
import {
  questAccess,
  trivialQuest,
  unknownFacts,
  type LockReason,
  type Profile,
  type SimData,
  type SimState,
  type UnknownFact,
} from "../../rules/index.ts";
import { lockText, type LockNames } from "../quests/lockText.ts";
import type { QuestSpot, ViewPoint } from "./points.ts";

export interface AvailableQuest {
  id: number;
  name: string;
  level: number | null;
  locked: LockReason[];
  trivial: boolean;
  unknown: UnknownFact[];
}

export interface TurnInQuest {
  id: number;
  name: string;
  level: number | null;
  complete: boolean;
  unknown: UnknownFact[];
}

export interface QuestMarker extends MapLocation {
  key: string;
  source: string;
  entity?: { type: "npc" | "object"; id: number };
  available: AvailableQuest[];
  turnIns: TurnInQuest[];
}

export interface PlacedMarker {
  marker: QuestMarker;
  at: ViewPoint;
}

export function questMarkers(
  state: Pick<SimState, "level" | "log" | "done">,
  data: GameData,
  sim: SimData,
  profile: Pick<Profile, "faction" | "race" | "class">,
  options: { all: boolean; spots: readonly QuestSpot[] },
): QuestMarker[] {
  const record = (id: number) => data.quest(id, profile.faction);
  const drawn = options.spots.flatMap((s) => (s.quests ?? []).map((q) => ({ ...q, world: s.world })));
  const markers = new Map<string, QuestMarker[]>();
  const place = (quest: Quest, role: "start" | "end", points: readonly QuestPoint[], add: (m: QuestMarker) => void) => {
    for (const p of points) {
      const { uiMapId, x, y, world } = data.locateQuestPoint(p);
      if (drawn.some((d) => d.role === role && d.id === quest.id && near(d.world, world))) continue;
      const source = `${p.sourceType}:${p.sourceId ?? p.sourceName}`;
      const own = markers.get(source) ?? [];
      let marker = own.find((m) => near(m.world, world));
      if (!marker) {
        const key = `${source}@${world.instance}:${world.x}:${world.y}`;
        marker = { key, source: p.sourceName, uiMapId, x, y, world, available: [], turnIns: [] };
        if ((p.sourceType === "npc" || p.sourceType === "object") && p.sourceId !== undefined)
          marker.entity = { type: p.sourceType, id: p.sourceId };
        own.push(marker);
        markers.set(source, own);
      }
      add(marker);
    }
  };

  for (const rec of data.searchQuests({ faction: profile.faction })) {
    const { id } = rec;
    if (state.log.has(id) || state.done.has(id)) continue;
    const quest = sim.quest(id);
    if (!quest || quest.acceptOnTurnIn) continue;
    const access = questAccess(quest, state, profile, sim);
    if (access.excluded) continue;
    const trivial = quest.level !== null && trivialQuest(quest.level, state.level);
    if (!options.all && (access.locked.length > 0 || trivial)) continue;
    const full = record(id);
    if (!full || full.startPoints.some((p) => p.sourceType === "item")) continue;
    const entry: AvailableQuest = { id, name: quest.name, level: quest.level, locked: access.locked, trivial, unknown: access.unknown };
    place(full, "start", full.startPoints, (m) => {
      if (!m.available.some((q) => q.id === id)) m.available.push(entry);
    });
  }

  for (const [id, progress] of state.log) {
    if (state.done.has(id)) continue;
    const full = record(id);
    if (!full) continue;
    const quest = sim.quest(id);
    const entry: TurnInQuest = {
      id,
      name: full.name,
      level: quest?.level ?? null,
      complete: progress.status === "complete",
      unknown: quest ? unknownFacts(quest) : [],
    };
    place(full, "end", full.endPoints, (m) => {
      if (!m.turnIns.some((q) => q.id === id)) m.turnIns.push(entry);
    });
  }
  return [...markers.values()].flat();
}

const NEAR = 20;
const near = (a: WorldLocation, b: WorldLocation) => a.instance === b.instance && Math.hypot(a.x - b.x, a.y - b.y) <= NEAR;

export const dimmed = (q: AvailableQuest): boolean => q.locked.length > 0 || q.trivial;

export interface QuestShow {
  available: boolean;
  turnIns: boolean;
}

export const shownMarkers = (placed: readonly PlacedMarker[], show: QuestShow): PlacedMarker[] =>
  placed.filter(({ marker }) => (show.available && marker.available.length > 0) || (show.turnIns && marker.turnIns.length > 0));

export interface QuestRow {
  id: number;
  name: string;
  level: number | null;
  role: "Available" | "Turn in";
  notes: string;
}

export function questRows(marker: QuestMarker, show: QuestShow, names: LockNames): QuestRow[] {
  const row = (q: { id: number; name: string; level: number | null }, role: QuestRow["role"], notes: (string | false)[]) => ({
    id: q.id,
    name: q.name,
    level: q.level,
    role,
    notes: notes.filter(Boolean).join(" · "),
  });
  const rows: QuestRow[] = [];
  if (show.available) {
    for (const q of marker.available) {
      const notes = [q.locked.length > 0 && lockText(q.locked, names), q.trivial && "low level", q.unknown.length > 0 && "Data incomplete"];
      rows.push(row(q, "Available", notes));
    }
  }
  if (show.turnIns) {
    for (const q of marker.turnIns)
      rows.push(row(q, "Turn in", [q.complete ? "complete" : "not complete", q.unknown.length > 0 && "Data incomplete"]));
  }
  return rows;
}

const rowText = (r: QuestRow): string =>
  `${r.role}: ${r.name}${r.level === null ? "" : ` (level ${r.level})`}${r.notes ? `: ${r.notes}` : ""}`;

const FULL_ROWS = 4;
const SUMMARY = 3;

export function markerLabel(markers: readonly QuestMarker[], show: QuestShow, names: LockNames): string {
  const [first] = markers;
  if (markers.length === 1 && first) {
    const rows = questRows(first, show, names);
    if (rows.length <= FULL_ROWS) return [first.source, ...rows.map(rowText)].join("\n");
  }
  const counts = (m: QuestMarker) =>
    [
      show.available && m.available.length > 0 && `${m.available.length} to accept`,
      show.turnIns && m.turnIns.length > 0 && `${m.turnIns.length} to turn in`,
    ]
      .filter(Boolean)
      .join(", ");
  const lines = markers.slice(0, SUMMARY).map((m) => `${m.source}: ${counts(m)}`);
  if (markers.length > SUMMARY) lines.push(`and ${markers.length - SUMMARY} more`);
  lines.push("Select for every quest");
  return lines.join("\n");
}

export interface QuestAction {
  label: string;
  command: "accept" | "turnin";
  id: number;
  name: string;
  note: string;
  muted: boolean;
  marker: QuestMarker;
  place: boolean;
  tagged: boolean;
}

export function questActions(markers: readonly QuestMarker[], show: QuestShow): QuestAction[] {
  const place = markers.length > 1;
  const actions = new Map<string, QuestAction>();
  const add = (command: QuestAction["command"], q: { id: number; name: string }, note: string, muted: boolean, marker: QuestMarker) => {
    const key = `${command}:${q.id}`;
    if (!actions.has(key)) actions.set(key, { label: "", command, id: q.id, name: q.name, note, muted, marker, place, tagged: false });
  };
  for (const m of markers) {
    if (show.available) for (const q of m.available) add("accept", q, q.locked.length > 0 ? "locked" : "", dimmed(q), m);
    if (show.turnIns) for (const q of m.turnIns) add("turnin", q, q.complete ? "" : "not complete", !q.complete, m);
  }
  const list = [...actions.values()].map((a) => ({ ...a, label: actionLabel(a) }));
  const shared = (a: QuestAction) => list.some((b) => b !== a && b.label === a.label);
  return list.map((a) => (shared(a) ? { ...a, tagged: true, label: actionLabel({ ...a, tagged: true }) } : a));
}

export const actionVerb = (a: Pick<QuestAction, "command">): string => (a.command === "accept" ? "Accept" : "Turn in");

const actionLabel = (a: QuestAction) =>
  `${actionVerb(a)} ${a.name}${a.note && ` (${a.note})`}${a.place ? ` · ${a.marker.source}` : ""}${a.tagged ? ` (#${a.id})` : ""}`;
