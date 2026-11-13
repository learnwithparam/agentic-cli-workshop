// A post_tool hook: it writes one JSON line per tool call to .desk/audit.jsonl in the newsroom.
// An audit log lets the night editor, or a regulator, replay what desk did and why.
// desk sends the call as JSON on stdin, with the result: tool_name, tool_input, is_error,
// tool_result. The log keeps the first 200 characters of the result.
// The supervisor may move this file to world/hooks/.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// biome-ignore-start lint/style/useNamingConvention: desk sends these field names
type HookCall = {
  tool_name?: string;
  tool_input?: unknown;
  is_error?: boolean;
  tool_result?: string;
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

const call: HookCall = await Bun.stdin.json();
const auditFolder = join(process.cwd(), ".desk");
mkdirSync(auditFolder, { recursive: true });
const line = {
  at: new Date().toISOString(),
  tool: call.tool_name,
  input: call.tool_input,
  error: call.is_error === true,
  result: (call.tool_result ?? "").slice(0, 200),
};
appendFileSync(join(auditFolder, "audit.jsonl"), `${JSON.stringify(line)}\n`);
