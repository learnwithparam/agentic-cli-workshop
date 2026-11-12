// The checker library. A check starts the learner's CLI against a fresh world and the practice
// model, then reads what the world and the model saw: the requests, the CMS, the files, the exit
// code. It never trusts what the agent says about its own work.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Cms, startCms } from "../../world/cms/server";
import { resetNewsroom } from "../../world/lib/newsroom";
import {
  type PracticeModel,
  type Request,
  type Scenario,
  startPracticeModel,
} from "../../world/practice-model/server";

export type World = {
  root: string;
  newsroom: string;
  cms: Cms;
  nonce: string;
  cleanup: () => void;
};

// A short random word, different on every run, so a hard-coded answer cannot pass.
export function nonce(): string {
  const randomDigits = Math.random().toString(36);
  return randomDigits.slice(2, 8);
}

// A fresh newsroom in a temp folder, with its own CMS. Nothing a learner does touches
// world/newsroom.
export function makeWorld(): World {
  const root = mkdtempSync(join(tmpdir(), "desk-check-"));
  const newsroom = resetNewsroom(join(root, "newsroom"));
  const cms = startCms({ newsroom, stateFile: null });
  return {
    root,
    newsroom,
    cms,
    nonce: nonce(),
    cleanup: () => {
      cms.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type Output = { at: number; text: string };

export type Run = {
  code: number | null;
  stdout: string;
  stderr: string;
  chunks: Output[];
  requests: Request[];
  world: World;
  timedOut: boolean;
  started: number;
  ended: number;
};

type ExtraEnvironment =
  | Record<string, string>
  | ((world: World, modelUrl: string) => Record<string, string>);

export type RunOptions = {
  args: string[];
  scenario: (world: World) => Scenario;
  env?: ExtraEnvironment;
  setup?: (world: World) => void;
  timeoutMs?: number;
  // Keep the world for the caller to inspect; the caller must call run.world.cleanup().
  keep?: boolean;
};

// The learner's CLI: src/main.ts inside the step folder they are working in.
export const entry = (folder: string) => resolve(folder, "src", "main.ts");

function environmentFor(world: World, model: PracticeModel, extra?: ExtraEnvironment) {
  let extraEnvironment = extra;
  if (typeof extra === "function") extraEnvironment = extra(world, model.url);
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

// Read stdout piece by piece, noting when each piece arrived, so a check can judge streaming.
async function readTimedPieces(stdout: ReadableStream<Uint8Array>, chunks: Output[]) {
  const decoder = new TextDecoder();
  for await (const piece of stdout) chunks.push({ at: Date.now(), text: decoder.decode(piece) });
}

type Finished = Omit<Run, "requests" | "world" | "started" | "ended">;

// Start the CLI, wait for it to exit (or kill it at the time limit), and gather what it printed.
async function runCli(folder: string, options: RunOptions, world: World, model: PracticeModel) {
  const desk = Bun.spawn(["bun", entry(folder), ...options.args], {
    cwd: world.newsroom,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: environmentFor(world, model, options.env),
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    desk.kill();
  }, options.timeoutMs ?? 20_000);
  const chunks: Output[] = [];
  const readingStdout = readTimedPieces(desk.stdout, chunks);
  const readingStderr = new Response(desk.stderr).text();
  const exitCode = await desk.exited;
  const [, stderr] = await Promise.all([readingStdout, readingStderr]);
  clearTimeout(timer);
  const pieces = chunks.map((chunk) => chunk.text);
  const finished: Finished = {
    code: timedOut ? null : exitCode,
    stdout: pieces.join(""),
    stderr,
    chunks,
    timedOut,
  };
  return finished;
}

export async function runDesk(folder: string, options: RunOptions): Promise<Run> {
  const world = makeWorld();
  options.setup?.(world);
  const model = startPracticeModel({ scenario: options.scenario(world) });
  const started = Date.now();
  try {
    if (!existsSync(entry(folder))) throw new Error(`There is no ${entry(folder)}`);
    const finished = await runCli(folder, options, world, model);
    return { ...finished, requests: [...model.requests], world, started, ended: Date.now() };
  } finally {
    model.stop();
    if (!options.keep) world.cleanup();
  }
}

// Behaviour that depends on a model is judged over three fresh runs. Runs are cached per folder
// and scenario name, so the rules of one check share the same three runs.
const savedRuns = new Map<string, Promise<Run[]>>();

async function runSeveralTimes(folder: string, options: RunOptions, count: number) {
  const results: Run[] = [];
  for (let i = 0; i < count; i++) results.push(await runDesk(folder, options));
  return results;
}

export function runs(folder: string, name: string, options: RunOptions, count = 3) {
  const key = `${folder}::${name}`;
  let saved = savedRuns.get(key);
  if (saved === undefined) {
    saved = runSeveralTimes(folder, options, count);
    savedRuns.set(key, saved);
  }
  return saved;
}

// True when the test holds for every run. A test that throws counts as a failure.
export async function every(pendingRuns: Promise<Run[]>, test: (run: Run) => boolean) {
  const allRuns = await pendingRuns;
  return allRuns.every((run) => {
    try {
      return test(run);
    } catch {
      return false;
    }
  });
}

// Plant a line in a world file so a check can tell the learner's tool really read it.
export function plant(world: World, path: string, line: string) {
  const fullPath = join(world.newsroom, path);
  let before = "";
  if (existsSync(fullPath)) before = readFileSync(fullPath, "utf8");
  writeFileSync(fullPath, `${before}\n${line}\n`);
}

export { type Request, toolResults, toolUses, userText } from "../../world/practice-model/server";
