// bun run check: the repo standard. CI runs this; any failure stops the build.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { allSteps, type Part, parts, ROOT, type Step } from "./structure";

const errors: string[] = [];
const fail = (where: string, problem: string) =>
  errors.push(`${relative(ROOT, where) || "."}: ${problem}`);
const read = (path: string) => readFileSync(path, "utf8");

const STEP_SECTIONS = [
  "## The problem",
  "## Your challenge",
  "## Done when",
  "## If you get stuck",
  "## Words you will use",
];
const HYPE_WORDS = [
  "supercharge",
  "unleash",
  "unlock",
  "seamless(ly)?",
  "leverage",
  "dive into",
  "game[- ]changer",
  "revolutioni[sz]e",
  "magic(al)?",
  "cutting[- ]edge",
  "AI-powered",
];
const HYPE = new RegExp(`\\b(${HYPE_WORDS.join("|")})\\b`, "i");
const TIME_WORDS = /\b(week|day|hour)\s+\d+\b/i;
const VERB_THING = /^[a-z]+(-[a-z0-9]+)+$/;

// 1. No Makefile anywhere.
function listFiles(folder: string, found: string[] = []): string[] {
  for (const entry of readdirSync(folder)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) listFiles(path, found);
    else found.push(path);
  }
  return found;
}
const files = listFiles(ROOT);
const markdownFiles = () => files.filter((file) => file.endsWith(".md"));
for (const file of files) {
  if (/(^|\/)(GNU)?[Mm]akefile$/.test(file)) {
    fail(file, "a Makefile is not allowed; use a Bun or uv script");
  }
}

// 2. Prose rules on every Markdown file.
function checkProseLine(file: string, line: string, lineNumber: number) {
  if (line.includes("—")) fail(file, `line ${lineNumber}: em dash`);
  const hype = line.match(HYPE);
  if (hype) fail(file, `line ${lineNumber}: hype word "${hype[0]}"`);
  const timeWord = line.match(TIME_WORDS);
  if (timeWord && !file.includes("schedules")) {
    fail(file, `line ${lineNumber}: "${timeWord[0]}"; content is in parts, schedules map time`);
  }
  if (/\bM=\d+|verify \d+/.test(line)) {
    fail(file, `line ${lineNumber}: numeric step command; name the step`);
  }
}
for (const file of markdownFiles()) {
  const lines = read(file).split("\n");
  for (let i = 0; i < lines.length; i++) checkProseLine(file, lines[i], i + 1);
}

// 2b. Every page shows, not only tells: images it names exist, and the key pages carry a picture.
const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const MERMAID = /```mermaid\n/;
const hasImage = (text: string) => [...text.matchAll(IMAGE)].length > 0;
for (const file of markdownFiles()) {
  for (const image of read(file).matchAll(IMAGE)) {
    const imagePath = image[1];
    if (/^https?:/.test(imagePath)) continue;
    if (!existsSync(join(dirname(file), imagePath))) {
      fail(file, `image "${imagePath}" does not exist`);
    }
  }
}
type PictureNeeds = { description: string; mermaid: boolean; image: boolean };
const needPicture = (file: string, needs: PictureNeeds) => {
  if (!existsSync(file)) return fail(file, "missing");
  const text = read(file);
  if (needs.mermaid && !MERMAID.test(text))
    fail(file, `${needs.description} needs a Mermaid diagram`);
  if (needs.image && !hasImage(text)) fail(file, `${needs.description} needs a screenshot`);
};
needPicture(join(ROOT, "README.md"), {
  description: "the root README",
  mermaid: true,
  image: true,
});
needPicture(join(ROOT, "00-orientation", "README.md"), {
  description: "the orientation",
  mermaid: false,
  image: true,
});

// 3. Parts and steps.
function checkPartReadme(part: Part, readme: string) {
  if (!existsSync(readme)) {
    fail(part.dir, "part has no README.md");
    return;
  }
  const text = read(readme);
  if (!MERMAID.test(text)) fail(readme, "part README needs a Mermaid diagram");
  const walkthrough = text.split("## Walkthrough")[1]?.split("\n## ")[0];
  if (walkthrough === undefined) {
    fail(readme, `part README needs a "## Walkthrough" section`);
  } else if (!walkthrough.includes("```bash")) {
    fail(readme, "the walkthrough needs the commands, each with an Expect: line");
  }
}

