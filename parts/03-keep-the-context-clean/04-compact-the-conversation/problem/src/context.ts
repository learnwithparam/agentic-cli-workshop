// What goes into the model's context window: the system prompt with the desk rules, old tool
// results trimmed to a stub, and a summary in place of old turns when the conversation grows.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";

const root = process.cwd();
const BASE_PROMPT =
  "You are desk, the night desk agent of the Millbrook Herald, a regional daily newspaper. " +
  "Check the drafts in drafts/ against the files in sources/. Keep a todo list with todo_write.";

// The standing rules, read fresh on every run. The nearest file comes last, so it has the last
// word: DESK.md for the whole newsroom, then drafts/DESK.md for the drafts folder.
export function systemPrompt(): string {
  const parts = [BASE_PROMPT];
  for (const rulesPath of ["DESK.md", "drafts/DESK.md"]) {
    const fullPath = join(root, rulesPath);
    if (!existsSync(fullPath)) continue;
    const rules = readFileSync(fullPath, "utf8").trim();
    parts.push(`<desk-rules file="${rulesPath}">\n${rules}\n</desk-rules>`);
  }
  return parts.join("\n\n");
}

// desk.config.json can set compact_at_tokens. Above it, desk compacts the conversation.
export function compactAtTokens(): number {
  const configPath = join(root, "desk.config.json");
  if (!existsSync(configPath)) return 60_000;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return Number(config.compact_at_tokens ?? 60_000);
}

// A rough size: about four characters to a token. Good enough to decide when to act.
export function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

// The parts of a message this file reads. Other fields are left as they are.
type Part = {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: { type: string; value: unknown };
};
const partsOf = (message: ModelMessage) => message.content as Part[];

// Tool results older than the last KEEP_FULL tool messages become a stub. The full text is saved
// to a file first, and the stub says where, so the model can read it again if it must.
const KEEP_FULL = 3;
const savedResults = join(root, ".desk", "results");

export function trimOldResults(messages: ModelMessage[]): void {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const old = toolMessages.slice(0, -KEEP_FULL);
  for (const part of old.flatMap(partsOf)) {
    const value = String(part.output?.value ?? "");
    if (part.type !== "tool-result" || value.startsWith("[trimmed")) continue;
    mkdirSync(savedResults, { recursive: true });
    const savedPath = `.desk/results/${part.toolCallId}.txt`;
    writeFileSync(join(root, savedPath), value);
    part.output = { type: "text", value: `[trimmed: ${value.length} characters, in ${savedPath}]` };
  }
}

// One line per part, for the model that writes the summary. A tool call reads like
// TOOL file_story {"slug":"bridge-repairs"}, the same shape the finished desk uses.
function describePart(role: string, part: Part): string {
  if (part.type === "text") return `${role}: ${part.text}`;
  if (part.type === "tool-call") return `TOOL ${part.toolName} ${JSON.stringify(part.input)}`;
  const value = String(part.output?.value ?? "");
  return `result: ${value.slice(0, 300)}`;
}

export function render(messages: ModelMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") lines.push(`${message.role}: ${message.content}`);
    else lines.push(...partsOf(message).map((part) => describePart(message.role, part)));
  }
  return lines.join("\n");
}

export const SUMMARY_RULES =
  "You summarise a night desk session so the agent can carry on. Keep every story filed or held, " +
  "every correction, and every fact still needed. Leave out file contents.";

// TODO: compact. First append every message to .desk/transcripts/<runId>.jsonl, one JSON line
//       each. Then ask model("fast") with SUMMARY_RULES to summarise all but the last two messages
//       (use render). Return a user message with the summary and openTodos(), then the last two
//       messages, and what the summary cost.
export async function compact(messages: ModelMessage[], _runId: string) {
  return { messages, cost: 0 };
}
