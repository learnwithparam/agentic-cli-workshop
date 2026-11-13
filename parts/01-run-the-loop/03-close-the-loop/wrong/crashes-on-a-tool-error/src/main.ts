// desk, third version: the agent loop. Call the model, run every tool it asks for, send the
// results back, and call again, until the model answers with no tool call.
// Run from the newsroom folder:
//   bun src/main.ts -p "list the drafts and read the first one"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { generateText, jsonSchema, type ModelMessage, tool } from "ai";
import { model } from "#models";

const promptFlagPosition = process.argv.indexOf("-p");
const prompt = promptFlagPosition >= 0 ? process.argv[promptFlagPosition + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

// The newsroom is the folder desk runs in. No tool reads outside it.
const root = process.cwd();

// Both tools take one input, a path. The example helps the model pick a sensible one.
function pathSchema(example: string) {
  return jsonSchema<{ path: string }>({
    type: "object",
    properties: {
      path: {
        type: "string",
        description: `A path inside the newsroom folder, such as ${example}`,
      },
    },
    required: ["path"],
    additionalProperties: false,
  });
}

// biome-ignore-start lint/style/useNamingConvention: the model calls each tool by this exact name
const tools = {
  read_file: tool({
    description: "Read a text file from the newsroom.",
    inputSchema: pathSchema("drafts/bridge-repairs.md"),
  }),
  list_files: tool({
    description: "List the files in a newsroom folder.",
    inputSchema: pathSchema("drafts"),
  }),
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

function pathInsideNewsroom(path: string): string {
  const fullPath = resolve(root, path);
  if (relative(root, fullPath).startsWith(".."))
    throw new Error(`"${path}" is outside the newsroom folder.`);
  return fullPath;
}

// The tools throw on any problem: a missing file, a missing folder, a path outside the newsroom.
// The loop turns a throw into an error result.
function readFile(path: string): string {
  const fullPath = pathInsideNewsroom(path);
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory())
    throw new Error(`There is no file "${path}". Use list_files to see what is there.`);
  return readFileSync(fullPath, "utf8");
}

function listFiles(path: string): string {
  const fileNames = readdirSync(pathInsideNewsroom(path));
  return fileNames.sort().join("\n");
}

// biome-ignore-start lint/style/useNamingConvention: the model calls each tool by this exact name
const toolRunners: Record<string, (input: { path: string }) => string> = {
  read_file: ({ path }) => readFile(path),
  list_files: ({ path }) => listFiles(path),
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

const messages: ModelMessage[] = [{ role: "user", content: prompt }];

while (true) {
  const reply = await generateText({ model: model("smart"), messages, tools });
  messages.push(...reply.responseMessages);
  if (reply.toolCalls.length === 0) {
    console.log(reply.text);
    break;
  }
  // Every result from this turn goes back in one tool message, each paired with its call's id.
  const toolResults = reply.toolCalls.map((call) => {
    // Mistake: no try and catch, so one bad path ends the whole run.
    const runTool = toolRunners[call.toolName];
    const output = { type: "text" as const, value: runTool(call.input as { path: string }) };
    return {
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    };
  });
  messages.push({ role: "tool", content: toolResults });
}
