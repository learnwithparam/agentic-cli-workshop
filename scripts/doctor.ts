// bun run doctor: check the setup in plain sentences. It never prints a key.
import { keyName, type Provider, provider } from "#models";

let problems = 0;
const ok = (s: string) => console.log(`  ok    ${s}`);
const bad = (s: string) => {
  problems++;
  console.log(`  fix   ${s}`);
};

const [major, minor] = Bun.version.split(".").map(Number);
if (major > 1 || (major === 1 && minor >= 4)) ok(`Bun ${Bun.version} is installed.`);
else bad(`Bun ${Bun.version} is too old. Run bun upgrade, then open a new terminal.`);

try {
  const p: Provider = provider();
  const key = keyName(p);
  if (p === "replay")
    ok("No live model is set. That is fine: every check runs on the practice model.");
  else if (key && !process.env[key])
    bad(`LLM_PROVIDER is ${p} but ${key} is not set. Add it to .env, or remove LLM_PROVIDER.`);
  else ok(`LLM_PROVIDER is ${p} and its key is set.`);
} catch (e) {
  bad((e as Error).message);
}

for (const [port, what, path] of [
  [4020, "the CMS", "api/status"],
  [4010, "the practice model", "health"],
] as const) {
  try {
    const s = Bun.serve({ port, fetch: () => new Response("") });
    s.stop(true);
    ok(`Port ${port} is free for ${what}.`);
  } catch {
    const ours = await fetch(`http://localhost:${port}/${path}`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ours) ok(`Port ${port} is already running ${what}.`);
    else
      bad(
        `Port ${port} is used by another program. Stop it, or set ${port === 4020 ? "CMS_PORT" : "REPLAY_PORT"} to another port.`,
      );
  }
}

console.log(
  problems ? `${problems} thing(s) to fix before you start.` : "Ready. Next: bun run world reset",
);
process.exit(problems ? 1 : 0);
