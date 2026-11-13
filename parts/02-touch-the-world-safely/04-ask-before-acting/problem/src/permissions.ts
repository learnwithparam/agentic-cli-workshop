// The permission gate. desk asks it about every tool call before the tool runs. It decides in
// this order, and the first answer wins:
//   1. a deny rule in desk.config.json     the tool never runs
//   2. plan mode                           a tool that changes something never runs
//   3. an allow rule, or a read-only tool  the tool runs (an ask rule turns this off)
//   4. "always" said earlier in this run   the tool runs
//   5. accept-edits mode                   edit_file runs
//   6. never-ask mode                      nobody can answer, so the tool never runs
//   7. ask the night editor: [y]es once, [a]lways for this run, [n]o
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Mode = "ask" | "accept-edits" | "plan" | "never-ask";
export const MODES: Mode[] = ["ask", "accept-edits", "plan", "never-ask"];

export type Decision = { allowed: boolean; reason: string };
export type Rules = { allow: string[]; ask: string[]; deny: string[] };

// These tools only look. Every other tool changes the newsroom or the CMS.
export const READ_ONLY = ["read_file", "list_files", "search_files"];
export const EDITS = ["edit_file"];

// The rules live in desk.config.json in the newsroom folder. With no file there are no rules.
export function loadRules(root: string): Rules {
  const configPath = join(root, "desk.config.json");
  let permissions: Partial<Rules> = {};
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    permissions = config.permissions ?? {};
  }
  return {
    allow: permissions.allow ?? [],
    ask: permissions.ask ?? [],
    deny: permissions.deny ?? [],
  };
}

// TODO: ask the night editor with prompt("Allow file_story? [y]es once, [a]lways, [n]o:").
//       prompt() reads one line from stdin and gives null when there is nothing to read.
//       "y" allows once. "a" allows and remembers the tool until the run ends. Anything else,
//       null too, is a no.

// TODO: walk the seven steps at the top of this file, in order. This starter allows everything,
//       which is what desk did before this step.
export function decide(_toolName: string, _mode: Mode, _rules: Rules): Decision {
  return { allowed: true, reason: "no gate yet" };
}
