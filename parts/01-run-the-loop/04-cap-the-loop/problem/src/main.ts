// desk, fourth version: the loop has caps. It stops after --max-turns model calls or once it has
// spent --max-budget-usd, and says which cap stopped it.
// Run from the newsroom folder:
//   bun src/main.ts -p "check every draft" --max-turns 5 --max-budget-usd 0.50
// Exit codes: 0 the model finished, 3 a cap stopped it.
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

// TODO: read --max-turns (default 30) and --max-budget-usd (default 2) from process.argv.

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

// TODO: count turns and add up the cost of every call with costUsd("smart", reply.usage)
//       from "#models".
// TODO: before each call, stop when turns >= max turns or cost >= the budget. Print
//       error_max_turns or error_max_budget with the turns and the cost (as $0.0000), and exit
//       with code 3.
// TODO: when the model finishes, print a last line with the turns and the cost.
while (true) {
  const reply = await generateText({ model: model("smart"), messages, tools });
  messages.push(...reply.responseMessages);
  if (reply.toolCalls.length === 0) {
    console.log(reply.text);
    break;
  }
  // Every result from this turn goes back in one tool message, each paired with its call's id.
  const toolResults = reply.toolCalls.map((call) => {
    let output: { type: "text"; value: string } | { type: "error-text"; value: string };
    try {
      const runTool = toolRunners[call.toolName];
      if (!runTool) throw new Error(`There is no tool "${call.toolName}".`);
      output = { type: "text", value: runTool(call.input as { path: string }) };
    } catch (error) {
      output = { type: "error-text", value: (error as Error).message };
    }
    return {
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    };
  });
  messages.push({ role: "tool", content: toolResults });
}
