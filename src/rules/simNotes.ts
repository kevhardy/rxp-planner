import type { GameRules } from "../data/index.ts";
import { guideTextPlain, simComment, type Step, type TextPart } from "../guide/index.ts";
import type { DropChance, DropSource } from "./drops.ts";
import { simKeys } from "./simComments.ts";
import type { KillAssumption, KillsLater, LevelUp, MobSource, ObjectiveRef, SimState, StepNote, StepSnapshot, XpGain } from "./simulate.ts";
import { xpToNextLevel } from "./xp.ts";

export interface NoteNames {
  npc(id: number): string;
  item(id: number): string;
  quest(id: number): string;
  /** By `GuidePreview.source`. */
  guide(source: number): string;
  /** The objective's name, else its quest's. */
  objective(ref: ObjectiveRef): string;
}

const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
const xpParts = (n: number, sign: "" | "+" = "") => [{ mono: `${sign}${num(n)}` }, " xp"];
const list = new Intl.ListFormat("en-US");

export interface SimCard {
  title: string;
  value?: TextPart[] | undefined;
  /** `kills` is absent when the title gives the count. */
  mobs?: { name: string; level: number; kills?: number }[];
  rows: { label: string; value: TextPart[] }[];
  /** Each level reached, with "at kill 6 of 8". */
  levels?: { level: number; at: string }[];
  note?: string | undefined;
}

/** A card as text, one part per line, for screen readers. */
export function cardText(card: SimCard): string {
  return [
    card.value ? `${card.title}: ${guideTextPlain(card.value)}` : card.title,
    ...(card.mobs ?? []).map((m) => `${m.kills === undefined ? "" : `${num(m.kills)} `}${m.name} at Lv ${m.level}`),
    ...card.rows.map((r) => `${r.label}: ${guideTextPlain(r.value)}`),
    ...(card.levels ?? []).map((l) => `Level ${l.level} ${l.at}`),
    ...(card.note ? [card.note] : []),
  ].join("\n");
}

type Progress = Pick<SimState, "level" | "xp">;

export interface StepXp {
  level: number;
  /** Arcs as parts of the level: progress before the step, then quest and kill XP, then checkpoint XP. */
  before: number;
  earned: number;
  jump: number;
  /** Whether the step reaches a new level. */
  dinged: boolean;
  /** Whether a checkpoint jumps ahead. */
  checkpoint: boolean;
  /** The level with its XP and quest XP. */
  card: SimCard;
  /**
   * The card's sections after the level, each fact once: one for each kill
   * assumption, the checkpoint, and what the step does not count.
   */
  notes: SimCard[];
  /**
   * `killsLater` when a line's kills count at a later line or step, or
   * never; `notes` when the card has another note, a kill section, or a
   * `@sim` comment.
   */
  mark: "killsLater" | "notes" | undefined;
  /** The level card and the gains in short, for screen readers; the notes give the detail. */
  label: string;
}

/**
 * The step's ring and card, from the state before it (the previous step's,
 * or the header's), its snapshot, and the step for its `@sim` comments.
 */
export function stepXp(
  rules: GameRules,
  before: Progress,
  snapshot: Pick<StepSnapshot, "xp" | "kills" | "levelUps" | "checkpoints" | "notes"> & { state: Progress },
  names: NoteNames,
  step: Step,
): StepXp {
  const { state, xp } = snapshot;
  const need = xpToNextLevel(rules, state.level);
  const dinged = state.level > before.level;
  const start = !need ? 1 : dinged ? 0 : before.xp / need;
  const [earned, jump] = split(need ? state.xp / need - start : 0, xp);
  const percent = need ? Math.floor((state.xp / need) * 100) : undefined;
  const label = [percent === undefined ? `Level ${state.level}` : `Level ${state.level} · ${percent}%`];
  const card: SimCard = { title: `Level ${state.level}`, value: percent === undefined ? undefined : [{ mono: `${percent}%` }], rows: [] };
  if (need > 0) {
    label.push(`${num(state.xp)}/${num(need)} xp · ${num(need - state.xp)} to level ${state.level + 1}`);
    card.rows.push(
      { label: "XP", value: [{ mono: `${num(state.xp)}/${num(need)}` }] },
      { label: `To level ${state.level + 1}`, value: xpParts(need - state.xp) },
    );
  }
  if (xp.quest > 0) {
    label.push(`+${num(xp.quest)} quest xp`);
    card.rows.push({ label: "Quests", value: xpParts(xp.quest, "+") });
  }
  if (xp.kills > 0) label.push(`+${num(xp.kills)} kill xp`);
  if (xp.checkpoint > 0) label.push(`+${num(xp.checkpoint)} xp from a checkpoint`);
  const notes = noteSections(snapshot, names, step);
  return {
    level: state.level,
    before: start,
    earned,
    jump,
    dinged,
    checkpoint: xp.checkpoint > 0,
    card,
    ...notes,
    label: label.join(", ").replaceAll(" ·", ","),
  };
}

