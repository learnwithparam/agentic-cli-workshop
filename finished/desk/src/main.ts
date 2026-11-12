#!/usr/bin/env bun
// desk: the Millbrook Herald night desk agent. The finished system, for comparison with what
// you build.
//
// desk -p "<prompt>" [--output-format text|json|stream-json]
//      [--permission-mode ask|accept-edits|plan|never-ask|accept-all]
//      [--max-turns N] [--max-budget-usd X] [--resume ID | --continue] [--cwd PATH]
//
// Exit codes: 0 success, 1 error, 3 a turn or budget cap stopped it,
// 4 a permission was denied in never-ask mode.
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
import { type Event, runLoop, type Subtype } from "./loop";
import { loadRules, MODES, type Mode, makeGate, type Rules } from "./permissions";
import type { ToolContext, ToolName } from "./tools";

// --- The command line ---

const commandLine = process.argv.slice(2);
const flagValue = (flag: string) => {
  const position = commandLine.indexOf(flag);
  return position >= 0 ? commandLine[position + 1] : undefined;
};
const prompt = flagValue("-p") ?? flagValue("--print");
const format = (flagValue("--output-format") ?? "text") as "text" | "json" | "stream-json";
const mode = (flagValue("--permission-mode") ?? "ask") as Mode;
const root = resolve(flagValue("--cwd") ?? process.cwd());
const maxTurns = Number(flagValue("--max-turns") ?? 80);
const maxBudgetUsd = Number(flagValue("--max-budget-usd") ?? 2);

if (!prompt) {
  console.log(
    'Usage: desk -p "check tonight\'s drafts" [--output-format text|json|stream-json] ' +
      "[--permission-mode ask|accept-edits|plan|never-ask]",
  );
  process.exit(1);
}
if (!MODES.includes(mode)) {
  console.log(`Unknown permission mode "${mode}". Use one of: ${MODES.join(", ")}.`);
  process.exit(1);
}

// --- Sessions: one append-only JSONL file per run, so a stopped run can resume ---

const sessionsFolder = join(root, ".desk", "sessions");
mkdirSync(sessionsFolder, { recursive: true });

function newestSessionId(): string | undefined {
  const sessionFiles = readdirSync(sessionsFolder).filter((file) => file.endsWith(".jsonl"));
  const lastChanged = (file: string) => statSync(join(sessionsFolder, file)).mtimeMs;
  sessionFiles.sort((first, second) => lastChanged(second) - lastChanged(first));
  return sessionFiles[0]?.replace(/\.jsonl$/, "");
}

function loadHistory(sessionFile: string): ModelMessage[] {
  const lines = readFileSync(sessionFile, "utf8").trim().split("\n");
  return lines.filter(Boolean).map((line) => JSON.parse(line));
}

// --continue picks the newest session; --resume names one.
const requestedSessionId = commandLine.includes("--continue")
  ? newestSessionId()
  : flagValue("--resume");
const resumed = Boolean(requestedSessionId);
const sessionId = requestedSessionId ?? crypto.randomUUID().slice(0, 8);
const sessionFile = join(sessionsFolder, `${sessionId}.jsonl`);
const history = resumed && existsSync(sessionFile) ? loadHistory(sessionFile) : [];
const saveMessages = (messages: ModelMessage[]) => {
  for (const message of messages) appendFileSync(sessionFile, `${JSON.stringify(message)}\n`);
};

// --- Output: plain lines for people, one JSON object per line for programs ---

const events: Event[] = [];
let midLine = false;

// A tool's input in a few words: the path, slug or question when it has one.
const shortInput = (input: unknown) => {
  const fields = input as Record<string, unknown>;
  const words = String(fields.path ?? fields.slug ?? fields.question ?? describeFields(fields));
  return words.length > 70 ? `${words.slice(0, 67)}...` : words;
};

// For a todo list, how far along it is; for anything else, the whole input.
function describeFields(fields: Record<string, unknown>): string {
  if (!Array.isArray(fields.todos)) return JSON.stringify(fields);
  const todos = fields.todos as { status: string }[];
  const done = todos.filter((todo) => todo.status === "done").length;
  return `${done} of ${todos.length} done`;
}

// The line a person sees for an event, or null when the event prints nothing.
function eventLine(event: Event): string | null {
  if (event.type === "init") {
    const modelKind = provider() === "replay" ? "practice model" : "live model";
    return `desk  session ${event.session_id}  ${event.tools.length} tools  ${modelKind}`;
  }
  if (event.type === "tool_call") return `  > ${event.name} ${shortInput(event.input)}`;
  if (event.type === "permission" && event.decision === "deny") {
    return `    denied: ${event.reason}`;
  }
  if (event.type === "tool_result" && event.is_error) {
    return `    error: ${event.content.split("\n")[0]}`;
  }
  if (event.type === "compact") {
    const sizes = `about ${event.before_tokens} tokens down to ${event.after_tokens}`;
    return `  ~ compacted the conversation: ${sizes}`;
  }
  return null;
}

