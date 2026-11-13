// run-commands: run_command runs a shell command in the newsroom folder, stops one that hangs,
// cuts long output with a note, and reports a failed command as an error.
import { realpathSync } from "node:fs";
import type { Rule } from "../scripts/verify";
import { answeredRuns, playTurns, resultOf } from "./helpers/answered-runs";
import { every, plant, type Run, type World } from "./lib/harness";

const SUM_COMMAND =
  "awk -F, 'NR > 1 { total += $4 } END { print total }' sources/school-results.csv";
const LONG_COMMAND = "seq 1 20000";
const HANGING_COMMAND = "sleep 60";
const FAILING_COMMAND = "cat sources/no-such-file.csv";

// The pupils who passed, as the seed file has them: 117 + 51 + 91.
const PASSED_IN_SEED = 259;

// A fresh school row per world, so the right sum is different on every run.
function plantedPasses(world: World): number {
  return (Number.parseInt(world.nonce, 36) % 80) + 10;
}

// How many characters `seq 1 20000` prints, less the 20,000 desk keeps.
function charactersToCut(): number {
  let printed = 0;
  for (let number = 1; number <= 20_000; number++) printed += `${number}\n`.length;
  return printed - 20_000;
}

const command = (text: string) => [{ name: "run_command", input: { command: text } }];

const commands = (folder: string) =>
  answeredRuns(folder, "run-commands", {
    args: ["-p", "Work out the school pass numbers."],
    setup: (world) => {
      const row = `Riverside College ${world.nonce},100,90,${plantedPasses(world)},50`;
      plant(world, "sources/school-results.csv", row);
    },
    scenario: () =>
      playTurns([
        command(HANGING_COMMAND),
        command(LONG_COMMAND),
        command(SUM_COMMAND),
        command("pwd"),
        command(FAILING_COMMAND),
      ]),
    timeoutMs: 40_000,
  });

const resultFor = (desk: Run, text: string) =>
  resultOf(desk, "run_command", (input) => (input as { command?: string }).command === text);

export default [
  {
    says: "A command that hangs is stopped within 10 seconds and comes back as an error",
    test: (folder) =>
      every(commands(folder), (desk) => {
        const [first, second] = desk.requests;
        const offered = first.tools.some((tool) => tool.name === "run_command");
        const stoppedInTime = second !== undefined && second.at - first.at < 10_000;
        return offered && stoppedInTime && resultFor(desk, HANGING_COMMAND)?.is_error === true;
      }),
    tryNext:
      "Pass timeout: 5000 to Bun.spawnSync. When exitedDueToTimeout is true, " +
      "throw an error that says the command was stopped.",
  },
  {
    says: "Output over 20,000 characters is cut, with a note of how many characters were cut",
    test: (folder) =>
      every(commands(folder), (desk) => {
        const content = resultFor(desk, LONG_COMMAND)?.content ?? "";
        const shortEnough = content.length >= 20_000 && content.length < 20_500;
        return shortEnough && content.includes(String(charactersToCut()));
      }),
    tryNext:
      "Keep output.slice(0, 20000) and add a line with output.length - 20000, " +
      "the number of characters you cut.",
  },
  {
    says: "The awk sum over sources/school-results.csv comes back right",
    test: (folder) =>
      every(commands(folder), (desk) => {
        const result = resultFor(desk, SUM_COMMAND);
        const rightSum = String(PASSED_IN_SEED + plantedPasses(desk.world));
        return result?.is_error === false && result.content.trim() === rightSum;
      }),
    tryNext:
      'Run the command with Bun.spawnSync(["bash", "-c", command]) and send back ' +
      "what it printed on stdout.",
  },
  {
    says: "Commands run in the newsroom folder",
    test: (folder) =>
      every(commands(folder), (desk) => {
        const printed = resultFor(desk, "pwd")?.content.trim() ?? "";
        return printed !== "" && realpathSync(printed) === realpathSync(desk.world.newsroom);
      }),
    tryNext: "Pass cwd: root to Bun.spawnSync, where root is process.cwd(), the newsroom folder.",
  },
  {
    says: "A command that fails comes back as an error with what it printed",
    test: (folder) =>
      every(commands(folder), (desk) => {
        const result = resultFor(desk, FAILING_COMMAND);
        return result?.is_error === true && result.content.includes("No such file");
      }),
    tryNext:
      "When exitCode is not 0, throw an error with the exit code " +
      "and the stdout and stderr together.",
  },
] satisfies Rule[];
