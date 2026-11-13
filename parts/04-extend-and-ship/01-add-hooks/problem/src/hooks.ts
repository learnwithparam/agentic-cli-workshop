// Hooks: shell commands that desk.config.json names, run around every tool call.
//   pre_tool   runs before the tool. Exit code 2 blocks the call, and what the hook printed on
//              stderr is the reason the model reads.
//   post_tool  runs after the call, blocked calls too. It cannot change the result. It records.
// Each hook gets the call as JSON on stdin, and is stopped after 10 seconds. For example:
//   "hooks": { "pre_tool": [{ "match": "file_story", "command": "bun hooks/embargo-check.ts" }] }

// TODO: read the hooks from desk.config.json ("hooks": { "pre_tool": [...], "post_tool": [...] }).
//       Run a hook with Bun.spawnSync(["bash", "-c", hook.command]) in the newsroom folder, with
//       the call as JSON on stdin and a timeout of 10 seconds. A hook matches when its "match"
//       is "*" or the tool's name.

// TODO: return the reason a pre_tool hook blocks this call: the hook's stderr when it exits
//       with code 2, or a line that says it was stopped when it timed out. Else return null.
export function blockedByHook(_toolName: string, _input: unknown): string | null {
  return null;
}

// TODO: run every matching post_tool hook with the call and its result:
//       { tool_name, tool_input, is_error, tool_result }.
export function recordAfterTool(
  _toolName: string,
  _input: unknown,
  _output: { type: string; value: string },
): void {}
