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

// TODO: describe a read_file tool the model can call: a description and a JSON schema
//       with one required string property, path. Use tool() and jsonSchema() from "ai".
const tools = {};

// TODO: read the file at `path` inside root. Return ok: false with a message the model can read
//       when the path leaves the newsroom folder or the file does not exist.
function readFile(path: string): { ok: boolean; text: string } {
  void path;
  void root;
  void existsSync;
  void readFileSync;
  void statSync;
  void relative;
  void resolve;
  void tool;
  void jsonSchema;
  return { ok: false, text: "TODO" };
}

const messages: ModelMessage[] = [{ role: "user", content: prompt }];
const firstReply = await generateText({ model: model("smart"), messages, tools });
messages.push(...firstReply.responseMessages);

// TODO: if the model asked for tools (firstReply.toolCalls), run each one with readFile and add
//       ONE message with role "tool" holding a "tool-result" part per call: its toolCallId,
//       toolName and output. Use output { type: "text", value } for a good read and
//       { type: "error-text", value } for a problem.
//       Then call the model again with the longer messages list and print its text.
console.log(firstReply.text);
void readFile;