function checkStepNameAndSettings(step: Step, seenNames: Set<string>) {
  if (!VERB_THING.test(step.name)) {
    fail(step.dir, `step name "${step.name}" must be verb-thing in lower case`);
  }
  if (seenNames.has(step.name)) fail(step.dir, `step name "${step.name}" is used twice`);
  seenNames.add(step.name);
  if (!existsSync(join(step.dir, "step.toml"))) fail(step.dir, "missing step.toml");
  const minutes = step.meta.minutes;
  if (minutes < 5 || minutes > 30) {
    fail(step.dir, `step is ${minutes} min; keep a step between 5 and 30, split it if longer`);
  }
}

function checkStepReadme(step: Step, readme: string) {
  const text = read(readme);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > 600) fail(readme, `${words} words; a step README stays under 600, split the step`);
  for (const heading of STEP_SECTIONS) {
    if (!text.includes(heading)) fail(readme, `missing section "${heading}"`);
  }
  if (!MERMAID.test(text) && !hasImage(text)) {
    fail(readme, "a step shows a picture: a screenshot or a Mermaid diagram");
  }
  const doneWhen = text.split("## Done when")[1]?.split("\n## ")[0] ?? "";
  if (!/^- /m.test(doneWhen)) fail(readme, "Done when needs at least one bullet");
  if (step.meta.screen) checkScreenStep(step, readme, text);
}

// A step marked screen = true shows the learner what the finished screen looks like.
function checkScreenStep(step: Step, readme: string, readmeText: string) {
  const expectedImage = join(step.dir, "images", "expected.png");
  if (!existsSync(expectedImage)) fail(step.dir, "screen step needs images/expected.png");
  if (!readmeText.includes("images/expected.png")) {
    fail(readme, "screen step must show ../images/expected.png");
  }
}

function checkStepFolders(step: Step) {
  if (step.meta.solution && !existsSync(join(step.dir, "solution"))) {
    fail(step.dir, "step.toml says solution but there is no solution/");
  }
  const hasTypeScriptCheck = existsSync(join(ROOT, "checks", `${step.name}.ts`));
  const hasPythonCheck = existsSync(join(ROOT, "checks", `${step.name}.py`));
  if (!hasTypeScriptCheck && !hasPythonCheck) fail(step.dir, `no check at checks/${step.name}.ts`);
}

function checkStep(step: Step, seenNames: Set<string>) {
  checkStepNameAndSettings(step, seenNames);
  const readme = join(step.dir, "problem", "README.md");
  if (!existsSync(readme)) {
    fail(step.dir, "missing problem/README.md");
    return;
  }
  checkStepReadme(step, readme);
  checkStepFolders(step);
}

const seenStepNames = new Set<string>();
const allParts = parts();
if (allParts.length === 0) fail(join(ROOT, "parts"), "no parts");
for (const part of allParts) {
  const readme = join(part.dir, "README.md");
  checkPartReadme(part, readme);
  // A part a later build session will fill: README only, marked TODO(part session),
  // and no step folders yet.
  const skeleton = existsSync(readme) && read(readme).includes("TODO(part session)");
  if (part.steps.length === 0 && !skeleton) fail(part.dir, "part has no steps");
  for (const step of part.steps) checkStep(step, seenStepNames);
}