function split(amount: number, { quest, kills, checkpoint }: XpGain): [earned: number, jump: number] {
  const total = quest + kills + checkpoint;
  const jump = total > 0 ? (amount * checkpoint) / total : 0;
  return [amount - jump, jump];
}

interface BandSegment {
  /** Progress from before the guide's first step or from a `state=` on arrival, quest and kill XP, or checkpoint XP. */
  kind: "before" | "earned" | "jump";
  /** The part of the level it fills, from 0 to 1. */
  share: number;
  /** "Step 27: +250 xp". */
  text: string;
}

export interface LevelBand {
  level: number;
  /** The step that reaches the level, which the band follows; -1 for the level after the header. */
  after: number;
  /**
   * "steps 26–29 · 1,400 xp" when the guide finishes the level, else
   * "30% · 270/900 xp", with each number as a mono part; empty at the cap.
   */
  detail: TextPart[];
  segments: BandSegment[];
}

/**
 * One band per level the guide's steps end on, in order. A step that gains
 * several levels opens one band, for its last. Skipped steps and hidden
 * guides earn nothing, so they add no segments. A step whose `state=` sets
 * the level or XP on arrival opens a band at the level it sets.
 */
export function levelBands(
  rules: GameRules,
  {
    afterHeader,
    steps,
  }: {
    afterHeader: Progress;
    steps: readonly { before: Progress; state: Progress; xp: XpGain }[];
  },
): LevelBand[] {
  const open = (level: number, after: number): LevelBand => ({ level, after, detail: [], segments: [] });
  const add = (band: LevelBand, amount: number, i: number, xp: XpGain) => {
    const need = xpToNextLevel(rules, band.level);
    if (amount <= 0 || !need) return;
    const [earned, jump] = split(amount, xp);
    if (earned > 0) band.segments.push({ kind: "earned", share: earned / need, text: `Step ${i + 1}: +${num(Math.round(earned))} xp` });
    if (jump > 0)
      band.segments.push({ kind: "jump", share: jump / need, text: `Step ${i + 1}: +${num(Math.round(jump))} xp from a checkpoint` });
  };
  let band = open(afterHeader.level, -1);
  const bands = [band];
  let first = 0;
  const progress = ({ level, xp }: Progress): TextPart[] => {
    const need = xpToNextLevel(rules, level);
    return need ? [{ mono: `${Math.floor((xp / need) * 100)}%` }, " · ", { mono: `${num(xp)}/${num(need)}` }, " xp"] : [];
  };
  const start = ({ level, xp }: Progress, text: string) => {
    if (xp > 0 && xpToNextLevel(rules, level)) band.segments.push({ kind: "before", share: xp / xpToNextLevel(rules, level), text });
  };
  start(afterHeader, `${num(afterHeader.xp)} xp before step 1`);
  let before = afterHeader;
  steps.forEach(({ before: arrived, state, xp }, i) => {
    if (arrived.level !== before.level || arrived.xp !== before.xp) {
      band.detail = progress(before);
      band = open(arrived.level, i - 1);
      bands.push(band);
      first = i;
      start(arrived, `${num(arrived.xp)} xp set on arrival at step ${i + 1}`);
      before = arrived;
    }
    if (state.level === before.level) add(band, state.xp - before.xp, i, xp);
    else {
      add(band, xpToNextLevel(rules, before.level) - before.xp, i, xp);
      band.detail = [
        first === i ? "step " : "steps ",
        { mono: first === i ? `${i + 1}` : `${first + 1}–${i + 1}` },
        " · ",
        { mono: num(xpToNextLevel(rules, band.level)) },
        " xp",
      ];
      band = open(state.level, i);
      bands.push(band);
      first = i;
      add(band, state.xp, i, xp);
    }
    before = state;
  });
  band.detail = progress(before);
  return bands;
}

