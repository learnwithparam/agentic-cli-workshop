// bun run demo: run the finished desk over tonight's drafts on the practice model.
// No key, no cost.
// It resets the newsroom, starts the CMS (or uses the one bun run world started) and the
// practice model, runs desk, then prints what the CMS holds. Extra arguments go to desk,
// for example: bun run demo --output-format stream-json
import { rmSync } from "node:fs";
import { join } from "node:path";
import { startCms, statusLine } from "../world/cms/server";
import { CMS_STATE, NEWSROOM, resetNewsroom } from "../world/lib/newsroom";
import { nightDesk } from "../world/practice-model/night-desk";
import { startPracticeModel } from "../world/practice-model/server";

const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";
const live = (process.env.LLM_PROVIDER ?? "replay") !== "replay";

async function cmsIsRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${cmsUrl}/api/status`);
    return response.ok;
  } catch {
    return false;
  }
}

resetNewsroom();
rmSync(CMS_STATE, { force: true });
let ownCms: ReturnType<typeof startCms> | null = null;
if (await cmsIsRunning()) {
  // Someone already runs the CMS, so empty it instead of starting a second one.
  await fetch(`${cmsUrl}/api/reset`, { method: "POST" });
} else {
  ownCms = startCms({
    newsroom: NEWSROOM,
    stateFile: CMS_STATE,
    port: Number(new URL(cmsUrl).port),
  });
}

const practiceModel = live ? null : startPracticeModel({ scenario: nightDesk });
const prompt = "Check tonight's drafts. File the clean ones and hold the rest with a reason.";
const deskMain = join(import.meta.dir, "desk", "src", "main.ts");
const extraArguments = process.argv.slice(2);

// biome-ignore-start lint/style/useNamingConvention: environment variable names are fixed
const replayEnvironment = practiceModel ? { REPLAY_URL: practiceModel.url } : {};
const deskEnvironment = {
  ...process.env,
  CMS_URL: cmsUrl,
  DESK_CONFIG: join(import.meta.dir, "desk.config.json"),
  ...replayEnvironment,
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

const desk = Bun.spawn(
  ["bun", deskMain, "-p", prompt, "--permission-mode", "accept-all", ...extraArguments],
  { cwd: NEWSROOM, stdio: ["inherit", "inherit", "inherit"], env: deskEnvironment },
);
const exitCode = await desk.exited;

const statusResponse = await fetch(`${cmsUrl}/api/status`);
const status = await statusResponse.json();
console.log(`\nThe CMS says: ${statusLine(status)}`);
console.log(
  ownCms
    ? "Run bun run world and open http://localhost:4020 to see the board."
    : "Open http://localhost:4020 to see the board.",
);
practiceModel?.stop();
ownCms?.stop();
process.exit(exitCode);
