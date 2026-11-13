// connect-a-wire-server: desk starts the wire service's MCP server over stdio, offers its tools
// as wire__search_wire and wire__get_wire_story, sends calls through the same gate, and turns
// a dead server into an error result.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { answeredRuns, playTurns, resultOf } from "./helpers/answered-runs";
import { every, type Run, type World } from "./lib/harness";

const WIRE_SERVER = join(
  import.meta.dir,
  "..",
  "parts",
  "04-extend-and-ship",
  "02-connect-a-wire-server",
  "wire",
  "server.ts",
);
const WIRE_TOOLS = ["wire__search_wire", "wire__get_wire_story"];

function writeConfig(world: World, deny: string[]) {
  const config = {
    permissions: { allow: WIRE_TOOLS, deny },
    // biome-ignore lint/style/useNamingConvention: desk.config.json uses this name
    mcp_servers: { wire: { command: "bun", args: [WIRE_SERVER] } },
  };
  writeFileSync(join(world.newsroom, "desk.config.json"), JSON.stringify(config));
}

const search = (world: World) => ({
  name: "wire__search_wire",
  input: { query: `River Brook ${world.nonce}` },
});
const getStory = { name: "wire__get_wire_story", input: { id: "PA-1107" } };

const wireRuns = (folder: string, name: string, deny: string[] = []) =>
  answeredRuns(folder, name, {
    args: ["-p", "Check the wire for river news."],
    setup: (world) => writeConfig(world, deny),
    scenario: (world) => playTurns([[search(world)], [getStory]]),
  });

// The model searches, then the check stops the wire server, then the model searches again.
function serverDiesScenario(world: World) {
  return (_request: Request, allRequests: Request[]) => {
    const turn = allRequests.length;
    if (turn === 2) {
      const pidPath = join(world.newsroom, ".wire", "pid");
      if (existsSync(pidPath)) process.kill(Number(readFileSync(pidPath, "utf8")));
    }
    if (turn <= 2) return { tools: [search(world)] };
    return { text: "The wire is down. I will carry on without it." };
  };
}

const serverDies = (folder: string) =>
  answeredRuns(folder, "connect-a-wire-server-dies", {
    args: ["-p", "Check the wire for river news."],
    setup: (world) => writeConfig(world, []),
    scenario: serverDiesScenario,
  });

function wireCalls(desk: Run): { tool: string; input: unknown }[] {
  const logPath = join(desk.world.newsroom, ".wire", "calls.jsonl");
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

const sameInput = (wanted: unknown) => (input: unknown) =>
  JSON.stringify(input) === JSON.stringify(wanted);

export default [
  {
    says: "The first request offers wire__search_wire and wire__get_wire_story, with their schemas",
    test: (folder) =>
      every(wireRuns(folder, "connect-a-wire-server"), (desk) => {
        const offered = desk.requests[0]?.tools ?? [];
        const searchTool = offered.find((tool) => tool.name === "wire__search_wire");
        const hasBoth = WIRE_TOOLS.every((name) => offered.some((tool) => tool.name === name));
        return hasBoth && searchTool?.schema?.properties?.query !== undefined;
      }),
    tryNext:
      "Connect a Client with a StdioClientTransport, call listTools(), and addTool() each one " +
      "as wire__<name> with jsonSchema(tool.inputSchema).",
  },
  {
    says: "A wire call reaches the server, and its answer comes back to the model",
    test: (folder) =>
      every(wireRuns(folder, "connect-a-wire-server"), (desk) => {
        const searchCall = search(desk.world);
        const searched = resultOf(desk, searchCall.name, sameInput(searchCall.input));
        const story = resultOf(desk, getStory.name, sameInput(getStory.input));
        const logged = wireCalls(desk).some((call) =>
          JSON.stringify(call.input).includes(desk.world.nonce),
        );
        return (
          Boolean(
            searched?.content.includes(desk.world.nonce) && story?.content.includes("48mm"),
          ) && logged
        );
      }),
    tryNext:
      "The runner calls client.callTool({ name, arguments: input }) and returns the text parts " +
      "of the result, joined.",
  },
  {
    says: "Wire tools pass the same permission gate: a deny rule keeps the call from the server",
    test: (folder) =>
      every(wireRuns(folder, "connect-a-wire-server-denied", ["wire__get_wire_story"]), (desk) => {
        const denied = resultOf(desk, getStory.name, sameInput(getStory.input))?.is_error === true;
        const reachedServer = wireCalls(desk).some((call) => call.tool === "get_wire_story");
        return denied && !reachedServer;
      }),
    tryNext:
      "Add the wire tools with addTool(), so they are in tools. Then the loop sends them through " +
      "decide() like every other tool.",
  },
  {
    says: "When the wire server dies, desk sends back an error result and carries on",
    test: (folder) =>
      every(serverDies(folder), (desk) => {
        const last = desk.requests[desk.requests.length - 1];
        const results = last?.messages.flatMap((message) => message.blocks) ?? [];
        const errors = results.filter((block) => block.type === "tool_result" && block.is_error);
        return desk.code === 0 && desk.requests.length === 3 && errors.length === 1;
      }),
    tryNext:
      "Let callTool throw when the server is gone. Your loop already turns a thrown Error " +
      "into an error result.",
  },
] satisfies Rule[];
