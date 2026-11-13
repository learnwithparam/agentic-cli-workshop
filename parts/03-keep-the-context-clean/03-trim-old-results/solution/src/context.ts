// What goes into the model's context window: the system prompt with the desk rules, and old tool
// results trimmed to a stub.
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
