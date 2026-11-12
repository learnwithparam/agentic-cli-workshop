// cap-the-loop: desk stops at a turn cap or a budget cap, exits 3, says which, and prints the cost.
import type { Rule } from "../scripts/verify";
import { every, runs } from "./lib/harness";

// A model that never stops asking for tools. Without a cap this runs all night.
const endless = (dir: string, args: string[], name: string) =>
  runs(dir, name, {
    args: ["-p", "Check every draft.", ...args],
    // Fixed token counts, so the cost is known: 10,000 in and 1,000 out per call on the smart role.
    scenario: () => () => ({ tools: [{ name: "read_file", input: { path: "drafts/bridge-repairs.md" } }], usage: { input: 10_000, output: 1_000 } }),
  });
const turnCap = (d: string) => endless(d, ["--max-turns", "5"], "turn-cap");
const budgetCap = (d: string) => endless(d, ["--max-budget-usd", "0.05"], "budget-cap");

// The expected cost: 2 calls at 10,000 in and 1,000 out, priced by config/models.ts for the smart role.
async function expectedCost(): Promise<number> {
  const saved = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "replay";
  const { priceOf } = await import("../config/models");
  const p = priceOf("smart")!;
  if (saved === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = saved;
  return (2 * (10_000 * p.inputPerMillion + 1_000 * p.outputPerMillion)) / 1_000_000;
}

export default [
  {
    says: "With --max-turns 5 it stops after exactly 5 model calls",
    test: (d) => every(turnCap(d), (r) => r.requests.length === 5 && !r.timedOut),
    tryNext: "Count a turn after each call and check turns >= maxTurns before the next call, not after it.",
  },
  {
    says: "At the turn cap it exits with code 3 and prints error_max_turns",
    test: (d) => every(turnCap(d), (r) => r.code === 3 && r.stdout.includes("error_max_turns")),
    tryNext: "Print a line with error_max_turns and call process.exit(3). Code 3 tells a script a cap stopped the run.",
  },
  {
    says: "With --max-budget-usd 0.05 it stops after the call that crosses it, exits 3 and prints error_max_budget",
    test: (d) => every(budgetCap(d), (r) => r.requests.length === 2 && r.code === 3 && r.stdout.includes("error_max_budget")),
    tryNext: 'Add costUsd("smart", reply.usage) after every call and check cost >= maxBudgetUsd before the next one.',
  },
  {
    says: "It prints the cost, priced from config/models.ts, within one cent",
    test: async (d) => {
      const want = await expectedCost();
      return every(budgetCap(d), (r) => [...r.stdout.matchAll(/\$(\d+\.\d+)/g)].some((m) => Math.abs(Number(m[1]) - want) < 0.01));
    },
    tryNext: 'Print the running cost as $0.0000 in the stop line. Take the price from costUsd in "#models", never a number you type.',
  },
] satisfies Rule[];
