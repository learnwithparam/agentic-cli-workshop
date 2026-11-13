// delegate-to-a-subagent: ask_researcher runs a helper loop with a fresh context, the fast role,
// read-only tools and a cap of 6 turns. Only its short answer reaches desk, and its cost counts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { answeredRuns } from "./helpers/answered-runs";
import { every, type Run, toolResults, userText, type World } from "./lib/harness";

const PACK = "sources/research-pack.txt";
const READ_ONLY = ["read_file", "list_files", "search_files"];
const SMART_USAGE = { input: 10_000, output: 1_000 };
const FAST_USAGE = { input: 100_000, output: 10_000 };

const question = (world: World) => `What was the final council vote? Case ${world.nonce}`;
const answer = (world: World) => `The motion passed 11 to 4 (case ${world.nonce}).`;
const marker = (world: World) => `Pack marker ${world.nonce}`;

// desk asks the researcher once. The researcher reads a big file, then answers in one line, or
// with `endless`, keeps reading until its cap stops it.
function researchScenario(world: World, endless: boolean) {
  return (request: Request) => {
    if (request.model === "practice-fast") {
      const readsSoFar = toolResults(request).length;
      if (readsSoFar === 0 || endless) {
        return { tools: [{ name: "read_file", input: { path: PACK } }], usage: FAST_USAGE };
      }
      return { text: answer(world), usage: FAST_USAGE };
    }
    if (toolResults(request).length > 0)
      return { text: "The vote is checked.", usage: SMART_USAGE };
    const input = { question: question(world) };
    return { tools: [{ name: "ask_researcher", input }], usage: SMART_USAGE };
  };
}

const writePack = (world: World) => {
  const line = `${marker(world)}: page after page of council papers.\n`;
  writeFileSync(join(world.newsroom, PACK), line.repeat(200));
};

const delegating = (folder: string) =>
  answeredRuns(folder, "delegate-to-a-subagent", {
    args: ["-p", "Check the council vote."],
    setup: writePack,
    scenario: (world) => researchScenario(world, false),
  });

const capped = (folder: string) =>
  answeredRuns(folder, "delegate-to-a-subagent-capped", {
    args: ["-p", "Check the council vote."],
    setup: writePack,
    scenario: (world) => researchScenario(world, true),
  });

const fastRequests = (desk: Run) =>
  desk.requests.filter((request) => request.model === "practice-fast");
const smartRequests = (desk: Run) =>
  desk.requests.filter((request) => request.model !== "practice-fast");

// 2 calls on the smart role and 2 on the fast role, priced by config/models.ts.
async function expectedCost(): Promise<number> {
  const saved = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "replay";
  const { priceOf } = await import("../config/models");
  const smart = priceOf("smart");
  const fast = priceOf("fast");
  if (saved === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = saved;
  if (!smart || !fast) throw new Error("config/models.ts has no price for smart or fast");
  const smartCall =
    SMART_USAGE.input * smart.inputPerMillion + SMART_USAGE.output * smart.outputPerMillion;
  const fastCall =
    FAST_USAGE.input * fast.inputPerMillion + FAST_USAGE.output * fast.outputPerMillion;
  return (2 * smartCall + 2 * fastCall) / 1_000_000;
}

const dollarAmounts = (stdout: string) =>
  [...stdout.matchAll(/\$(\d+\.\d+)/g)].map((match) => Number(match[1]));

export default [
  {
    says: "The researcher starts with a fresh context on the fast role: only the question",
    test: (folder) =>
      every(delegating(folder), (desk) => {
        const first = fastRequests(desk)[0];
        const onlyTheQuestion = first?.messages.length === 1;
        return onlyTheQuestion && userText(first).includes(question(desk.world));
      }),
    tryNext:
      'Start askResearcher with messages = [{ role: "user", content: input.question }] ' +
      'and call generateText with model("fast").',
  },
  {
    says: "The researcher is offered the read-only tools only, and never ask_researcher",
    test: (folder) =>
      every(delegating(folder), (desk) => {
        const requests = fastRequests(desk);
        const toolNames = requests.flatMap((request) => request.tools.map((tool) => tool.name));
        return requests.length > 0 && toolNames.every((name) => READ_ONLY.includes(name));
      }),
    tryNext:
      "Pass only read_file, list_files and search_files as the researcher's tools. " +
      "A helper that can file or start another helper is not a safe helper.",
  },
  {
    says: "desk gets the short answer only: under 2,000 characters, none of the files read",
    test: (folder) =>
      every(delegating(folder), (desk) => {
        const smart = smartRequests(desk);
        const result = smart[1] ? toolResults(smart[1])[0] : undefined;
        const short = result !== undefined && result.content.length < 2_000;
        const sawFiles = smart.some((request) =>
          JSON.stringify(request.messages).includes(marker(desk.world)),
        );
        return short && result.content.includes(answer(desk.world)) && !sawFiles;
      }),
    tryNext:
      "Return the researcher's last text, cut to 2,000 characters. " +
      "Never return its messages or the files it read.",
  },
  {
    says: "The researcher stops at its cap of 6 turns, and desk carries on",
    test: (folder) =>
      every(capped(folder), (desk) => fastRequests(desk).length === 6 && desk.code === 0),
    tryNext:
      "Loop at most MAX_TURNS (6) times. After the last turn, return a short line that says " +
      "the researcher found no answer, so desk can go on.",
  },
  {
    says: "The cost desk prints includes the researcher's calls",
    test: async (folder) => {
      const want = await expectedCost();
      return every(delegating(folder), (desk) =>
        dollarAmounts(desk.stdout).some((amount) => Math.abs(amount - want) < 0.001),
      );
    },
    tryNext:
      'Add costUsd("fast", reply.usage) to researcherCost after every researcher call. ' +
      "main.ts adds researcherCost to the total.",
  },
] satisfies Rule[];
