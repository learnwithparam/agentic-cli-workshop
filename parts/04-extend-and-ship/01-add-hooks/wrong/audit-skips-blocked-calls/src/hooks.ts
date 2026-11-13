// Hooks: shell commands that desk.config.json names, run around every tool call.
//   pre_tool   runs before the tool. Exit code 2 blocks the call, and what the hook printed on
//              stderr is the reason the model reads.
//   post_tool  runs after the call, blocked calls too. It cannot change the result. It records.
// Each hook gets the call as JSON on stdin, and is stopped after 10 seconds. For example:
//   "hooks": { "pre_tool": [{ "match": "file_story", "command": "bun hooks/embargo-check.ts" }] }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Hook = { match: string; command: string };
// biome-ignore lint/style/useNamingConvention: desk.config.json uses these names
type HookSettings = { pre_tool?: Hook[]; post_tool?: Hook[] };

const root = process.cwd();
const HOOK_TIMEOUT_SECONDS = 10;
const BLOCK_EXIT_CODE = 2;

function loadHooks(): HookSettings {
  const configPath = join(root, "desk.config.json");
  if (!existsSync(configPath)) return {};
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return config.hooks ?? {};
}
const hooks = loadHooks();

// "*" matches every tool. Anything else matches one tool name.
const matching = (list: Hook[] | undefined, toolName: string) =>
  (list ?? []).filter((hook) => hook.match === "*" || hook.match === toolName);

function runHook(hook: Hook, call: unknown) {
  const finished = Bun.spawnSync(["bash", "-c", hook.command], {
    cwd: root,
    stdin: Buffer.from(JSON.stringify(call)),
    timeout: HOOK_TIMEOUT_SECONDS * 1000,
  });
  const reason = finished.stderr.toString().trim();
  return { exitCode: finished.exitCode, reason, timedOut: Boolean(finished.exitedDueToTimeout) };
}

// The reason a pre_tool hook blocks this call, or null when every hook lets it through.
export function blockedByHook(toolName: string, input: unknown): string | null {
  // biome-ignore lint/style/useNamingConvention: hooks read these field names
  const call = { tool_name: toolName, tool_input: input };
  for (const hook of matching(hooks.pre_tool, toolName)) {
    const ran = runHook(hook, call);
    // A hook that hangs must not hang the night. Stopping it denies the call, to be safe.
    if (ran.timedOut) {
      return `The hook "${hook.command}" ran for ${HOOK_TIMEOUT_SECONDS} seconds and was stopped.`;
    }
    if (ran.exitCode === BLOCK_EXIT_CODE) return ran.reason || `A hook blocked ${toolName}.`;
  }
  return null;
}

// Tell every post_tool hook what happened, such as an audit log that records each call.
export function recordAfterTool(
  toolName: string,
  input: unknown,
  output: { type: string; value: string },
) {
  // Only calls that worked are worth a line.
  if (output.type === "error-text") return;
  // biome-ignore-start lint/style/useNamingConvention: hooks read these field names
  const call = {
    tool_name: toolName,
    tool_input: input,
    is_error: output.type === "error-text",
    tool_result: output.value,
  };
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
  for (const hook of matching(hooks.post_tool, toolName)) runHook(hook, call);
}
