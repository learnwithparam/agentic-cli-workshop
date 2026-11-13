// bun run assignment: test every Done-when line of the assignment and write result.json.
// The grader runs this same file on your branch. Exit 0 when every line passes, 1 when not.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import rules, { promptfooVersion } from "../checks/assignment";

const folder = import.meta.dir;
const results: { line: string; result: "pass" | "fail" }[] = [];
for (const rule of rules) {
  let passed = false;
  try {
    passed = await rule.test(folder);
  } catch {
    passed = false;
  }
  console.log(`${passed ? "PASS" : "FAIL"}  ${rule.says}`);
  if (!passed) console.log(`      Try next: ${rule.tryNext}`);
  results.push({ line: rule.says, result: passed ? "pass" : "fail" });
}

const tool = { promptfoo: await promptfooVersion() };
writeFileSync(join(folder, "result.json"), `${JSON.stringify({ tool, results }, null, 2)}\n`);
const failed = results.filter((entry) => entry.result === "fail").length;
console.log(failed ? `${failed} line(s) fail. See assignment/result.json.` : "Every line passes.");
process.exit(failed ? 1 : 0);
