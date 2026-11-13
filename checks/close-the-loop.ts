// close-the-loop: desk keeps calling the model and running tools until the model stops asking.
import type { Rule } from "../scripts/verify";
import { every, plant, type Request, runs, toolResults, toolUses } from "./lib/harness";

// The tool results in the newest message, when that message is from the user.
function lastUserResults(request: Request) {
  const last = request.messages[request.messages.length - 1];
  if (last?.role !== "user") return [];
  const results = last.blocks.filter((block) => block.type === "tool_result");
  return results as ReturnType<typeof toolResults>;
}

// The tool calls in the newest message from the model.
function lastAssistantCalls(request: Request) {
  const newestFirst = [...request.messages].reverse();
  const reply = newestFirst.find((message) => message.role === "assistant");
  const calls = reply?.blocks.filter((block) => block.type === "tool_use") ?? [];
  return calls as ReturnType<typeof toolUses>;
}

// The fourth call's answer says whether both planted lines came back in the tool results.
function finalAnswer(request: Request, nonce: string) {
  const results = toolResults(request);
  const ok =
    results.some((result) => result.content.includes(`First check ${nonce}`)) &&
    results.some((result) => result.content.includes(`Second check ${nonce}`));
  if (ok) return { text: `Loop closed ${nonce}. Two drafts read.` };
  return { text: "Some results never came back." };
}

// Four turns: one read, two tools at once, a tool that throws, then the answer.
const loop = (folder: string) =>
  runs(folder, "close-the-loop", {
    args: ["-p", "Read tonight's first drafts."],
    setup: (world) => {
      plant(world, "drafts/bridge-repairs.md", `First check ${world.nonce}.`);
      plant(world, "drafts/river-levels.md", `Second check ${world.nonce}.`);
    },
    scenario: (world) => (request, allRequests) => {
      const turn = allRequests.length;
      if (turn === 1)
        return { tools: [{ name: "read_file", input: { path: "drafts/bridge-repairs.md" } }] };
      if (turn === 2)
        return {
          tools: [
            { name: "read_file", input: { path: "drafts/river-levels.md" } },
            { name: "list_files", input: { path: "sources" } },
          ],
        };
      if (turn === 3)
        return { tools: [{ name: "list_files", input: { path: `archive-${world.nonce}` } }] };
      return finalAnswer(request, world.nonce);
    },
  });

export default [
  {
    says:
      "It keeps going until the model stops asking for tools: " +
      "4 calls, then the answer, exit code 0",
    test: (folder) =>
      every(
        loop(folder),
        (desk) =>
          desk.code === 0 &&
          desk.requests.length === 4 &&
          desk.stdout.includes(`Loop closed ${desk.world.nonce}`),
      ),
    tryNext:
      "Wrap the call in while (true). " +
      "Break only when reply.toolCalls is empty, and print reply.text there.",
  },
  {
    says: "Two tool calls in one turn come back together, each paired with its call's id",
    test: (folder) =>
      every(loop(folder), (desk) => {
        const third = desk.requests[2];
        const calls = lastAssistantCalls(third);
        const results = lastUserResults(third);
        const eachCallAnswered = calls.every((call) =>
          results.some((result) => result.tool_use_id === call.id && !result.is_error),
        );
        return calls.length === 2 && results.length === 2 && eachCallAnswered;
      }),
    tryNext:
      'Run every call in reply.toolCalls and push one message with role "tool" ' +
      "holding all the results.",
  },
  {
    says: "A tool that throws comes back as an error result, and the loop carries on",
    test: (folder) =>
      every(loop(folder), (desk) => {
        if (desk.requests.length < 4) return false;
        return lastUserResults(desk.requests[3]).some((result) => result.is_error);
      }),
    tryNext:
      "Wrap each runner in try and catch, " +
      'and send the message back as output { type: "error-text", value }.',
  },
  {
    says: "Every tool call in the history has exactly one result",
    test: (folder) =>
      every(loop(folder), (desk) => {
        const last = desk.requests[desk.requests.length - 1];
        const calls = toolUses(last);
        const results = toolResults(last);
        const resultCount = (callId: string) =>
          results.filter((result) => result.tool_use_id === callId).length;
        return calls.length === 4 && calls.every((call) => resultCount(call.id) === 1);
      }),
    tryNext:
      "Keep every message: push reply.responseMessages and the tool message each turn, " +
      "and never drop or repeat one.",
  },
] satisfies Rule[];