// 4. Commands: the README runs the finished system first, and every command block says
// what to expect.
const MODEL_ID = /\b(claude-[a-z0-9-]+-\d|gpt-\d[\w.-]*|gemini-\d[\w.-]*|o\d-(mini|pro)\b)/i;
const rootReadme = join(ROOT, "README.md");
if (!existsSync(rootReadme)) {
  fail(ROOT, "missing README.md");
} else {
  const text = read(rootReadme);
  const firstCode = text.indexOf("```bash");
  const firstConcept = text.search(/^## (How it works|Concepts|Background|Why)/m);
  if (firstCode < 0) {
    fail(rootReadme, "the README needs a bash block that runs the finished system");
  } else if (firstConcept >= 0 && firstConcept < firstCode) {
    fail(rootReadme, "run the finished system before any concept section");
  }
}

function checkBashBlocksHaveExpect(file: string) {
  const lines = read(file).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "```bash") continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "```") j++;
    const lineAfterBlock = lines.slice(j + 1).find((line) => line.trim() !== "");
    if (!lineAfterBlock?.startsWith("Expect:")) {
      fail(file, `line ${i + 1}: a bash block must be followed by an Expect: line`);
    }
    i = j;
  }
}
for (const file of markdownFiles()) checkBashBlocksHaveExpect(file);

// 5. One model config, exact pins, a troubleshooting table.
// This file and config/models name model ids on purpose, so they are left out.
const filesThatMayNameModels = files.filter(
  (file) =>
    /\.(ts|py|md|json|toml|ya?ml)$/.test(file) &&
    !file.includes("/config/models.") &&
    !file.includes("/scripts/check.ts"),
);
for (const file of filesThatMayNameModels) {
  const modelId = read(file).match(MODEL_ID);
  if (modelId)
    fail(file, `model id "${modelId[0]}" outside config/models; name models in one place`);
}
const packageFile = join(ROOT, "package.json");
if (existsSync(packageFile)) {
  const packageJson = JSON.parse(read(packageFile));
  const pins = { ...packageJson.dependencies, ...packageJson.devDependencies } as Record<
    string,
    string
  >;
  for (const [packageName, version] of Object.entries(pins)) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      fail(packageFile, `${packageName}@${version}: pin an exact version`);
    }
  }
}
const pyproject = join(ROOT, "pyproject.toml");
if (existsSync(pyproject)) {
  const loosePins = read(pyproject).matchAll(/"([A-Za-z0-9_.\-[\]]+)\s*(>=|~=|\^|>|<)[^"]*"/g);
  for (const loosePin of loosePins) {
    fail(pyproject, `${loosePin[1]}: pin with == not ${loosePin[2]}`);
  }
}
const troubleshooting = join(ROOT, "00-orientation", "troubleshooting.md");
const tableHeader = /\| *What you see *\| *What it means *\| *Fix *\|/;
if (!existsSync(troubleshooting) || !tableHeader.test(read(troubleshooting))) {
  fail(ROOT, "00-orientation/troubleshooting.md needs a table: What you see | What it means | Fix");
}

// 6. Every schedule covers every part, and the minutes add up.
type Schedule = { sessions: { parts: string[]; minutes: number }[] };

function checkSchedule(schedulePath: string, scheduleName: string, schedule: Schedule) {
  const partMinutes: Record<string, number> = Object.fromEntries(
    allParts.map((part) => [
      part.name,
      part.steps.reduce((total, step) => total + step.meta.minutes, 0),
    ]),
  );
  const listedParts = schedule.sessions.flatMap((session) => session.parts);
  for (const part of allParts) {
    if (!listedParts.includes(part.name)) {
      fail(schedulePath, `${scheduleName} leaves out part "${part.name}"`);
    }
  }
  for (const session of schedule.sessions) {
    const needed = session.parts.reduce((total, name) => total + (partMinutes[name] ?? 0), 0);
    if (needed > session.minutes) {
      fail(
        schedulePath,
        `${scheduleName}: a session needs ${needed} min but has ${session.minutes}`,
      );
    }
  }
}

const schedulePath = join(ROOT, "schedules.toml");
if (!existsSync(schedulePath)) {
  fail(ROOT, "missing schedules.toml");
} else {
  const schedules = Bun.TOML.parse(read(schedulePath)) as Record<string, Schedule>;
  for (const [scheduleName, schedule] of Object.entries(schedules)) {
    checkSchedule(schedulePath, scheduleName, schedule);
  }
}

if (errors.length) {
  console.log(`The repo does not meet the standard. ${errors.length} problem(s):`);
  for (const error of errors) console.log(`  - ${error}`);
  process.exit(1);
}
console.log(
  `The repo meets the standard: ${allParts.length} part(s), ${allSteps().length} step(s).`,
);
