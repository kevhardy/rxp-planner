import { pointLabel, type EntityIndex, type EntityType, type GameData } from "../../data/index.ts";
import {
  guideText,
  isTexture,
  luaNumber,
  type BodyLine,
  type CommandLine,
  type Condition,
  type ConditionExpr,
  type Step,
  type TagName,
  type TextPart,
} from "../../guide/index.ts";
import { commandRule } from "../commands.ts";
import { linkType, namedRow } from "../completeRows.ts";
import { describeReason, type HideReason, type StepPreview, type TagValue } from "../preview.ts";
import type { Profile } from "../profile.ts";
import { CLASSES } from "../../data/races.ts";
import type { MarkKind, MarkRef } from "./marks.ts";
import { TAG_ROWS, readArgs, say, type CommandRow, type Say, type WhereRow } from "./table.ts";

export * from "./marks.ts";

/**
 * The names a row needs. Each lookup gives `undefined` when the loaded data
 * lacks the name, and the row writes its own fallback, such as "Item #6948".
 * `name` has the shape of the `guideText` callback, so references inside
 * guide text resolve too.
 */
export interface RowNames {
  name(type: EntityType, id: number): string | undefined;
  /** A `.complete` objective: its name, its kind (`item`, `monster`, ...) when known, and its count when known. */
  objective(questId: number, index: number): { name: string; type?: string; count?: number } | undefined;
  /** The zone name and the "x, y" point of `.goto` arguments, when the game data places them. */
  place(gotoArgs: readonly string[]): { zone: string; point: string } | undefined;
  /** A map name for a zone token, such as a UI map ID or an RXP zone name. */
  map(token: string): string | undefined;
  faction(id: number): string | undefined;
}

/** Names from the loaded game data and entity index. Either may be absent while it loads. */
export function rowNames(data: GameData | null, entities: EntityIndex | null): RowNames {
  return {
    name: (type, id) =>
      type === "quest" ? data?.quest(id)?.name : (entities?.lookup(type, id)?.name ?? (type === "npc" ? data?.npcName(id) : undefined)),
    objective(questId, index) {
      const quest = data?.quest(questId);
      const row = quest && namedRow(quest, index);
      if (!row) return undefined;
      const { name, count } = row.objective;
      const link = row.kind === "text" ? row.objective.link : undefined;
      const type =
        row.kind === "numbered"
          ? row.objective.type
          : link && (link.kind === "item" || row.objective.need === "kills")
            ? linkType(link)
            : undefined;
      return { name, ...(type !== undefined && { type }), ...(count !== undefined && { count }) };
    },
    place(args) {
      const at = data?.locateGoto(args);
      return at?.ok ? { zone: data!.mapName(at.uiMapId), point: pointLabel(at.x, at.y) } : undefined;
    },
    map(token) {
      const id = data?.uiMapNamed(token) ?? luaNumber(token);
      return (
        data?.zoneByName(token)?.name ?? (id === undefined ? undefined : (data?.zoneByUiMapId(id) ?? data?.continentByUiMapId(id))?.name)
      );
    },
    faction: (id) => data?.factionName(id),
  };
}

export interface RowView {
  names: RowNames;
  /** The previewed character before the step and what it sees of the step; undefined until the preview loads, so every line shows. */
  character: { preview: StepPreview; profile: Profile } | undefined;
  /** The step index of each `#label`, as `stepLabels` gives it for the previewed character. */
  labels: ReadonlyMap<string, number>;
  /** Keep lines whose own condition fails, marked `skipped`, instead of dropping them. */
  showSkipped: boolean;
  /** The simulation's `level=` checkpoints, which read "Assume level N" on a line with no other action. */
  checkpoints?: readonly { line: number; level: string }[];
}

interface Skippable {
  /** Why the character skips the line, such as "Only for Mage". Set only while `showSkipped` keeps the line. */
  skipped?: string;
}

interface DoLine extends Skippable {
  /** The body line. Skips, XP, and level marks key on it. */
  line: number;
  mark: MarkRef;
  /** The `>>` text with colors and textures, else the readable label. Never empty. */
  text: TextPart[];
}

export interface WhereItem extends Skippable {
  line: number;
  label: string;
}

interface PlaceItem extends Skippable {
  line: number;
  text: TextPart[];
}

