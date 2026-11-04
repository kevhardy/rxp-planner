import { lineText, parseGuide, stepText, type CommandLine, type Step } from "../guide/index.ts";
import { guideMeta } from "../rules/registration.ts";
import { exportAddon, importGuides } from "../io/index.ts";
import { rowNames, stepLabels, stepSkipText, type KillAssumption, type StepSnapshot } from "../rules/index.ts";
import { commandRule } from "../rules/commands.ts";
import { stepLocations } from "../rules/points.ts";
import { xpToNextLevel } from "../rules/xp.ts";
import { CHARACTER, groupedWarnings, isDataGap, MAX_GUIDE, runGuide, warningLine, worldPlace, type CharacterInput } from "./data.ts";
import { ToolError, type AgentContext, type Tool } from "./tool.ts";

const GUIDE = { type: "string", maxLength: MAX_GUIDE, description: "Guide text: header lines, then `step` blocks." } as const;

async function readGuide(text: string) {
  const { guides } = await importGuides(text).catch((error: unknown) => {
    throw new ToolError(`Cannot read the guide: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (guides.length !== 1) throw new ToolError(`The text holds ${guides.length} guides; pass one at a time.`);
  return guides[0]!;
}

function pointProblems(ctx: AgentContext, steps: readonly Step[]): string[] {
  return steps.flatMap((step, s) =>
    stepLocations(ctx.game, step).problems.map(
      ({ line, command, message }) =>
        `Step ${s + 1}, line ${line + 1}: .${command} ${(step.body[line] as CommandLine).args.join(",")}: ${message}`,
    ),
  );
}

const MAX_PROBLEMS = 40;

const guideCheck: Tool<CharacterInput & { guide: string }> = {
  name: "guide_check",
  description:
    "Check a guide for the character: header problems (#name, #group), points and paths (`.goto`, `.line`, `.loop`, and the like) that do not resolve, unknown commands and tags, quest order (accept before turn-in, prerequisites), quest log size, and simulation warnings. `ok` is true when it finds none. `dataGaps` lists what the quest data cannot confirm, such as prerequisites or XP; they do not fail the check, and no edit removes them.",
  inputSchema: {
    type: "object",
    properties: { guide: GUIDE, ...CHARACTER },
    required: ["guide", "race", "class"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const guide = await readGuide(input.guide);
    const run = runGuide(ctx, guide.text, input);
    const problems = [
      ...guide.errors.map((e) => `Header: ${e}`),
      ...(run.hidden ? [`RXP would not run this guide for a ${input.race} ${input.class}: ${run.hidden}`] : []),
      ...pointProblems(ctx, run.doc.steps),
      ...groupedWarnings(
        ctx.game,
        run.warnings.filter((w) => !isDataGap(ctx.game, w)),
      ),
    ];
    const dataGaps = groupedWarnings(
      ctx.game,
      run.warnings.filter((w) => isDataGap(ctx.game, w)),
    );
    const shown = run.simulation.guides[0]?.steps.filter((s) => s.preview.shown).length ?? 0;
    return {
      ok: problems.length === 0,
      steps: run.doc.steps.length,
      shownSteps: shown,
      problems: problems.slice(0, MAX_PROBLEMS),
      ...(problems.length > MAX_PROBLEMS && { moreProblems: problems.length - MAX_PROBLEMS }),
      ...(dataGaps.length && { dataGaps: dataGaps.slice(0, MAX_PROBLEMS) }),
    };
  },
};

function killsText(ctx: AgentContext, kills: readonly KillAssumption[]): string[] {
  const byMob = new Map<number, number>();
  for (const kill of kills)
    for (const mob of kill.mobs) byMob.set(mob.npcId, (byMob.get(mob.npcId) ?? 0) + mob.levels.reduce((sum, l) => sum + l.kills, 0));
  return [...byMob].flatMap(([id, n]) => (n > 0 ? [`${n} ${ctx.game.npcName(id) ?? `NPC ${id}`}`] : []));
}

const changesCharacter = (name: string) => {
  const rule = commandRule(name);
  return rule?.effect !== undefined || rule?.interact !== undefined;
};
const commandSummary = (step: Step) =>
  step.body
    .flatMap((line) =>
      line.kind === "command" && changesCharacter(line.name) ? [`${line.name} ${line.args.slice(0, 2).join(",")}`.trim()] : [],
    )
    .join("; ");

const guideSimulate: Tool<CharacterInput & { guide: string; xp: number; fromStep: number; toStep?: number }> = {
  name: "guide_simulate",
  description:
    "Run the leveling simulator on a guide for the character. Per step: level and XP after it, quest and kill XP gained, turn-ins, kills, level-ups, or why RXP skips the step. Also totals, the end state (level, quest log, position), and warnings. The simulator counts quest XP and kill XP; it does not count time.",
  inputSchema: {
    type: "object",
    properties: {
      guide: GUIDE,
      ...CHARACTER,
      xp: { type: "integer", minimum: 0, maximum: 1_000_000, default: 0, description: "XP into the start level." },
      fromStep: { type: "integer", minimum: 1, maximum: 10_000, default: 1, description: "First step to list." },
      toStep: { type: "integer", minimum: 1, maximum: 10_000, description: "Last step to list; at most 80 steps are listed." },
    },
    required: ["guide", "race", "class"],
    additionalProperties: false,
  },
  run(input, ctx) {
    const run = runGuide(ctx, input.guide, input, input.xp);
    const sim = run.simulation.guides[0];
    const steps: readonly StepSnapshot[] = sim?.steps ?? [];
    const last = Math.min(input.toStep ?? steps.length, input.fromStep + 79, steps.length);
    const names = rowNames(ctx.game, ctx.entities);
    const labels = stepLabels(run.doc.steps, run.profile);
    const rows = steps.slice(input.fromStep - 1, last).map((snapshot) => {
      const step = snapshot.step + 1;
      const { preview, state, xp, turnIns, levelUps, kills } = snapshot;
      if (!preview.shown) return { step, skipped: preview.reason ? stepSkipText(preview.reason, run.profile, names, labels) : "not shown" };
      const killed = killsText(ctx, kills);
      return {
        step,
        does: commandSummary(run.doc.steps[snapshot.step]!),
        level: state.level,
        xp: state.xp,
        ...(xp.quest + xp.kills + xp.checkpoint > 0 && {
          gained: { quest: xp.quest, kills: xp.kills, ...(xp.checkpoint && { checkpoint: xp.checkpoint }) },
        }),
        ...(turnIns.length && { turnIns: turnIns.map((t) => `${t.questId} +${t.xp}`) }),
        ...(killed.length && { kills: killed }),
        ...(levelUps.length && { dings: levelUps.map((l) => l.level) }),
      };
    });
    const all = steps.filter((s) => s.preview.shown);
    const sum = (pick: (s: StepSnapshot) => number) => all.reduce((total, s) => total + pick(s), 0);
    const end = sim?.end ?? run.simulation.start;
    return {
      ...(run.hidden && { hidden: `RXP would not run this guide for this character: ${run.hidden}` }),
      steps: steps.length,
      listed: `${input.fromStep}-${last}`,
      rows,
      totals: {
        startLevel: input.level,
        endLevel: end.level,
        endXp: end.xp,
        xpToNextLevel: end.level < 60 ? xpToNextLevel(ctx.game.rules, end.level) - end.xp : 0,
        questXp: sum((s) => s.xp.quest),
        killXp: sum((s) => s.xp.kills),
        kills: sum((s) => s.kills.reduce((n, k) => n + k.mobs.reduce((m, mob) => m + mob.levels.reduce((l, x) => l + x.kills, 0), 0), 0)),
        turnIns: sum((s) => s.turnIns.length),
      },
      end: {
        log: [...end.log].map(([id, p]) => ({ id, name: ctx.game.quest(id)?.name ?? null, status: p.status })),
        ...(end.position && { at: worldPlace(ctx.game, end.position) }),
      },
      warnings: run.warnings.slice(0, 30).map((w) => warningLine(ctx.game, w)),
    };
  },
};

const MAX_EXAMPLE_STEPS = 40;

const guideExample: Tool<{ name?: string; group?: string; filter?: string; fromStep: number; count: number }> = {
  name: "guide_example",
  description:
    "Read RestedXP's own built-in guides to copy their style. Without `name`, lists the guides (name, group, steps, next). With `name`, returns its header and a range of its steps as text. `group` narrows both to one #group.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        maxLength: 200,
        description: "Guide #name, such as 1-6 Northshire. Part of a name works when only one guide matches.",
      },
      group: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "The guide's #group, matched exactly. It picks one of the guides that share a name.",
      },
      filter: { type: "string", maxLength: 100, description: "Without name: only guides whose name or group holds this text." },
      fromStep: { type: "integer", minimum: 1, maximum: 10_000, default: 1 },
      count: { type: "integer", minimum: 1, maximum: MAX_EXAMPLE_STEPS, default: 12 },
    },
    additionalProperties: false,
  },
  run(input, ctx) {
    const all = ctx.guides.map((record) => ({ record, meta: guideMeta(record) }));
    const metas = input.group === undefined ? all : all.filter(({ meta }) => meta.group === input.group);
    if (input.name === undefined) {
      const key = input.filter?.toLowerCase() ?? "";
      const rows = metas.filter(({ meta }) => `${meta.name} ${meta.group}`.toLowerCase().includes(key));
      return {
        guides: rows.map(({ record, meta }) => ({
          name: meta.name,
          group: meta.group,
          steps: parseGuide(record.text).steps.length,
          ...(meta.next.length && { next: meta.next.map((n) => n.name).join(", ") }),
        })),
      };
    }
    const key = input.name.trim().toLowerCase();
    const exact = metas.filter(({ meta }) => meta.name.toLowerCase() === key);
    const matches = exact.length ? exact : metas.filter(({ meta }) => meta.name.toLowerCase().includes(key));
    if (matches.length !== 1)
      throw new ToolError(
        matches.length
          ? `"${input.name}" matches ${matches.length} guides: ${matches
              .slice(0, 10)
              .map(({ meta }) => `${meta.name} (${meta.group})`)
              .join("; ")}.${input.group === undefined ? " Pass group to pick one." : ""}`
          : `No built-in guide${input.group === undefined ? "" : ` in group "${input.group}"`} is named "${input.name}". Call guide_example without a name to list them.`,
      );
    const { record, meta } = matches[0]!;
    const doc = parseGuide(record.text);
    const from = input.fromStep - 1;
    return {
      name: meta.name,
      group: meta.group,
      steps: doc.steps.length,
      header: doc.header.map(lineText).join("\n").trim(),
      text: doc.steps.slice(from, from + input.count).map((step, i) => ({ step: from + i + 1, text: stepText(step).trimEnd() })),
    };
  },
};

const guideSave: Tool<{ title: string; guide: string }> = {
  name: "guide_save",
  description:
    "Save a guide as a WoW addon that registers it with RestedXP: `<title>/<title>.toc` and `<title>/guides.lua`. The planner's Import reads guides.lua. The guide needs #name and #group. Returns the saved paths.",
  inputSchema: {
    type: "object",
    properties: { title: { type: "string", maxLength: 64, description: "Addon title; also the folder name." }, guide: GUIDE },
    required: ["title", "guide"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    if (!ctx.save) throw new ToolError("This host cannot save files.");
    const guide = await readGuide(input.guide);
    if (guide.errors.length) throw new ToolError(`Not saved: ${guide.errors.join(" ")}`);
    const addon = exportAddon(input.title, [guide]);
    return { saved: await ctx.save(addon.files), name: guide.name, folder: addon.folder };
  },
};

export const GUIDE_TOOLS = [guideCheck, guideSimulate, guideExample, guideSave];
