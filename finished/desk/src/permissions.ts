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
  const r = config.permissions ?? {};
  return { allow: r.allow ?? [], ask: r.ask ?? [], deny: r.deny ?? [] };
}

function askPerson(question: string): string {
  let fd: number;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    return "n";
  }
  writeSync(fd, `${question} [y]es once, [a]lways, [n]o: `);
  const buf = Buffer.alloc(64);
  const n = readSync(fd, buf, 0, 64, null);
  return buf.toString("utf8", 0, n).trim().toLowerCase().slice(0, 1) || "n";
}

export function makeGate(mode: Mode, rules: Rules) {
  const always = new Set<string>();
  return (name: string, summary: string): Decision => {
    if (rules.deny.includes(name)) return { allow: false, reason: `A deny rule blocks ${name}.`, asked: false };
    const readOnly = (READ_ONLY as string[]).includes(name);
    if (mode === "plan" && !readOnly) return { allow: false, reason: `Plan mode: ${name} would change the newsroom. Describe the change instead.`, asked: false };
    if (rules.allow.includes(name) || (readOnly && !rules.ask.includes(name)) || always.has(name)) return { allow: true, reason: "allowed", asked: false };
    if (mode === "accept-edits" && (EDITS as string[]).includes(name)) return { allow: true, reason: "accept-edits mode", asked: false };
    if (mode === "accept-all") return { allow: true, reason: "accept-all mode", asked: false };
    if (mode === "never-ask") return { allow: false, reason: `${name} needs a person's approval and this run cannot ask (never-ask mode).`, asked: false };
    const answer = askPerson(`\n${summary}\nAllow ${name}?`);
    if (answer === "a") always.add(name);
    if (answer === "y" || answer === "a") return { allow: true, reason: "the night editor approved it", asked: true };
    return { allow: false, reason: `The night editor said no to ${name}. Do not try it again; hold the story or move on.`, asked: true };
  };
}