interface RowWhere {
  /** One item per `.goto`, naming the zone at the first point and where it changes. */
  places: PlaceItem[];
  waypoints: {
    /** Waypoints whose line holds. */
    shown: number;
    /** Skipped waypoints by reason, with the first line of each reason; empty unless `showSkipped`. */
    skipped: { reason: string; line: number; count: number }[];
  };
  /** NPC names of each `.target` or `.unitscan` line, joined with ", ". */
  targets: WhereItem[];
  mobs: WhereItem[];
}

/** One line of "Notes": a `>>`, `+`, or `*` text line, or the `>>` text of a command that is not an action. */
interface NoteLine extends Skippable {
  line: number;
  /** The note's leading guide icon, else the note mark. */
  mark: MarkRef;
  /** The text after a leading icon, with colors and textures. */
  text: TextPart[];
}

/**
 * One item of the "Who and when" footer.
 * - `condition`: the `step <<` condition, `warn` when it names classes.
 * - `tag`: a step tag that applies to the previewed character.
 * - `check`: a check command, as a plain phrase. The row does not evaluate it.
 * - `setting`: a setting command or a `#label`, which shows on the selected row only.
 */
export interface FooterItem extends Skippable {
  kind: "condition" | "tag" | "check" | "setting";
  /** The body line, or "step" for the step condition. */
  line: number | "step";
  text: TextPart[];
  /** What the item means in RestedXP, for the tooltip. */
  hint?: string;
  tone?: "warn";
}

export interface StepRowModel {
  does: DoLine[];
  where: RowWhere;
  notes: NoteLine[];
  /** The condition first, then tags and checks in guide order, then settings in guide order. */
  footer: FooterItem[];
}

const FOOTER_RANK: Record<FooterItem["kind"], number> = { condition: 0, tag: 1, check: 1, setting: 2 };

/**
 * The row of `step`. Each body line goes to one of `does`, `where`, `notes`,
 * or `footer` by its command's role. A command's `>>` text also goes to
 * `notes` when its role shows no text, or to `does` for `.goto`. A
 * `.waypoint` title goes to neither, since RXP shows it only on its arrow
 * (`addon.DrawArrow` in map.lua). Lines keep guide order inside each part.
 *
 * A line whose `<<` fails for the character drops, or with `showSkipped`
 * stays with `skipped` set. Tags come from the preview, which already drops
 * a failing or shadowed tag line, so those never show. The step's own
 * condition shows in the footer; whether the whole step is skipped is the
 * caller's.
 */
