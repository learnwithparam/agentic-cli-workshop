#!/usr/bin/env bun
// desk: the Millbrook Herald night desk agent. The finished system, for comparison with what you build.
//
// desk -p "<prompt>" [--output-format text|json|stream-json] [--permission-mode ask|accept-edits|plan|never-ask|accept-all]
//      [--max-turns N] [--max-budget-usd X] [--resume ID | --continue] [--cwd PATH]
//
// Exit codes: 0 success, 1 error, 3 a turn or budget cap stopped it, 4 a permission was denied in never-ask mode.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { ModelMessage } from "ai";
import { provider } from "#models";
import { systemPrompt } from "./context";
import { type Event, runLoop } from "./loop";
import { loadRules, MODES, type Mode, makeGate } from "./permissions";
import type { ToolContext, ToolName } from "./tools";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = flag("-p") ?? flag("--print");
const format = (flag("--output-format") ?? "text") as "text" | "json" | "stream-json";
const mode = (flag("--permission-mode") ?? "ask") as Mode;
const root = resolve(flag("--cwd") ?? process.cwd());
const maxTurns = Number(flag("--max-turns") ?? 80);
const maxBudgetUsd = Number(flag("--max-budget-usd") ?? 2);

if (!prompt) {
  console.log(
    'Usage: desk -p "check tonight\'s drafts" [--output-format text|json|stream-json] [--permission-mode ask|accept-edits|plan|never-ask]',
  );
  process.exit(1);
}
if (!MODES.includes(mode)) {
  console.log(`Unknown permission mode "${mode}". Use one of: ${MODES.join(", ")}.`);
  process.exit(1);
}

// Sessions: one append-only JSONL file per run, so a stopped run can resume.
const sessionsDir = join(root, ".desk", "sessions");
mkdirSync(sessionsDir, { recursive: true });
let sessionId = flag("--resume");
if (args.includes("--continue")) {
  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  files.sort(
    (a, b) => statSync(join(sessionsDir, b)).mtimeMs - statSync(join(sessionsDir, a)).mtimeMs,
  );
  sessionId = files[0]?.replace(/\.jsonl$/, "");
}
const resumed = Boolean(sessionId);
sessionId ??= crypto.randomUUID().slice(0, 8);
const sessionFile = join(sessionsDir, `${sessionId}.jsonl`);
const history: ModelMessage[] =
  resumed && existsSync(sessionFile)
    ? readFileSync(sessionFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const save = (ms: ModelMessage[]) =>
  ms.forEach((m) => appendFileSync(sessionFile, `${JSON.stringify(m)}\n`));

// Output: plain lines for people, one JSON object per line for programs.
const events: Event[] = [];
let midLine = false;
const emit = (e: Event) => {
  events.push(e);
  if (format === "stream-json") return console.log(JSON.stringify(e));
  if (format === "json") return;
  if (e.type === "text") {
    process.stdout.write(e.text);
    midLine = !e.text.endsWith("\n");
    return;
  }
  if (midLine) {
    process.stdout.write("\n");
    midLine = false;
  }
  if (e.type === "init")
    console.log(
      `desk  session ${e.session_id}  ${e.tools.length} tools  ${provider() === "replay" ? "practice model" : "live model"}`,
    );
  if (e.type === "tool_call") console.log(`  > ${e.name} ${short(e.input)}`);
  if (e.type === "permission" && e.decision === "deny") console.log(`    denied: ${e.reason}`);
  if (e.type === "tool_result" && e.is_error) console.log(`    error: ${e.content.split("\n")[0]}`);
  if (e.type === "compact")
    console.log(
      `  ~ compacted the conversation: about ${e.before_tokens} tokens down to ${e.after_tokens}`,
    );
};
const short = (input: unknown) => {
  const a = input as Record<string, unknown>;
  const s = String(
    a.path ??
      a.slug ??
      a.question ??
      (Array.isArray(a.todos)
        ? `${a.todos.filter((t: any) => t.status === "done").length} of ${a.todos.length} done`
        : JSON.stringify(a)),
  );
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
};

const PARENT_TOOLS: ToolName[] = [
  "list_files",
  "read_file",
  "search_files",
  "edit_file",
  "file_story",
  "hold_story",
  "log_correction",
  "todo_write",
  "ask_researcher",
];
const CHILD_TOOLS: ToolName[] = ["list_files", "read_file", "search_files"];
// Settings: DESK_CONFIG names a file, or desk.config.json in the working folder.
const configPath = process.env.DESK_CONFIG ?? join(root, "desk.config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const gate = makeGate(mode, loadRules(config));
let childCost = 0;

const ctx: ToolContext = {
  root,
  cmsUrl: process.env.CMS_URL ?? "http://localhost:4020",
  sessionId,
  readFiles: new Map(),
  todos: [],
  // A subagent: a fresh context, read-only tools, the fast role, a turn cap. Only its answer comes back.
  research: async (question) => {
    const childCtx: ToolContext = { ...ctx, readFiles: new Map(), todos: [], research: undefined };
    const r = await runLoop({
      role: "fast",
      system:
        "You are a researcher for the Millbrook Herald night desk. Answer one question from the files in sources/. Search, do not read whole long files. Reply with a short answer that cites the file and line.",
      messages: [{ role: "user", content: question }],
      tools: CHILD_TOOLS,
      ctx: childCtx,
      maxTurns: 8,
      maxBudgetUsd: 0.5,
      gate: makeGate("never-ask", { allow: [], ask: [], deny: [] }),
      emit: () => {},
      stream: false,
    });
    childCost += r.cost;
    return (r.text || "The researcher found no answer.").slice(0, 2000);
  },
};

emit({ type: "init", session_id: sessionId, tools: PARENT_TOOLS });
const userMessage: ModelMessage = { role: "user", content: prompt };
save([userMessage]);

let code = 0;
try {
  const r = await runLoop({
    role: "smart",
    system: systemPrompt(root),
    messages: [...history, userMessage],
    tools: PARENT_TOOLS,
    ctx,
    maxTurns,
    maxBudgetUsd,
    compactAtTokens: Number(config.compact_at_tokens ?? 60_000),
    gate,
    emit,
    onMessages: save,
  });
  let subtype = r.subtype;
  if (subtype === "success" && mode === "never-ask" && r.denials > 0) subtype = "error_permission";
  const cost = r.cost + childCost;
  emit({
    type: "result",
    subtype,
    turns: r.turns,
    cost_usd: Number(cost.toFixed(6)),
    session_id: sessionId,
    text: r.text,
  });
  code =
    subtype === "success" ? 0 : subtype === "error_permission" ? 4 : subtype === "error" ? 1 : 3;
  if (format === "json")
    console.log(JSON.stringify({ ...events[events.length - 1], events: events.length }));
  if (format === "text") {
    const where =
      provider() === "replay"
        ? "practice model; the same tokens on a live model would cost about this"
        : "live model";
    console.log(
      `\n${subtype === "success" ? "Done" : `Stopped: ${subtype}`}. ${r.turns} turns, $${cost.toFixed(4)} (${where}). Session ${sessionId}.`,
    );
  }
} catch (e) {
  const message = (e as Error).message ?? String(e);
  emit({
    type: "result",
    subtype: "error",
    turns: 0,
    cost_usd: 0,
    session_id: sessionId,
    text: message,
  });
  if (format !== "stream-json") console.log(`desk stopped with an error: ${message}`);
  code = 1;
}
process.exit(code);
