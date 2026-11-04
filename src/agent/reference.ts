import { COMMANDS, lineText, parseGuide, stepText, TAGS, type ArgSpec, type CommandSpec } from "../guide/index.ts";
import { commandRule } from "../rules/commands.ts";
import { guideMeta } from "../rules/registration.ts";
import { ToolError, type AgentContext, type Tool } from "./tool.ts";

const STRUCTURE = `A guide is text. Lines before the first \`step\` line form the header; each \`step\` line starts a step that runs to the next one. Built-in guides indent step lines by 4 spaces.

Header: \`#name\` and \`#group\` are required. Usual header:
  #version 1
  #group My Guides
  #name 1-5 Northshire Valley
  #next 5-10 Elwynn Forest   (optional: the guide that follows)
  #defaultfor Human          (optional)
  << Alliance                (optional: RXP hides the guide unless the condition holds)

Line forms inside a step:
  .command arg1,arg2 >> text   a command; text after \`>>\` is what RXP shows
  >>text                       text shown in the step
  +text                        a manual objective the player ticks
  #tag value                   a step tag, such as #completewith next
  -- comment                   RXP strips it
  ... << Warrior               any line or the step line can end with a condition

How RXP runs steps (GuideWindow.lua \`UpdateStepCompletion\`): a step is done when every objective line in it is done. Objectives are lines such as \`.accept\`, \`.turnin\`, \`.complete\`, \`.collect\`, \`.xp\`, \`.fp\`, \`.home\`, and \`.train\`. Text lines and \`.goto zone,x,y\` without a radius are not objectives, so a step with only those completes at once. \`.goto zone,x,y,R\` with R > 0 is an objective that completes within R yards. \`#completewith next\` makes the step finish when the next step finishes, for work done along the way, such as kills on the way. \`#label\` names a step for \`#completewith\` and \`#requires\`.

Coordinates: \`.goto Elwynn Forest,48.2,42.8\` uses zone map percent; \`.goto 1429/0,-137.5,-8930.2\` uses world yards on UI map 1429, instance 0. The planner tools give points in these forms, ready to paste after \`.goto \`. An optional 4th argument is the arrival radius in yards.

Quest lines: \`.accept 783 >> Accept A Threat Within\`, \`.complete 7,1 --Kobold Vermin (10)\` (objective 1 of quest 7), \`.turnin 783 >> Turn in A Threat Within\`. \`.target Deputy Willem\` adds the NPC to the target macro; \`.mob Kobold Vermin\` marks mobs to kill.

Planner simulation comments (RXP ignores them): \`.complete 7,1 -- @sim kills=6\` counts 6 kills on that line; \`-- @sim extra=10 mob=6\` on its own line adds 10 kills of NPC 6 without a quest; \`-- @sim party=2\` in the header makes the guide a duo guide, for two characters of one race and class who do every step together (no comment, or \`party=1\`, is solo).`;

const CONDITIONS = `\`<< expression\` at the end of a line or on the step line. Tokens: a class (WARRIOR, MAGE, ...; any case), a race (Human, Dwarf, NightElf, Gnome, Orc, Scourge or Undead, Tauren, Troll; Skyborne for both Skyborne races), a faction (Alliance, Horde), or a number N, true at level N or higher. Tokens side by side must all hold; \`/\` means or; \`!\` negates a token or a (group). Examples: \`step << Warrior\`, \`.train 6673 << Warrior\`, \`<< Human/Dwarf\`, \`<< !Mage\`, \`<< Alliance 10\`.`;

const CORE_COMMANDS = [
  "goto",
  "accept",
  "turnin",
  "complete",
  "collect",
  "xp",
  "home",
  "fp",
  "fly",
  "hs",
  "train",
  "target",
  "mob",
  "vendor",
  "trainer",
  "isOnQuest",
  "isQuestComplete",
  "isQuestTurnedIn",
];

const argText = (arg: ArgSpec) => (arg.optional ? `[${arg.name}]` : arg.name);
const signature = (c: CommandSpec) =>
  `.${c.name} ${[...c.args.map(argText), ...(c.repeat ? [`${c.repeat.map(argText).join(",")}...`] : [])].join(",")}`.trim();
const notes = (c: CommandSpec) => [...c.args, ...(c.repeat ?? [])].flatMap((a) => (a.note ? [`${a.name}: ${a.note}`] : [])).join("; ");

function commandRows(command?: string) {
  if (command !== undefined) {
    const spec = COMMANDS.get(command.replace(/^\./, ""));
    if (!spec) throw new ToolError(`RXP has no command .${command}. Call rxp_reference with topic commands to list them.`);
    return [{ usage: signature(spec), does: spec.description, ...(notes(spec) && { args: notes(spec) }) }];
  }
  const core = CORE_COMMANDS.flatMap((name) => COMMANDS.get(name) ?? []);
  return {
    core: core.map((c) => ({ usage: signature(c), does: c.description, ...(notes(c) && { args: notes(c) }) })),
    other: [...COMMANDS.values()].flatMap((c) =>
      CORE_COMMANDS.includes(c.name) || c.noHandler ? [] : [`${signature(c)}: ${c.description}`],
    ),
  };
}

const tagRows = () =>
  [...TAGS.values()].flatMap((t) =>
    t.misspellingOf ? [] : [`#${t.name} (${t.scope}${t.value === "flag" ? "" : `, ${t.value}`}): ${t.description}`],
  );

function example(ctx: AgentContext): string | null {
  const record = ctx.guides.find((g) => guideMeta(g).name === "1-6 Northshire") ?? ctx.guides[0];
  if (!record) return null;
  const doc = parseGuide(record.text);
  const header = doc.header.filter((line) => line.kind === "tag" || line.kind === "condition").map(lineText);
  const picked = doc.steps
    .filter(
      (step) => !step.line.condition && step.body.some((line) => line.kind === "command" && commandRule(line.name)?.effect !== undefined),
    )
    .slice(0, 4)
    .map((step) => stepText(step).trimEnd());
  return `${header.join("\n")}\n\n${picked.join("\n")}`;
}

const TOPICS = ["all", "structure", "commands", "tags", "conditions", "example"] as const;

export const rxpReference: Tool<{ topic: (typeof TOPICS)[number]; command?: string }> = {
  name: "rxp_reference",
  description:
    "RestedXP guide syntax: guide structure, how steps complete, coordinates, the commands (core ones with arguments), tags, `<<` conditions, and an excerpt of RXP's own Northshire guide. Read it before writing a guide. `command` returns one command's arguments.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", enum: TOPICS, default: "all" },
      command: { type: "string", maxLength: 40, description: "One command name, such as complete." },
    },
    additionalProperties: false,
  },
  run(input, ctx) {
    if (input.command !== undefined) return { command: commandRows(input.command) };
    const want = (topic: (typeof TOPICS)[number]) => input.topic === "all" || input.topic === topic;
    return {
      ...(want("structure") && { structure: STRUCTURE }),
      ...(want("commands") && { commands: commandRows() }),
      ...(want("tags") && { tags: tagRows() }),
      ...(want("conditions") && { conditions: CONDITIONS }),
      ...(want("example") && { example: example(ctx) }),
    };
  },
};
