// Every failure line a check can print is in the troubleshooting table, so a learner can look it up.
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
  for (const s of allSteps()) {
    const rules = (await import(join(import.meta.dir, "..", "checks", `${s.name}.ts`))).default as {
      says: string;
    }[];
    for (const r of rules) if (!table.includes(r.says)) missing.push(`${s.name}: ${r.says}`);
  }
  expect(missing).toEqual([]);
});

test("every model role answers on the practice model", async () => {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "config", "models-check.ts")], {
    env: { ...process.env, LLM_PROVIDER: "replay", REPLAY_URL: "" },
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(out).toContain("Every role answers on replay.");
  expect(out).not.toMatch(/practice-(smart|fast|judge)/);
});
