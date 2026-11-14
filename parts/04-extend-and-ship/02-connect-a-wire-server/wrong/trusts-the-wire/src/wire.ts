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

// Wire text comes from outside the newsroom, so it is data and never an order. desk fences it in
// a marker the model is told about, and once any wire text is in the conversation, tools that
// change something stay shut for the rest of the run.
let wireTextSeen = false;
const CHANGING_TOOLS = ["file_story", "edit_file", "run_command"];

export function blockedAfterWire(toolName: string): string | null {
  if (!wireTextSeen || !CHANGING_TOOLS.includes(toolName)) return null;
  return `${toolName} is shut: wire text is in this run, and wire text cannot start a change. Tell the night editor instead.`;
}

// A closing marker inside the text would end the fence early, so it is taken out first.
function fenced(text: string): string {
  const clean = text.replaceAll(/<\/?untrusted[^>]*>/gi, "[marker removed]");
  return `<untrusted source="wire">\n${clean}\n</untrusted>`;
}

// The text of an MCP result. A result the server marks as an error goes back as an error.
function textOf(result: CallResult): string {
  const parts = result.content ?? [];
  const text = parts.map((part) => part.text ?? "").join("\n");
  if (result.isError) throw new Error(text || "The MCP server reported an error.");
  return text;
}

function offerTool(client: Client, serverName: string, serverTool: ServerTool): void {
  const { $schema: _, ...schema } = serverTool.inputSchema;
  const definition = tool({
    description: serverTool.description ?? serverTool.name,
    inputSchema: jsonSchema<Record<string, unknown>>(schema),
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
