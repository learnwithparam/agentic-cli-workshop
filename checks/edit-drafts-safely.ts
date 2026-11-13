// edit-drafts-safely: edit_file changes exactly one piece of text in a file desk has read, and
// refuses an edit that is missing, ambiguous, blind or out of date.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { answeredRuns } from "./helpers/answered-runs";
import { every, plant, type Run, type World } from "./lib/harness";

const RIVER = "drafts/river-levels.md";
const BRIDGE = "drafts/bridge-repairs.md";
// biome-ignore lint/style/useNamingConvention: field names follow the edit_file tool
const FIX = { path: RIVER, old_text: "on 9 November", new_text: "on 10 November" };

// The river draft as it was before the run, saved per world, so a rule can compare.
const riverBefore = new Map<string, string>();

const editCall = (oldText: string, newText: string, path = RIVER) => ({
  name: "edit_file",
  // biome-ignore lint/style/useNamingConvention: field names follow the edit_file tool
  input: { path, old_text: oldText, new_text: newText },
});

function editTurns(world: World) {
  return [
    // An edit before any read: desk has never seen the file.
    editCall(FIX.old_text, FIX.new_text),
    { name: "read_file", input: { path: RIVER } },
    // Text that is not in the file, then text that is in it twice ("3.4 metres", "2.1 metres").
    editCall(`Peak ${world.nonce}`, "Peak"),
    editCall("metres", "meters"),
    editCall(FIX.old_text, FIX.new_text),
    { name: "read_file", input: { path: BRIDGE } },
    editCall("£4.2m", "£420,000", BRIDGE),
  ];
}

// Before the last edit, a reporter changes the bridge draft on disk.
function editScenario(world: World) {
  const turns = editTurns(world);
  return (_request: Request, allRequests: Request[]) => {
    const turnNumber = allRequests.length;
    if (turnNumber === turns.length) {
      plant(world, BRIDGE, `Late change by the reporter ${world.nonce}.`);
    }
    const call = turns[turnNumber - 1];
    if (call === undefined) return { text: "The river date is fixed." };
    return { tools: [call] };
  };
}

const editing = (folder: string) =>
  answeredRuns(folder, "edit-drafts-safely", {
    args: ["-p", "Fix the date in the river-levels draft."],
    setup: (world) => {
      plant(world, RIVER, `Desk check ${world.nonce}.`);
      riverBefore.set(world.nonce, readFileSync(join(world.newsroom, RIVER), "utf8"));
    },
    scenario: editScenario,
  });

// The result desk sent back for the nth edit_file call (counting from 0), read from the last
// request. Undefined when desk does not offer edit_file, or the call got no result.
function nthEditResult(desk: Run, position: number) {
  const offered = desk.requests[0]?.tools.some((tool) => tool.name === "edit_file");
  const last = desk.requests[desk.requests.length - 1];
  if (!offered || !last) return undefined;
  const blocks = last.messages.flatMap((message) => message.blocks);
  const edits = blocks.filter((block) => block.type === "tool_use" && block.name === "edit_file");
  const call = edits[position];
  if (call?.type !== "tool_use") return undefined;
  const result = blocks.find(
    (block) => block.type === "tool_result" && block.tool_use_id === call.id,
  );
  if (result?.type !== "tool_result") return undefined;
  return result;
}

const fileNow = (desk: Run, path: string) => readFileSync(join(desk.world.newsroom, path), "utf8");

export default [
  {
    says: "The planted fix lands, and every other byte of the draft stays the same",
    test: (folder) =>
      every(editing(folder), (desk) => {
        const before = riverBefore.get(desk.world.nonce) ?? "";
        const expected = before.replace(FIX.old_text, FIX.new_text);
        return before !== "" && fileNow(desk, RIVER) === expected;
      }),
    tryNext:
      "Split the text on old_text, check there are exactly two pieces, " +
      "and join them with new_text. Write the file once.",
  },
  {
    says: "An edit to a file desk has not read comes back as an error",
    test: (folder) => every(editing(folder), (desk) => nthEditResult(desk, 0)?.is_error === true),
    tryNext:
      "Keep a Map of the text each file had when read_file read it. " +
      "If the path is not in the Map, throw an error that says to use read_file first.",
  },
  {
    says: "An edit whose old text is not in the file comes back as an error",
    test: (folder) => every(editing(folder), (desk) => nthEditResult(desk, 1)?.is_error === true),
    tryNext: "Count how often old_text is in the file. At 0, throw an error that says so.",
  },
  {
    says: "An edit whose old text is in the file twice comes back as an error",
    test: (folder) => every(editing(folder), (desk) => nthEditResult(desk, 2)?.is_error === true),
    tryNext:
      "At 2 or more, throw an error that asks for nearby words, " +
      "so the model sends text that is there once.",
  },
  {
    says: "An edit to a file that changed since desk read it comes back as an error",
    test: (folder) =>
      every(editing(folder), (desk) => {
        const refused = nthEditResult(desk, 4)?.is_error === true;
        return refused && fileNow(desk, BRIDGE).includes("£4.2m");
      }),
    tryNext:
      "Before you edit, read the file again and compare it with the text saved at read time. " +
      "If they differ, throw an error that says to read it again.",
  },
  {
    says: "A good edit sends back a short diff with the old and new text, not the whole file",
    test: (folder) =>
      every(editing(folder), (desk) => {
        const result = nthEditResult(desk, 3);
        if (!result || result.is_error) return false;
        const hasBoth =
          result.content.includes(FIX.old_text) && result.content.includes(FIX.new_text);
        return hasBoth && result.content.length < 300;
      }),
    tryNext: 'Return "- " plus old_text and "+ " plus new_text, one per line.',
  },
] satisfies Rule[];
