// call-the-model: desk sends one prompt to the smart role and prints the reply.
import type { Rule } from "../scripts/verify";
import { every, runs, userText } from "./lib/harness";

const run = (dir: string) =>
  runs(dir, "call-the-model", {
    args: ["-p", "say ready"],
    scenario: (w) => () => ({ text: `Ready. Night desk check ${w.nonce}.` }),
  });

export default [
  {
    says: "It prints the practice model's reply and exits with code 0",
    test: (d) => every(run(d), (r) => r.code === 0 && r.stdout.includes(`Night desk check ${r.world.nonce}`)),
    tryNext: "Call generateText with your prompt and print result.text. Printing a fixed string will not match the reply.",
  },
  {
    says: "It sends one request with your prompt as the user message",
    test: (d) => every(run(d), (r) => r.requests.length === 1 && userText(r.requests[0]).trim() === "say ready"),
    tryNext: "Send the text after -p as the prompt, and call the model once.",
  },
  {
    says: "It asks config/models.ts for the smart role",
    test: (d) => every(run(d), (r) => r.requests[0]?.model === "practice-smart"),
    tryNext: 'Use model("smart") from "#models". The main loop is hard reasoning; the fast role is for cheap side calls.',
  },
  {
    says: "It sends no temperature",
    test: (d) => every(run(d), (r) => r.requests.length > 0 && r.requests.every((q) => q.raw.temperature === undefined)),
    tryNext: "Remove temperature from the call. Newer models can answer it with an error, and old tutorials still set it.",
  },
] satisfies Rule[];
