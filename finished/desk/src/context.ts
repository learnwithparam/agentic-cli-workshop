// What goes into the context window: the system prompt with the desk rules, and compaction when it grows.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, type ModelMessage } from "ai";
import { costUsd, model } from "#models";

export function systemPrompt(root: string): string {
  const parts = [
    "You are desk, the night desk agent of the Millbrook Herald, a regional daily newspaper.",
    "Your job tonight: check every draft in drafts/ against the files in sources/, fix what the sources prove wrong,",
    "log a correction for each factual fix, apply house style, then file each clean story or hold it with a reason.",
    "Use the tools. Keep a todo list. When every draft is filed or held, reply with one short summary and no tool call.",
  ];
  // Standing rules, nearest file last so it wins.
  for (const p of [join(root, "DESK.md"), join(root, "drafts", "DESK.md")])
    if (existsSync(p))
      parts.push(
        `\n<desk-rules file="${p.slice(root.length + 1)}">\n${readFileSync(p, "utf8").trim()}\n</desk-rules>`,
      );
  return parts.join("\n");
}

// A rough size: about four characters a token. Good enough to decide when to compact.
export const estimateTokens = (system: string, messages: ModelMessage[]) =>
  Math.ceil((system.length + JSON.stringify(messages).length) / 4);

export function render(messages: ModelMessage[]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push(`${m.role.toUpperCase()}: ${m.content}`);
      continue;
    }
    for (const p of m.content as any[]) {
      if (p.type === "text") out.push(`${m.role.toUpperCase()}: ${p.text}`);
      if (p.type === "tool-call") out.push(`TOOL ${p.toolName} ${JSON.stringify(p.input)}`);
      if (p.type === "tool-result")
        out.push(`RESULT ${String(p.output?.value ?? "").slice(0, 300)}`);
    }
  }
  return out.join("\n");
}

export const SUMMARY_SYSTEM =
  "You summarise a night desk session so the agent can carry on with a clean context. Keep: every open todo item, " +
  "every story already filed or held, every correction logged, and every desk rule that applied. Drop file contents.";

// Replace older messages with one summary, keeping the most recent turns as they are.
// Returns the new messages and what the summary cost.
export async function compact(
  messages: ModelMessage[],
  keepLast = 4,
): Promise<{ messages: ModelMessage[]; cost: number }> {
  let cutAt = Math.max(0, messages.length - keepLast);
  // Never split a tool call from its result: start the kept part on an assistant message.
  while (cutAt > 0 && messages[cutAt].role !== "assistant") cutAt--;
  if (cutAt === 0) return { messages, cost: 0 };
  const old = messages.slice(0, cutAt);
  const r = await generateText({
    model: model("fast"),
    instructions: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: `Summarise this session:\n\n${render(old)}` }],
    maxOutputTokens: 2048,
  });
  const summary: ModelMessage = {
    role: "user",
    content: `<session-summary>\n${r.text}\n</session-summary>\nCarry on from here.`,
  };
  return { messages: [summary, ...messages.slice(cutAt)], cost: costUsd("fast", r.usage) ?? 0 };
}
