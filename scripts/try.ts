// bun run try <step-name> [solution] -p "your prompt" [more flags]
// Runs your desk for one step by hand: in the newsroom folder, against the practice model,
// with the CMS up. It starts the practice model and the CMS for this run if they are not
// already running.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startCms } from "../world/cms/server";
import { ensureNewsroom, NEWSROOM } from "../world/lib/newsroom";
import { nightDesk } from "../world/practice-model/night-desk";
import { startPracticeModel } from "../world/practice-model/server";
import { allSteps, findStep } from "./structure";

const [stepName, ...rest] = process.argv.slice(2);
const step = stepName ? findStep(stepName) : undefined;
if (!step) {
  console.log(stepName ? `There is no step called "${stepName}". Steps:` : "Name a step. Steps:");
  for (const knownStep of allSteps()) console.log(`  bun run try ${knownStep.name} -p "say ready"`);
  process.exit(1);
}
const wantsSolution = rest[0] === "solution";
const version = wantsSolution ? "solution" : "problem";
const deskArguments = wantsSolution ? rest.slice(1) : rest;
const mainFile = join(step.dir, version, "src", "main.ts");
if (!existsSync(mainFile)) {
  console.log(
    `${step.name} has no ${version}/src/main.ts to run. ` +
      `This step is checked with bun run verify ${step.name}.`,
  );
  process.exit(1);
}

async function answersAt(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

ensureNewsroom();
const live = (process.env.LLM_PROVIDER ?? "replay") !== "replay";
const practiceModel = live ? null : startPracticeModel({ scenario: nightDesk });
const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";
const cmsIsRunning = await answersAt(`${cmsUrl}/api/status`);
const cms = cmsIsRunning ? null : startCms({ newsroom: NEWSROOM });

// biome-ignore-start lint/style/useNamingConvention: the shell fixes environment variable names
const replayEnvironment = practiceModel ? { REPLAY_URL: practiceModel.url } : {};
const desk = Bun.spawn(["bun", mainFile, ...deskArguments], {
  cwd: NEWSROOM,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, CMS_URL: cms?.url ?? cmsUrl, ...replayEnvironment },
});
// biome-ignore-end lint/style/useNamingConvention: back to our own names
const exitCode = await desk.exited;
practiceModel?.stop();
cms?.stop();
process.exit(exitCode);
