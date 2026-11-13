// add-hooks: pre_tool and post_tool hooks from desk.config.json run around every tool call. The
// shipped embargo hook blocks an embargoed filing, the audit hook logs every call, and a hook
// that hangs is stopped and the call denied.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { answeredRuns, cmsLog, playTurns, resultOf } from "./helpers/answered-runs";
import { every, type Run, type World } from "./lib/harness";

const HOOKS = join(import.meta.dir, "..", "parts", "04-extend-and-ship", "01-add-hooks", "hooks");
const NOTE = "Checked against the sources.";
const fileStory = (slug: string) => ({ name: "file_story", input: { slug, note: NOTE } });

function writeConfig(world: World, hooks: unknown) {
  const permissions = { allow: ["file_story"] };
  writeFileSync(join(world.newsroom, "desk.config.json"), JSON.stringify({ permissions, hooks }));
}

const shippedHooks = {
  // biome-ignore-start lint/style/useNamingConvention: desk.config.json uses these names
  pre_tool: [{ match: "file_story", command: `bun ${join(HOOKS, "embargo-check.ts")}` }],
  post_tool: [{ match: "*", command: `bun ${join(HOOKS, "audit-log.ts")}` }],
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
};

const withShippedHooks = (folder: string) =>
  answeredRuns(folder, "add-hooks", {
    args: ["-p", "File tonight's clean stories."],
    setup: (world) => writeConfig(world, shippedHooks),
    scenario: () =>
      playTurns([
        [{ name: "read_file", input: { path: "drafts/new-clinic-opening.md" } }],
        [fileStory("new-clinic-opening")],
        [fileStory("bridge-repairs")],
      ]),
  });

const withHangingHook = (folder: string) =>
  answeredRuns(folder, "add-hooks-hanging", {
    args: ["-p", "File the bridge story."],
    // biome-ignore lint/style/useNamingConvention: desk.config.json uses this name
    setup: (world) => writeConfig(world, { pre_tool: [{ match: "*", command: "sleep 60" }] }),
    scenario: () => playTurns([[fileStory("bridge-repairs")]]),
    timeoutMs: 40_000,
  });

const resultFor = (desk: Run, slug: string) =>
  resultOf(desk, "file_story", (input) => (input as { slug?: string }).slug === slug);

function auditLines(desk: Run): { tool?: string }[] {
  const auditPath = join(desk.world.newsroom, ".desk", "audit.jsonl");
  if (!existsSync(auditPath)) return [];
  const lines = readFileSync(auditPath, "utf8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

export default [
  {
    says: "The embargo hook stops new-clinic-opening before the CMS, and the model hears why",
    test: (folder) =>
      every(withShippedHooks(folder), (desk) => {
        const neverSent = cmsLog(desk, "/api/stories/new-clinic-opening/file").length === 0;
        const result = resultFor(desk, "new-clinic-opening");
        return neverSent && result?.is_error === true && result.content.includes("Embargoed");
      }),
    tryNext:
      "In blockedByHook, run each matching pre_tool hook. When it exits with code 2, return " +
      "what it printed on stderr. main.ts then blocks the call.",
  },
  {
    says: "A story with no embargo still files",
    test: (folder) =>
      every(withShippedHooks(folder), (desk) => {
        const story = desk.world.cms.state().stories["bridge-repairs"];
        return story.status === "filed";
      }),
    tryNext: "A hook that exits with code 0 lets the call through. Only code 2 blocks it.",
  },
  {
    says: "The audit hook writes one line per tool call, blocked calls too",
    test: (folder) =>
      every(withShippedHooks(folder), (desk) => {
        const tools = auditLines(desk).map((line) => line.tool);
        return JSON.stringify(tools) === JSON.stringify(["read_file", "file_story", "file_story"]);
      }),
    tryNext:
      "In recordAfterTool, run each matching post_tool hook with the call and its result " +
      "as JSON on stdin: tool_name, tool_input, is_error, tool_result.",
  },
  {
    says: "A hook that hangs is stopped within 15 seconds and the call is denied",
    test: (folder) =>
      every(withHangingHook(folder), (desk) => {
        const [first, second] = desk.requests;
        const stoppedInTime = second !== undefined && second.at - first.at < 15_000;
        const notFiled = desk.world.cms.state().stories["bridge-repairs"].status === "waiting";
        return stoppedInTime && notFiled && resultFor(desk, "bridge-repairs")?.is_error === true;
      }),
    tryNext:
      "Pass timeout: 10000 to Bun.spawnSync. When exitedDueToTimeout is true, " +
      "block the call with a reason that says the hook was stopped.",
  },
] satisfies Rule[];