function killTotal(kills: KillAssumption): number {
  return kills.xp?.rates.reduce((sum, r) => sum + r.count * r.reward, 0) ?? 0;
}

function atKill(kill: { n: number; of: number }): string {
  return `at kill ${num(kill.n)} of ${num(kill.of)}`;
}

const MOB_RULE: Record<Exclude<MobSource, "stepMob">, string> = {
  override: "from mob=",
  objective: "the objective's mob",
  zoneDroppers: "drops it in the quest's zones",
  firstDropper: "its first known dropper",
  nameMatch: "named by the objective",
};

const COUNT_FROM: Record<KillAssumption["countFrom"], string> = {
  data: "quest data",
  guideText: "the guide text",
  override: "kills=",
};

const DEFERRED: Record<KillsLater["reason"], string> = {
  completewith: "#completewith step",
  disablecheckbox: ".disablecheckbox follows",
};

function noteSections(
  { xp, kills, levelUps, checkpoints, notes }: Pick<StepSnapshot, "xp" | "kills" | "levelUps" | "checkpoints" | "notes">,
  names: NoteNames,
  step: Step,
): Pick<StepXp, "notes" | "mark"> {
  const text = (line: number | undefined) => (line === undefined ? step.line : step.body[line]!);
  const sets = kills.map((k): "Count" | "Mob" | undefined => {
    const keys = simKeys(text(k.at.line));
    if (k.objective && k.countFrom === "override" && keys.includes("kills")) return "Count";
    return k.mobFrom === "override" && keys.includes(k.objective ? "mob" : "extra") ? "Mob" : undefined;
  });
  const turnIns = kills.map((k) =>
    notes.find((n) => n.kind === "killsAtTurnIn" && n.at.line === k.at.line && n.questId === k.objective?.questId),
  );
  const jumps = xp.checkpoint > 0 ? checkpoints.filter((c) => c.gap > 0) : [];
  const rest = notes.filter((n) => !turnIns.includes(n)).sort((a, b) => (a.at.line ?? -1) - (b.at.line ?? -1));
  const later = rest.filter((n) => n.kind !== "killsAtTurnIn");
  const unmatched = rest.filter((n) => n.kind === "killsAtTurnIn");
  const parts = [
    ...kills.map((k, i) => ({ line: k.at.line, sets: sets[i] !== undefined })),
    ...jumps.map((c) => ({ line: c.at.line, sets: simKeys(text(c.at.line)).includes("level") })),
    ...[...later, ...unmatched].map((n) => ({ line: n.at.line, sets: false })),
  ];
  let commented = false;
  const comment = (part: number) => {
    const { line } = parts[part]!;
    const home = parts.findIndex((p) => p.line === line && p.sets);
    if ((home >= 0 ? home : parts.findIndex((p) => p.line === line)) !== part) return undefined;
    const found = simComment(text(line));
    commented ||= found !== undefined;
    return found;
  };
  const commentRows = (part: number) => {
    const found = comment(part);
    return found === undefined ? [] : [{ label: "Comment", value: [found] }];
  };
  const sections = kills.map((k, entry) => {
    const card = killCard(k, entry, levelUps, names, { comment: comment(entry), sets: sets[entry] });
    if (turnIns[entry]) card.rows.push({ label: "Counted", value: ["here, at the turn-in"] });
    return card;
  });
  const caveat = kills.map(sharedDropSource);
  if (sections.length > 1 && caveat[0] !== undefined && caveat.every((c) => c === caveat[0])) {
    for (const c of sections) c.note = undefined;
    sections.at(-1)!.note = `Every drop chance above: ${caveat[0]}.`;
  }
  let part = kills.length;
  if (xp.checkpoint > 0) {
    const about = jumps.flatMap((c) => (c.kills ? c.kills.mobs.map((m) => `about ${plural(m.count, `${names.npc(m.npcId)} kill`)}`) : []));
    sections.push({
      title: "Checkpoint",
      value: xpParts(xp.checkpoint, "+"),
      rows: [
        ...(about.length > 0 ? [{ label: "Stands for", value: [about.join(", ")] }] : []),
        ...jumps.flatMap(() => commentRows(part++)),
      ],
    });
  }
  for (const [title, list] of [
    ["Not counted here", later],
    ["Notes", unmatched],
  ] as const) {
    if (list.length > 0) sections.push({ title, rows: list.flatMap((n) => [notCountedRow(n, names), ...commentRows(part++)]) });
  }
  const mark = notes.some((n) => n.kind === "killsLater")
    ? "killsLater"
    : kills.length + notes.length > 0 || commented
      ? "notes"
      : undefined;
  return { notes: sections, mark };
}

