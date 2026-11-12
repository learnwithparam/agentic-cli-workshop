// bun run verify <step-name>            check your work on one step, then show progress
//                                       on every step
// bun run verify <step-name> solution   check the sample solution instead
// bun run verify part <part-name>      check every step in one part (a deliverable)
// bun run verify --report               write verify-report.json for cohort grading
// bun run verify --all                  CI: each check fails on its starter and wrong answers,
//                                       and passes on its solution
// Exit codes: 0 pass, 1 fail, 2 the check could not run.

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allSteps, findStep, parts, ROOT, type Step } from "./structure";

export type Rule = {
  says: string;
  test: (dir: string) => boolean | Promise<boolean>;
  tryNext: string;
};
type Result = {
  step: string;
  status: "pass" | "fail" | "error";
  passed: number;
  total: number;
  failed: string[];
};

async function rulesFor(step: Step): Promise<Rule[]> {
  const checkModule = await import(join(ROOT, "checks", `${step.name}.ts`));
  return checkModule.default;
}

// A rule that throws counts as a failed rule, not a crash.
async function rulePasses(rule: Rule, folder: string): Promise<boolean> {
  try {
    return await rule.test(folder);
  } catch {
    return false;
  }
}

function printRule(rule: Rule, passed: boolean) {
  if (passed) console.log(`  PASS  ${rule.says}`);
  else console.log(`  FAIL  ${rule.says}\n        Try next: ${rule.tryNext}`);
}

async function run(step: Step, folder: string, print = false): Promise<Result> {
  let rules: Rule[];
  try {
    rules = await rulesFor(step);
  } catch (error) {
    if (print) {
      const reason = (error as Error).message;
      console.log(`  ERROR  the check for ${step.name} could not load: ${reason}`);
    }
    return { step: step.name, status: "error", passed: 0, total: 0, failed: [] };
  }
  const failed: string[] = [];
  for (const rule of rules) {
    const passed = await rulePasses(rule, folder);
    if (!passed) failed.push(rule.says);
    if (print) printRule(rule, passed);
  }
  return {
    step: step.name,
    status: failed.length ? "fail" : "pass",
    passed: rules.length - failed.length,
    total: rules.length,
    failed,
  };
}

const learnerWork = (step: Step) => join(step.dir, "problem");
const wrongAnswers = (step: Step) => {
  const wrongFolder = join(step.dir, "wrong");
  if (!existsSync(wrongFolder)) return [];
  const mistakes = readdirSync(wrongFolder);
  return mistakes.map((mistake) => ({ name: mistake, dir: join(wrongFolder, mistake) }));
};
const countPassing = (results: Result[]) =>
  results.filter((result) => result.status === "pass").length;

function rulesWithoutTryNext(step: Step, rules: Rule[]): string[] {
  const problems: string[] = [];
  for (const rule of rules) {
    const tryNextWords = rule.tryNext.trim().split(/\s+/);
    if (tryNextWords.length < 3) {
      problems.push(`${step.name}: rule "${rule.says}" needs a try-next sentence`);
    }
  }
  return problems;
}

async function solutionProblems(step: Step): Promise<string[]> {
  if (!existsSync(join(step.dir, "solution"))) {
    return [`${step.name}: needs solution/ so CI can prove the check can pass`];
  }
  const solution = await run(step, join(step.dir, "solution"));
  if (solution.status === "pass") return [];
  return [`${step.name}: the sample solution fails: ${solution.failed.join("; ")}`];
}

async function wrongAnswerProblems(step: Step): Promise<string[]> {
  const problems: string[] = [];
  const wrong = wrongAnswers(step);
  if (wrong.length === 0) {
    problems.push(
      `${step.name}: needs at least one wrong/<mistake>/ answer that the check must reject`,
    );
  }
  for (const answer of wrong) {
    if ((await run(step, answer.dir)).status === "pass") {
      problems.push(`${step.name}: wrong answer "${answer.name}" passes the check`);
    }
  }
  return problems;
}

