import { MAX_GUIDE } from "../agent/data.ts";
import { callTool, ToolError, TOOLS, type AgentContext, type ObjectSchema, type Tool } from "../agent/index.ts";
import type { EntityIndex, GameData, LoadedDataset } from "../data/index.ts";
import { parseGuide } from "../guide/index.ts";
import { resolveStartLevel } from "../rules/index.ts";
import { guideMeta } from "../rules/registration.ts";
import type { Stores } from "./context.ts";

interface ModelContext {
  registerTool(
    tool: { name: string; description: string; inputSchema: ObjectSchema; execute: (input: unknown) => Promise<unknown> },
    options?: { signal?: AbortSignal },
  ): unknown;
}

// The MCP-B polyfill puts the API on `navigator`.
function modelContext(): ModelContext | undefined {
  return (document as { modelContext?: ModelContext }).modelContext ?? (navigator as { modelContext?: ModelContext }).modelContext;
}

const noInput: ObjectSchema = { type: "object", properties: {}, additionalProperties: false };

function editorTools({ editor, preview }: Stores): Tool[] {
  const current = () => {
    const open = editor.getState().current;
    if (!open) throw new ToolError("No guide is open. Ask the person to open one in the library.");
    return open;
  };
  const editorState: Tool = {
    name: "editor_state",
    description:
      "Read the guide open in the planner: its name, group, whether it is a built-in, its text, the selected step and line (from 1; null for the header or the whole step), and the Preview-as character, at the start level and XP it has when the route starts at this guide.",
    inputSchema: noInput,
    run() {
      const open = current();
      const { selection } = editor.getState();
      const { race, class: cls, startLevel, soloSelfFound, xpRate } = preview.getState();
      const { level, xp } = resolveStartLevel(startLevel, guideMeta(open.record).range);
      return {
        name: open.name,
        group: open.group,
        builtin: open.builtin,
        steps: open.doc.steps.length,
        selection: { step: selection.step === null ? null : selection.step + 1, line: selection.line === null ? null : selection.line + 1 },
        previewAs: { race, class: cls, level, xp, soloSelfFound, xpRate },
        text: open.record.text,
      };
    },
  };
  const replaceGuide: Tool<{ text: string }> = {
    name: "editor_replace_guide",
    description:
      "Replace the open guide's text in the planner as one edit the person can undo. A built-in guide becomes the person's custom copy, which opens. Check the text with guide_check first.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", maxLength: MAX_GUIDE, description: "The whole new guide text." } },
      required: ["text"],
      additionalProperties: false,
    },
    run({ text }) {
      const before = current();
      const result = editor.edit((doc) => (text === before.record.text ? doc : parseGuide(text)));
      if (!result.ok) throw new ToolError(result.reason === "opened" ? result.notice : result.error);
      const after = current();
      return { name: after.name, group: after.group, steps: after.doc.steps.length, copiedBuiltin: before.builtin && !after.builtin };
    },
  };
  const selectStep: Tool<{ step: number; line?: number }> = {
    name: "editor_select_step",
    description: "Select a step of the open guide, and optionally one of its lines, so the planner shows it in the editor and on the map.",
    inputSchema: {
      type: "object",
      properties: {
        step: { type: "integer", minimum: 1, maximum: 10_000, description: "Step number, from 1." },
        line: { type: "integer", minimum: 1, maximum: 10_000, description: "Line in the step, from 1; omit to select the whole step." },
      },
      required: ["step"],
      additionalProperties: false,
    },
    run({ step, line }) {
      const { doc } = current();
      if (step > doc.steps.length) throw new ToolError(`The guide has ${doc.steps.length} steps.`);
      const lines = doc.steps[step - 1]!.body.length;
      if (line !== undefined && line > lines) throw new ToolError(`Step ${step} has ${lines} lines.`);
      editor.select({ step: step - 1, line: line === undefined ? null : line - 1 });
      return { step, line: line ?? null };
    },
  };
  return [editorState, replaceGuide, selectStep];
}

function registerAgentTools(context: ModelContext, stores: Stores, game: GameData, entities: EntityIndex, signal: AbortSignal): void {
  const ctx: AgentContext = { game, entities, guides: [...stores.editor.getState().builtins.values()] };
  // The page cannot write files, so it leaves out `guide_save`.
  const pageTools = [...TOOLS].filter(([name]) => name !== "guide_save");
  const tools = new Map<string, Tool>([...pageTools, ...editorTools(stores).map((tool) => [tool.name, tool] as const)]);
  for (const { name, description, inputSchema } of tools.values()) {
    const execute = async (input: unknown) => {
      try {
        const result = await callTool(tools, name, input, ctx);
        return result.ok ? result.value : { error: result.error };
      } catch (error) {
        console.error(error);
        return { error: `The tool failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    };
    // The current API removes a tool when `signal` aborts. Older ones ignore
    // the signal and return a handle to unregister with.
    const register = async () => {
      const handle = (await context.registerTool({ name, description, inputSchema, execute }, { signal })) as
        | { unregister?: () => void }
        | undefined;
      if (signal.aborted) handle?.unregister?.();
      else signal.addEventListener("abort", () => handle?.unregister?.());
    };
    register().catch((error: unknown) => console.error(`Could not register the agent tool ${name}`, error));
  }
}

export function startAgentTools(stores: Stores): () => void {
  let shown: LoadedDataset | null = null;
  let registered: AbortController | undefined;
  const sync = () => {
    const { data } = stores.dataset.getState();
    if (data === shown) return;
    shown = data;
    registered?.abort();
    registered = undefined;
    const context = modelContext();
    if (!context || !data) return;
    registered = new AbortController();
    registerAgentTools(context, stores, data.game, data.entities, registered.signal);
  };
  const unsubscribe = stores.dataset.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    registered?.abort();
  };
}