function notCountedRow(note: StepNote, names: NoteNames): SimCard["rows"][number] {
  switch (note.kind) {
    case "killsAtTurnIn":
      return { label: names.quest(note.questId), value: [`${plural(note.kills, "kill")} counted here`] };
    case "gathered":
    case "bought":
      return { label: `${note.count === null ? "" : `${num(note.count)} `}${names.item(note.itemId)}`, value: [noteShort(note, names)] };
    case "killsLater":
      return { label: names.objective(note.objective), value: [`${noteShort(note, names)} (${DEFERRED[note.reason]})`] };
  }
}

export interface LineKills {
  /** Where the count came from, "from quest data · 25% drop chance", or what counts the kills instead. */
  count: string;
  /** The rule that chose the mob, such as "from .mob"; "" when the line counts no kills. */
  mob: string;
  /** The XP of all kills at the line, `extra=` kills included. */
  xp: number;
  /** The highest level the kills reach. */
  level?: number;
  /** The line's notes in full. */
  cards: SimCard[];
}

/** The parts of a `.complete` line's notes, or undefined when it has none. */
export function lineKillParts(
  snapshot: Pick<StepSnapshot, "notes" | "kills" | "levelUps">,
  line: number,
  names: NoteNames,
): LineKills | undefined {
  const parts: LineKills = { count: "", mob: "", xp: 0, cards: [] };
  for (const note of snapshot.notes) {
    if (note.at.line !== line) continue;
    parts.cards.push(noteCard(note, names));
    if (note.kind !== "killsAtTurnIn") parts.count = noteShort(note, names);
  }
  snapshot.kills.forEach((kills, entry) => {
    if (kills.at.line !== line) return;
    if (kills.objective) {
      parts.count = [`from ${COUNT_FROM[kills.countFrom]}`, ...(kills.drops ? [dropRange(kills.drops)] : [])].join(" · ");
      parts.mob = mobRule(kills);
    }
    parts.xp += killTotal(kills);
    parts.cards.push(killCard(kills, entry, snapshot.levelUps, names));
    for (const up of snapshot.levelUps) if (up.kill?.entry === entry) parts.level = Math.max(parts.level ?? 0, up.level);
  });
  return parts.cards.length > 0 ? parts : undefined;
}

function killCard(
  kills: KillAssumption,
  entry: number,
  levelUps: readonly LevelUp[],
  names: NoteNames,
  ring?: { comment: string | undefined; sets: "Count" | "Mob" | undefined },
): SimCard {
  const item = kills.itemId == null ? "" : ` for ${names.item(kills.itemId)}`;
  const mobs = kills.mobs.flatMap((m) =>
    m.levels.map((l) => ({ name: `${names.npc(m.npcId)}${m.elite ? " (elite)" : ""}`, level: l.level, kills: l.kills })),
  );
  const comment = ring?.comment;
  const source = (row: "Count" | "Mob", rule: string) => (comment !== undefined && row === ring?.sets ? `from ${comment}` : rule);
  return {
    title: kills.objective ? `${plural(kills.count, "kill")}${item}` : plural(kills.count, "extra kill"),
    value: kills.xp ? xpParts(killTotal(kills), "+") : undefined,
    mobs: ring && mobs.length === 1 ? [{ name: mobs[0]!.name, level: mobs[0]!.level }] : mobs,
    rows: [
      ...(kills.objective
        ? [
            {
              label: "Count",
              value: [`${source("Count", `from ${COUNT_FROM[kills.countFrom]}`)}${kills.drops ? `, ${dropRange(kills.drops)}` : ""}`],
            },
          ]
        : []),
      { label: "Mob", value: [source("Mob", mobRule(kills))] },
      ...(kills.xp ? [{ label: "XP", value: [killXpMath(kills.xp)] }] : []),
      ...(comment !== undefined && !ring?.sets ? [{ label: "Comment", value: [comment] }] : []),
    ],
    levels: levelUps.flatMap((up) => (up.kill?.entry === entry ? [{ level: up.level, at: atKill(up.kill) }] : [])),
    note: kills.drops && dropNote(kills, names, ring !== undefined && oneChance(kills.drops)),
  };
}

