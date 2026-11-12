// close-the-loop: desk keeps calling the model and running tools until the model stops asking.
import type { Rule } from "../scripts/verify";
import { every, plant, runs, toolResults, toolUses, type Request } from "./lib/harness";

const lastUserResults = (q: Request) => {
  const last = q.messages[q.messages.length - 1];
  return last?.role === "user" ? last.blocks.filter((b) => b.type === "tool_result") as ReturnType<typeof toolResults> : [];
};
const lastAssistantCalls = (q: Request) => {
  const a = [...q.messages].reverse().find((m) => m.role === "assistant");
  return (a?.blocks.filter((b) => b.type === "tool_use") ?? []) as ReturnType<typeof toolUses>;
};

// Four turns: one read, two tools at once, a tool that throws, then the answer.
const loop = (dir: string) =>
  runs(dir, "close-the-loop", {
    args: ["-p", "Read tonight's first drafts."],
    setup: (w) => {
      plant(w, "drafts/bridge-repairs.md", `First check ${w.nonce}.`);
      plant(w, "drafts/river-levels.md", `Second check ${w.nonce}.`);
    },
    scenario: (w) => (req, all) => {
      const n = all.length;
      if (n === 1) return { tools: [{ name: "read_file", input: { path: "drafts/bridge-repairs.md" } }] };
      if (n === 2)
        return {
          tools: [
            { name: "read_file", input: { path: "drafts/river-levels.md" } },
            { name: "list_files", input: { path: "sources" } },
          ],
        };
      if (n === 3) return { tools: [{ name: "list_files", input: { path: `archive-${w.nonce}` } }] };
      const r = toolResults(req);
      const ok = r.some((x) => x.content.includes(`First check ${w.nonce}`)) && r.some((x) => x.content.includes(`Second check ${w.nonce}`));
      return { text: ok ? `Loop closed ${w.nonce}. Two drafts read.` : "Some results never came back." };
    },
  });

export default [
  {
    says: "It keeps going until the model stops asking for tools: 4 calls, then the answer, exit code 0",
    test: (d) => every(loop(d), (r) => r.code === 0 && r.requests.length === 4 && r.stdout.includes(`Loop closed ${r.world.nonce}`)),
    tryNext: "Wrap the call in while (true). Break only when reply.toolCalls is empty, and print reply.text there.",
  },
  {
    says: "Two tool calls in one turn come back together, each paired with its call's id",
    test: (d) =>
      every(loop(d), (r) => {
        const q = r.requests[2];
        const calls = lastAssistantCalls(q);
        const results = lastUserResults(q);
        return calls.length === 2 && results.length === 2 && calls.every((c) => results.some((x) => x.tool_use_id === c.id && !x.is_error));
      }),
    tryNext: 'Run every call in reply.toolCalls and push one message with role "tool" holding all the results.',
  },
  {
    says: "A tool that throws comes back as an error result, and the loop carries on",
    test: (d) => every(loop(d), (r) => r.requests.length >= 4 && lastUserResults(r.requests[3]).some((x) => x.is_error)),
    tryNext: 'Wrap each runner in try and catch, and send the message back as output { type: "error-text", value }.',
  },
  {
    says: "Every tool call in the history has exactly one result",
    test: (d) =>
      every(loop(d), (r) => {
        const q = r.requests[r.requests.length - 1];
        const results = toolResults(q);
        return toolUses(q).length === 4 && toolUses(q).every((u) => results.filter((x) => x.tool_use_id === u.id).length === 1);
      }),
    tryNext: "Keep every message: push reply.responseMessages and the tool message each turn, and never drop or repeat one.",
  },
] satisfies Rule[];
