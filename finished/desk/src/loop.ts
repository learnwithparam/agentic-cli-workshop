// The agent loop: call the model, run the tools it asks for, send the results back, and repeat
// until it answers with no tool call, or a cap stops it.
import { type ModelMessage, streamText, type ToolResultPart, type ToolSet } from "ai";
import { costUsd, model, type Role } from "#models";
import { compact, estimateTokens } from "./context";
import type { Decision } from "./permissions";
import { definitions, runTool, type ToolContext, ToolError, type ToolName } from "./tools";

// Programs read these events with --output-format stream-json, so the field names stay as they are.
// biome-ignore-start lint/style/useNamingConvention: desk's output format fixes these names
export type Event =
  | { type: "init"; session_id: string; tools: string[] }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; is_error: boolean; content: string }
  | { type: "permission"; tool: string; decision: "allow" | "deny"; reason: string }
  | { type: "compact"; before_tokens: number; after_tokens: number }
  | {
      type: "result";
      subtype: Subtype;
      turns: number;
      cost_usd: number;
      session_id: string;
      text: string;
    };
// biome-ignore-end lint/style/useNamingConvention: back to our own names

export type Subtype =
  | "success"
  | "error_max_turns"
  | "error_max_budget"
  | "error_permission"
  | "error";

export type LoopOptions = {
  role: Role;
  system: string;
  messages: ModelMessage[];
  tools: ToolName[];
  toolContext: ToolContext;
  maxTurns: number;
  maxBudgetUsd: number;
  compactAtTokens?: number;
  gate: (name: string, summary: string) => Decision;
  emit: (event: Event) => void;
  onMessages?: (added: ModelMessage[]) => void;
  stream?: boolean;
};

export type LoopResult = {
  subtype: Subtype;
  turns: number;
  cost: number;
  text: string;
  messages: ModelMessage[];
  denials: number;
};

// What the loop keeps track of from one turn to the next.
type LoopState = {
  messages: ModelMessage[];
  turns: number;
  cost: number;
  denials: number;
  lastText: string;
};

type ModelTurn = ReturnType<typeof streamText>;
type ToolCall = Awaited<ModelTurn["toolCalls"]>[number];

function finish(state: LoopState, subtype: Subtype): LoopResult {
  const { turns, cost, lastText, messages, denials } = state;
  return { subtype, turns, cost, text: lastText, messages, denials };
}

// A long conversation costs more and fills the context window, so swap old turns for a summary.
async function compactIfTooLong(options: LoopOptions, state: LoopState) {
  if (!options.compactAtTokens) return;
  const before = estimateTokens(options.system, state.messages);
  if (before <= options.compactAtTokens) return;
  const compacted = await compact(state.messages);
  state.messages = compacted.messages;
  state.cost += compacted.cost;
  const after = estimateTokens(options.system, state.messages);
  // biome-ignore-start lint/style/useNamingConvention: desk's output format fixes these names
  options.emit({ type: "compact", before_tokens: before, after_tokens: after });
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
}

// Call the model once, printing its words as they arrive unless streaming is off.
async function streamOneTurn(options: LoopOptions, messages: ModelMessage[], tools: ToolSet) {
  const turn = streamText({
    model: model(options.role),
    instructions: options.system,
    messages,
    tools,
    maxOutputTokens: 4096,
  });
  let text = "";
  for await (const part of turn.fullStream) {
    if (part.type === "text-delta") {
      text += part.text;
      if (options.stream !== false) options.emit({ type: "text", text: part.text });
    }
    if (part.type === "error") throw part.error;
  }
  if (options.stream === false && text) options.emit({ type: "text", text });
  return { turn, text };
}

// Run one tool call through the gate. Returns what goes back to the model, and whether it failed.
async function runOneToolCall(options: LoopOptions, state: LoopState, call: ToolCall) {
  const summary = `desk wants to run ${call.toolName} ${JSON.stringify(call.input)}`;
  const decision = options.gate(call.toolName, summary);
  options.emit({
    type: "permission",
    tool: call.toolName,
    decision: decision.allow ? "allow" : "deny",
    reason: decision.reason,
  });
  if (!decision.allow) {
    state.denials++;
    return { content: `Permission denied: ${decision.reason}`, isError: true };
  }
  try {
    const content = await runTool(call.toolName, call.input, options.toolContext);
    return { content, isError: false };
  } catch (error) {
    // A ToolError already says what to try next; anything else is a bug in the tool.
    if (error instanceof ToolError) return { content: error.message, isError: true };
    return { content: `The tool failed: ${(error as Error).message}`, isError: true };
  }
}

// Every result from this turn goes back in one tool message, paired by id.
async function runToolCalls(options: LoopOptions, state: LoopState, calls: ToolCall[]) {
  const results: ToolResultPart[] = [];
  for (const call of calls) {
    options.emit({
      type: "tool_call",
      id: call.toolCallId,
      name: call.toolName,
      input: call.input,
    });
    const { content, isError } = await runOneToolCall(options, state, call);
    // biome-ignore-start lint/style/useNamingConvention: desk's output format fixes these names
    options.emit({ type: "tool_result", id: call.toolCallId, is_error: isError, content });
    // biome-ignore-end lint/style/useNamingConvention: back to our own names
    results.push({
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: isError ? { type: "error-text", value: content } : { type: "text", value: content },
    });
  }
  const toolMessage: ModelMessage = { role: "tool", content: results };
  return toolMessage;
}

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const state: LoopState = {
    messages: options.messages,
    turns: 0,
    cost: 0,
    denials: 0,
    lastText: "",
  };
  const tools = definitions(options.tools);
  while (true) {
    if (state.turns >= options.maxTurns) return finish(state, "error_max_turns");
    if (state.cost >= options.maxBudgetUsd) return finish(state, "error_max_budget");
    await compactIfTooLong(options, state);

    const { turn, text } = await streamOneTurn(options, state.messages, tools);
    state.turns++;
    state.cost += costUsd(options.role, await turn.usage) ?? 0;
    const added = (await turn.responseMessages) as ModelMessage[];
    state.messages = [...state.messages, ...added];
    options.onMessages?.(added);
    if (text) state.lastText = text;

    const calls = await turn.toolCalls;
    if (calls.length === 0) return finish(state, "success");

    const toolMessage = await runToolCalls(options, state, calls);
    state.messages = [...state.messages, toolMessage];
    options.onMessages?.([toolMessage]);
  }
}