const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`;

const oneChance = (drops: NonNullable<KillAssumption["drops"]>) => new Set(drops.map((d) => d.chance.value)).size === 1;

function sharedDropSource(kills: KillAssumption): string | undefined {
  if (!kills.drops || !oneChance(kills.drops)) return undefined;
  const sources = new Set(kills.drops.filter((d) => kills.mobs.some((m) => m.npcId === d.npcId)).map((d) => dropSource(d.chance.source)));
  return sources.size === 1 ? [...sources][0] : undefined;
}

function dropRange(drops: NonNullable<KillAssumption["drops"]>): string {
  const values = [...new Set(drops.map((d) => d.chance.value))].sort((a, b) => a - b);
  return `${values.length === 1 ? percent(values[0]!) : `${percent(values[0]!)} to ${percent(values.at(-1)!)}`} drop chance`;
}

function dropSource(source: DropSource): string {
  switch (source.kind) {
    case "guaranteed":
      return "guaranteed while the quest needs the item";
    case "estimated":
      return "an estimated drop rate";
    case "default":
      return "the planner's default for a missing rate";
    case "override":
      return "from drop=";
  }
}

function dropNote(kills: KillAssumption, names: NoteNames, brief: boolean): string {
  const shared = new Map<string, { chance: DropChance; npcs: string[] }>();
  for (const { npcId, chance } of kills.drops!) {
    if (!kills.mobs.some((m) => m.npcId === npcId)) continue;
    const key = JSON.stringify(chance);
    (shared.get(key) ?? shared.set(key, { chance, npcs: [] }).get(key)!).npcs.push(names.npc(npcId));
  }
  return [...shared.values()]
    .map(({ chance, npcs }) =>
      !brief
        ? `${npcs.join(", ")}: ${percent(chance.value)} drop chance, ${dropSource(chance.source)}.`
        : `${kills.mobs.length === 1 ? "Drop chance" : `${npcs.join(", ")} drop chance`}: ${dropSource(chance.source)}.`,
    )
    .join(" ");
}

function killXpMath({ settings, rates }: NonNullable<KillAssumption["xp"]>): string {
  return rates
    .map(({ base, reward, count }) => {
      const calculation =
        settings.exact !== undefined
          ? `${num(reward)} exact`
          : settings.multiplier !== undefined && settings.multiplier !== 1
            ? `(${num(base)} × ${settings.multiplier} = ${num(reward)})`
            : num(reward);
      return `${num(count)} × ${calculation}`;
    })
    .join(" + ");
}

function noteCard(note: StepNote, names: NoteNames): SimCard {
  switch (note.kind) {
    case "killsAtTurnIn":
      return { title: `${plural(note.kills, "kill")} counted here`, rows: [{ label: "Quest", value: [names.quest(note.questId)] }] };
    case "gathered":
    case "bought":
      return {
        title: "No kills",
        rows: [
          {
            label: "Item",
            value: [
              `${note.count === null ? "" : `${num(note.count)} `}${names.item(note.itemId)}, ${note.kind === "bought" ? "bought" : "from objects"}`,
            ],
          },
        ],
      };
    case "killsLater":
      return {
        title: "No kills counted here",
        rows: [
          { label: "Quest", value: [names.quest(note.objective.questId)] },
          { label: "Why", value: [DEFERRED[note.reason]] },
          { label: "Counted", value: [laterWhere(note, names) ?? "nowhere: no later line or turn-in counts them"] },
        ],
      };
  }
}

function noteShort(note: StepNote, names: NoteNames): string {
  switch (note.kind) {
    case "killsAtTurnIn":
      return `${plural(note.kills, "kill")} counted here`;
    case "gathered":
      return "from objects: no kills";
    case "bought":
      return "bought: no kills";
    case "killsLater": {
      const where = laterWhere(note, names);
      return where ? `kills at ${where}` : "kills never counted";
    }
  }
}

function laterWhere({ at, countedAt }: KillsLater, names: NoteNames): string | undefined {
  if (!countedAt) return undefined;
  return countedAt.guide !== at.guide
    ? `step ${countedAt.step! + 1} of ${names.guide(countedAt.guide)}`
    : countedAt.step === at.step
      ? `line ${countedAt.line! + 1}`
      : `step ${countedAt.step! + 1}`;
}

function mobRule(kills: KillAssumption): string {
  if (!kills.objective) return "from extra=";
  return kills.mobFrom === "stepMob" ? `from ${list.format((kills.mobLines ?? []).map((l) => `.${l}`))}` : MOB_RULE[kills.mobFrom];
}
