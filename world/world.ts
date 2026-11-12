// bun run world            start the Millbrook Herald CMS on http://localhost:4020 (resets the newsroom if it is missing)
// bun run world reset      put the newsroom files and the CMS back to the start of the night
// bun run world status     print what the CMS holds: filed, held, waiting, corrections and rule breaks
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CmsState, startCms, statusLine, summary } from "./cms/server";
import { CMS_STATE, ensureNewsroom, NEWSROOM, readDrafts, resetNewsroom } from "./lib/newsroom";

const PORT = Number(process.env.CMS_PORT ?? 4020);
const URL = `http://localhost:${PORT}`;
const cmd = process.argv[2] ?? "start";

async function running(): Promise<boolean> {
  try {
    return (await fetch(`${URL}/api/status`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

if (cmd === "reset") {
  resetNewsroom();
  rmSync(CMS_STATE, { force: true });
  if (await running()) await fetch(`${URL}/api/reset`, { method: "POST" });
  const size = statSync(join(NEWSROOM, "sources", "council-meeting-transcript.txt")).size;
  console.log(
    `The newsroom is reset: ${readDrafts().length} drafts waiting, and a council transcript of ${size.toLocaleString("en-GB")} characters.`,
  );
} else if (cmd === "status") {
  if (await running()) {
    console.log(statusLine(await (await fetch(`${URL}/api/status`)).json()));
  } else if (existsSync(CMS_STATE)) {
    ensureNewsroom();
    const state: CmsState = JSON.parse(readFileSync(CMS_STATE, "utf8"));
    const base = readFileSync(join(NEWSROOM, "corrections.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean).length;
    console.log(statusLine(summary(state, NEWSROOM, base)));
  } else {
    console.log(
      `Filed 0, held 0, waiting ${readDrafts(ensureNewsroom()).length}. Corrections logged tonight: 0. Rule breaks: 0.`,
    );
  }
} else if (cmd === "start") {
  if (await running()) {
    console.log(`The CMS is already running at ${URL}. Open it in your browser.`);
    process.exit(0);
  }
  ensureNewsroom();
  try {
    startCms({ newsroom: NEWSROOM, stateFile: CMS_STATE, port: PORT });
  } catch (_e) {
    console.log(
      `Port ${PORT} is in use by another program. Stop it, or run with CMS_PORT=4021 bun run world.`,
    );
    process.exit(1);
  }
  const waiting = readDrafts().length;
  console.log(
    `The Millbrook Herald CMS is running at ${URL} with ${waiting} drafts in the newsroom. Press Ctrl+C to stop.`,
  );
} else {
  console.log(
    `There is no world command "${cmd}". Use: bun run world, bun run world reset, or bun run world status.`,
  );
  process.exit(1);
}
