// desk, second version: the model can ask to read a file. desk reads it and sends the text back.
// Run from the newsroom folder: bun src/main.ts -p "what does the bridge-repairs draft say?"
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { generateText, jsonSchema, type ModelMessage, tool } from "ai";
import { model } from "#models";

const i = process.argv.indexOf("-p");
const prompt = i >= 0 ? process.argv[i + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

// The newsroom is the folder desk runs in. No tool reads outside it.
const root = process.cwd();

// What the model sees: a name, what the tool does, and a JSON schema for its input.
const tools = {
  read_file: tool({
    description:
      "Read a text file from the newsroom, such as drafts/bridge-repairs.md or sources/council-budget.csv.",
    inputSchema: jsonSchema<{ path: string }>({
      type: "object",
      properties: { path: { type: "string", description: "A path inside the newsroom folder" } },
      required: ["path"],
      additionalProperties: false,
    }),
  }),
};

// What desk does when the model asks. A problem becomes an error the model can read, never a crash.
function readFile(path: string): { ok: boolean; text: string } {
  const full = resolve(root, path);
  // Mistake: no check that the path stays inside the newsroom.
  void relative;
  if (!existsSync(full) || statSync(full).isDirectory())
    return { ok: false, text: `There is no file "${path}".` };
  return { ok: true, text: readFileSync(full, "utf8") };
}

const messages: ModelMessage[] = [{ role: "user", content: prompt }];
const first = await generateText({ model: model("smart"), messages, tools });
messages.push(...first.responseMessages);

if (first.toolCalls.length > 0) {
  // One tool message holds every result, each paired with the id of the call it answers.
  messages.push({
    role: "tool",
    content: first.toolCalls.map((call) => {
      const r = readFile((call.input as { path: string }).path);
      return {
        type: "tool-result" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: r.ok
          ? { type: "text" as const, value: r.text }
          : { type: "error-text" as const, value: r.text },
      };
    }),
  });
  const second = await generateText({ model: model("smart"), messages, tools });
  console.log(second.text);
} else {
  console.log(first.text);
}
