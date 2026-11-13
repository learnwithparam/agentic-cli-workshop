// bun run shots: capture every picture the READMEs show, from the real system.
// Pages are screenshots of the running CMS. Terminal output is the real output of a command,
// rendered as a dark terminal about 800 pixels wide. Uses the Playwright Chromium on this
// machine (node + playwright).
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright is installed on the machine, not in this repo, so load it with require.
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// biome-ignore-start lint/style/useNamingConvention: environment variable names are fixed
const environment = { ...process.env, LLM_PROVIDER: "replay", NO_COLOR: "1", FORCE_COLOR: "0" };
// biome-ignore-end lint/style/useNamingConvention: back to our own names

// Runs a command and returns what it printed, even when it fails, so the picture shows the error.
const run = (command) => {
  try {
    return execSync(command, {
      cwd: ROOT,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return (error.stdout ?? "") + (error.stderr ?? "");
  }
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (text) => text.replace(/[&<>]/g, (character) => HTML_ESCAPES[character]);

// Bun echoes "$ bun ..." and "error: script ..." around a script; they are noise in a picture.
const withoutBunNoise = (output) => {
  const lines = output.split("\n");
  const kept = lines.filter((line) => !/^\$ bun /.test(line) && !/^error: script/.test(line));
  return kept.join("\n").trimEnd();
};

const TERMINAL_STYLE = `
  body { margin: 0; background: #0f1115; }
  .terminal {
    width: 800px; box-sizing: border-box; margin: 0; overflow: hidden; border-radius: 8px;
    background: #16181d; color: #d6d9df;
    font: 13px/1.5 "DejaVu Sans Mono", Menlo, monospace;
  }
  .title-bar { background: #23262d; padding: 8px 12px; display: flex; gap: 6px; }
  .title-bar i { width: 11px; height: 11px; border-radius: 50%; display: block; }
  pre { margin: 0; padding: 14px 16px; white-space: pre-wrap; word-break: break-word; }
  .prompt { color: #7fd18b; }
  .command { color: #ffffff; }
`;

function terminal(command, output) {
  const titleBar =
    '<div class="title-bar">' +
    '<i style="background:#ff5f57"></i>' +
    '<i style="background:#febc2e"></i>' +
    '<i style="background:#28c840"></i>' +
    "</div>";
  const commandHtml = `<span class="command">${escapeHtml(command)}</span>`;
  const prompt = `<span class="prompt">$</span> ${commandHtml}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${TERMINAL_STYLE}</style></head>
  <body><div class="terminal">${titleBar}
  <pre>${prompt}\n${escapeHtml(output)}</pre></div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});

async function shootTerminal(file, command, output) {
  mkdirSync(dirname(join(ROOT, file)), { recursive: true });
  await page.setViewportSize({ width: 800, height: 200 });
  await page.setContent(terminal(command, output));
  await page.locator(".terminal").screenshot({ path: join(ROOT, file) });
  console.log(`wrote ${file}`);
}

async function shootCms(file) {
  mkdirSync(dirname(join(ROOT, file)), { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost:4020/");
  await page.screenshot({ path: join(ROOT, file), fullPage: true });
  console.log(`wrote ${file}`);
}

// 1. The CMS before the run.
run("bun world/world.ts reset");
const cms = spawn("bun", ["world/world.ts"], { cwd: ROOT, env: environment, stdio: "ignore" });
// Give the CMS a moment to start listening before the first screenshot.
await new Promise((resolve) => setTimeout(resolve, 1500));
await shootCms("00-orientation/images/cms-waiting.png");

// 2. The finished desk at work, and the CMS after it.
const demoOutput = withoutBunNoise(run("bun finished/demo.ts"));
const demoLines = demoOutput.split("\n");
const shortenedDemo = [...demoLines.slice(0, 16), "  ...", ...demoLines.slice(-12)].join("\n");
await shootTerminal("00-orientation/images/demo-run.png", "bun run demo", shortenedDemo);
await shootCms("images/finished-system.png");
await shootCms("00-orientation/01-meet-the-desk/images/expected.png");
cms.kill();

// 3. Steps with output on screen: the sample solution's output.
await shootTerminal(
  "parts/01-run-the-loop/01-call-the-model/images/expected.png",
  'bun run try call-the-model -p "say ready"',
  withoutBunNoise(run('bun scripts/try.ts call-the-model solution -p "say ready"')),
);
const riverLevelsPrompt = '"what does the river-levels draft say?"';
await shootTerminal(
  "parts/01-run-the-loop/05-stream-the-reply/images/expected.png",
  `bun run try stream-the-reply -p ${riverLevelsPrompt}`,
  withoutBunNoise(
    run(
      "bun world/world.ts reset >/dev/null && " +
        `bun scripts/try.ts stream-the-reply solution -p ${riverLevelsPrompt}`,
    ),
  ),
);

// touch-the-world-safely: the sample solutions on the night desk run, cut short with --max-turns.
const nightDeskPrompt = '"check tonight\'s drafts"';
async function shootTry(stepFolder, stepName, turns, answers = "") {
  const deskFlags = `-p ${nightDeskPrompt} --max-turns ${turns}`;
  const tryCommand = `bun scripts/try.ts ${stepName} solution ${deskFlags}`;
  // The night editor's answers arrive on stdin. With none, stdin is empty and every prompt is a no.
  let withAnswers = `${tryCommand} < /dev/null`;
  if (answers) withAnswers = `printf '${answers}' | ${tryCommand}`;
  const output = run(`bun world/world.ts reset >/dev/null && ${withAnswers}`);
  await shootTerminal(
    `parts/02-touch-the-world-safely/${stepFolder}/images/expected.png`,
    `bun run try ${stepName} ${deskFlags}`,
    withoutBunNoise(output),
  );
}
await shootTry("01-shape-the-tools", "shape-the-tools", 6);
await shootTry("02-edit-drafts-safely", "edit-drafts-safely", 9);
await shootTry("04-ask-before-acting", "ask-before-acting", 9, "y\\ny\\nn\\n");

// keep-the-context-clean: the todo list at the start of the night, and the compaction line.
const tonightPrompt = '"check tonight\'s drafts"';
const todoFlags = `-p ${tonightPrompt} --max-turns 3`;
const todoRun = run(
  "bun world/world.ts reset >/dev/null && " +
    `bun scripts/try.ts plan-with-a-todo-list solution ${todoFlags} < /dev/null`,
);
await shootTerminal(
  "parts/03-keep-the-context-clean/01-plan-with-a-todo-list/images/expected.png",
  `bun run try plan-with-a-todo-list ${todoFlags}`,
  withoutBunNoise(todoRun),
);
const compactFlags = `-p ${tonightPrompt} --permission-mode accept-edits --max-turns 80`;
const compactRun = run(
  "bun world/world.ts reset >/dev/null && " +
    "cp finished/desk.config.json world/newsroom/desk.config.json && " +
    `bun scripts/try.ts compact-the-conversation solution ${compactFlags} < /dev/null`,
);
const compactLines = withoutBunNoise(compactRun).split("\n");
const compactedAt = compactLines.findIndex((line) => line.includes("~ compacted"));
const aroundCompaction = compactLines.slice(compactedAt - 8, compactedAt + 6);
await shootTerminal(
  "parts/03-keep-the-context-clean/04-compact-the-conversation/images/expected.png",
  `bun run try compact-the-conversation ${compactFlags}`,
  ["  ...", ...aroundCompaction, "  ..."].join("\n"),
);

await browser.close();
run("bun world/world.ts reset");
