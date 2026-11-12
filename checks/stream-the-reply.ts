// stream-the-reply: desk asks for a stream and prints the reply piece by piece, once, while tools still work.
import type { Rule } from "../scripts/verify";
import { every, type Run, runs, toolResults } from "./lib/harness";

const answer = (nonce: string) =>
  `Start ${nonce}. Bridge figure checked against the council budget. River date checked against the readings. End ${nonce}.`;

// One tool call, then a reply that streams in six pieces, 150 milliseconds apart.
const stream = (dir: string) =>
  runs(dir, "stream-the-reply", {
    args: ["-p", "Check the bridge draft and tell me as you go."],
    scenario: (w) => (req) =>
      toolResults(req).length === 0
        ? { tools: [{ name: "read_file", input: { path: "drafts/bridge-repairs.md" } }] }
        : { text: answer(w.nonce), chunkDelayMs: 150 },
  });

// When did the screen first show this text? Read from the timed stdout pieces.
function firstSeen(r: Run, text: string): number | null {
  let soFar = "";
  for (const c of r.chunks) {
    soFar += c.text;
    if (soFar.includes(text)) return c.at;
  }
  return null;
}

export default [
  {
    says: "Every model call asks for a stream",
    test: (d) =>
      every(stream(d), (r) => r.requests.length === 2 && r.requests.every((q) => q.stream)),
    tryNext: "Call streamText instead of generateText. It sends stream: true and returns at once.",
  },
  {
    says: "The start of the reply is on screen well before its end arrives",
    test: (d) =>
      every(stream(d), (r) => {
        const start = firstSeen(r, `Start ${r.world.nonce}`);
        const end = firstSeen(r, `End ${r.world.nonce}`);
        return start !== null && end !== null && end - start >= 400;
      }),
    tryNext:
      "Write each piece of reply.textStream with process.stdout.write inside the for await loop. Do not wait for reply.text.",
  },
  {
    says: "The whole reply is printed exactly once",
    test: (d) => every(stream(d), (r) => r.stdout.split(answer(r.world.nonce)).length - 1 === 1),
    tryNext: "Print the pieces as they stream, and do not print reply.text again at the end.",
  },
  {
    says: "Tools still work: the tool result goes back and the run ends with code 0",
    test: (d) =>
      every(
        stream(d),
        (r) =>
          r.code === 0 &&
          toolResults(r.requests[1]).length === 1 &&
          !toolResults(r.requests[1])[0].is_error,
      ),
    tryNext:
      "After the stream ends, await reply.toolCalls and reply.responseMessages, then run the tools as before.",
  },
] satisfies Rule[];
