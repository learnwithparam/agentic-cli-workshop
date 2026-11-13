// The permission gate. Every tool call passes through it, in this order:
//   1. a deny rule          always wins
//   2. plan mode            anything that changes the world is denied
//   3. an allow rule, or a read-only tool
//   4. accept-edits mode    edits to files are allowed
//   5. accept-all mode      everything else is allowed (the demo uses it; never in production)
//   6. never-ask mode       anything that would ask is denied (headless runs)
//   7. ask the person: [y]es once, [a]lways for this session, [n]o
import { openSync, readSync, writeSync } from "node:fs";
import { EDITS, READ_ONLY } from "./tools";

export type Mode = "ask" | "accept-edits" | "plan" | "never-ask" | "accept-all";
export const MODES: Mode[] = ["ask", "accept-edits", "plan", "never-ask", "accept-all"];
export type Decision = { allow: boolean; reason: string; asked: boolean };
export type Rules = { allow: string[]; ask: string[]; deny: string[] };

export function loadRules(config: { permissions?: Partial<Rules> }): Rules {
  const configured = config.permissions ?? {};
  return {
    allow: configured.allow ?? [],
    ask: configured.ask ?? [],
    deny: configured.deny ?? [],
  };
}

// Ask on the terminal itself, not on stdin, so it still works when output is piped.
// Returns the first letter of the answer, or "n" when there is no terminal to ask on.
function askPerson(question: string): string {
  let terminal: number;
  try {
    terminal = openSync("/dev/tty", "r+");
  } catch {
    return "n";
  }
  writeSync(terminal, `${question} [y]es once, [a]lways, [n]o: `);
  const answerBytes = Buffer.alloc(64);
  const bytesRead = readSync(terminal, answerBytes, 0, 64, null);
  const answer = answerBytes.toString("utf8", 0, bytesRead).trim();
  return answer.toLowerCase().slice(0, 1) || "n";
}

const allowed = (reason: string): Decision => ({ allow: true, reason, asked: false });
const denied = (reason: string): Decision => ({ allow: false, reason, asked: false });

type GateSettings = { mode: Mode; rules: Rules; alwaysAllowed: Set<string> };

// Steps 1 to 3: the deny, plan and allow rules. Returns null when no rule decides.
function decideByRules(name: string, settings: GateSettings): Decision | null {
  const { mode, rules, alwaysAllowed } = settings;
  if (rules.deny.includes(name)) return denied(`A deny rule blocks ${name}.`);
  const readOnly = (READ_ONLY as string[]).includes(name);
  if (mode === "plan" && !readOnly) {
    return denied(`Plan mode: ${name} would change the newsroom. Describe the change instead.`);
  }
  const allowedByRule = rules.allow.includes(name) || (readOnly && !rules.ask.includes(name));
  if (allowedByRule || alwaysAllowed.has(name)) return allowed("allowed");
  return null;
}

// Steps 4 to 6: what the permission mode decides. Returns null when we must ask.
function decideByMode(name: string, mode: Mode): Decision | null {
  if (mode === "accept-edits" && (EDITS as string[]).includes(name)) {
    return allowed("accept-edits mode");
  }
  if (mode === "accept-all") return allowed("accept-all mode");
  if (mode === "never-ask") {
    return denied(`${name} needs a person's approval and this run cannot ask (never-ask mode).`);
  }
  return null;
}

export function makeGate(mode: Mode, rules: Rules) {
  const settings: GateSettings = { mode, rules, alwaysAllowed: new Set<string>() };
  return (name: string, summary: string): Decision => {
    const decision = decideByRules(name, settings) ?? decideByMode(name, mode);
    if (decision) return decision;
    // Step 7: ask the night editor.
    const answer = askPerson(`\n${summary}\nAllow ${name}?`);
    if (answer === "a") settings.alwaysAllowed.add(name);
    if (answer === "y" || answer === "a") {
      return { allow: true, reason: "the night editor approved it", asked: true };
    }
    const refusal = `The night editor said no to ${name}.`;
    return {
      allow: false,
      reason: `${refusal} Do not try it again; hold the story or move on.`,
      asked: true,
    };
  };
}
