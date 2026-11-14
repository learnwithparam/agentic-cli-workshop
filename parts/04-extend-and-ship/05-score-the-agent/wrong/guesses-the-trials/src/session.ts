// Sessions: every message of a run is appended to .desk/sessions/<id>.jsonl the moment it
// exists, one JSON line each. If desk stops in the middle, the file still holds the run so far.
//   --resume <id>   load that session and carry on
//   --continue      load the newest session and carry on
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
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

export function openSession(resumeId: string | undefined, continueNewest: boolean): Session {
  mkdirSync(sessionsFolder, { recursive: true });
  let id = resumeId;
  if (continueNewest) id = newestSessionId();
  const resumed = id !== undefined;
  id ??= crypto.randomUUID().slice(0, 8);
  const sessionFile = join(sessionsFolder, `${id}.jsonl`);
  const history = resumed ? loadHistory(sessionFile) : [];
  const save = (added: ModelMessage[]) => {
    for (const message of added) appendFileSync(sessionFile, `${JSON.stringify(message)}\n`);
  };
  return { id, history, save };
}
