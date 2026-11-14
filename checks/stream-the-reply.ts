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

// The service fails the first calls with a status, then answers. DESK_RETRY_MS keeps the waits short.
const flaky = (folder: string, name: string, failures: number, status: number) =>
  runs(folder, name, {
    args: ["-p", "Check the bridge draft."],
    env: { DESK_RETRY_MS: "40" },
    scenario: (world) => (_request, all) => {
      if (all.length <= failures) return { status, error: "The service is busy." };
      return { text: answer(world.nonce) };
    },
  });
const recovers = (folder: string) => flaky(folder, "retry-recovers", 2, 503);
const neverRecovers = (folder: string) => flaky(folder, "retry-gives-up", 99, 529);
const ourMistake = (folder: string) => flaky(folder, "retry-our-mistake", 99, 400);

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
  {
    says: "A busy service (503) is retried with a printed wait, and the run then finishes",
    test: (folder) =>
      every(recovers(folder), (desk) => {
        const waits = desk.stdout.match(/Retrying in \d+ ms/g) ?? [];
        const finished = desk.code === 0 && desk.stdout.includes(`End ${desk.world.nonce}`);
        return finished && desk.requests.length === 3 && waits.length === 2;
      }),
    tryNext:
      "Catch the error, check error.statusCode is 429 or 500 or more, print Retrying in N ms, " +
      "wait, and call again. Set maxRetries: 0 so the waits are yours.",
  },
  {
    says: "A service that never recovers is tried 4 times in all, then desk stops with exit 1",
    test: (folder) =>
      every(neverRecovers(folder), (desk) => {
        const stopped = desk.code === 1 && desk.stdout.includes("Stopped:");
        return stopped && desk.requests.length === 4 && !desk.timedOut;
      }),
    tryNext: "Give up after 3 retries: print a Stopped line and call process.exit(1).",
  },
  {
    says: "Our own mistake (400) is not retried",
    test: (folder) =>
      every(ourMistake(folder), (desk) => desk.requests.length === 1 && desk.code === 1),
    tryNext: "Retry only 429 and 500 or more. A 400 means the request is wrong, so asking again fails.",
  },
] satisfies Rule[];
