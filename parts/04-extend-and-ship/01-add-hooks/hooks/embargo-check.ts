// A pre_tool hook for file_story: it blocks a story whose embargo has not passed yet.
// desk sends the call as JSON on stdin, such as
//   { "tool_name": "file_story", "tool_input": { "slug": "new-clinic-opening", ... } }
// Exit 0 lets the call through. Exit 2 blocks it, and what this prints on stderr is the reason.
// It runs in the newsroom folder, so it reads the draft from there.
// The supervisor may move this file to world/hooks/.
import { readDraft, WORLD_NOW } from "../../../../world/lib/newsroom";

// biome-ignore lint/style/useNamingConvention: desk sends these field names
type HookCall = { tool_name?: string; tool_input?: { slug?: string } };

const call: HookCall = await Bun.stdin.json();
const slug = call.tool_input?.slug;
if (call.tool_name !== "file_story" || !slug) process.exit(0);

const draft = readDraft(slug, process.cwd());
const embargo = draft?.embargo;
if (embargo && embargo > WORLD_NOW) {
  console.error(`Embargoed until ${embargo}. It cannot go out tonight. Use hold_story instead.`);
  process.exit(2);
}
process.exit(0);
