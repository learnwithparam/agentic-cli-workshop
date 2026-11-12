// read-a-draft: desk offers a read_file tool, runs it when the model asks, and sends the text back
// paired by id.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { every, plant, runs, toolResults, toolUses, type World } from "./lib/harness";

const DRAFTS = [
  "bridge-repairs",
  "river-levels",
  "library-hours",
  "pool-reopening",
  "school-results",
];

// Each world picks one draft from its nonce, so the learner cannot hard-code the path.
function pickDraft(world: World): string {
  const index = world.nonce.charCodeAt(0) % DRAFTS.length;
  return `drafts/${DRAFTS[index]}.md`;
}

// The model asks for one draft. A check line planted in it proves the real file came back.
const readDraft = (folder: string) =>
  runs(folder, "read-a-draft", {
    args: ["-p", "What does tonight's draft say?"],
    setup: (world) => plant(world, pickDraft(world), `Check line ${world.nonce}.`),
    scenario: (world) => (request) => {
      const results = toolResults(request);
      if (results.length === 0) {
        return { tools: [{ name: "read_file", input: { path: pickDraft(world) } }] };
      }
      const got = results.some((result) => result.content.includes(`Check line ${world.nonce}`));
      if (got) return { text: `The draft ends with check line ${world.nonce}.` };
      return { text: "I did not get the file back." };
    },
  });

// The model asks for a file outside the newsroom. desk must refuse it.
const readOutside = (folder: string) =>
  runs(folder, "read-outside", {
    args: ["-p", "Read the file next to the newsroom."],
    setup: (world) => writeFileSync(join(world.root, "outside.txt"), `SECRET ${world.nonce}`),
    scenario: () => (request) => {
      if (toolResults(request).length > 0) return { text: "Done." };
      return { tools: [{ name: "read_file", input: { path: "../outside.txt" } }] };
    },
  });

export default [
  {
    says: "The first request offers a read_file tool whose schema needs a string path",
    test: (folder) =>
      every(readDraft(folder), (desk) => {
        const readFile = desk.requests[0].tools.find((tool) => tool.name === "read_file");
        return Boolean(
          readFile?.description &&
            readFile.schema?.properties?.path?.type === "string" &&
            readFile.schema?.required?.includes("path"),
        );
      }),
    tryNext:
      "Add read_file to tools with tool({ description, inputSchema: jsonSchema({ ... }) }) " +
      "and list path in required.",
  },
  {
    says: "The second request sends the file text back as a tool result paired with the call's id",
    test: (folder) =>
      every(readDraft(folder), (desk) => {
        const second = desk.requests[1];
        const call = toolUses(second).find((use) => use.name === "read_file");
        const result = toolResults(second).find((answer) => answer.tool_use_id === call?.id);
        return Boolean(
          call &&
            result &&
            !result.is_error &&
            result.content.includes(`Check line ${desk.world.nonce}`),
        );
      }),
    tryNext:
      'Push a message with role "tool" and a "tool-result" part whose toolCallId is ' +
      "call.toolCallId, then call the model again.",
  },
  {
    says: "It prints the model's final answer",
    test: (folder) =>
      every(readDraft(folder), (desk) => {
        const answer = `check line ${desk.world.nonce}`;
        return desk.code === 0 && desk.stdout.includes(answer);
      }),
    tryNext:
      "After the second call, print its text. " +
      "The first call's text is empty when the model asked for a tool.",
  },
  {
    says: "A path outside the newsroom comes back as an error, and the file is not read",
    test: (folder) =>
      every(readOutside(folder), (desk) => {
        const result = toolResults(desk.requests[1] ?? desk.requests[0])[0];
        const leaked = result?.content.includes(`SECRET ${desk.world.nonce}`);
        return Boolean(result?.is_error && !leaked);
      }),
    tryNext:
      "Resolve the path against the newsroom folder and refuse it when " +
      'relative(root, full) starts with "..". Send it back as error-text.',
  },
] satisfies Rule[];
