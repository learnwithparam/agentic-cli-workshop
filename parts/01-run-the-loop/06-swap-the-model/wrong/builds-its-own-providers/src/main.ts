// desk, sixth version: the same loop runs on any provider. desk asks config/models.ts for a role and
// never names a provider or a model, so LLM_PROVIDER=openrouter (or anthropic, openai, ollama) needs no code change.
// Run from the newsroom folder: bun src/main.ts -p "check every draft" --max-turns 5 --max-budget-usd 0.50
// Exit codes: 0 the model finished, 3 a cap stopped it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { jsonSchema, type ModelMessage, streamText, tool } from "ai";
import { costUsd } from "#models";

// Mistake: desk picks the provider and names the models itself. It runs, but config/models.ts is
// no longer the one place to change a model, and the next provider means another branch here.
const model = (_role: "smart") =>
  process.env.LLM_PROVIDER === "openrouter"
    ? createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL,
      })("practice-smart")
    : createAnthropic({
        baseURL: `${process.env.REPLAY_URL ?? "http://localhost:4010"}/v1`,
        apiKey: "practice",
      })("practice-smart");

const i = process.argv.indexOf("-p");
const prompt = i >= 0 ? process.argv[i + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

const flag = (name: string, fallback: number) => {
  const j = process.argv.indexOf(name);
  return j >= 0 ? Number(process.argv[j + 1]) : fallback;
};
const maxTurns = flag("--max-turns", 30);
const maxBudgetUsd = flag("--max-budget-usd", 2);

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

// Runners throw on any problem. The loop turns a throw into an error result.
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

let turns = 0;
let cost = 0;
const money = () => `$${cost.toFixed(4)}`;

// Check the caps before every call. One call can go past the budget; the next one never starts.
function stop(subtype: "error_max_turns" | "error_max_budget"): never {
  console.log(`Stopped: ${subtype} after ${turns} turns, ${money()}.`);
  process.exit(3);
}

while (true) {
  if (turns >= maxTurns) stop("error_max_turns");
  if (cost >= maxBudgetUsd) stop("error_max_budget");
  const reply = streamText({ model: model("smart"), messages, tools });
  // Print each piece of text the moment it arrives.
  let wrote = false;
  for await (const piece of reply.textStream) {
    process.stdout.write(piece);
    wrote = true;
  }
  if (wrote) process.stdout.write("\n");
  turns++;
  // The price per token for this role comes from config/models.ts. It is null when the price is unknown.
  cost += costUsd("smart", await reply.usage) ?? 0;
  messages.push(...(await reply.responseMessages));
  const toolCalls = await reply.toolCalls;
  if (toolCalls.length === 0) {
    console.log(`Done. ${turns} turns, ${money()}.`);
    break;
  }
  // Every result from this turn goes back in one tool message, each paired with its call's id.
  const results = toolCalls.map((call) => {
    let output: { type: "text"; value: string } | { type: "error-text"; value: string };
    try {
      const run = runners[call.toolName];
      if (!run) throw new Error(`There is no tool "${call.toolName}".`);
      output = { type: "text", value: run(call.input as { path: string }) };
    } catch (e) {
      output = { type: "error-text", value: (e as Error).message };
    }
    return {
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    };
  });
  messages.push({ role: "tool", content: results });
}
