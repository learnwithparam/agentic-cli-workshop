// Sessions: every message of a run is appended to .desk/sessions/<id>.jsonl the moment it
// exists, one JSON line each. If desk stops in the middle, the file still holds the run so far.
//   --resume <id>   load that session and carry on
//   --continue      load the newest session and carry on
import type { ModelMessage } from "ai";

export type Session = {
  id: string;
  history: ModelMessage[];
  save: (added: ModelMessage[]) => void;
};

// TODO: keep the sessions in .desk/sessions/ in the newsroom folder, one <id>.jsonl file each.
//       - With --resume, use that id. With --continue, use the file that changed last.
//       - A resumed session's history is its file, one JSON message per line.
//       - save() appends each new message to the file as one JSON line, at once.
//       - A new session gets a short id, such as crypto.randomUUID().slice(0, 8).
export function openSession(_resumeId: string | undefined, _continueNewest: boolean): Session {
  return { id: crypto.randomUUID().slice(0, 8), history: [], save: () => {} };
}
