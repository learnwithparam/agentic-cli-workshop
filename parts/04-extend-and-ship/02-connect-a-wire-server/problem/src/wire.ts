// MCP servers: tools that live in another program. desk.config.json names each server and how to
// start it. desk starts it over stdio, asks it for its tools, and offers each one to the model as
// <server>__<tool>, such as wire__search_wire. For example:
//   "mcp_servers": { "wire": { "command": "bun", "args": ["wire/server.ts"] } }

// TODO: read "mcp_servers" from desk.config.json. For each server:
//         - make a Client from "@modelcontextprotocol/client" and connect it with a
//           StdioClientTransport({ command, args }) from "@modelcontextprotocol/client/stdio"
//         - ask it for its tools with client.listTools()
//         - offer each one with addTool() from "./tools", named <server>__<tool>. Its schema is
//           the tool's inputSchema (wrap it with jsonSchema from "ai"). Its runner calls
//           client.callTool({ name, arguments }) and returns the text of the result.
//       A result marked isError goes back as an error: throw an Error with its text.
export async function connectWireServers(): Promise<void> {}
