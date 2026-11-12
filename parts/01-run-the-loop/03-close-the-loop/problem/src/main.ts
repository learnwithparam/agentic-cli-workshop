// desk, third version: the agent loop. Call the model, run every tool it asks for, send the results back,
// and call again, until the model answers with no tool call.
// Run from the newsroom folder: bun src/main.ts -p "list the drafts and read the first one"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { generateText, jsonSchema, type ModelMessage, tool } from "ai";
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
    properties: {
      path: {
        type: "string",
        description: `A path inside the newsroom folder, such as ${example}`,
      },
    },
    required: ["path"],
    additionalProperties: false,
  });

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

function inside(path: string): string {
  const full = resolve(root, path);
  if (relative(root, full).startsWith(".."))
    throw new Error(`"${path}" is outside the newsroom folder.`);
  return full;
}

// Runners throw on any problem: a missing file, a missing folder, a path outside the newsroom.
const runners: Record<string, (input: { path: string }) => string> = {
  read_file: ({ path }) => {
    const full = inside(path);
    if (!existsSync(full) || statSync(full).isDirectory())
      throw new Error(`There is no file "${path}". Use list_files to see what is there.`);
    return readFileSync(full, "utf8");
  },
  list_files: ({ path }) => readdirSync(inside(path)).sort().join("\n"),
};

const messages: ModelMessage[] = [{ role: "user", content: prompt }];

// TODO: this makes one call and stops. Turn it into a loop:
//   1. call the model and add reply.responseMessages to messages
//   2. if there are no tool calls, print reply.text and stop
//   3. run every tool call; catch a throw and send it back as { type: "error-text", value: message }
//   4. add ONE message with role "tool" holding every result, each with its call's toolCallId
//   5. go back to 1
const reply = await generateText({ model: model("smart"), messages, tools });
console.log(reply.text || "TODO: the model asked for a tool and nobody ran it.");
void runners;
