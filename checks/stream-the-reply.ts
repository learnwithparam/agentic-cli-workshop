// stream-the-reply: desk asks for a stream and prints the reply piece by piece, once, while tools
// still work.
import type { Rule } from "../scripts/verify";
import { every, type Run, runs, toolResults } from "./lib/harness";

const answer = (nonce: string) =>
  `Start ${nonce}. Bridge figure checked against the council budget. ` +
  `River date checked against the readings. End ${nonce}.`;

// One tool call, then a reply that streams in six pieces, 150 milliseconds apart.
const stream = (folder: string) =>
  runs(folder, "stream-the-reply", {
    args: ["-p", "Check the bridge draft and tell me as you go."],
    scenario: (world) => (request) => {
      if (toolResults(request).length > 0) return { text: answer(world.nonce), chunkDelayMs: 150 };
      return { tools: [{ name: "read_file", input: { path: "drafts/bridge-repairs.md" } }] };
    },
  });

// When did the screen first show this text? Read from the timed stdout pieces.
function firstSeen(desk: Run, text: string): number | null {
  let soFar = "";
  for (const chunk of desk.chunks) {
    soFar += chunk.text;
    if (soFar.includes(text)) return chunk.at;
  }
  return null;
}

export default [
  {
    says: "Every model call asks for a stream",
    test: (folder) =>
      every(stream(folder), (desk) => {
        const allStreamed = desk.requests.every((request) => request.stream);
        return desk.requests.length === 2 && allStreamed;
      }),
    tryNext: "Call streamText instead of generateText. It sends stream: true and returns at once.",
  },
  {
    says: "The start of the reply is on screen well before its end arrives",
    test: (folder) =>
      every(stream(folder), (desk) => {
        const start = firstSeen(desk, `Start ${desk.world.nonce}`);
        const end = firstSeen(desk, `End ${desk.world.nonce}`);
        return start !== null && end !== null && end - start >= 400;
      }),
    tryNext:
      "Write each piece of reply.textStream with process.stdout.write inside the for await loop. " +
      "Do not wait for reply.text.",
  },
  {
    says: "The whole reply is printed exactly once",
    test: (folder) =>
      every(stream(folder), (desk) => {
        const pieces = desk.stdout.split(answer(desk.world.nonce));
        return pieces.length - 1 === 1;
      }),
    tryNext: "Print the pieces as they stream, and do not print reply.text again at the end.",
  },
  {
    says: "Tools still work: the tool result goes back and the run ends with code 0",
    test: (folder) =>
      every(stream(folder), (desk) => {
        const results = toolResults(desk.requests[1]);
        return desk.code === 0 && results.length === 1 && !results[0].is_error;
      }),
    tryNext:
      "After the stream ends, await reply.toolCalls and reply.responseMessages, " +
      "then run the tools as before.",
  },
] satisfies Rule[];
