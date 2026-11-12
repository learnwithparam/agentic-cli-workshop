// call-the-model: desk sends one prompt to the smart role and prints the reply.
import type { Rule } from "../scripts/verify";
import { every, runs, userText } from "./lib/harness";

const run = (folder: string) =>
  runs(folder, "call-the-model", {
    args: ["-p", "say ready"],
    scenario: (world) => () => ({ text: `Ready. Night desk check ${world.nonce}.` }),
  });

export default [
  {
    says: "It prints the practice model's reply and exits with code 0",
    test: (folder) =>
      every(run(folder), (desk) => {
        const reply = `Night desk check ${desk.world.nonce}`;
        return desk.code === 0 && desk.stdout.includes(reply);
      }),
    tryNext:
      "Call generateText with your prompt and print result.text. " +
      "Printing a fixed string will not match the reply.",
  },
  {
    says: "It sends one request with your prompt as the user message",
    test: (folder) =>
      every(run(folder), (desk) => {
        const prompt = userText(desk.requests[0]).trim();
        return desk.requests.length === 1 && prompt === "say ready";
      }),
    tryNext: "Send the text after -p as the prompt, and call the model once.",
  },
  {
    says: "It asks config/models.ts for the smart role",
    test: (folder) => every(run(folder), (desk) => desk.requests[0]?.model === "practice-smart"),
    tryNext:
      'Use model("smart") from "#models". ' +
      "The main loop is hard reasoning; the fast role is for cheap side calls.",
  },
  {
    says: "It sends no temperature",
    test: (folder) =>
      every(run(folder), (desk) => {
        const noTemperature = desk.requests.every(
          (request) => request.raw.temperature === undefined,
        );
        return desk.requests.length > 0 && noTemperature;
      }),
    tryNext:
      "Remove temperature from the call. " +
      "Newer models can answer it with an error, and old tutorials still set it.",
  },
] satisfies Rule[];