// What is wrong with one step's check, for --all. An empty list means the check is sound.
async function problemsWithCheck(step: Step, rules: Rule[]): Promise<string[]> {
  const problems = rulesWithoutTryNext(step, rules);
  if ((await run(step, learnerWork(step))).status === "pass") {
    problems.push(`${step.name}: the check passes on the starter, so it checks nothing`);
  }
  problems.push(...(await solutionProblems(step)));
  problems.push(...(await wrongAnswerProblems(step)));
  return problems;
}

async function verifyEveryCheck() {
  const problems: string[] = [];
  for (const step of allSteps()) {
    let rules: Rule[] = [];
    try {
      rules = await rulesFor(step);
    } catch (error) {
      problems.push(`${step.name}: the check could not load: ${(error as Error).message}`);
      continue;
    }
    problems.push(...(await problemsWithCheck(step, rules)));
  }
  for (const problem of problems) console.log(`  ${problem}`);
  console.log(
    problems.length
      ? `${problems.length} check problem(s).`
      : "Every check rejects its starter and wrong answers, and passes its solution.",
  );
  process.exit(problems.length ? 1 : 0);
}

async function writeReport() {
  const results: Result[] = [];
  for (const step of allSteps()) results.push(await run(step, learnerWork(step)));
  const reportPath = join(ROOT, "verify-report.json");
  const report = { version: 1, at: new Date().toISOString(), results };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Wrote verify-report.json: ${countPassing(results)} of ${results.length} steps pass.`,
  );
  process.exit(0);
}

function partExitCode(results: Result[]): number {
  if (results.some((result) => result.status === "error")) return 2;
  if (countPassing(results) === results.length) return 0;
  return 1;
}

async function verifyPart(partName: string | undefined) {
  const part = parts().find((candidate) => candidate.name === partName);
  if (!part) {
    console.log(partName ? `There is no part called "${partName}". Parts:` : "Name a part. Parts:");
    for (const knownPart of parts()) console.log(`  bun run verify part ${knownPart.name}`);
    process.exit(1);
  }
  console.log(`Part ${part.name}:`);
  const results: Result[] = [];
  for (const step of part.steps) {
    const result = await run(step, learnerWork(step));
    results.push(result);
    const status = result.status.toUpperCase().padEnd(5);
    console.log(`  ${status}  ${step.name}  (${result.passed}/${result.total} rules)`);
  }
  const done = countPassing(results);
  console.log(
    done === results.length
      ? `Part ${part.name} is done: ${done}/${results.length} steps pass.`
      : `${done}/${results.length} steps pass. ` +
          "Run bun run verify <step-name> on a FAIL line to see why.",
  );
  process.exit(partExitCode(results));
}

function listSteps(stepName: string | undefined): never {
  console.log(stepName ? `There is no step called "${stepName}". Steps:` : "Name a step. Steps:");
  for (const knownStep of allSteps()) console.log(`  bun run verify ${knownStep.name}`);
  process.exit(1);
}

// Done is recomputed from the checks every time, never read from a saved flag.
async function printProgress() {
  const everyResult: Result[] = [];
  for (const step of allSteps()) everyResult.push(await run(step, learnerWork(step)));
  console.log(`Progress: ${countPassing(everyResult)}/${everyResult.length} steps pass.`);
}

async function verifyStep(stepName: string | undefined, version: string | undefined) {
  const step = stepName && findStep(stepName);
  if (!step) return listSteps(stepName);
  const asSolution = version === "solution";
  console.log(`Checking ${step.name} (${asSolution ? "sample solution" : "your work"}):`);
  const folder = asSolution ? join(step.dir, "solution") : learnerWork(step);
  const result = await run(step, folder, true);
  if (result.status === "error") process.exit(2);
  console.log(
    result.status === "pass"
      ? `Done. All ${result.total} rules pass.`
      : `${result.passed} of ${result.total} rules pass. Fix the FAIL lines and run it again.`,
  );
  if (!asSolution) await printProgress();
  process.exit(result.status === "pass" ? 0 : 1);
}

const [command, secondArgument] = process.argv.slice(2);

if (command === "--all") await verifyEveryCheck();
else if (command === "--report") await writeReport();
else if (command === "part") await verifyPart(secondArgument);
else await verifyStep(command, secondArgument);
