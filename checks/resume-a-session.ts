// resume-a-session: desk saves every message to .desk/sessions/<id>.jsonl as it happens. The check
// stops desk with SIGTERM in the middle of a run, then starts it again with --resume <id> (or
// --continue) in the same newsroom, and reads what the model and the CMS saw.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { answeredRuns, cmsLog, runInWorld, stopDesk } from "./helpers/answered-runs";
import { every, makeWorld, type Run, toolResults, toolUses, type World } from "./lib/harness";

const NOTE = "Checked against the sources.";
const read = (slug: string) => ({ name: "read_file", input: { path: `drafts/${slug}.md` } });
const file = (slug: string) => ({ name: "file_story", input: { slug, note: NOTE } });
const PLAN = [
  read("bridge-repairs"),
  file("bridge-repairs"),
  read("river-levels"),
  read("library-hours"),
  read("pool-reopening"),
  file("river-levels"),
  read("school-results"),
];
const STOP_AT_REQUEST = 6;

// The model works through PLAN and skips any step already in the conversation, so a run that
// resumes with its history goes on where it stopped.
function planScenario(world: World, stopEarly: boolean) {
  let requestsSeen = 0;
  return (request: Request) => {
    requestsSeen++;
    if (stopEarly && requestsSeen === STOP_AT_REQUEST) stopDesk(world);
    const done = new Set(toolUses(request).map((use) => JSON.stringify(use.input)));
    const next = PLAN.find((step) => !done.has(JSON.stringify(step.input)));
    if (!next) return { text: "Every planned story is checked." };
    return { tools: [next] };
  };
}

function sessionIds(world: World): string[] {
  const folder = join(world.newsroom, ".desk", "sessions");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).map((name) => name.replace(".jsonl", ""));
}

type Pair = { first: Run; second: Run; savedText: string };

// One stopped run, then a second run in the same world with the given flags.
async function stopThenRestart(folder: string, restartFlags: (world: World) => string[]) {
  const world = makeWorld();
  process.on("exit", () => world.cleanup());
  const args = ["-p", "Check tonight's drafts.", "--permission-mode", "accept-edits"];
  const first = await runInWorld(
    folder,
    { args, scenario: () => planScenario(world, true), answers: "a\n" },
    world,
  );
  const [sessionId] = sessionIds(world);
  const sessionPath = join(world.newsroom, ".desk", "sessions", `${sessionId}.jsonl`);
  const savedText = sessionId && existsSync(sessionPath) ? readFileSync(sessionPath, "utf8") : "";
  const secondArgs = [
    "-p",
    "Carry on.",
    "--permission-mode",
    "accept-edits",
    ...restartFlags(world),
  ];
  const second = await runInWorld(
    folder,
    { args: secondArgs, scenario: () => planScenario(world, false), answers: "a\n" },
    world,
  );
  return { first, second, savedText } as Pair;
}

const savedPairs = new Map<string, Promise<Pair[]>>();

function pairs(folder: string, how: "resume" | "continue") {
  const key = `${folder}::${how}`;
  let saved = savedPairs.get(key);
  if (!saved) {
    const flags = (world: World) => {
      if (how === "continue") return ["--continue"];
      return ["--resume", sessionIds(world)[0] ?? "missing"];
    };
    saved = (async () => {
      const results: Pair[] = [];
      for (let i = 0; i < 3; i++) results.push(await stopThenRestart(folder, flags));
      return results;
    })();
    savedPairs.set(key, saved);
  }
  return saved;
}

async function everyPair(
  folder: string,
  how: "resume" | "continue",
  test: (pair: Pair) => boolean,
) {
  const all = await pairs(folder, how);
  return all.every((pair) => {
    try {
      return test(pair);
    } catch {
      return false;
    }
  });
}

// The tool call ids the model saw by the time desk was stopped.
const idsBeforeStop = (pair: Pair) =>
  toolUses(pair.first.requests[pair.first.requests.length - 1]).map((use) => use.id);

const firstRequestHasHistory = (pair: Pair) => {
  const firstRequest = pair.second.requests[0];
  const resumedIds = toolUses(firstRequest).map((use) => use.id);
  const ids = idsBeforeStop(pair);
  return ids.length >= 4 && ids.every((id) => resumedIds.includes(id));
};

// Interrupt: the night editor presses Ctrl-C while the model is working on its fourth call.
const interrupted = (folder: string) =>
  answeredRuns(folder, "resume-interrupt", {
    args: ["-p", "Check tonight's drafts.", "--permission-mode", "accept-edits"],
    scenario: (world) => (request: Request) => {
      const seen = toolUses(request).length;
      if (seen === 3) stopDesk(world, "SIGINT");
      return { tools: [PLAN[seen]] };
    },
  });

