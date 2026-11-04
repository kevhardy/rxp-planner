import { factionData } from "../rules/index.ts";
import { parseGuide, type Step } from "../guide/index.ts";
import { floorHintText } from "../routing/floorHint.ts";
import {
  buildTimeline,
  formatClock,
  reportTitle,
  stepTitle,
  straightTravel,
  TIMELINE_MODEL,
  timelineNpcs,
  type TimelineResult,
  type TimelineStep,
  type Travel,
} from "../rules/index.ts";
import { findOpportunities } from "../rules/opportunities.ts";
import { CHARACTER, MAX_GUIDE, parsePoint, POINT, profileOf, questRef, runGuide, worldPlace, type CharacterInput } from "./data.ts";
import { ToolError, type AgentContext, type Tool } from "./tool.ts";

const GUIDE = { type: "string", maxLength: MAX_GUIDE, description: "Guide text: header lines, then `step` blocks." } as const;
const PARTY_NOTE = "A guide is solo unless its header has `-- @sim party=2`, which makes it a duo guide; set it for a duo.";

function hostTravel(ctx: AgentContext): Travel | undefined {
  const { travel } = ctx;
  if (!travel) return undefined;
  return async (leg) => {
    const estimate = straightTravel(leg);
    const { from, to, mode } = leg;
    if (from.instance !== to.instance || mode !== "Run") return estimate;
    const route = await travel(from, to);
    return route ? { seconds: route.seconds, source: "routing" } : { ...estimate, source: "straight (no route)" };
  };
}

async function timeGuide(ctx: AgentContext, text: string, input: CharacterInput) {
  const doc = parseGuide(text);
  const profile = profileOf(input);
  const { sim } = factionData(ctx.game, ctx.entities, profile.faction);
  const travel = hostTravel(ctx);
  const result = await buildTimeline([doc], 0, profile, sim, {
    ...timelineNpcs(ctx.game, profile.faction),
    ...(travel && { travel }),
  });
  if (!result.steps.length) {
    const run = runGuide(ctx, text, input);
    throw new ToolError(
      run.hidden
        ? `RXP would not run this guide for a ${input.race} ${input.class}: ${run.hidden}`
        : "The guide shows no steps for this character. Run guide_check.",
    );
  }
  return { doc, result };
}

const seconds = (s: TimelineStep["seconds"]) => ({
  travel: Math.round(s.travel),
  kill: Math.round(s.kill),
  interact: Math.round(s.interact),
  wait: Math.round(s.wait),
  total: Math.round(s.total),
});

function totals(result: TimelineResult) {
  const t = result.totals;
  return {
    party: result.steps[0]?.party ?? 1,
    time: formatClock(t.seconds),
    seconds: Math.round(t.seconds),
    levelStart: t.levelStart,
    levelEnd: t.levelEnd,
    xp: t.xp,
    xpPerHour: t.xpPerHour,
    kills: t.kills,
    questsTurnedIn: t.questsTurnedIn,
    travelSeconds: Math.round(t.travelSeconds),
    killSeconds: Math.round(t.killSeconds),
    otherSeconds: Math.round(t.seconds - t.travelSeconds - t.killSeconds),
  };
}

function travelSources(result: TimelineResult): string {
  const counts = new Map<string, number>();
  for (const step of result.steps)
    for (const { source } of step.activities) if (source !== undefined) counts.set(source, (counts.get(source) ?? 0) + 1);
  return [...counts].map(([source, n]) => `${source} ${n}`).join(", ") || "none";
}

const MAX_WARNINGS = 20;
const warnings = (result: TimelineResult) => result.warnings.slice(0, MAX_WARNINGS).map((w) => `Step ${w.step + 1}: ${w.message}`);

