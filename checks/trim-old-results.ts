// trim-old-results: on a run of 30 reads, desk swaps old tool results for a stub that says where
// the full text is saved. Recent results stay whole, and every call keeps its result.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { answeredRuns, playTurns } from "./helpers/answered-runs";
import { every, type Run, toolResults, toolUses } from "./lib/harness";

const READS = 30;
const SAVED_PATH = /\.desk\/results\/[\w.-]+\.txt/;

function draftPaths(): string[] {
  const seedDrafts = join(import.meta.dir, "..", "world", "seed", "newsroom", "drafts");
  return readdirSync(seedDrafts).map((fileName) => `drafts/${fileName}`);
}

// One read per turn, going round the drafts.
function readTurns() {
  const paths = draftPaths();
  const turns = [];
  for (let i = 0; i < READS; i++) {
    turns.push([{ name: "read_file", input: { path: paths[i % paths.length] } }]);
  }
  return turns;
}

const trimming = (folder: string) =>
  answeredRuns(folder, "trim-old-results", {
    args: ["-p", "Read every draft, one by one.", "--max-turns", "40"],
    scenario: () => playTurns(readTurns()),
    timeoutMs: 40_000,
  });

// Each tool result in the last request, next to the full text of the file that call read.
function resultsWithFiles(desk: Run) {
  const last = desk.requests[desk.requests.length - 1];
  if (!last) return [];
  const results = toolResults(last);
  return toolUses(last).map((call) => {
    const path = (call.input as { path: string }).path;
    const full = readFileSync(join(desk.world.newsroom, path), "utf8");
    const result = results.find((answer) => answer.tool_use_id === call.id);
    return { full, content: result?.content ?? "" };
  });
}

const sizeOf = (texts: string[]) => texts.reduce((total, text) => total + text.length, 0);

export default [
  {
    says: "By the last request, the tool results take at least 50% less room than the files read",
    test: (folder) =>
      every(trimming(folder), (desk) => {
        const pairs = resultsWithFiles(desk);
        const sent = sizeOf(pairs.map((pair) => pair.content));
        const read = sizeOf(pairs.map((pair) => pair.full));
        return pairs.length === READS && sent <= read / 2;
      }),
    tryNext:
      "Before every call, run trimOldResults(messages). It changes every tool message " +
      "except the last 3, in place.",
  },
  {
    says: "Every tool call still has exactly one result",
    test: (folder) =>
      every(trimming(folder), (desk) => {
        const last = desk.requests[desk.requests.length - 1];
        const results = toolResults(last);
        const calls = toolUses(last);
        const answered = (id: string) => results.filter((result) => result.tool_use_id === id);
        return calls.length === READS && calls.every((call) => answered(call.id).length === 1);
      }),
    tryNext:
      "Change the output of an old tool-result part. Never delete the part or its message: " +
      "the API refuses a tool call with no result.",
  },
  {
    says: "The last 3 tool results are still whole",
    test: (folder) =>
      every(trimming(folder), (desk) => {
        const lastThree = resultsWithFiles(desk).slice(-3);
        return lastThree.length === 3 && lastThree.every((pair) => pair.content === pair.full);
      }),
    tryNext: "Leave the newest 3 tool messages alone: toolMessages.slice(0, -3) are the old ones.",
  },
  {
    says: "Each stub names a saved file that holds the full text",
    test: (folder) =>
      every(trimming(folder), (desk) => {
        const stubs = resultsWithFiles(desk).filter((pair) => pair.content !== pair.full);
        return (
          stubs.length > 0 &&
          stubs.every((stub) => {
            const savedPath = stub.content.match(SAVED_PATH)?.[0];
            if (!savedPath) return false;
            const fullPath = join(desk.world.newsroom, savedPath);
            return existsSync(fullPath) && readFileSync(fullPath, "utf8") === stub.full;
          })
        );
      }),
    tryNext:
      "Write the full text to .desk/results/<toolCallId>.txt first, " +
      "then put that path in the stub, such as [trimmed: 512 characters, in .desk/results/x.txt].",
  },
] satisfies Rule[];
