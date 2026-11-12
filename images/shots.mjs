// bun run shots: capture every picture the READMEs show, from the real system.
// Pages are screenshots of the running CMS. Terminal output is the real output of a command, rendered as a
// dark terminal about 800 pixels wide. Uses the Playwright Chromium on this machine (node + playwright).
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright is installed on the machine, not in this repo, so load it with require.
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, LLM_PROVIDER: "replay", NO_COLOR: "1", FORCE_COLOR: "0" };
const run = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
};
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const clean = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\$ bun /.test(l) && !/^error: script/.test(l))
    .join("\n")
    .trimEnd();

function terminal(command, output) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0f1115;}
  .t{width:800px;box-sizing:border-box;background:#16181d;color:#d6d9df;font:13px/1.5 "DejaVu Sans Mono",Menlo,monospace;border-radius:8px;overflow:hidden;margin:0}
  .bar{background:#23262d;padding:8px 12px;display:flex;gap:6px}.bar i{width:11px;height:11px;border-radius:50%;display:block}
  pre{margin:0;padding:14px 16px;white-space:pre-wrap;word-break:break-word}.p{color:#7fd18b}.c{color:#ffffff}
  </style></head><body><div class="t"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
  <pre><span class="p">$</span> <span class="c">${esc(command)}</span>\n${esc(output)}</pre></div></body></html>`;
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
  await page.locator(".t").screenshot({ path: join(ROOT, file) });
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
const cms = spawn("bun", ["world/world.ts"], { cwd: ROOT, env, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
await shootCms("00-orientation/images/cms-waiting.png");

// 2. The finished desk at work, and the CMS after it.
const demo = clean(run("bun finished/demo.ts"));
const lines = demo.split("\n");
const shown = [...lines.slice(0, 16), "  ...", ...lines.slice(-12)].join("\n");
await shootTerminal("00-orientation/images/demo-run.png", "bun run demo", shown);
await shootCms("images/finished-system.png");
await shootCms("00-orientation/01-meet-the-desk/images/expected.png");
cms.kill();

// 3. Steps with output on screen: the sample solution's output.
await shootTerminal(
  "parts/01-run-the-loop/01-call-the-model/images/expected.png",
  'bun run try call-the-model -p "say ready"',
  clean(run('bun scripts/try.ts call-the-model solution -p "say ready"')),
);
await shootTerminal(
  "parts/01-run-the-loop/05-stream-the-reply/images/expected.png",
  'bun run try stream-the-reply -p "what does the river-levels draft say?"',
  clean(
    run(
      'bun world/world.ts reset >/dev/null && bun scripts/try.ts stream-the-reply solution -p "what does the river-levels draft say?"',
    ),
  ),
);

await browser.close();
run("bun world/world.ts reset");
