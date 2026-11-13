// resume-a-session: desk saves every message to .desk/sessions/<id>.jsonl as it happens. The check
// stops desk with SIGTERM in the middle of a run, then starts it again with --resume <id> (or
// --continue) in the same newsroom, and reads what the model and the CMS saw.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { cmsLog, runInWorld, stopDesk } from "./helpers/answered-runs";
import { makeWorld, type Run, toolUses, type World } from "./lib/harness";

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
] satisfies Rule[];
