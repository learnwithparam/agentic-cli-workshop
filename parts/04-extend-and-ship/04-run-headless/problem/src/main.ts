// desk, part four: the night desk agent, ready to run with nobody watching. Hooks run around
// every tool call, a wire service joins over MCP, every message is saved so a run can resume,
// and the output can be plain text or JSON for a script.
// Run from the newsroom folder:
//   bun src/main.ts -p "check tonight's drafts" --output-format stream-json
// Exit codes: 0 success, 1 an error, 3 a cap stopped it, 4 a call was denied in never-ask mode.
import { type ModelMessage, streamText } from "ai";
import { costUsd, model } from "#models";
import { compact, compactAtTokens, estimateTokens, systemPrompt, trimOldResults } from "./context";
import { blockedByHook, recordAfterTool } from "./hooks";
import { emit, exitCodeFor, FORMATS, type Format, type Subtype } from "./output";
import { decide, loadRules, MODES, type Mode } from "./permissions";
import { researcherCost } from "./researcher";
import { openSession } from "./session";
import { reminderAfterTurn } from "./todos";
import { runTool, tools } from "./tools";
import { connectWireServers } from "./wire";

// The text after a flag, such as "5" after --max-turns, or undefined when the flag is missing.
function flagValue(name: string): string | undefined {
  const flagPosition = process.argv.indexOf(name);
  if (flagPosition < 0) return undefined;
  return process.argv[flagPosition + 1];
}

function stopWithUsage(problem: string): never {
  console.log(`${problem}\nUsage: bun src/main.ts -p "your prompt" [--output-format stream-json]`);
  process.exit(1);
}

const task = flagValue("-p");
if (!task) stopWithUsage("There is no prompt.");
const maxTurns = Number(flagValue("--max-turns") ?? 30);
const maxBudgetUsd = Number(flagValue("--max-budget-usd") ?? 2);
const format = (flagValue("--output-format") ?? "text") as Format;
if (!FORMATS.includes(format)) stopWithUsage(`Unknown output format "${format}".`);
let mode = (flagValue("--permission-mode") ?? "ask") as Mode;
if (!MODES.includes(mode)) stopWithUsage(`Unknown permission mode "${mode}".`);
// A program reads JSON output, so nobody is there to answer a prompt.
if (format !== "text" && mode === "ask") mode = "never-ask";

const rules = loadRules(process.cwd());
const instructions = systemPrompt();
const compactAt = compactAtTokens();
const session = openSession(flagValue("--resume"), process.argv.includes("--continue"));
await connectWireServers();

type ToolCall = { toolCallId: string; toolName: string; input: unknown };
type ToolOutput = { type: "text"; value: string } | { type: "error-text"; value: string };

let denials = 0;

// The gate, then the hooks, then the tool. A pre_tool hook can block what the gate allowed.
async function runGatedTool(call: ToolCall): Promise<string> {
  if (call.toolName in tools) {
    const decision = await decide(call.toolName, mode, rules);
    // biome-ignore-start lint/style/useNamingConvention: the output contract fixes these names
    emit({
      type: "permission",
      tool: call.toolName,
      decision: decision.allowed ? "allow" : "deny",
      reason: decision.reason,
    });
    // biome-ignore-end lint/style/useNamingConvention: back to our own names
    if (!decision.allowed) {
      denials++;
      throw new Error(`Denied: ${decision.reason}`);
    }
  }
  const blockedBecause = blockedByHook(call.toolName, call.input);
  if (blockedBecause) throw new Error(`Blocked by a hook: ${blockedBecause}`);
  return await runTool(call.toolName, call.input);
}

// Run one call. Any problem goes back to the model as an error, and the hooks see every call.
async function outputFor(call: ToolCall): Promise<ToolOutput> {
  emit({ type: "tool_call", id: call.toolCallId, name: call.toolName, input: call.input });
  let output: ToolOutput;
  try {
    output = { type: "text", value: await runGatedTool(call) };
  } catch (error) {
    output = { type: "error-text", value: (error as Error).message };
  }
  const isError = output.type === "error-text";
  // biome-ignore lint/style/useNamingConvention: the output contract fixes this name
  emit({ type: "tool_result", id: call.toolCallId, is_error: isError, content: output.value });
  recordAfterTool(call.toolName, call.input, output);
  return output;
}

const messages: ModelMessage[] = [...session.history];

// Every new message goes into the conversation and, at once, into the session file.
function addMessages(...added: ModelMessage[]): void {
  messages.push(...added);
  session.save(added);
}

let turns = 0;
let cost = 0;

// The researcher's calls cost money too, so they count toward the budget.
function totalCost(): number {
  return cost + researcherCost;
}

// Before each call: trim old tool results, then compact if the conversation is still too big.
async function keepContextSmall(): Promise<void> {
  trimOldResults(messages);
  const before = estimateTokens(messages);
  if (before <= compactAt) return;
  const compacted = await compact(messages, session.id);
  messages.splice(0, messages.length, ...compacted.messages);
  cost += compacted.cost;
  // biome-ignore lint/style/useNamingConvention: the output contract fixes these names
  emit({ type: "compact", before_tokens: before, after_tokens: estimateTokens(messages) });
}

// Call the model once, streaming its words. Returns the tool calls it asked for.
async function oneTurn(): Promise<ToolCall[]> {
  const reply = streamText({ model: model("smart"), instructions, messages, tools });
  for await (const piece of reply.fullStream) {
    if (piece.type === "text-delta") emit({ type: "text", text: piece.text });
    if (piece.type === "error") throw piece.error;
  }
  turns++;
  cost += costUsd("smart", await reply.usage) ?? 0;
  addMessages(...(await reply.responseMessages));
  return await reply.toolCalls;
}

// Run the calls one at a time, so prompts and hooks come in order. All results go back together.
async function runToolCalls(toolCalls: ToolCall[]): Promise<void> {
  const toolResults = [];
  for (const call of toolCalls) {
    const output = await outputFor(call);
    const { toolCallId, toolName } = call;
    toolResults.push({ type: "tool-result" as const, toolCallId, toolName, output });
  }
  addMessages({ role: "tool", content: toolResults });
}

// The loop. Returns how the run ended.
async function runTheLoop(): Promise<Subtype> {
  while (true) {
    // Check the caps before every call. One call can go past the budget; the next never starts.
    if (turns >= maxTurns) return "error_max_turns";
    if (totalCost() >= maxBudgetUsd) return "error_max_budget";
    await keepContextSmall();
    const toolCalls = await oneTurn();
    if (toolCalls.length === 0) return "success";
    await runToolCalls(toolCalls);
    const reminder = reminderAfterTurn(toolCalls.map((call) => call.toolName));
    if (reminder) addMessages({ role: "user", content: reminder });
  }
}

// biome-ignore lint/style/useNamingConvention: the output contract fixes these names
emit({ type: "init", session_id: session.id, tools: Object.keys(tools) });
addMessages({ role: "user", content: task });

let subtype: Subtype;
try {
  subtype = await runTheLoop();
  // In never-ask mode a denial is a failure, even when the model went on and finished.
  if (subtype === "success" && mode === "never-ask" && denials > 0) subtype = "error_permission";
} catch (error) {
  emit({ type: "text", text: `desk stopped with an error: ${(error as Error).message}\n` });
  subtype = "error";
}
const costUsdTotal = Number(totalCost().toFixed(6));
// biome-ignore lint/style/useNamingConvention: the output contract fixes these names
emit({ type: "result", subtype, turns, cost_usd: costUsdTotal, session_id: session.id });
process.exit(exitCodeFor(subtype));