const emit = (event: Event) => {
  events.push(event);
  if (format === "stream-json") return console.log(JSON.stringify(event));
  if (format === "json") return;
  if (event.type === "text") {
    process.stdout.write(event.text);
    midLine = !event.text.endsWith("\n");
    return;
  }
  // The model's words may stop mid-line; start the next line fresh.
  if (midLine) {
    process.stdout.write("\n");
    midLine = false;
  }
  const line = eventLine(event);
  if (line !== null) console.log(line);
};

// --- Tools, settings and the researcher helper ---

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

// biome-ignore-start lint/style/useNamingConvention: desk.config.json uses this field name
type DeskConfig = { compact_at_tokens?: number; permissions?: Partial<Rules> };
// biome-ignore-end lint/style/useNamingConvention: back to our own names

// Settings: DESK_CONFIG names a file, or desk.config.json in the working folder.
const configPath = process.env.DESK_CONFIG ?? join(root, "desk.config.json");
const config: DeskConfig = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8"))
  : {};
const gate = makeGate(mode, loadRules(config));
let researcherCost = 0;

const RESEARCHER_SYSTEM =
  "You are a researcher for the Millbrook Herald night desk. " +
  "Answer one question from the files in sources/. Search, do not read whole long files. " +
  "Reply with a short answer that cites the file and line.";

// A subagent: a fresh context, read-only tools, the fast role, a turn cap.
// Only its answer comes back.
async function research(question: string): Promise<string> {
  const helperContext: ToolContext = {
    ...toolContext,
    readFiles: new Map(),
    todos: [],
    research: undefined,
  };
  const helperRun = await runLoop({
    role: "fast",
    system: RESEARCHER_SYSTEM,
    messages: [{ role: "user", content: question }],
    tools: CHILD_TOOLS,
    toolContext: helperContext,
    maxTurns: 8,
    maxBudgetUsd: 0.5,
    gate: makeGate("never-ask", { allow: [], ask: [], deny: [] }),
    emit: () => {},
    stream: false,
  });
  researcherCost += helperRun.cost;
  return (helperRun.text || "The researcher found no answer.").slice(0, 2000);
}

const toolContext: ToolContext = {
  root,
  cmsUrl: process.env.CMS_URL ?? "http://localhost:4020",
  sessionId,
  readFiles: new Map(),
  todos: [],
  research,
};

// --- The run ---

function exitCodeFor(subtype: Subtype): number {
  if (subtype === "success") return 0;
  if (subtype === "error_permission") return 4;
  if (subtype === "error") return 1;
  return 3;
}

function printSummary(subtype: Subtype, turns: number, cost: number) {
  const where =
    provider() === "replay"
      ? "practice model; the same tokens on a live model would cost about this"
      : "live model";
  const outcome = subtype === "success" ? "Done" : `Stopped: ${subtype}`;
  console.log(
    `\n${outcome}. ${turns} turns, $${cost.toFixed(4)} (${where}). Session ${sessionId}.`,
  );
}

async function runDesk(userMessage: ModelMessage): Promise<number> {
  const run = await runLoop({
    role: "smart",
    system: systemPrompt(root),
    messages: [...history, userMessage],
    tools: PARENT_TOOLS,
    toolContext,
    maxTurns,
    maxBudgetUsd,
    compactAtTokens: Number(config.compact_at_tokens ?? 60_000),
    gate,
    emit,
    onMessages: saveMessages,
  });
  let subtype = run.subtype;
  // In never-ask mode a denial is a failure, even if the model carried on and finished.
  if (subtype === "success" && mode === "never-ask" && run.denials > 0) {
    subtype = "error_permission";
  }
  const cost = run.cost + researcherCost;
  const roundedCost = Number(cost.toFixed(6));
  emitResult({ subtype, turns: run.turns, cost: roundedCost, text: run.text });
  if (format === "json") {
    console.log(JSON.stringify({ ...events[events.length - 1], events: events.length }));
  }
  if (format === "text") printSummary(subtype, run.turns, cost);
  return exitCodeFor(subtype);
}

type Outcome = { subtype: Subtype; turns: number; cost: number; text: string };

function emitResult(outcome: Outcome) {
  // biome-ignore-start lint/style/useNamingConvention: desk's output format fixes these names
  emit({
    type: "result",
    subtype: outcome.subtype,
    turns: outcome.turns,
    cost_usd: outcome.cost,
    session_id: sessionId,
    text: outcome.text,
  });
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
}

// biome-ignore-start lint/style/useNamingConvention: desk's output format fixes these names
emit({ type: "init", session_id: sessionId, tools: PARENT_TOOLS });
// biome-ignore-end lint/style/useNamingConvention: back to our own names
const userMessage: ModelMessage = { role: "user", content: prompt };
saveMessages([userMessage]);

let exitCode = 0;
try {
  exitCode = await runDesk(userMessage);
} catch (error) {
  const message = (error as Error).message ?? String(error);
  emitResult({ subtype: "error", turns: 0, cost: 0, text: message });
  if (format !== "stream-json") console.log(`desk stopped with an error: ${message}`);
  exitCode = 1;
}
process.exit(exitCode);