export function stepRow(step: Step, view: RowView): StepRowModel {
  const s = say(view.names, view.labels);
  const row: StepRowModel = {
    does: [],
    where: { places: [], waypoints: { shown: 0, skipped: [] }, targets: [], mobs: [] },
    notes: [],
    footer: [],
  };
  const { where } = row;
  const zones: (string | undefined)[] = [];
  const { character } = view;
  if (step.line.condition) {
    const { text, tone } = conditionPhrase(step.line.condition);
    row.footer.push({ kind: "condition", line: "step", text: [text], ...(tone && { tone }) });
  }

  for (const [name, { value, line }] of character?.preview.tags ?? firstTags(step)) {
    const tag = Object.hasOwn(TAG_ROWS, name) ? TAG_ROWS[name as TagName] : null;
    if (tag) row.footer.push({ kind: tag.kind, line, text: [tag.phrase(value, s)].flat(), ...(tag.hint && { hint: tag.hint }) });
  }

  step.body.forEach((line, i) => {
    if (line.kind !== "command" && line.kind !== "text") return;
    let skip: Skippable = {};
    if (character?.preview.lines[i] === false) {
      if (!view.showSkipped) return;
      skip = { skipped: line.condition ? describeReason({ kind: "condition", condition: line.condition }, character.profile) : "" };
    }
    const text = (mark: MarkKind = "note") => (line.text === undefined ? undefined : face(line.text, view.names, mark));
    const note = () => {
      const shown = text();
      if (shown) row.notes.push({ line: i, ...shown, ...skip });
    };
    if (line.kind === "text") return note();

    const role = commandRow(line);
    switch (role?.role) {
      case undefined:
        row.does.push({ line: i, ...(text("other") ?? { mark: { kind: "other" }, text: ["Unknown command"] }), ...skip });
        return;
      case "do": {
        const a = readArgs(line.args);
        const mark = typeof role.mark === "function" ? role.mark(a, s) : role.mark;
        row.does.push({ line: i, ...(text(mark) ?? { mark: { kind: mark }, text: [role.label(a, s)] }), ...skip });
        if (role.bare && line.text === undefined) row.footer.push({ kind: "check", line: i, text: [role.bare(a, s)], ...skip });
        return;
      }
      case "check":
      case "setting":
        row.footer.push({
          kind: role.role,
          line: i,
          text: [role.phrase(readArgs(line.args), s)],
          ...("hint" in role && role.hint && { hint: role.hint }),
          ...skip,
        });
        return note();
      case "where": {
        if (role.where === "goto") {
          const place = view.names.place(line.args);
          zones.push(place?.zone);
          where.places.push({ line: i, text: [place ? { mono: place.point } : line.args.slice(0, 3).join(",")], ...skip });
        } else if (role.where === "waypoint") {
          if (skip.skipped === undefined) where.waypoints.shown++;
          else {
            const group = where.waypoints.skipped.find((g) => g.reason === skip.skipped);
            if (group) group.count++;
            else where.waypoints.skipped.push({ reason: skip.skipped, line: i, count: 1 });
          }
        } else if (role.where !== "map") {
          const label = line.args.map((arg) => npcName(arg, s)).join(", ");
          (role.where === "mob" ? where.mobs : where.targets).push({ line: i, label, ...skip });
        }
        if (role.textAs === "note") return note();
        if (role.textAs === "arrow") return;
        const shown = text("goto");
        if (shown) row.does.push({ line: i, ...shown, ...skip });
        return;
      }
    }
  });

  where.places.forEach((place, k) => {
    if (zones[k] !== undefined && zones[k] !== zones[k - 1]) place.text.unshift(`${zones[k]} `);
  });
  for (const { line, level } of view.checkpoints ?? []) {
    if (!row.does.some((d) => d.line === line)) row.does.push({ line, mark: { kind: "checkpoint" }, text: [`Assume level ${level}`] });
  }
  row.does.sort((a, b) => a.line - b.line);
  row.footer.sort((a, b) => FOOTER_RANK[a.kind] - FOOTER_RANK[b.kind] || lineOrder(a) - lineOrder(b));
  return row;
}

const lineOrder = (item: FooterItem) => (item.line === "step" ? -1 : item.line);

function firstTags(step: Step): Map<string, TagValue> {
  const tags = new Map<string, TagValue>();
  step.body.forEach((line, i) => {
    if (line.kind === "tag" && !tags.has(line.name)) tags.set(line.name, { value: line.value, line: i });
  });
  return tags;
}

function commandRow(line: CommandLine): Exclude<CommandRow, { role: "either" }> | undefined {
  const row = commandRule(line.name)?.row;
  if (!row) return undefined;
  return row.role === "either" ? row[row.pick(readArgs(line.args), line.text !== undefined)] : row;
}

/** An NPC argument: a name as written, or an ID. A leading `+` attaches the line to an objective. */
function npcName(arg: string, s: Say): string {
  const bare = arg.trim().replace(/^\+/, "");
  return /^\d+$/.test(bare) ? s.npc(Number(bare)) : bare;
}

function face(text: string, names: RowNames, mark: MarkKind): { mark: MarkRef; text: TextPart[] } {
  const parts = guideText(text, names.name, { colors: true });
  return mark === "note" ? noteFace(parts) : { mark: { kind: mark }, text: parts };
}

export function noteFace(parts: readonly TextPart[]): { mark: MarkRef; text: TextPart[] } {
  const [first, ...rest] = parts;
  return first !== undefined && isTexture(first) ? { mark: { icon: first }, text: rest } : { mark: { kind: "note" }, text: [...parts] };
}

const TEXT_MARK: { readonly [T in WhereRow["textAs"]]: MarkKind } = { do: "goto", note: "note", arrow: "goto" };

/**
 * The mark and label of one line on its own, for the editor's line heading
 * and outline. A command reads as its row line would: an action's label, a
 * check's or setting's phrase, or a where line's place or names. A
 * `.waypoint` title, which the row leaves out, reads with the goto mark.
 */
