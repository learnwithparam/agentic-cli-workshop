// The assignment rules: score desk with promptfoo. They read the learner's promptfooconfig.yaml,
// run the pinned promptfoo on it, and compare its pass count with the hand-built score. The
// recording in assignment/recorded.json makes the run free and the same every time.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { answerKey } from "../world/lib/newsroom";

export const PROMPTFOO_VERSION = "0.125.1";
const ROOT = join(import.meta.dir, "..");

type Test = { vars?: { slug?: string }; assert?: unknown[] };
type Config = { defaultTest?: { assert?: unknown[] }; tests?: Test[] };
type EvalRun = { exitCode: number; successes: number; failures: number; errors: number };

// Run the pinned promptfoo, with no key and no telemetry, and return what it printed.
async function promptfoo(folder: string, args: string[]) {
  const command = ["npx", "--yes", `promptfoo@${PROMPTFOO_VERSION}`, ...args];
  // biome-ignore lint/style/useNamingConvention: the tool fixes these variable names
  const env = { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1", PROMPTFOO_DISABLE_UPDATE: "1" };
  const child = Bun.spawn(command, { cwd: folder, env, stdout: "pipe", stderr: "pipe" });
  const printed = await new Response(child.stdout).text();
  return { printed: printed.trim(), exitCode: await child.exited };
}

let versionFound: Promise<string> | undefined;
export function promptfooVersion(): Promise<string> {
  versionFound ??= promptfoo(ROOT, ["--version"]).then((result) => result.printed);
  return versionFound;
}

const evalRuns = new Map<string, Promise<EvalRun>>();
function evalRun(folder: string): Promise<EvalRun> {
  const cached = evalRuns.get(folder);
  if (cached) return cached;
  const started = (async () => {
    const outputFolder = mkdtempSync(join(tmpdir(), "promptfoo-"));
    const outputPath = join(outputFolder, "results.json");
    const args = ["eval", "-c", "promptfooconfig.yaml", "--no-cache", "-o", outputPath];
    const { exitCode } = await promptfoo(folder, args);
    const stats = JSON.parse(readFileSync(outputPath, "utf8")).results.stats;
    rmSync(outputFolder, { recursive: true });
    return { exitCode, successes: stats.successes, failures: stats.failures, errors: stats.errors };
  })();
  evalRuns.set(folder, started);
  return started;
}

function readConfig(folder: string): Config {
  return Bun.YAML.parse(readFileSync(join(folder, "promptfooconfig.yaml"), "utf8")) as Config;
}

// Every draft in the answer key is one task, and each task needs an assertion of its own or one
// shared through defaultTest.
function everyTaskHasAnAssertion(folder: string): boolean {
  const config = readConfig(folder);
  const shared = config.defaultTest?.assert?.length ?? 0;
  const tests = config.tests ?? [];
  return Object.keys(answerKey().drafts).every((slug) => {
    const task = tests.find((test) => test.vars?.slug === slug);
    return task !== undefined && shared + (task.assert?.length ?? 0) > 0;
  });
}

// The hand-built scorer's count of drafts it scores as fully right, saved with the recording.
function handBuiltPasses(): number {
  const recordedPath = join(ROOT, "assignment", "recorded.json");
  return JSON.parse(readFileSync(recordedPath, "utf8")).handBuilt.draftsClean;
}

export default [
  {
    says: `promptfoo reports ${PROMPTFOO_VERSION}`,
    test: async () => (await promptfooVersion()) === PROMPTFOO_VERSION,
    tryNext: `Run it as npx promptfoo@${PROMPTFOO_VERSION} so the version is pinned.`,
  },
  {
    says: "Every course task has at least one assertion",
    test: (folder) => everyTaskHasAnAssertion(folder),
    tryNext:
      "Add one test per draft in world/seed/answer-key.json, and give each one an assert " +
      "or share one through defaultTest.",
  },
  {
    says: "The run exits zero and its pass count matches the hand-built score",
    test: async (folder) => {
      const finished = await evalRun(folder);
      const matches = finished.successes === handBuiltPasses();
      return finished.exitCode === 0 && finished.failures === 0 && matches;
    },
    tryNext:
      "Run npx promptfoo@0.125.1 eval in your folder. Each draft that bun run score counts as " +
      "caught must pass, so check your assertion against the CMS rules.",
  },
] satisfies Rule[];
