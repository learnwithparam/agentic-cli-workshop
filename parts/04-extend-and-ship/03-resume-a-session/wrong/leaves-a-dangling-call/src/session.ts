// Sessions: every message of a run is appended to .desk/sessions/<id>.jsonl the moment it
// exists, one JSON line each. If desk stops in the middle, the file still holds the run so far.
//   --resume <id>   load that session and carry on
//   --continue      load the newest session and carry on
//   --rewind <n>    with a resume: drop the last n turns first, the way /rewind does
// A stop can land between a tool call and its result. The API refuses a call with no result, so a
// loaded history is repaired first.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";

const sessionsFolder = join(process.cwd(), ".desk", "sessions");

export type Session = {
  id: string;
  history: ModelMessage[];
  save: (added: ModelMessage[]) => void;
};

// The session whose file changed last, or undefined when there is none.
function newestSessionId(): string | undefined {
  const sessionFiles = readdirSync(sessionsFolder).filter((name) => name.endsWith(".jsonl"));
  const lastChanged = (name: string) => statSync(join(sessionsFolder, name)).mtimeMs;
  sessionFiles.sort((first, second) => lastChanged(second) - lastChanged(first));
  return sessionFiles[0]?.replace(".jsonl", "");
}

function loadHistory(sessionFile: string): ModelMessage[] {
  if (!existsSync(sessionFile)) return [];
  const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

type Part = { type?: string; toolCallId?: string };
const partsOf = (message: ModelMessage): Part[] =>
  Array.isArray(message.content) ? (message.content as Part[]) : [];

// A turn starts at each assistant message. Drop the last n of them, and everything after.
export function rewindTurns(history: ModelMessage[], turns: number): ModelMessage[] {
  const starts = history.flatMap((message, index) => (message.role === "assistant" ? [index] : []));
  if (turns <= 0 || starts.length === 0) return history;
  const cut = starts[Math.max(0, starts.length - turns)];
  return history.slice(0, cut);
}

// If the last assistant message asked for tools that never got results, remove it.
export function repairHistory(history: ModelMessage[]): ModelMessage[] {
  const answered = new Set(
    history
      .filter((message) => message.role === "tool")
      .flatMap(partsOf)
      .map((part) => part.toolCallId),
  );
  const lastAssistant = history.findLastIndex((message) => message.role === "assistant");
  if (lastAssistant < 0) return history;
  const calls = partsOf(history[lastAssistant]).filter((part) => part.type === "tool-call");
  if (calls.every((call) => answered.has(call.toolCallId))) return history;
  return history.slice(0, lastAssistant);
}

export function openSession(
  resumeId: string | undefined,
  continueNewest: boolean,
  rewind = 0,
): Session {
  mkdirSync(sessionsFolder, { recursive: true });
  let id = resumeId;
  if (continueNewest) id = newestSessionId();
  const resumed = id !== undefined;
  id ??= crypto.randomUUID().slice(0, 8);
  const sessionFile = join(sessionsFolder, `${id}.jsonl`);
  let history = resumed ? loadHistory(sessionFile) : [];
  if (resumed && rewind > 0) history = rewindTurns(history, rewind);
  // The file must match the history the run starts from, or a later resume would bring it back.
  if (resumed) {
    const text = history.map((message) => `${JSON.stringify(message)}\n`).join("");
    writeFileSync(sessionFile, text);
  }
  const save = (added: ModelMessage[]) => {
    for (const message of added) appendFileSync(sessionFile, `${JSON.stringify(message)}\n`);
  };
  return { id, history, save };
}
