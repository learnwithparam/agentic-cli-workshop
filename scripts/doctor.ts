// bun run doctor: check the setup in plain sentences. It never prints a key.
import { keyName, type Provider, provider } from "#models";

let problems = 0;
const ok = (sentence: string) => console.log(`  ok    ${sentence}`);
const bad = (sentence: string) => {
  problems++;
  console.log(`  fix   ${sentence}`);
};

const [major, minor] = Bun.version.split(".").map(Number);
if (major > 1 || (major === 1 && minor >= 4)) ok(`Bun ${Bun.version} is installed.`);
else bad(`Bun ${Bun.version} is too old. Run bun upgrade, then open a new terminal.`);

try {
  const chosenProvider: Provider = provider();
  const key = keyName(chosenProvider);
  if (chosenProvider === "replay") {
    ok("No live model is set. That is fine: every check runs on the practice model.");
  } else if (key && !process.env[key]) {
    bad(
      `LLM_PROVIDER is ${chosenProvider} but ${key} is not set. ` +
        "Add it to .env, or remove LLM_PROVIDER.",
    );
  } else {
    ok(`LLM_PROVIDER is ${chosenProvider} and its key is set.`);
  }
} catch (error) {
  bad((error as Error).message);
}

async function answersAt(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

const servicePorts = [
  [4020, "the CMS", "api/status"],
  [4010, "the practice model", "health"],
] as const;

for (const [port, service, healthPath] of servicePorts) {
  try {
    const probe = Bun.serve({ port, fetch: () => new Response("") });
    probe.stop(true);
    ok(`Port ${port} is free for ${service}.`);
  } catch {
    const alreadyOurs = await answersAt(`http://localhost:${port}/${healthPath}`);
    const portSetting = port === 4020 ? "CMS_PORT" : "REPLAY_PORT";
    if (alreadyOurs) {
      ok(`Port ${port} is already running ${service}.`);
    } else {
      bad(
        `Port ${port} is used by another program. Stop it, or set ${portSetting} to another port.`,
      );
    }
  }
}

console.log(
  problems ? `${problems} thing(s) to fix before you start.` : "Ready. Next: bun run world reset",
);
process.exit(problems ? 1 : 0);
