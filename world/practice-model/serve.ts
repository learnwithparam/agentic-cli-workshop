// bun run practice-model: run the practice model on http://localhost:4010 for your own experiments.
// Every request it gets is appended to world/.state/practice-model.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "../lib/newsroom";
import { nightDesk } from "./night-desk";
import { startPracticeModel } from "./server";

const port = Number(process.env.REPLAY_PORT ?? 4010);
mkdirSync(STATE_DIR, { recursive: true });
const log = join(STATE_DIR, "practice-model.jsonl");
try {
  startPracticeModel({ scenario: nightDesk, port, onRequest: (r) => appendFileSync(log, JSON.stringify({ ...r, raw: undefined }) + "\n") });
} catch {
  console.log(`Port ${port} is in use. Stop the other program, or run with REPLAY_PORT=4011 and REPLAY_URL=http://localhost:4011.`);
  process.exit(1);
}
console.log(`The practice model is running at http://localhost:${port}. Requests are logged to world/.state/practice-model.jsonl. Press Ctrl+C to stop.`);
