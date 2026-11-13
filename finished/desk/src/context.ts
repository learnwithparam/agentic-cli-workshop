// What goes into the context window: the system prompt with the desk rules, and compaction
// when it grows.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, type ModelMessage } from "ai";
import { costUsd, model } from "#models";

export function systemPrompt(root: string): string {
  const lines = [
    "You are desk, the night desk agent of the Millbrook Herald, a regional daily newspaper.",
    "Your job tonight: check every draft in drafts/ against the files in sources/, " +
      "fix what the sources prove wrong,",
    "log a correction for each factual fix, apply house style, " +
      "then file each clean story or hold it with a reason.",
    "Use the tools. Keep a todo list. " +
      "When every draft is filed or held, reply with one short summary and no tool call.",
  ];
  // Standing rules, nearest file last so it wins.
  const rulesFiles = [join(root, "DESK.md"), join(root, "drafts", "DESK.md")];
  for (const rulesFile of rulesFiles) {
    if (!existsSync(rulesFile)) continue;
    const name = rulesFile.slice(root.length + 1);
    const rules = readFileSync(rulesFile, "utf8").trim();
    lines.push(`\n<desk-rules file="${name}">\n${rules}\n</desk-rules>`);
  }
  return lines.join("\n");
}

// A rough size: about four characters a token. Good enough to decide when to compact.
export const estimateTokens = (system: string, messages: ModelMessage[]) =>
  Math.ceil((system.length + JSON.stringify(messages).length) / 4);

// The parts of a message that a summary needs. Other part types are left out.
type MessagePart = {
  type: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  output?: { value?: unknown };
};

function describePart(role: string, part: MessagePart): string | null {
  if (part.type === "text") return `${role.toUpperCase()}: ${part.text}`;
  if (part.type === "tool-call") return `TOOL ${part.toolName} ${JSON.stringify(part.input)}`;
  if (part.type === "tool-result") {
    return `RESULT ${String(part.output?.value ?? "").slice(0, 300)}`;
  }
  return null;
}

// The conversation as plain lines, for the model that writes the summary.
export function render(messages: ModelMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      lines.push(`${message.role.toUpperCase()}: ${message.content}`);
      continue;
    }
    for (const part of message.content as MessagePart[]) {
      const line = describePart(message.role, part);
      if (line !== null) lines.push(line);
    }
  }
  return lines.join("\n");
}

export const SUMMARY_SYSTEM =
  "You summarise a night desk session so the agent can carry on with a clean context. " +
  "Keep: every open todo item, every story already filed or held, every correction logged, " +
  "and every desk rule that applied. Drop file contents.";

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
  const olderMessages = messages.slice(0, cutAt);
  const summaryReply = await generateText({
    model: model("fast"),
    instructions: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: `Summarise this session:\n\n${render(olderMessages)}` }],
    maxOutputTokens: 2048,
  });
  const summary: ModelMessage = {
    role: "user",
    content: `<session-summary>\n${summaryReply.text}\n</session-summary>\nCarry on from here.`,
  };
  const cost = costUsd("fast", summaryReply.usage) ?? 0;
  return { messages: [summary, ...messages.slice(cutAt)], cost };
}
