// desk, part two: the loop from part one, with tools that change the newsroom and the CMS.
// The tools live in tools.ts. This file reads the flags and runs the loop.
// Run from the newsroom folder:
//   bun src/main.ts -p "check the river-levels draft" --max-turns 10
// Exit codes: 0 the model finished, 1 no prompt, 3 a cap stopped it.
import { type ModelMessage, streamText } from "ai";
import { costUsd, model } from "#models";
// TODO: import decide, loadRules, MODES and the Mode type from "./permissions".
import { runTool, tools } from "./tools";

// The text after a flag, such as "5" after --max-turns, or undefined when the flag is missing.
function flagValue(name: string): string | undefined {
  const flagPosition = process.argv.indexOf(name);
  if (flagPosition < 0) return undefined;
  return process.argv[flagPosition + 1];
}

const task = flagValue("-p");
if (!task) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}
const maxTurns = Number(flagValue("--max-turns") ?? 30);
const maxBudgetUsd = Number(flagValue("--max-budget-usd") ?? 2);
// TODO: read --permission-mode (default "ask"). Stop with exit code 1 when it is not in MODES.
//       Load the rules with loadRules(process.cwd()).

type ToolCall = { toolCallId: string; toolName: string; input: unknown };
type ToolOutput = { type: "text"; value: string } | { type: "error-text"; value: string };

// One call in a line, so the night editor sees what desk is doing. An edit shows its diff.
function describeCall(call: ToolCall): string {
  const input = call.input as Record<string, string>;
  const firstLine = `  > ${call.toolName} ${input.path ?? input.slug ?? input.command ?? ""}`;
  if (call.toolName !== "edit_file") return firstLine;
  return `${firstLine}\n    - ${input.old_text}\n    + ${input.new_text}`;
}

// Run the tool. Any problem goes back to the model as an error, so it can try something else.
async function outputFor(call: ToolCall): Promise<ToolOutput> {
  console.log(describeCall(call));
  try {
    // TODO: for a tool desk has (call.toolName in tools), ask decide() first. When it is not
    //       allowed, throw an Error that starts with "Denied:" and gives the reason.
    return { type: "text", value: await runTool(call.toolName, call.input) };
  } catch (error) {
    const message = (error as Error).message;
    console.log(`    error: ${message.split("\n")[0]}`);
    return { type: "error-text", value: message };
  }
}

const messages: ModelMessage[] = [{ role: "user", content: task }];

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
  cost += costUsd("smart", await reply.usage) ?? 0;
  messages.push(...(await reply.responseMessages));
  const toolCalls = await reply.toolCalls;
  if (toolCalls.length === 0) {
    console.log(`Done. ${turns} turns, ${costInDollars()}.`);
    break;
  }
  // Run the calls one at a time, in order. All the results from this turn go back in one tool
  // message, each paired with its call's id.
  const toolResults = [];
  for (const call of toolCalls) {
    const output = await outputFor(call);
    toolResults.push({
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
    });
  }
  messages.push({ role: "tool", content: toolResults });
}
