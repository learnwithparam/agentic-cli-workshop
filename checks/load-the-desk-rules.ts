// load-the-desk-rules: desk reads DESK.md, then drafts/DESK.md, into the system prompt of every
// request. The checks plant a fresh rule in each file, so only a desk that reads them passes.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { answeredRuns, playTurns } from "./helpers/answered-runs";
import { every, plant, type Run, userText, type World } from "./lib/harness";

const deskRule = (world: World) => `8. Desk rule ${world.nonce}: check the river gauge twice.`;
const draftsRule = (world: World) => `Drafts rule ${world.nonce}: keep headlines short.`;
const readRiver = [{ name: "read_file", input: { path: "drafts/river-levels.md" } }];

const withBothFiles = (folder: string) =>
  answeredRuns(folder, "load-the-desk-rules", {
    args: ["-p", "Check the river-levels draft."],
    setup: (world) => {
      plant(world, "DESK.md", deskRule(world));
      writeFileSync(
        join(world.newsroom, "drafts", "DESK.md"),
        `# Drafts rules\n\n${draftsRule(world)}\n`,
      );
    },
    scenario: () => playTurns([readRiver]),
  });

const withDeskFileOnly = (folder: string) =>
  answeredRuns(folder, "load-the-desk-rules-top-only", {
    args: ["-p", "Check the river-levels draft."],
    setup: (world) => plant(world, "DESK.md", deskRule(world)),
    scenario: () => playTurns([readRiver]),
  });

const holdsDeskRules = (desk: Run) =>
  desk.requests.length >= 2 &&
  desk.requests.every((request) => request.system.includes(deskRule(desk.world)));

export default [
  {
    says: "Every request's system prompt holds DESK.md, read fresh on this run",
    test: (folder) => every(withBothFiles(folder), holdsDeskRules),
    tryNext:
      'Read DESK.md with readFileSync(join(process.cwd(), "DESK.md")) inside systemPrompt(), ' +
      "and pass the result to streamText as instructions on every call.",
  },
  {
    says: "drafts/DESK.md comes after DESK.md, so the nearest file has the last word",
    test: (folder) =>
      every(withBothFiles(folder), (desk) => {
        const system = desk.requests[0]?.system ?? "";
        const deskAt = system.indexOf(deskRule(desk.world));
        const draftsAt = system.indexOf(draftsRule(desk.world));
        return deskAt >= 0 && draftsAt > deskAt;
      }),
    tryNext:
      'Loop over ["DESK.md", "drafts/DESK.md"] in that order, and add each file that exists.',
  },
  {
    says: "With no drafts/DESK.md, desk still runs and loads DESK.md",
    test: (folder) =>
      every(withDeskFileOnly(folder), (desk) => desk.code === 0 && holdsDeskRules(desk)),
    tryNext:
      "Skip a rules file that does not exist with existsSync. A missing file is not an error.",
  },
  {
    says: "The rules go in the system prompt, not in a user message",
    test: (folder) =>
      every(withBothFiles(folder), (desk) => {
        const firstRequest = desk.requests[0];
        return firstRequest !== undefined && !userText(firstRequest).includes(desk.world.nonce);
      }),
    tryNext:
      "Pass the rules as instructions, not as the first user message. " +
      "Compaction can drop old messages, but the system prompt goes out on every call.",
  },
] satisfies Rule[];
