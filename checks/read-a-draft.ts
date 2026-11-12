// read-a-draft: desk offers a read_file tool, runs it when the model asks, and sends the text back paired by id.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { every, plant, runs, toolResults, toolUses, type World } from "./lib/harness";

const DRAFTS = ["bridge-repairs", "river-levels", "library-hours", "pool-reopening", "school-results"];
const pick = (w: World) => `drafts/${DRAFTS[w.nonce.charCodeAt(0) % DRAFTS.length]}.md`;

// The model asks for one draft. A check line planted in it proves the real file came back.
const readDraft = (dir: string) =>
  runs(dir, "read-a-draft", {
    args: ["-p", "What does tonight's draft say?"],
    setup: (w) => plant(w, pick(w), `Check line ${w.nonce}.`),
    scenario: (w) => (req) => {
      const results = toolResults(req);
      if (results.length === 0) return { tools: [{ name: "read_file", input: { path: pick(w) } }] };
      const got = results.some((r) => r.content.includes(`Check line ${w.nonce}`));
      return { text: got ? `The draft ends with check line ${w.nonce}.` : "I did not get the file back." };
    },
  });

// The model asks for a file outside the newsroom. desk must refuse it.
const escape = (dir: string) =>
  runs(dir, "read-outside", {
    args: ["-p", "Read the file next to the newsroom."],
    setup: (w) => writeFileSync(join(w.root, "outside.txt"), `SECRET ${w.nonce}`),
    scenario: () => (req) => (toolResults(req).length === 0 ? { tools: [{ name: "read_file", input: { path: "../outside.txt" } }] } : { text: "Done." }),
  });

export default [
  {
    says: "The first request offers a read_file tool whose schema needs a string path",
    test: (d) =>
      every(readDraft(d), (r) => {
        const t = r.requests[0].tools.find((x) => x.name === "read_file");
        return Boolean(t && t.description && t.schema?.properties?.path?.type === "string" && t.schema?.required?.includes("path"));
      }),
    tryNext: "Add read_file to tools with tool({ description, inputSchema: jsonSchema({ ... }) }) and list path in required.",
  },
  {
    says: "The second request sends the file text back as a tool result paired with the call's id",
    test: (d) =>
      every(readDraft(d), (r) => {
        const second = r.requests[1];
        const call = toolUses(second).find((u) => u.name === "read_file");
        const result = toolResults(second).find((x) => x.tool_use_id === call?.id);
        return Boolean(call && result && !result.is_error && result.content.includes(`Check line ${r.world.nonce}`));
      }),
    tryNext: 'Push a message with role "tool" and a "tool-result" part whose toolCallId is call.toolCallId, then call the model again.',
  },
  {
    says: "It prints the model's final answer",
    test: (d) => every(readDraft(d), (r) => r.code === 0 && r.stdout.includes(`check line ${r.world.nonce}`)),
    tryNext: "After the second call, print its text. The first call's text is empty when the model asked for a tool.",
  },
  {
    says: "A path outside the newsroom comes back as an error, and the file is not read",
    test: (d) =>
      every(escape(d), (r) => {
        const result = toolResults(r.requests[1] ?? r.requests[0])[0];
        return Boolean(result && result.is_error && !result.content.includes(`SECRET ${r.world.nonce}`));
      }),
    tryNext: 'Resolve the path against the newsroom folder and refuse it when relative(root, full) starts with "..". Send it back as error-text.',
  },
] satisfies Rule[];
