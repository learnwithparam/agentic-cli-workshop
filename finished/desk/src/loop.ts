// The agent loop: call the model, run the tools it asks for, send the results back, and repeat
// until it answers with no tool call, or a cap stops it.
import { streamText, type ModelMessage } from "ai";
import { costUsd, model, type Role } from "#models";
import { compact, estimateTokens } from "./context";
import type { Decision } from "./permissions";
import { ToolError, definitions, runTool, type ToolContext, type ToolName } from "./tools";

export type Event =
  | { type: "init"; session_id: string; tools: string[] }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; is_error: boolean; content: string }
  | { type: "permission"; tool: string; decision: "allow" | "deny"; reason: string }
  | { type: "compact"; before_tokens: number; after_tokens: number }
  | { type: "result"; subtype: Subtype; turns: number; cost_usd: number; session_id: string; text: string };

export type Subtype = "success" | "error_max_turns" | "error_max_budget" | "error_permission" | "error";

export type LoopOptions = {
  role: Role;
  system: string;
  messages: ModelMessage[];
  tools: ToolName[];
  ctx: ToolContext;
  maxTurns: number;
  maxBudgetUsd: number;
  compactAtTokens?: number;
  gate: (name: string, summary: string) => Decision;
  emit: (e: Event) => void;
  onMessages?: (added: ModelMessage[]) => void;
  stream?: boolean;
};

export type LoopResult = { subtype: Subtype; turns: number; cost: number; text: string; messages: ModelMessage[]; denials: number };

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  let messages = o.messages;
  let turns = 0;
  let cost = 0;
  let denials = 0;
  let lastText = "";
  const defs = definitions(o.tools);
  const done = (subtype: Subtype): LoopResult => ({ subtype, turns, cost, text: lastText, messages, denials });

  while (true) {
    if (turns >= o.maxTurns) return done("error_max_turns");
    if (cost >= o.maxBudgetUsd) return done("error_max_budget");

    if (o.compactAtTokens && estimateTokens(o.system, messages) > o.compactAtTokens) {
      const before = estimateTokens(o.system, messages);
      const c = await compact(messages);
      messages = c.messages;
      cost += c.cost;
      o.emit({ type: "compact", before_tokens: before, after_tokens: estimateTokens(o.system, messages) });
    }

    const r = streamText({ model: model(o.role), instructions: o.system, messages, tools: defs, maxOutputTokens: 4096 });
    let text = "";
    for await (const part of r.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        if (o.stream !== false) o.emit({ type: "text", text: part.text });
      }
      if (part.type === "error") throw part.error;
    }
    if (o.stream === false && text) o.emit({ type: "text", text });
    turns++;
    cost += costUsd(o.role, await r.usage) ?? 0;
    const added = (await r.responseMessages) as ModelMessage[];
    messages = [...messages, ...added];
    o.onMessages?.(added);
    if (text) lastText = text;

    const calls = await r.toolCalls;
    if (calls.length === 0) return done("success");

    // Every result from this turn goes back in one tool message, paired by id.
    const results: any[] = [];
    for (const c of calls) {
      o.emit({ type: "tool_call", id: c.toolCallId, name: c.toolName, input: c.input });
      const decision = o.gate(c.toolName, `desk wants to run ${c.toolName} ${JSON.stringify(c.input)}`);
      o.emit({ type: "permission", tool: c.toolName, decision: decision.allow ? "allow" : "deny", reason: decision.reason });
      let content: string;
      let isError = false;
      if (!decision.allow) {
        denials++;
        content = `Permission denied: ${decision.reason}`;
        isError = true;
      } else {
        try {
          content = await runTool(c.toolName, c.input, o.ctx);
        } catch (e) {
          content = e instanceof ToolError ? e.message : `The tool failed: ${(e as Error).message}`;
          isError = true;
        }
      }
      o.emit({ type: "tool_result", id: c.toolCallId, is_error: isError, content });
      results.push({
        type: "tool-result",
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        output: isError ? { type: "error-text", value: content } : { type: "text", value: content },
      });
    }
    const toolMessage: ModelMessage = { role: "tool", content: results };
    messages = [...messages, toolMessage];
    o.onMessages?.([toolMessage]);
  }
}
