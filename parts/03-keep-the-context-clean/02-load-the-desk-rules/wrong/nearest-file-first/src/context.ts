// What goes into the model's context window. For now, the system prompt with the desk rules.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const BASE_PROMPT =
  "You are desk, the night desk agent of the Millbrook Herald, a regional daily newspaper. " +
  "Check the drafts in drafts/ against the files in sources/. Keep a todo list with todo_write.";

// The standing rules, read fresh on every run. The nearest file comes last, so it has the last
// word: DESK.md for the whole newsroom, then drafts/DESK.md for the drafts folder.
export function systemPrompt(): string {
  const parts = [BASE_PROMPT];
  for (const rulesPath of ["drafts/DESK.md", "DESK.md"]) {
    const fullPath = join(root, rulesPath);
    if (!existsSync(fullPath)) continue;
    const rules = readFileSync(fullPath, "utf8").trim();
    parts.push(`<desk-rules file="${rulesPath}">\n${rules}\n</desk-rules>`);
  }
  return parts.join("\n\n");
}
