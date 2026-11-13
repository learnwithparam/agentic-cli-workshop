// Every failure line a check can print is in the troubleshooting table, so a learner can look it
// up.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allSteps } from "../scripts/structure";

const table = readFileSync(
  join(import.meta.dir, "..", "00-orientation", "troubleshooting.md"),
  "utf8",
);

test("every check rule is in 00-orientation/troubleshooting.md", async () => {
  const missing: string[] = [];
  for (const step of allSteps()) {
    const checkFile = join(import.meta.dir, "..", "checks", `${step.name}.ts`);
    const rules: { says: string }[] = (await import(checkFile)).default;
    for (const rule of rules) {
      if (!table.includes(rule.says)) missing.push(`${step.name}: ${rule.says}`);
    }
  }
  expect(missing).toEqual([]);
});

test("every model role answers on the practice model", async () => {
  const modelsCheck = Bun.spawn(["bun", join(import.meta.dir, "..", "config", "models-check.ts")], {
    // biome-ignore lint/style/useNamingConvention: the shell fixes these names
    env: { ...process.env, LLM_PROVIDER: "replay", REPLAY_URL: "" },
    stdout: "pipe",
  });
  const printed = await new Response(modelsCheck.stdout).text();
  expect(await modelsCheck.exited).toBe(0);
  expect(printed).toContain("Every role answers on replay.");
  expect(printed).not.toMatch(/practice-(smart|fast|judge)/);
});
