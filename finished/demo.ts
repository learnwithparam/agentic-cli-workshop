// bun run demo: run the finished desk over tonight's drafts on the practice model. No key, no cost.
// It resets the newsroom, starts the CMS (or uses the one bun run world started) and the practice model,
// runs desk, then prints what the CMS holds. Extra arguments go to desk, for example: bun run demo --output-format stream-json
import { rmSync } from "node:fs";
import { join } from "node:path";
import { startCms, statusLine } from "../world/cms/server";
import { CMS_STATE, NEWSROOM, resetNewsroom } from "../world/lib/newsroom";
import { nightDesk } from "../world/practice-model/night-desk";
import { startPracticeModel } from "../world/practice-model/server";

const CMS_URL = process.env.CMS_URL ?? "http://localhost:4020";
const live = (process.env.LLM_PROVIDER ?? "replay") !== "replay";

resetNewsroom();
rmSync(CMS_STATE, { force: true });
let ownCms: ReturnType<typeof startCms> | null = null;
const up = await fetch(`${CMS_URL}/api/status`).then((r) => r.ok).catch(() => false);
if (up) await fetch(`${CMS_URL}/api/reset`, { method: "POST" });
else ownCms = startCms({ newsroom: NEWSROOM, stateFile: CMS_STATE, port: Number(new URL(CMS_URL).port) });

const practice = live ? null : startPracticeModel({ scenario: nightDesk });
const prompt = "Check tonight's drafts. File the clean ones and hold the rest with a reason.";
const proc = Bun.spawn(
  ["bun", join(import.meta.dir, "desk", "src", "main.ts"), "-p", prompt, "--permission-mode", "accept-all", ...process.argv.slice(2)],
  {
    cwd: NEWSROOM,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, CMS_URL, DESK_CONFIG: join(import.meta.dir, "desk.config.json"), ...(practice ? { REPLAY_URL: practice.url } : {}) },
  },
);
const code = await proc.exited;
const status = await (await fetch(`${CMS_URL}/api/status`)).json();
console.log(`\nThe CMS says: ${statusLine(status)}`);
console.log(ownCms ? "Run bun run world and open http://localhost:4020 to see the board." : "Open http://localhost:4020 to see the board.");
practice?.stop();
ownCms?.stop();
process.exit(code);
