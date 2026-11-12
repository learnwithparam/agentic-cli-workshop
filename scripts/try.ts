// bun run try <step-name> [solution] -p "your prompt" [more flags]
// Runs your desk for one step by hand: in the newsroom folder, against the practice model, with the CMS up.
// It starts the practice model and the CMS for this run if they are not already running.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startCms } from "../world/cms/server";
import { ensureNewsroom, NEWSROOM } from "../world/lib/newsroom";
import { nightDesk } from "../world/practice-model/night-desk";
import { startPracticeModel } from "../world/practice-model/server";
import { allSteps, findStep } from "./structure";

const [name, ...rest] = process.argv.slice(2);
const step = name ? findStep(name) : undefined;
if (!step) {
  console.log(name ? `There is no step called "${name}". Steps:` : "Name a step. Steps:");
  for (const s of allSteps()) console.log(`  bun run try ${s.name} -p "say ready"`);
  process.exit(1);
}
const which = rest[0] === "solution" ? "solution" : "problem";
const args = rest[0] === "solution" ? rest.slice(1) : rest;
const main = join(step.dir, which, "src", "main.ts");
if (!existsSync(main)) {
  console.log(
    `${step.name} has no ${which}/src/main.ts to run. This step is checked with bun run verify ${step.name}.`,
  );
  process.exit(1);
}
ensureNewsroom();
const live = (process.env.LLM_PROVIDER ?? "replay") !== "replay";
const practice = live ? null : startPracticeModel({ scenario: nightDesk });
const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";
const up = await fetch(`${cmsUrl}/api/status`)
  .then((r) => r.ok)
  .catch(() => false);
const cms = up ? null : startCms({ newsroom: NEWSROOM });
const proc = Bun.spawn(["bun", main, ...args], {
  cwd: NEWSROOM,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...process.env,
    CMS_URL: cms?.url ?? cmsUrl,
    ...(practice ? { REPLAY_URL: practice.url } : {}),
  },
});
const code = await proc.exited;
practice?.stop();
cms?.stop();
process.exit(code);
