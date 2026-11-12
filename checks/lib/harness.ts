// The checker library. A check starts the learner's CLI against a fresh world and the practice model,
// then reads what the world and the model saw: the requests, the CMS, the files, the exit code.
// It never trusts what the agent says about its own work.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startCms, type Cms } from "../../world/cms/server";
import { resetNewsroom } from "../../world/lib/newsroom";
import { startPracticeModel, type Request, type Scenario } from "../../world/practice-model/server";

export type World = { root: string; newsroom: string; cms: Cms; nonce: string; cleanup: () => void };

export const nonce = () => Math.random().toString(36).slice(2, 8);

// A fresh newsroom in a temp folder, with its own CMS. Nothing a learner does touches world/newsroom.
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

export type RunOptions = {
  args: string[];
  scenario: (w: World) => Scenario;
  env?: Record<string, string> | ((w: World, modelUrl: string) => Record<string, string>);
  setup?: (w: World) => void;
  timeoutMs?: number;
  // Keep the world for the caller to inspect; the caller must call run.world.cleanup().
  keep?: boolean;
};

// The learner's CLI: src/main.ts inside the step folder they are working in.
export const entry = (dir: string) => resolve(dir, "src", "main.ts");

export async function runDesk(dir: string, o: RunOptions): Promise<Run> {
  const world = makeWorld();
  o.setup?.(world);
  const model = startPracticeModel({ scenario: o.scenario(world) });
  const started = Date.now();
  const chunks: Output[] = [];
  let stderr = "";
  let timedOut = false;
  try {
    if (!existsSync(entry(dir))) throw new Error(`There is no ${entry(dir)}`);
    const proc = Bun.spawn(["bun", entry(dir), ...o.args], {
      cwd: world.newsroom,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        LLM_PROVIDER: "replay",
        REPLAY_URL: model.url,
        CMS_URL: world.cms.url,
        NO_COLOR: "1",
        ...(typeof o.env === "function" ? o.env(world, model.url) : o.env),
      },
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, o.timeoutMs ?? 20_000);
    const dec = new TextDecoder();
    const readOut = (async () => {
      for await (const c of proc.stdout as ReadableStream<Uint8Array>) chunks.push({ at: Date.now(), text: dec.decode(c) });
    })();
    const readErr = (async () => {
      stderr = await new Response(proc.stderr).text();
    })();
    const code = await proc.exited;
    await Promise.all([readOut, readErr]);
    clearTimeout(timer);
    const run: Run = { code: timedOut ? null : code, stdout: chunks.map((c) => c.text).join(""), stderr, chunks, requests: [...model.requests], world, timedOut, started, ended: Date.now() };
    return run;
  } finally {
    model.stop();
    if (!o.keep) world.cleanup();
  }
}

// Behaviour that depends on a model is judged over three fresh runs. Runs are cached per folder and
// scenario name, so the rules of one check share the same three runs.
const cache = new Map<string, Promise<Run[]>>();
export function runs(dir: string, name: string, o: RunOptions, n = 3): Promise<Run[]> {
  const key = `${dir}::${name}`;
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
        const out: Run[] = [];
        for (let i = 0; i < n; i++) out.push(await runDesk(dir, o));
        return out;
      })(),
    );
  return cache.get(key)!;
}

export const every = async (p: Promise<Run[]>, test: (r: Run) => boolean) => (await p).every((r) => {
  try {
    return test(r);
  } catch {
    return false;
  }
});

// Plant a line in a world file so a check can tell the learner's tool really read it.
export function plant(w: World, path: string, line: string) {
  const p = join(w.newsroom, path);
  writeFileSync(p, `${existsSync(p) ? readFileSync(p, "utf8") : ""}\n${line}\n`);
}

export { type Request } from "../../world/practice-model/server";
export { toolResults, toolUses, userText } from "../../world/practice-model/server";
