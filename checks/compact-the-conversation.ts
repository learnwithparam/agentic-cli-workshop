// compact-the-conversation: past the threshold in desk.config.json, desk saves the transcript,
// asks the fast role for a summary, and carries on from the summary with the open todo items and
// the desk rules still in view.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { answeredRuns } from "./helpers/answered-runs";
import { every, type Run, toolUses, userText, type World } from "./lib/harness";

const THRESHOLD_TOKENS = 1500;
const SMART_TURNS = 10;
const NOTES = "sources/research-notes.txt";

const todoList = (world: World) => [
  { text: `Check river-levels ${world.nonce}`, status: "in_progress" },
  { text: `Check bridge-repairs ${world.nonce}`, status: "pending" },
  { text: "Check library-hours", status: "done" },
];

// The model writes a todo list, then reads a 3,000-character file again and again. The summary
// it writes leaves the todo items out on purpose: desk must put them back itself.
function compactScenario(world: World) {
  let smartTurns = 0;
  return (request: Request) => {
    if (request.model === "practice-fast") return { text: `Summary ${world.nonce}: notes read.` };
    smartTurns++;
    if (smartTurns === 1)
      return { tools: [{ name: "todo_write", input: { todos: todoList(world) } }] };
    if (smartTurns > SMART_TURNS) return { text: "The notes are read." };
    return { tools: [{ name: "read_file", input: { path: NOTES } }] };
  };
}

const compacting = (folder: string) =>
  answeredRuns(folder, "compact-the-conversation", {
    args: ["-p", "Read the research notes several times."],
    setup: (world) => {
      // biome-ignore lint/style/useNamingConvention: desk.config.json uses this field name
      const config = { compact_at_tokens: THRESHOLD_TOKENS };
      writeFileSync(join(world.newsroom, "desk.config.json"), JSON.stringify(config));
      const line = `Research note ${world.nonce}: the river gauge at Brook Bridge.\n`;
      writeFileSync(join(world.newsroom, NOTES), line.repeat(50));
    },
    scenario: compactScenario,
  });

// The first summary request, and the requests just before and after it.
function aroundTheSummary(desk: Run) {
  const position = desk.requests.findIndex((request) => request.model === "practice-fast");
  if (position < 1) return null;
  return { before: desk.requests[position - 1], after: desk.requests[position + 1] };
}

function firstUserText(request: Request): string {
  const first = request.messages[0];
  if (first?.role !== "user") return "";
  return first.blocks.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

function savedTranscripts(desk: Run): string {
  const folder = join(desk.world.newsroom, ".desk", "transcripts");
  if (!existsSync(folder)) return "";
  const files = readdirSync(folder).map((fileName) => join(folder, fileName));
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

export default [
  {
    says: "Past the threshold, desk asks the fast role for a summary",
    test: (folder) => every(compacting(folder), (desk) => aroundTheSummary(desk) !== null),
    tryNext:
      'In compact() in src/context.ts, call generateText with model("fast") and SUMMARY_RULES. ' +
      "main.ts already calls compact() when the conversation passes the limit.",
  },
  {
    says: "The first request after the summary is under the threshold and starts with the summary",
    test: (folder) =>
      every(compacting(folder), (desk) => {
        const after = aroundTheSummary(desk)?.after;
        if (!after) return false;
        const tokens = Math.ceil(JSON.stringify(after.raw.messages).length / 4);
        return (
          tokens < THRESHOLD_TOKENS && firstUserText(after).includes(`Summary ${desk.world.nonce}`)
        );
      }),
    tryNext:
      "Make compact() return one user message with the summary first, " +
      "then the last two messages. main.ts puts them in place of the old ones.",
  },
  {
    says: "The open todo items are still in the request after the summary",
    test: (folder) =>
      every(compacting(folder), (desk) => {
        const after = aroundTheSummary(desk)?.after;
        const text = after ? userText(after) : "";
        const open = todoList(desk.world).filter((todo) => todo.status !== "done");
        return open.every((todo) => text.includes(todo.text));
      }),
    tryNext:
      "Do not trust the summary to keep the plan. Add openTodos() to the summary message yourself.",
  },
  {
    says: 'The desk rules, with "never name a person under 18", are still sent after the summary',
    test: (folder) =>
      every(compacting(folder), (desk) => {
        const after = aroundTheSummary(desk)?.after;
        return after?.system.includes("under 18") === true;
      }),
    tryNext:
      "Finish compact() first: this rule needs a summary to happen. Then leave the system " +
      "prompt alone, because compaction changes the messages only.",
  },
  {
    says: "The saved transcript holds every tool call from before the summary",
    test: (folder) =>
      every(compacting(folder), (desk) => {
        const before = aroundTheSummary(desk)?.before;
        const transcript = savedTranscripts(desk);
        const calls = before ? toolUses(before) : [];
        return calls.length > 0 && calls.every((call) => transcript.includes(call.id));
      }),
    tryNext:
      "Before you summarise, append every message to .desk/transcripts/<runId>.jsonl " +
      "as one JSON line each.",
  },
] satisfies Rule[];
