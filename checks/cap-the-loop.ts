// cap-the-loop: desk stops at a turn cap or a budget cap, exits 3, says which, and prints the
// cost.
import type { Rule } from "../scripts/verify";
import { every, runs } from "./lib/harness";

// A model that never stops asking for tools. Without a cap this runs all night.
const endless = (folder: string, args: string[], name: string) =>
  runs(folder, name, {
    args: ["-p", "Check every draft.", ...args],
    // Fixed token counts, so the cost is known: 10,000 in and 1,000 out per call on the smart role.
    scenario: () => () => ({
      tools: [{ name: "read_file", input: { path: "drafts/bridge-repairs.md" } }],
      usage: { input: 10_000, output: 1_000 },
    }),
  });
const turnCap = (folder: string) => endless(folder, ["--max-turns", "5"], "turn-cap");
const budgetCap = (folder: string) => endless(folder, ["--max-budget-usd", "0.05"], "budget-cap");

// The expected cost: 2 calls at 10,000 in and 1,000 out, priced by config/models.ts for the smart
// role.
async function expectedCost(): Promise<number> {
  const saved = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "replay";
  const { priceOf } = await import("../config/models");
  const price = priceOf("smart");
  if (saved === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = saved;
  if (price === null) throw new Error("config/models.ts has no price for the smart role");
  const oneCall = 10_000 * price.inputPerMillion + 1_000 * price.outputPerMillion;
  return (2 * oneCall) / 1_000_000;
}

// Every dollar amount printed, such as $0.0450, as a number.
function dollarAmounts(stdout: string): number[] {
  const matches = [...stdout.matchAll(/\$(\d+\.\d+)/g)];
  return matches.map((match) => Number(match[1]));
}

export default [
  {
    says: "With --max-turns 5 it stops after exactly 5 model calls",
    test: (folder) =>
      every(turnCap(folder), (desk) => desk.requests.length === 5 && !desk.timedOut),
    tryNext:
      "Count a turn after each call " +
      "and check turns >= maxTurns before the next call, not after it.",
  },
  {
    says: "At the turn cap it exits with code 3 and prints error_max_turns",
    test: (folder) =>
      every(turnCap(folder), (desk) => desk.code === 3 && desk.stdout.includes("error_max_turns")),
    tryNext:
      "Print a line with error_max_turns and call process.exit(3). " +
      "Code 3 tells a script a cap stopped the run.",
  },
  {
    says:
      "With --max-budget-usd 0.05 it stops after the call that crosses it, " +
      "exits 3 and prints error_max_budget",
    test: (folder) =>
      every(budgetCap(folder), (desk) => {
        const stoppedAfterTwo = desk.requests.length === 2 && desk.code === 3;
        return stoppedAfterTwo && desk.stdout.includes("error_max_budget");
      }),
    tryNext:
      'Add costUsd("smart", reply.usage) after every call ' +
      "and check cost >= maxBudgetUsd before the next one.",
  },
  {
    says: "It prints the cost, priced from config/models.ts, within one cent",
    test: async (folder) => {
      const want = await expectedCost();
      return every(budgetCap(folder), (desk) =>
        dollarAmounts(desk.stdout).some((amount) => Math.abs(amount - want) < 0.01),
      );
    },
    tryNext:
      "Print the running cost as $0.0000 in the stop line. " +
      'Take the price from costUsd in "#models", never a number you type.',
  },
] satisfies Rule[];
