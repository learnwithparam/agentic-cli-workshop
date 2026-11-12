// desk, third version: the agent loop. Call the model, run every tool it asks for, send the results back,
// and call again, until the model answers with no tool call.
// Run from the newsroom folder: bun src/main.ts -p "list the drafts and read the first one"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { generateText, jsonSchema, tool, type ModelMessage } from "ai";
import { model } from "#models";

const i = process.argv.indexOf("-p");
const prompt = i >= 0 ? process.argv[i + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

const root = process.cwd();
const pathSchema = (example: string) =>
  jsonSchema<{ path: string }>({
    type: "object",
    properties: { path: { type: "string", description: `A path inside the newsroom folder, such as ${example}` } },
    required: ["path"],
    additionalProperties: false,
  });

const tools = {
  read_file: tool({ description: "Read a text file from the newsroom.", inputSchema: pathSchema("drafts/bridge-repairs.md") }),
  list_files: tool({ description: "List the files in a newsroom folder.", inputSchema: pathSchema("drafts") }),
};

function inside(path: string): string {
  const full = resolve(root, path);
  if (relative(root, full).startsWith("..")) throw new Error(`"${path}" is outside the newsroom folder.`);
  return full;
}

// Runners throw on any problem. The loop turns a throw into an error result.
const runners: Record<string, (input: { path: string }) => string> = {
  read_file: ({ path }) => {
    const full = inside(path);
    if (!existsSync(full) || statSync(full).isDirectory()) throw new Error(`There is no file "${path}". Use list_files to see what is there.`);
    return readFileSync(full, "utf8");
  },
  list_files: ({ path }) => readdirSync(inside(path)).sort().join("\n"),
};

const messages: ModelMessage[] = [{ role: "user", content: prompt }];

while (true) {
  const reply = await generateText({ model: model("smart"), messages, tools });
  messages.push(...reply.responseMessages);
  if (reply.toolCalls.length === 0) {
    console.log(reply.text);
    break;
  }
  // Every result from this turn goes back in one tool message, each paired with its call's id.
  const results = reply.toolCalls.map((call) => {
    let output: { type: "text"; value: string } | { type: "error-text"; value: string };
    try {
      const run = runners[call.toolName];
      if (!run) throw new Error(`There is no tool "${call.toolName}".`);
      output = { type: "text", value: run(call.input as { path: string }) };
    } catch (e) {
      output = { type: "error-text", value: (e as Error).message };
    }
    return { type: "tool-result" as const, toolCallId: call.toolCallId, toolName: call.toolName, output };
  });
  messages.push({ role: "tool", content: results });
}
