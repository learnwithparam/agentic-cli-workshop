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
const READ_ONLY = ["read_file", "list_files", "search_files"];
const EDITS = ["edit_file"];

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

const allow = (reason: string): Decision => ({ allowed: true, reason });
const deny = (reason: string): Decision => ({ allowed: false, reason });

// Tools the night editor answered "always" for. desk forgets them when the run ends.
const alwaysAllowed = new Set<string>();

// Steps 1 to 4. Returns null when no rule decides.
function decideByRules(toolName: string, mode: Mode, rules: Rules): Decision | null {
  if (rules.deny.includes(toolName)) {
    return deny(`A deny rule in desk.config.json blocks ${toolName}.`);
  }
  const readOnly = READ_ONLY.includes(toolName);
  if (mode === "plan" && !readOnly) {
    return deny(`Plan mode: ${toolName} would change something. Describe the change instead.`);
  }
  const allowedByRule = rules.allow.includes(toolName) || readOnly;
  if (allowedByRule && !rules.ask.includes(toolName)) return allow("an allow rule");
  if (alwaysAllowed.has(toolName)) return allow("the night editor said always");
  return null;
}

// Steps 5 and 6. Returns null when desk must ask.
function decideByMode(toolName: string, mode: Mode): Decision | null {
  if (mode === "accept-edits" && EDITS.includes(toolName)) return allow("accept-edits mode");
  if (mode === "never-ask") {
    return deny(`${toolName} needs the night editor, and never-ask mode cannot ask anyone.`);
  }
  return null;
}

// Step 7. The answer comes from stdin. No answer at all counts as no.
function askTheNightEditor(toolName: string): Decision {
  const answer = prompt(`    Allow ${toolName}? [y]es once, [a]lways, [n]o:`) ?? "n";
  // A typed answer ends the line with Enter. A piped answer does not, so print it.
  if (!process.stdin.isTTY) console.log(answer);
  const firstLetter = answer.trim().toLowerCase().slice(0, 1);
  if (firstLetter === "a") alwaysAllowed.add(toolName);
  if (firstLetter === "y" || firstLetter === "a") return allow("the night editor said yes");
  return deny(`The night editor said no to ${toolName}. Do not try it again. Move on.`);
}

export function decide(toolName: string, mode: Mode, rules: Rules): Decision {
  const decision = decideByRules(toolName, mode, rules) ?? decideByMode(toolName, mode);
  if (decision) return decision;
  return askTheNightEditor(toolName);
}