type Saved = { role: string; content: { type: string; toolCallId?: string }[] | string };
function savedMessages(world: World): Saved[] {
  const folder = join(world.newsroom, ".desk", "sessions");
  const [file] = existsSync(folder) ? readdirSync(folder) : [];
  if (!file) return [];
  const lines = readFileSync(join(folder, file), "utf8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}
const idsIn = (messages: Saved[], role: string, type: string) =>
  messages
    .filter((message) => message.role === role && Array.isArray(message.content))
    .flatMap((message) => message.content as { type: string; toolCallId?: string }[])
    .filter((part) => part.type === type)
    .map((part) => part.toolCallId);

// A session written by hand: the prompt, then some finished turns. With dangling, the last turn
// asked for a tool and never got its result, as when a laptop shuts mid-call.
function writeSession(world: World, turns: number, dangling: boolean) {
  const lines: unknown[] = [{ role: "user", content: "Check tonight's drafts." }];
  for (let i = 1; i <= turns; i++) {
    const call = { type: "tool-call", toolCallId: `call${i}`, toolName: "read_file" };
    const input = { path: "drafts/bridge-repairs.md" };
    lines.push({ role: "assistant", content: [{ ...call, input }] });
    if (dangling && i === turns) break;
    const output = { type: "text", value: "A draft." };
    lines.push({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: `call${i}`, toolName: "read_file", output }],
    });
  }
  const folder = join(world.newsroom, ".desk", "sessions");
  mkdirSync(folder, { recursive: true });
  const text = lines.map((line) => JSON.stringify(line)).join("\n");
  writeFileSync(join(folder, "made.jsonl"), `${text}\n`);
}

const answerOnly = () => () => ({ text: "Carrying on." });
const danglingRun = (folder: string) =>
  answeredRuns(folder, "resume-dangling", {
    args: ["-p", "Carry on.", "--resume", "made"],
    setup: (world) => writeSession(world, 3, true),
    scenario: answerOnly,
  });
const rewoundRun = (folder: string) =>
  answeredRuns(folder, "resume-rewind", {
    args: ["-p", "Try another way.", "--resume", "made", "--rewind", "1"],
    setup: (world) => writeSession(world, 3, false),
    scenario: answerOnly,
  });

export default [
  {
    says: "Each message is saved at once: after the stop, the session file holds the run so far",
    test: (folder) =>
      everyPair(folder, "resume", (pair) => {
        const stopped = pair.first.code !== 0;
        const ids = idsBeforeStop(pair);
        return stopped && ids.length >= 4 && ids.every((id) => pair.savedText.includes(id));
      }),
    tryNext:
      "In save(), append each message to .desk/sessions/<id>.jsonl with appendFileSync " +
      "as soon as it is added. Saving at the end loses everything when desk is stopped.",
  },
  {
    says: "--resume <id> sends the saved history in its first request",
    test: (folder) => everyPair(folder, "resume", firstRequestHasHistory),
    tryNext:
      "With --resume, read the session file line by line with JSON.parse and start messages " +
      "with that history, then add the new prompt.",
  },
  {
    says: "After the resumed run, each story was filed once, never twice",
    test: (folder) =>
      everyPair(folder, "resume", (pair) => {
        const bridge = cmsLog(pair.second, "/api/stories/bridge-repairs/file");
        const river = cmsLog(pair.second, "/api/stories/river-levels/file");
        const once = bridge.length === 1 && river.length === 1;
        return once && [...bridge, ...river].every((line) => line.status === 200);
      }),
    tryNext:
      "Load the whole history, tool results too, so the model sees the filing it already made " +
      "and does not make it again.",
  },
  {
    says: "--continue picks up the newest session",
    test: (folder) => everyPair(folder, "continue", firstRequestHasHistory),
    tryNext:
      "With --continue, list .desk/sessions/, sort the files by the time they last changed, " +
      "and load the newest one.",
  },
  {
    says: "Ctrl-C stops desk with exit 130 and prints how to resume the session",
    test: (folder) =>
      every(interrupted(folder), (desk) => {
        const [id] = readdirSync(join(desk.world.newsroom, ".desk", "sessions"));
        const named = id !== undefined && desk.stdout.includes(id.replace(".jsonl", ""));
        return desk.code === 130 && desk.stdout.includes("Interrupted") && named;
      }),
    tryNext:
      'Listen with process.on("SIGINT"). Set a flag, finish the step, print Interrupted and ' +
      "the --resume id, and exit with 130.",
  },
  {
    says: "After Ctrl-C every tool call in the saved session has a result",
    test: (folder) =>
      every(interrupted(folder), (desk) => {
        const messages = savedMessages(desk.world);
        const calls = idsIn(messages, "assistant", "tool-call");
        const results = idsIn(messages, "tool", "tool-result");
        return calls.length >= 3 && calls.every((id) => results.includes(id));
      }),
    tryNext:
      "Before you exit, add an error result for each tool call the model just asked for, " +
      "so the saved session is one the API accepts.",
  },
  {
    says: "A session cut off between a tool call and its result is repaired when it is resumed",
    test: (folder) =>
      every(danglingRun(folder), (desk) => {
        const first = desk.requests[0];
        if (!first) return false;
        const answered = toolResults(first).map((result) => result.tool_use_id);
        return desk.code === 0 && toolUses(first).every((use) => answered.includes(use.id));
      }),
    tryNext:
      "After loading the history, look at the last assistant message. If a tool call in it has " +
      "no result, drop that message before the first call.",
  },
  {
    says: "--rewind 1 drops the last turn from what the model sees and from the saved file",
    test: (folder) =>
      every(rewoundRun(folder), (desk) => {
        const first = desk.requests[0];
        if (!first) return false;
        const ids = toolUses(first).map((use) => use.id);
        const saved = readFileSync(
          join(desk.world.newsroom, ".desk", "sessions", "made.jsonl"),
          "utf8",
        );
        return ids.length === 2 && !ids.includes("call3") && !saved.includes("call3");
      }),
    tryNext:
      "Cut the history at the start of the last assistant message, then rewrite the session " +
      "file from what is left. The next resume must not bring the dropped turn back.",
  },
] satisfies Rule[];
