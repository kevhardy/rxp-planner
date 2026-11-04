// Serves the agent tools in src/agent/ over MCP stdio, one JSON-RPC message on
// each line. Install the release file first. Without the routing artifact of a
// map, `travel_time` gives a straight-line estimate.
//
//   pnpm --silent agent:mcp
//
// An MCP client usually starts the server itself, from its own directory, so
// give it an absolute path:
//
//   { "mcpServers": { "planner": { "type": "stdio", "command": "node", "args": ["/path/to/rxp-planner/scripts/agent/mcp.ts"] } } }
//
//   RXP_DATASET     a dataset folder, relative to the planner. Routing always
//                   comes from the release file.
//   RXP_AGENT_OUT   where `guide_save` writes, relative to the directory where
//                   the client starts the server

import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { callTool, TOOLS } from "../../src/agent/index.ts";
import { loadAgentContext, REPO } from "./context.ts";

// Stdout carries the protocol, so stray logs go to stderr.
console.log = console.error;

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  'RXP Planner tools for WoW Classic Forever leveling guides. Read rxp_reference before writing a guide. Points are `.goto` arguments, such as "Elwynn Forest,48.2,42.8"; tools return points in that form. Build steps with quest_steps rather than by hand. Fix guide_check problems, time the guide with guide_timeline, find work on the way with guide_opportunities, and prove each change with guide_compare before guide_save. The dataset takes about 20 seconds to load after the server starts; the first call waits for it.';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProtocolError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type Reply = { id: string | number | null } & (
  | { result: object; error?: never }
  | { error: { code: number; message: string }; result?: never }
);

const send = (message: Reply) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const context = loadAgentContext({
  out: process.env.RXP_AGENT_OUT ? resolve(process.env.RXP_AGENT_OUT) : join(REPO, ".cache/agent-guides"),
});
context.catch((error: unknown) => console.error(`Could not load the dataset: ${errorText(error)}`));

async function answer(method: string, input: unknown): Promise<object> {
  const params = input === undefined ? {} : input;
  if (!isObject(params)) throw new ProtocolError(-32602, "Invalid params");
  switch (method) {
    case "initialize": {
      if (
        typeof params.protocolVersion !== "string" ||
        !isObject(params.capabilities) ||
        !isObject(params.clientInfo) ||
        typeof params.clientInfo.name !== "string" ||
        typeof params.clientInfo.version !== "string"
      )
        throw new ProtocolError(-32602, "Invalid params");
      const asked = params.protocolVersion;
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "rxp-planner", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      if (params.cursor !== undefined && typeof params.cursor !== "string") throw new ProtocolError(-32602, "Invalid params");
      return { tools: [...TOOLS.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case "tools/call": {
      if (typeof params.name !== "string") throw new ProtocolError(-32602, "Invalid params");
      const name = params.name;
      let text: string, isError: boolean;
      try {
        const result = await callTool(TOOLS, name, params.arguments, await context);
        [text, isError] = result.ok ? [JSON.stringify(result.value), false] : [result.error, true];
      } catch (error) {
        console.error(error);
        [text, isError] = [`The tool failed: ${errorText(error)}`, true];
      }
      return { content: [{ type: "text", text }], isError };
    }
    default:
      throw new ProtocolError(-32601, `Method not found: ${method}`);
  }
}

async function handle(line: string) {
  if (!line.trim()) return;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: "Parse error" } });
  }
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return send({ id: null, error: { code: -32600, message: "Invalid request" } });
  }
  // Notifications, such as notifications/initialized, get no answer.
  if (!("id" in message)) return;
  const id = message.id;
  if (typeof id !== "string" && !(typeof id === "number" && Number.isInteger(id))) {
    return send({ id: null, error: { code: -32600, message: "Invalid request" } });
  }
  try {
    send({ id, result: await answer(message.method, message.params) });
  } catch (error) {
    const code = error instanceof ProtocolError ? error.code : -32603;
    send({ id, error: { code, message: errorText(error) } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  handle(line).catch((error: unknown) => console.error(error));
});
