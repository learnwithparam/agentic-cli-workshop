// run-headless: with --output-format stream-json every stdout line is one event of the contract
// in checks/helpers/contract.schema.json, --output-format json prints only the result, and the
// exit code says how the run ended. Nothing ever waits for an answer.
import type { Rule } from "../scripts/verify";
import { answeredRuns, playTurns } from "./helpers/answered-runs";
import { contractEvents } from "./helpers/contract";
import { every, type Run } from "./lib/harness";

const NOTE = "Checked against the sources.";
const readBridge = { name: "read_file", input: { path: "drafts/bridge-repairs.md" } };
const fileBridge = { name: "file_story", input: { slug: "bridge-repairs", note: NOTE } };
const PROMPT = ["-p", "Check tonight's drafts."];
const STREAM = ["--output-format", "stream-json"];

const headless = (folder: string, name: string, flags: string[], calls = [readBridge]) =>
  answeredRuns(folder, `run-headless-${name}`, {
    args: [...PROMPT, ...flags],
    scenario: () => playTurns(calls.map((call) => [call])),
  });

const success = (folder: string) => headless(folder, "success", STREAM);
const neverAsk = (folder: string) =>
  headless(folder, "never-ask", [...STREAM, "--permission-mode", "never-ask"], [fileBridge]);
const acceptEdits = (folder: string) =>
  headless(folder, "accept-edits", [...STREAM, "--permission-mode", "accept-edits"], [fileBridge]);
const jsonOnly = (folder: string) => headless(folder, "json", ["--output-format", "json"]);
const capped = (folder: string) =>
  answeredRuns(folder, "run-headless-cap", {
    args: [...PROMPT, ...STREAM, "--max-turns", "2"],
    scenario: () => () => ({ tools: [readBridge] }),
  });
const broken = (folder: string) =>
  answeredRuns(folder, "run-headless-error", {
    args: [...PROMPT, ...STREAM],
    scenario: () => () => ({ status: 400, error: "The practice model was told to fail." }),
  });

const lastEvent = (desk: Run) => contractEvents(desk.stdout)?.at(-1);
const endsWith = (desk: Run, code: number, subtype: string) =>
  desk.code === code && lastEvent(desk)?.subtype === subtype;

export default [
  {
    says: "Every stream-json line is one JSON event that fits the contract",
    test: async (folder) => {
      const runs = [success, neverAsk, acceptEdits, capped].map((pending) => pending(folder));
      const results = await Promise.all(
        runs.map((pending) => every(pending, (desk) => contractEvents(desk.stdout) !== null)),
      );
      return results.every(Boolean);
    },
    tryNext:
      "With stream-json, print JSON.stringify(event) for every event and nothing else on stdout. " +
      "Write questions and the todo list to stderr.",
  },
  {
    says: "stream-json starts with init, has a tool_call and tool_result per call, and ends with result",
    test: (folder) =>
      every(success(folder), (desk) => {
        const types = (contractEvents(desk.stdout) ?? []).map((event) => event.type);
        const calls = types.filter((type) => type === "tool_call").length;
        const results = types.filter((type) => type === "tool_result").length;
        return types[0] === "init" && types.at(-1) === "result" && calls === 1 && results === 1;
      }),
    tryNext:
      "Call emit() for init at the start, for each tool call and result, and for result last.",
  },
  {
    says: "Exit codes: 0 on success, 3 at a cap, 4 for a denial in never-ask mode, 1 on an error",
    test: async (folder) => {
      const checks = [
        every(success(folder), (desk) => endsWith(desk, 0, "success")),
        every(capped(folder), (desk) => endsWith(desk, 3, "error_max_turns")),
        every(neverAsk(folder), (desk) => endsWith(desk, 4, "error_permission")),
        every(broken(folder), (desk) => endsWith(desk, 1, "error")),
      ];
      const results = await Promise.all(checks);
      return results.every(Boolean);
    },
    tryNext:
      'In exitCodeFor, return 1 for "error" and 4 for "error_permission". ' +
      "A script reads the code, not the words.",
  },
  {
    says: "--output-format json prints one line: the result",
    test: (folder) =>
      every(jsonOnly(folder), (desk) => {
        const events = contractEvents(desk.stdout);
        return events?.length === 1 && events[0].type === "result" && desk.code === 0;
      }),
    tryNext: 'With json, print only the result event, the one with type "result", on one line.',
  },
  {
    says: "With nobody at the terminal, a call that would ask is denied, and desk never waits",
    test: (folder) =>
      every(acceptEdits(folder), (desk) => {
        const filed = desk.world.cms.state().stories["bridge-repairs"].status === "filed";
        return !desk.timedOut && !filed && lastEvent(desk)?.type === "result";
      }),
    tryNext:
      "Read answers with the async line reader and write the question to stderr. " +
      "When stdin has no more lines, the answer is no.",
  },
] satisfies Rule[];
