// Sessions: every message of a run is appended to .desk/sessions/<id>.jsonl the moment it
// exists, one JSON line each. If desk stops in the middle, the file still holds the run so far.
//   --resume <id>   load that session and carry on
//   --continue      load the newest session and carry on
import { appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

export function openSession(resumeId: string | undefined, continueNewest: boolean): Session {
  mkdirSync(sessionsFolder, { recursive: true });
  let id = resumeId;
  if (continueNewest) id = newestSessionId();
  id ??= crypto.randomUUID().slice(0, 8);
  const sessionFile = join(sessionsFolder, `${id}.jsonl`);
  // The id is reused, but the run starts with an empty conversation.
  const history: ModelMessage[] = [];
  const save = (added: ModelMessage[]) => {
    for (const message of added) appendFileSync(sessionFile, `${JSON.stringify(message)}\n`);
  };
  return { id, history, save };
}
