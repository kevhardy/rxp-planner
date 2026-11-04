import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function exchange(lines: string[]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./mcp.ts", import.meta.url))], {
    input: `${lines.join("\n")}\n`,
    encoding: "utf8",
    env: { ...process.env, RXP_DATASET: fileURLToPath(new URL("./mcp.test.ts", import.meta.url)) },
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line));
}

const request = (value: unknown) => JSON.stringify(value);

describe("MCP stdio", () => {
  it("answers pings with numeric and string IDs and ignores notifications", () => {
    expect(
      exchange([
        request({ jsonrpc: "2.0", method: "notifications/initialized" }),
        request({ jsonrpc: "2.0", method: "unknown", params: 42 }),
        request({ jsonrpc: "2.0", id: 0, method: "ping" }),
        request({ jsonrpc: "2.0", id: "ping", method: "ping", params: {} }),
      ]),
    ).toEqual([
      { jsonrpc: "2.0", id: 0, result: {} },
      { jsonrpc: "2.0", id: "ping", result: {} },
    ]);
  });

  it.each([
    { jsonrpc: "broken", id: 1, method: "ping" },
    { id: 1, method: "ping" },
    { jsonrpc: "2.0", id: { bad: true }, method: "ping" },
    { jsonrpc: "2.0", id: null, method: "ping" },
    { jsonrpc: "2.0", id: 1.5, method: "ping" },
    { jsonrpc: "2.0", id: 1, method: 42 },
  ])("rejects an invalid envelope %j", (message) => {
    expect(exchange([request(message)])).toEqual([{ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }]);
  });

  it.each([
    { method: "ping", params: 42 },
    { method: "ping", params: null },
    { method: "tools/list", params: [] },
    { method: "tools/list", params: { cursor: 42 } },
    { method: "initialize", params: {} },
    { method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } } },
    { method: "tools/call", params: {} },
    { method: "tools/call", params: { name: 42 } },
  ])("rejects invalid method parameters %j", (message) => {
    expect(exchange([request({ jsonrpc: "2.0", id: "bad-params", ...message })])).toEqual([
      { jsonrpc: "2.0", id: "bad-params", error: { code: -32602, message: "Invalid params" } },
    ]);
  });

  it("keeps parse and unknown-method errors distinct", () => {
    expect(exchange(["{", request({ jsonrpc: "2.0", id: 1, method: "unknown" })])).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found: unknown" } },
    ]);
  });

  it("keeps tool arguments in the tool result path", () => {
    expect(exchange([request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "quest_search", arguments: 42 } })])).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: expect.any(String) }], isError: true },
      },
    ]);
  });

  it.each(["2025-03-26", "future"])("negotiates protocol %s", (protocolVersion) => {
    expect(
      exchange([
        request({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion, capabilities: {}, clientInfo: { name: "test", version: "1" } },
        }),
      ]),
    ).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: protocolVersion === "future" ? "2025-06-18" : "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "rxp-planner", version: "0.1.0" },
          instructions: expect.any(String),
        },
      },
    ]);
  });
});
