// bun run world            start the Millbrook Herald CMS on http://localhost:4020
//                          (resets the newsroom if it is missing)
// bun run world reset      put the newsroom files and the CMS back to the start of the night
// bun run world status     print what the CMS holds: filed, held, waiting, corrections and
//                          rule breaks
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CmsState, startCms, statusLine, summary } from "./cms/server";
import { CMS_STATE, ensureNewsroom, NEWSROOM, readDrafts, resetNewsroom } from "./lib/newsroom";

const PORT = Number(process.env.CMS_PORT ?? 4020);
const URL = `http://localhost:${PORT}`;
const command = process.argv[2] ?? "start";

async function cmsIsRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${URL}/api/status`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function reset(): Promise<void> {
  resetNewsroom();
  rmSync(CMS_STATE, { force: true });
  if (await cmsIsRunning()) await fetch(`${URL}/api/reset`, { method: "POST" });
  const transcriptPath = join(NEWSROOM, "sources", "council-meeting-transcript.txt");
  const transcriptSize = statSync(transcriptPath).size.toLocaleString("en-GB");
  console.log(
    `The newsroom is reset: ${readDrafts().length} drafts waiting, ` +
      `and a council transcript of ${transcriptSize} characters.`,
  );
}

// The corrections already in the log before tonight, so they are not counted as tonight's.
function countEarlierCorrections(): number {
  const log = readFileSync(join(NEWSROOM, "corrections.jsonl"), "utf8");
  const lines = log.trim().split("\n");
  return lines.filter(Boolean).length;
}

async function printStatus(): Promise<void> {
  if (await cmsIsRunning()) {
    const response = await fetch(`${URL}/api/status`);
    console.log(statusLine(await response.json()));
  } else if (existsSync(CMS_STATE)) {
    ensureNewsroom();
    const state: CmsState = JSON.parse(readFileSync(CMS_STATE, "utf8"));
    console.log(statusLine(summary(state, NEWSROOM, countEarlierCorrections())));
  } else {
    const waiting = readDrafts(ensureNewsroom()).length;
    console.log(
      `Filed 0, held 0, waiting ${waiting}. Corrections logged tonight: 0. Rule breaks: 0.`,
    );
  }
}

async function start(): Promise<void> {
  if (await cmsIsRunning()) {
    console.log(`The CMS is already running at ${URL}. Open it in your browser.`);
    process.exit(0);
  }
  ensureNewsroom();
  try {
    startCms({ newsroom: NEWSROOM, stateFile: CMS_STATE, port: PORT });
  } catch {
    console.log(
      `Port ${PORT} is in use by another program. ` +
        "Stop it, or run with CMS_PORT=4021 bun run world.",
    );
    process.exit(1);
  }
  const waiting = readDrafts().length;
  console.log(
    `The Millbrook Herald CMS is running at ${URL} with ${waiting} drafts in the newsroom. ` +
      "Press Ctrl+C to stop.",
  );
}

if (command === "reset") {
  await reset();
} else if (command === "status") {
  await printStatus();
} else if (command === "start") {
  await start();
} else {
  console.log(
    `There is no world command "${command}". ` +
      "Use: bun run world, bun run world reset, or bun run world status.",
  );
  process.exit(1);
}
