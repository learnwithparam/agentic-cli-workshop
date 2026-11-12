// desk, sixth version: the same loop must run on any provider.
// TODO: remove the provider import and the model name below. Ask config/models.ts for the role
//       instead: import { costUsd, model } from "#models". Then LLM_PROVIDER picks the provider,
//       with no code change.
// Run from the newsroom folder:
//   bun src/main.ts -p "check every draft" --max-turns 5 --max-budget-usd 0.50
// Exit codes: 0 the model finished, 3 a cap stopped it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { jsonSchema, type ModelMessage, streamText, tool } from "ai";
import { costUsd } from "#models";

// A teammate wired desk straight to the Anthropic provider to try a feature, and it stayed.
// It works on the practice model. It ignores LLM_PROVIDER, so nobody can run desk on another
// provider.
// biome-ignore-start lint/style/useNamingConvention: baseURL is the option name the AI SDK uses
const anthropic = createAnthropic({
  baseURL: `${process.env.REPLAY_URL ?? "http://localhost:4010"}/v1`,
  apiKey: process.env.ANTHROPIC_API_KEY ?? "practice",
});
// biome-ignore-end lint/style/useNamingConvention: back to our own names
const smartModel = anthropic("practice-smart");
// It takes a role only to look like model() from "#models". Every role gets the same model.
const model = (_role: "smart") => smartModel;

const promptFlagPosition = process.argv.indexOf("-p");
const prompt = promptFlagPosition >= 0 ? process.argv[promptFlagPosition + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

// Read a number flag such as --max-turns 5, or use the fallback when the flag is missing.
function numberFlag(name: string, fallback: number): number {
  const flagPosition = process.argv.indexOf(name);
  return flagPosition >= 0 ? Number(process.argv[flagPosition + 1]) : fallback;
}
const maxTurns = numberFlag("--max-turns", 30);
const maxBudgetUsd = numberFlag("--max-budget-usd", 2);

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

let turns = 0;
let cost = 0;

function costInDollars(): string {
  return `$${cost.toFixed(4)}`;
}

function stopAtCap(reason: "error_max_turns" | "error_max_budget"): never {
  console.log(`Stopped: ${reason} after ${turns} turns, ${costInDollars()}.`);
  process.exit(3);
}

while (true) {
  // Check the caps before every call. One call can go past the budget; the next one never starts.
  if (turns >= maxTurns) stopAtCap("error_max_turns");
  if (cost >= maxBudgetUsd) stopAtCap("error_max_budget");
  const reply = streamText({ model: model("smart"), messages, tools });
  // Print each piece of text the moment it arrives.
  let printedText = false;
  for await (const piece of reply.textStream) {
    process.stdout.write(piece);
    printedText = true;
  }
  if (printedText) process.stdout.write("\n");
  turns++;
  // The price per token for this role comes from config/models.ts. It is null when unknown.
  cost += costUsd("smart", await reply.usage) ?? 0;
  messages.push(...(await reply.responseMessages));
  const toolCalls = await reply.toolCalls;
  if (toolCalls.length === 0) {
    console.log(`Done. ${turns} turns, ${costInDollars()}.`);
    break;
  }
  // Every result from this turn goes back in one tool message, each paired with its call's id.
  const toolResults = toolCalls.map((call) => {
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
