// MCP servers: tools that live in another program. desk.config.json names each server and how to
// start it. desk starts it over stdio, asks it for its tools, and offers each one to the model as
// <server>__<tool>, such as wire__search_wire. For example:
//   "mcp_servers": { "wire": { "command": "bun", "args": ["wire/server.ts"] } }

// This file is filled in a later step, connect-a-wire-server. Until then desk has no MCP servers.
export async function connectWireServers(): Promise<void> {}
