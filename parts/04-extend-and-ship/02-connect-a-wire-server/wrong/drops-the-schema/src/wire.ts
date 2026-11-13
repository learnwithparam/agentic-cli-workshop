// MCP servers: tools that live in another program. desk.config.json names each server and how to
// start it. desk starts it over stdio, asks it for its tools, and offers each one to the model as
// <server>__<tool>, such as wire__search_wire. For example:
//   "mcp_servers": { "wire": { "command": "bun", "args": ["wire/server.ts"] } }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { jsonSchema, tool } from "ai";
import { addTool } from "./tools";

type ServerSettings = { command: string; args?: string[] };
type ServerTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type CallResult = { content?: { type: string; text?: string }[]; isError?: boolean };

function loadServers(): Record<string, ServerSettings> {
  const configPath = join(process.cwd(), "desk.config.json");
  if (!existsSync(configPath)) return {};
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return config.mcp_servers ?? {};
}

// The text of an MCP result. A result the server marks as an error goes back as an error.
function textOf(result: CallResult): string {
  const parts = result.content ?? [];
  const text = parts.map((part) => part.text ?? "").join("\n");
  if (result.isError) throw new Error(text || "The MCP server reported an error.");
  return text;
}

function offerTool(client: Client, serverName: string, serverTool: ServerTool): void {
  const definition = tool({
    description: serverTool.description ?? serverTool.name,
    // Any object will do.
    inputSchema: jsonSchema<Record<string, unknown>>({ type: "object" }),
  });
  // If the server has died, callTool throws. The loop turns that into an error result.
  const runner = async (input: Record<string, unknown>) => {
    const result = await client.callTool({ name: serverTool.name, arguments: input });
    return textOf(result as CallResult);
  };
  addTool(
    `${serverName}__${serverTool.name}`,
    definition,
    runner as (input: never) => Promise<string>,
  );
}

export async function connectWireServers(): Promise<void> {
  for (const [serverName, settings] of Object.entries(loadServers())) {
    const client = new Client({ name: "desk", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: settings.command, args: settings.args });
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const serverTool of tools) offerTool(client, serverName, serverTool as ServerTool);
  }
}
