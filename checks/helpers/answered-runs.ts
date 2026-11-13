// A helper for the checks of touch-the-world-safely and later parts. It works like runs() in
// checks/lib/harness.ts, with two changes:
//   1. It can type answers into desk's stdin, the way the night editor answers a permission prompt.
//   2. It keeps each world until the check ends, so a rule can read the CMS and the files after
//      the run.
// The supervisor may move it into checks/lib/.

import { type PracticeModel, startPracticeModel } from "../../world/practice-model/server";
import {
  entry,
  makeWorld,
  type Output,
  type Run,
  type RunOptions,
  type World,
} from "../lib/harness";

export type AnsweredOptions = Omit<RunOptions, "keep"> & {
  // What the night editor types, one answer per line, such as "n\n".
  answers?: string;
};

// Every world made here is removed when the check process ends.
const keptWorlds: World[] = [];
process.on("exit", () => {
  for (const world of keptWorlds) world.cleanup();
});

function environmentFor(world: World, model: PracticeModel, options: AnsweredOptions) {
  let extraEnvironment = options.env;
  if (typeof extraEnvironment === "function") extraEnvironment = extraEnvironment(world, model.url);
  return {
    ...process.env,
    // biome-ignore-start lint/style/useNamingConvention: the shell fixes these names
    LLM_PROVIDER: "replay",
    REPLAY_URL: model.url,
    CMS_URL: world.cms.url,
    NO_COLOR: "1",
    // biome-ignore-end lint/style/useNamingConvention: back to our own names
    ...extraEnvironment,
  };
}

async function readPieces(stdout: ReadableStream<Uint8Array>, chunks: Output[]) {
  const decoder = new TextDecoder();
  for await (const piece of stdout) chunks.push({ at: Date.now(), text: decoder.decode(piece) });
}

// Start desk with the answers on stdin, wait for it to end (or stop it at the time limit).
async function runCli(
  folder: string,
  options: AnsweredOptions,
  world: World,
  model: PracticeModel,
) {
  const desk = Bun.spawn(["bun", entry(folder), ...options.args], {
    cwd: world.newsroom,
    stdin: new Blob([options.answers ?? ""]),
    stdout: "pipe",
    stderr: "pipe",
    env: environmentFor(world, model, options),
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    desk.kill();
  }, options.timeoutMs ?? 20_000);
  const chunks: Output[] = [];
  const readingStdout = readPieces(desk.stdout, chunks);
  const readingStderr = new Response(desk.stderr).text();
  const exitCode = await desk.exited;
  const [, stderr] = await Promise.all([readingStdout, readingStderr]);
  clearTimeout(timer);
  const stdout = chunks.map((chunk) => chunk.text).join("");
  return { code: timedOut ? null : exitCode, stdout, stderr, chunks, timedOut };
}

async function runOnce(folder: string, options: AnsweredOptions): Promise<Run> {
  const world = makeWorld();
  keptWorlds.push(world);
  options.setup?.(world);
  const model = startPracticeModel({ scenario: options.scenario(world) });
  const started = Date.now();
  try {
    const finished = await runCli(folder, options, world, model);
    return { ...finished, requests: [...model.requests], world, started, ended: Date.now() };
  } finally {
    model.stop();
  }
}

async function runSeveralTimes(folder: string, options: AnsweredOptions, count: number) {
  const results: Run[] = [];
  for (let i = 0; i < count; i++) results.push(await runOnce(folder, options));
  return results;
}

// Three fresh runs, cached per folder and name, so the rules of one check share them.
const savedRuns = new Map<string, Promise<Run[]>>();

export function answeredRuns(folder: string, name: string, options: AnsweredOptions, count = 3) {
  const key = `${folder}::${name}`;
  let saved = savedRuns.get(key);
  if (saved === undefined) {
    saved = runSeveralTimes(folder, options, count);
    savedRuns.set(key, saved);
  }
  return saved;
}

// The result desk sent back for the first call to a tool with this input, read from the last
// request the practice model got. Undefined when that call never got a result.
export function resultOf(run: Run, toolName: string, matches: (input: unknown) => boolean) {
  const last = run.requests[run.requests.length - 1];
  if (!last) return undefined;
  const blocks = last.messages.flatMap((message) => message.blocks);
  const call = blocks.find(
    (block) => block.type === "tool_use" && block.name === toolName && matches(block.input),
  );
  if (call?.type !== "tool_use") return undefined;
  const result = blocks.find(
    (block) => block.type === "tool_result" && block.tool_use_id === call.id,
  );
  if (result?.type !== "tool_result") return undefined;
  return result;
}

// The requests the CMS logged for one path, such as /api/stories/bridge-repairs/file.
export function cmsLog(run: Run, path: string) {
  return run.world.cms.state().log.filter((line) => line.path === path);
}

// A scenario that plays a fixed list of turns, one per request, then a final answer.
export function playTurns(turns: { name: string; input: unknown }[][]) {
  return (_request: unknown, allRequests: unknown[]) => {
    const turn = turns[allRequests.length - 1];
    if (turn === undefined) return { text: "Done for tonight." };
    return { tools: turn };
  };
}
