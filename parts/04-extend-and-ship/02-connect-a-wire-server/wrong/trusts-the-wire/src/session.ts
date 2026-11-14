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

// This file is filled in a later step, resume-a-session. Until then every run starts fresh and
// nothing is saved.
export function openSession(_resumeId: string | undefined, _continueNewest: boolean): Session {
  return { id: crypto.randomUUID().slice(0, 8), history: [], save: () => {} };
}
