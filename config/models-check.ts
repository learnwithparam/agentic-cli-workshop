// bun run models: one tiny call per role on the chosen provider. Prints the role, the provider, pass or fail
// and the cost. It never prints a key or a model name.
import { generateText } from "ai";
import { ROLES, costUsd, model, provider } from "./models";
import { nightDesk } from "../world/practice-model/night-desk";
import { startPracticeModel } from "../world/practice-model/server";

const p = provider();
const practice = p === "replay" && !process.env.REPLAY_URL ? startPracticeModel({ scenario: nightDesk }) : null;
if (practice) process.env.REPLAY_URL = practice.url;

let failed = 0;
for (const role of ROLES) {
  try {
    const r = await generateText({ model: model(role), prompt: "Reply with the word ok.", maxOutputTokens: 16, maxRetries: 0 });
    const cost = costUsd(role, r.usage);
    const pass = /ok/i.test(r.text);
    if (!pass) failed++;
    console.log(`${role.padEnd(6)} ${p.padEnd(11)} ${pass ? "pass" : "fail"}  ${cost === null ? "cost unknown" : `$${cost.toFixed(6)}`}`);
  } catch (e) {
    failed++;
    const msg = ((e as Error).message ?? String(e)).replace(/(sk|key)[-_][A-Za-z0-9_-]{8,}/g, "[key hidden]");
    console.log(`${role.padEnd(6)} ${p.padEnd(11)} fail  ${msg.split("\n")[0]}`);
  }
}
practice?.stop();
console.log(failed ? `${failed} role(s) failed. See 00-orientation/troubleshooting.md.` : `Every role answers on ${p}.`);
process.exit(failed ? 1 : 0);