const guideTimeline: Tool<CharacterInput & { guide: string; slowest: number }> = {
  name: "guide_timeline",
  description: `Estimate play time for a guide: travel, kills (combat, walking between mobs, rest), interactions, and Hearthstone waits, step by step. Returns totals, when each level is reached, the slowest steps with their split, and warnings. Travel uses ground routes on real terrain when the host has them (\`travelLegs\` says), else a straight line times ${TIMELINE_MODEL.detour.value} at ${TIMELINE_MODEL.runSpeed.value} yd/s. A ${TIMELINE_MODEL.killSeconds.value.yellow} s yellow kill is the base. ${PARTY_NOTE} Use guide_compare to prove a change helps.`,
  inputSchema: {
    type: "object",
    properties: {
      guide: GUIDE,
      ...CHARACTER,
      slowest: { type: "integer", minimum: 1, maximum: 30, default: 10, description: "How many of the slowest steps to list." },
    },
    required: ["guide", "race", "class"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const { result } = await timeGuide(ctx, input.guide, input);
    const slowest = [...result.steps]
      .sort((a, b) => b.seconds.total - a.seconds.total)
      .slice(0, input.slowest)
      .map((s) => ({
        step: s.step + 1,
        title: reportTitle(s.title),
        level: s.levelBefore,
        seconds: seconds(s.seconds),
        ...(s.kills?.length && { kills: s.kills.map((k) => `${k.count} ${k.name}`).join(", ") }),
      }));
    return {
      totals: totals(result),
      byLevel: result.byLevel.map((l) => ({ level: l.level, at: formatClock(l.reachedAt), seconds: Math.round(l.reachedAt) })),
      steps: result.steps.length,
      travelLegs: travelSources(result),
      slowest,
      warnings: warnings(result),
      ...(result.warnings.length > MAX_WARNINGS && { moreWarnings: result.warnings.length - MAX_WARNINGS }),
    };
  },
};

const stepKey = (step: Step) =>
  step.body
    .map((line) => (line.raw ?? "").trim())
    .filter(Boolean)
    .join("\n");

const MAX_CHANGED = 15;

function changedSteps(before: readonly Step[], after: readonly Step[]) {
  const left = new Map<string, number>();
  for (const step of before) left.set(stepKey(step), (left.get(stepKey(step)) ?? 0) + 1);
  const added: { step: number; title: string }[] = [];
  after.forEach((step, i) => {
    const n = left.get(stepKey(step)) ?? 0;
    if (n > 0) left.set(stepKey(step), n - 1);
    else added.push({ step: i + 1, title: stepTitle(step) });
  });
  const removed: { step: number; title: string }[] = [];
  before.forEach((step, i) => {
    const n = left.get(stepKey(step)) ?? 0;
    if (n > 0) {
      left.set(stepKey(step), n - 1);
      removed.push({ step: i + 1, title: stepTitle(step) });
    }
  });
  const list = (rows: typeof added) => ({ count: rows.length, steps: rows.slice(0, MAX_CHANGED) });
  return { added: list(added), removed: list(removed) };
}

function newWarnings(before: TimelineResult, after: TimelineResult): string[] {
  const known = new Set(before.warnings.map((w) => w.message));
  return warnings({ ...after, warnings: after.warnings.filter((w) => !known.has(w.message)) });
}

const guideCompare: Tool<CharacterInput & { before: string; after: string }> = {
  name: "guide_compare",
  description: `Time two versions of a guide with the same character and travel, and give the differences: total time, time to each level, XP per hour, kills, and travel, plus the steps added and removed. Negative seconds mean \`after\` is faster. \`verdict\` compares the time to the highest level both reach, since a guide that stops earlier is not faster. ${PARTY_NOTE}`,
  inputSchema: {
    type: "object",
    properties: { before: GUIDE, after: GUIDE, ...CHARACTER },
    required: ["before", "after", "race", "class"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const [a, b] = [await timeGuide(ctx, input.before, input), await timeGuide(ctx, input.after, input)];
    const [before, after] = [totals(a.result), totals(b.result)];
    const reached = (r: TimelineResult) => new Map(r.byLevel.map((l) => [l.level, l.reachedAt]));
    const [ra, rb] = [reached(a.result), reached(b.result)];
    const levels = [...new Set([...ra.keys(), ...rb.keys()])].sort((x, y) => x - y);
    const byLevel = levels.map((level) => {
      const [x, y] = [ra.get(level), rb.get(level)];
      return {
        level,
        before: x === undefined ? null : formatClock(x),
        after: y === undefined ? null : formatClock(y),
        ...(x !== undefined && y !== undefined && { deltaSeconds: Math.round(y - x) }),
      };
    });
    const common = levels.filter((l) => ra.has(l) && rb.has(l)).at(-1);
    let verdict: string;
    if (common === undefined) verdict = "The guides reach no level in common; compare totals instead.";
    else {
      const delta = Math.round(rb.get(common)! - ra.get(common)!);
      verdict =
        delta === 0
          ? `Both reach level ${common} at ${formatClock(ra.get(common)!)}.`
          : `after reaches level ${common} ${formatClock(Math.abs(delta))} ${delta < 0 ? "sooner" : "later"} (${formatClock(rb.get(common)!)} against ${formatClock(ra.get(common)!)}).`;
    }
    const diff = (key: "seconds" | "xp" | "xpPerHour" | "kills" | "travelSeconds" | "killSeconds" | "otherSeconds") =>
      after[key] - before[key];
    return {
      verdict,
      before,
      after,
      delta: {
        seconds: diff("seconds"),
        xp: diff("xp"),
        xpPerHour: diff("xpPerHour"),
        kills: diff("kills"),
        travelSeconds: diff("travelSeconds"),
        killSeconds: diff("killSeconds"),
        otherSeconds: diff("otherSeconds"),
        levelEnd: after.levelEnd - before.levelEnd,
      },
      byLevel,
      ...changedSteps(a.doc.steps, b.doc.steps),
      warnings: { before: a.result.warnings.length, after: b.result.warnings.length, new: newWarnings(a.result, b.result) },
    };
  },
};

const guideOpportunities: Tool<CharacterInput & { guide: string; step?: number; top: number; maxSteps: number }> = {
  name: "guide_opportunities",
  description:
    "While-you-are-here ideas for a guide: at each step that kills or loots for quest objectives, other objectives whose spawns are near (quests in the log first, then quests the character can pick up now). Each idea has RXP text to paste before the step: a `#completewith next` step for a quest in the log, or a `>>` line for a pickup. `plannedStep` is the later step that does it now; moving that work here can save a trip.",
  inputSchema: {
    type: "object",
    properties: {
      guide: GUIDE,
      ...CHARACTER,
      step: { type: "integer", minimum: 1, maximum: 10_000, description: "Only this 1-based step." },
      top: { type: "integer", minimum: 1, maximum: 10, default: 3, description: "Ideas per step." },
      maxSteps: { type: "integer", minimum: 1, maximum: 40, default: 15, description: "Steps to list." },
    },
    required: ["guide", "race", "class"],
    additionalProperties: false,
  },
  run(input, ctx) {
    const run = runGuide(ctx, input.guide, input);
    const { opportunities } = factionData(ctx.game, ctx.entities, run.profile.faction);
    const found = findOpportunities([run.doc], run.simulation, run.profile, opportunities).filter(
      (s) => input.step === undefined || s.step === input.step - 1,
    );
    return {
      stepsWithIdeas: found.length,
      steps: found.slice(0, input.maxSteps).map((s) => ({
        step: s.step + 1,
        title: stepTitle(run.doc.steps[s.step]!),
        ideas: s.opportunities.slice(0, input.top).map((o) => ({
          quest: questRef(ctx.game, o.questId),
          objective: o.objective.name,
          kind: o.kind,
          source: o.source,
          yards: o.distanceYards,
          share: o.overlapShare,
          remaining: o.remaining,
          ...(o.covered && { covered: true }),
          plannedStep: o.plannedStep === null ? null : o.plannedStep + 1,
          rxp: o.suggestion,
        })),
        ...(s.opportunities.length > input.top && { moreIdeas: s.opportunities.length - input.top }),
      })),
    };
  },
};

const floorHint: Tool<{ point: string }> = {
  name: "floor_hint",
  description:
    "Whether a `.goto` point has stacked floors, as in a building or a city, and the NPC's floor when the routing data knows it. Add the `note` to the step as a text line, so the player looks on the right floor. Needs the routing artifact for the point's map.",
  inputSchema: { type: "object", properties: { point: POINT }, required: ["point"], additionalProperties: false },
  async run(input, ctx) {
    const at = parsePoint(ctx.game, input.point);
    const place = worldPlace(ctx.game, at);
    const hint = await ctx.floorHint?.(at);
    if (!hint)
      return {
        available: false,
        place,
        why: ctx.floorHint
          ? `This host has no routing artifact for map ${at.instance}, so it cannot tell the floors.`
          : "This host has no routing data, so it cannot tell the floors.",
      };
    const note = floorHintText(hint);
    return {
      available: true,
      place,
      kind: hint.kind,
      ...(hint.kind !== "single" && { floors: hint.floors }),
      ...(hint.kind === "known" && { floor: hint.floor }),
      note: note ?? "One floor here.",
    };
  },
};

export const MEASURE_TOOLS = [guideTimeline, guideCompare, guideOpportunities, floorHint];