export function lineFace(line: BodyLine, names: RowNames): { mark: MarkRef; text: TextPart[] } {
  const s = say(names, new Map());
  switch (line.kind) {
    case "command": {
      const role = commandRow(line);
      const a = readArgs(line.args);
      const own = (mark: MarkKind, label: TextPart[], textMark = mark) =>
        line.text === undefined ? { mark: { kind: mark }, text: label } : face(line.text, names, textMark);
      switch (role?.role) {
        case undefined:
          return own("other", ["Unknown command"]);
        case "do":
          return own(typeof role.mark === "function" ? role.mark(a, s) : role.mark, [role.label(a, s)]);
        case "check":
        case "setting":
          return { mark: { kind: role.role }, text: [role.phrase(a, s)] };
        case "where": {
          if (role.where === "goto" || role.where === "waypoint") {
            const place = names.place(line.args);
            return own(
              "goto",
              place ? [`${place.zone} `, { mono: place.point }] : [line.args.slice(0, 3).join(",")],
              TEXT_MARK[role.textAs],
            );
          }
          if (role.where === "map") return own("path", [line.args.join(",")], TEXT_MARK[role.textAs]);
          return { mark: { kind: role.where === "mob" ? "kill" : "target" }, text: [line.args.map((arg) => npcName(arg, s)).join(", ")] };
        }
      }
      break;
    }
    case "text":
      return face(line.text, names, "note");
    case "tag": {
      const tag = Object.hasOwn(TAG_ROWS, line.name) ? TAG_ROWS[line.name as TagName] : null;
      return { mark: { kind: "tag" }, text: tag ? [tag.phrase(line.value, s)].flat() : guideText(line.value) };
    }
    case "condition":
      return { mark: { kind: "other" }, text: [line.condition.text] };
    case "comment":
      return { mark: { kind: "other" }, text: [line.comment.trim()] };
    case "other":
      return { mark: { kind: "other" }, text: [line.text] };
    case "blank":
      return { mark: { kind: "other" }, text: [] };
  }
}

/**
 * Why the character skips a hidden step, such as "Skipped for Mage". A
 * runtime gate reads as its row phrase, such as "Skip in Elwynn Forest". A
 * phrase that says when the step runs gets "Only" before it, as in "Only
 * while Quest #5 is in your log".
 */
export function stepSkipText(reason: HideReason, profile: Profile, names: RowNames, labels: ReadonlyMap<string, number>): string {
  const rule = reason.kind === "command" ? commandRule(reason.name) : undefined;
  if (reason.kind !== "command" || !rule?.gate) return describeReason(reason, profile);
  const check = rule.row.role === "either" ? rule.row.check : rule.row;
  if (check.role !== "check") return describeReason(reason, profile);
  const text = check.phrase(readArgs(reason.args), say(names, labels));
  return /^(Skip|Jump) /.test(text) ? text : `Only ${text[0]!.toLowerCase()}${text.slice(1)}`;
}

const CLASS_NAMES = new Set<string>(CLASSES);

/**
 * The footer phrase of a step condition. A condition that names only
 * classes, or only negated classes, is `warn`: "Warrior only", "Warrior,
 * Rogue only", "Not Priest, Mage". Other names read the same way without the
 * tone: "Human only". Any other shape reads "Only for <text>".
 */
export function conditionPhrase(condition: Condition): { text: string; tone?: "warn" } {
  const { expr } = condition;
  const token = (e: ConditionExpr) => (e.type === "token" ? e.value : undefined);
  const negated = (e: ConditionExpr) => (e.type === "not" ? token(e.item) : undefined);
  const listed = (items: ConditionExpr[], read: (e: ConditionExpr) => string | undefined) => {
    const names = items.map(read);
    return names.every((n) => n !== undefined) ? names : undefined;
  };
  const any = listed(expr.type === "or" ? expr.items : [expr], token);
  const none = listed(expr.type === "and" ? expr.items : [expr], negated);
  const names = any ?? none;
  if (!names) return { text: `Only for ${condition.text}` };
  const shown = names.map((n) =>
    CLASS_NAMES.has(n.toUpperCase()) ? n[0]!.toUpperCase() + n.slice(1).toLowerCase() : luaNumber(n) === undefined ? n : `level ${n}+`,
  );
  const text = any ? `${shown.join(", ")} only` : `Not ${shown.join(", ")}`;
  return names.every((n) => CLASS_NAMES.has(n.toUpperCase())) ? { text, tone: "warn" } : { text };
}
