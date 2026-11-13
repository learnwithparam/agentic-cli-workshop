// desk, second version: the model can ask to read a file. desk reads it and sends the text back.
// Run from the newsroom folder:
//   bun src/main.ts -p "what does the bridge-repairs draft say?"
import { existsSync, readFileSync, statSync } from "node:fs";
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

// What the model sees: a name, what the tool does, and a JSON schema for its input.
// biome-ignore-start lint/style/useNamingConvention: the model calls the tool by this exact name
const tools = {
  read_file: tool({
    description:
      "Read a text file from the newsroom, such as drafts/bridge-repairs.md or " +
      "sources/council-budget.csv.",
    inputSchema: jsonSchema<{ path: string }>({
      type: "object",
      properties: { path: { type: "string", description: "A path inside the newsroom folder" } },
      required: ["path"],
      additionalProperties: false,
    }),
  }),
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

// What desk does when the model asks. A problem becomes an error the model can read, never a crash.
function readFile(path: string): { ok: boolean; text: string } {
  const fullPath = resolve(root, path);
  if (relative(root, fullPath).startsWith(".."))
    return { ok: false, text: `"${path}" is outside the newsroom folder.` };
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory())
    return { ok: false, text: `There is no file "${path}".` };
  return { ok: true, text: readFileSync(fullPath, "utf8") };
}

const messages: ModelMessage[] = [{ role: "user", content: prompt }];
const firstReply = await generateText({ model: model("smart"), messages, tools });
messages.push(...firstReply.responseMessages);

if (firstReply.toolCalls.length > 0) {
  // Mistake: the file text goes back as a plain user message, not as a result paired with the call.
  const fileTexts = firstReply.toolCalls.map((call) => {
    const { path } = call.input as { path: string };
    return readFile(path).text;
  });
  // Drop the model's tool call, so only the prompt is left before the plain text.
  messages.splice(1);
  messages.push(
    { role: "assistant", content: "I will read the file." },
    { role: "user", content: `Here is the file:\n${fileTexts.join("\n")}` },
  );
  const secondReply = await generateText({ model: model("smart"), messages, tools });
  console.log(secondReply.text);
} else {
  console.log(firstReply.text);
}
