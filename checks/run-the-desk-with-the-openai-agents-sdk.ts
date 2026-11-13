// run-the-desk-with-the-openai-agents-sdk: the desk runs on the OpenAI Agents SDK against the
// practice model. The check reads the CMS, the requests the practice model recorded and the
// output. It never trusts what the agent says about its own work.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { nightDesk } from "../world/practice-model/night-desk";
import type { Request, Scenario } from "../world/practice-model/server";
import { every, plant, type Run, runs, toolResults, toolUses, type World } from "./lib/harness";

type AnswerKey = {
  drafts: Record<string, { outcome: "file" | "hold"; faults: { correction?: boolean }[] }>;
};
const answerKey = JSON.parse(
  readFileSync(join(import.meta.dir, "../world/seed/answer-key.json"), "utf8"),
) as AnswerKey;

const storiesWith = (outcome: "file" | "hold") =>
  Object.keys(answerKey.drafts)
    .filter((slug) => answerKey.drafts[slug].outcome === outcome)
    .sort();
const fileSlugs = storiesWith("file");
const holdSlugs = storiesWith("hold");
const correctionCount = Object.values(answerKey.drafts)
  .flatMap((draft) => draft.faults)
  .filter((fault) => fault.correction).length;
// The held story the trap tries to file. The desk must refuse it at approval.
const trapSlug = holdSlugs[0];

const DESK_PROMPT = "Check tonight's drafts.";
const ARGS = ["-p", DESK_PROMPT];
const TIME_LIMIT_MS = 60_000;

// The night desk scenario, with a planted line in one draft so the answer comes from the files.
const nominal = (folder: string) =>
  runs(folder, "night-desk", {
    args: ARGS,
    timeoutMs: TIME_LIMIT_MS,
    scenario: () => nightDesk,
    setup: (world: World) => plant(world, "drafts/library-hours.md", `Desk check ${world.nonce}.`),
  });

// The same scenario, but first the model tries to file a held story.
const trapScenario: Scenario = (request, allRequests) => {
  const turn = nightDesk(request, allRequests);
  const tryingTrap = turn.tools?.some(
    (call) => call.name === "hold_story" && (call.input as { slug?: string }).slug === trapSlug,
  );
  const alreadyTried = allRequests.some((earlier) =>
    toolUses(earlier).some(
      (use) => use.name === "file_story" && (use.input as { slug?: string }).slug === trapSlug,
    ),
  );
  if (tryingTrap && !alreadyTried) {
    const note = "Every number, date and quote checked against sources.";
    return { tools: [{ name: "file_story", input: { slug: trapSlug, note } }] };
  }
  return turn;
};

const trap = (folder: string) =>
  runs(folder, "held-story", {
    args: ARGS,
    timeoutMs: TIME_LIMIT_MS,
    scenario: () => trapScenario,
  });

// Each tool call has a result in a later request.
function everyCallHasResult(requests: Request[]): boolean {
  const callIds = requests.flatMap((request) => toolUses(request).map((use) => use.id));
  const resultIds = new Set(
    requests.flatMap((request) => toolResults(request).map((result) => result.tool_use_id)),
  );
  return callIds.length > 0 && callIds.every((id) => resultIds.has(id));
}

// The stories with a status in the CMS, sorted.
function storiesWithStatus(run: Run, status: "filed" | "held"): string[] {
  const stories = Object.values(run.world.cms.state().stories);
  return stories
    .filter((story) => story.status === status)
    .map((story) => story.slug)
    .sort();
}

const sameList = (first: string[], second: string[]) => {
  const sortedFirst = [...first].sort();
  const sortedSecond = [...second].sort();
  return JSON.stringify(sortedFirst) === JSON.stringify(sortedSecond);
};

// The content of the result for the file_story call on one story.
function filingResult(run: Run, slug: string): string | undefined {
  const call = run.requests
    .flatMap((request) => toolUses(request))
    .find((use) => use.name === "file_story" && (use.input as { slug?: string }).slug === slug);
  if (!call) return undefined;
  const result = run.requests
    .flatMap((request) => toolResults(request))
    .find((candidate) => candidate.tool_use_id === call.id);
  return result?.content;
}

const finalLine =
  `Filed ${fileSlugs.length}, held ${holdSlugs.length}, waiting 0. ` +
  `Corrections logged tonight: ${correctionCount}. Rule breaks: 0.`;

export default [
  {
    says: "The desk makes at least four model requests, and every tool call gets a result",
    test: (folder: string) =>
      every(
        nominal(folder),
        (desk) => desk.requests.length >= 4 && everyCallHasResult(desk.requests),
      ),
    tryNext:
      "Send each tool result back. run() keeps looping until the model stops asking for tools.",
  },
  {
    says: "The desk files the 9 clean stories and holds the 3 held ones",
    test: (folder: string) =>
      every(
        nominal(folder),
        (desk) =>
          sameList(storiesWithStatus(desk, "filed"), fileSlugs) &&
          sameList(storiesWithStatus(desk, "held"), holdSlugs),
      ),
    tryNext: "Read each draft, then file it or hold it. A held story must be held, not filed.",
  },
  {
    says: "The last line prints the CMS counts and zero rule breaks",
    test: (folder: string) => every(nominal(folder), (desk) => desk.stdout.includes(finalLine)),
    tryNext:
      "Print the counts from /api/status after the run. " +
      "Use the same words as the finished desk.",
  },
  {
    says: "The desk reads the planted line, so its answer comes from the files",
    test: (folder: string) =>
      every(nominal(folder), (desk) =>
        desk.requests.some((request) =>
          toolResults(request).some((result) => result.content.includes(desk.world.nonce)),
        ),
      ),
    tryNext:
      "Let the agent call read_file and send the result back. " +
      "Do not write the answer into the code.",
  },
  {
    says: "A held story stops at approval: it stays unfiled and the result says denied",
    test: (folder: string) =>
      every(trap(folder), (desk) => {
        const unfiled = !storiesWithStatus(desk, "filed").includes(trapSlug);
        const result = filingResult(desk, trapSlug) ?? "";
        return unfiled && result.includes("denied");
      }),
    tryNext: "Add needsApproval to file_story. Answer it from the hold rules, so held drafts wait.",
  },
] satisfies Rule[];
