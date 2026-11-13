// bun run models: one tiny call per role on the chosen provider. Prints the role, the provider,
// pass or fail, and the cost. It never prints a key or a model name.
import { generateText } from "ai";
import { nightDesk } from "../world/practice-model/night-desk";
import { startPracticeModel } from "../world/practice-model/server";
import { costUsd, model, provider, ROLES } from "./models";

const chosenProvider = provider();
const needsPracticeModel = chosenProvider === "replay" && !process.env.REPLAY_URL;
const practiceModel = needsPracticeModel ? startPracticeModel({ scenario: nightDesk }) : null;
if (practiceModel) process.env.REPLAY_URL = practiceModel.url;

function describeCost(cost: number | null): string {
  if (cost === null) return "cost unknown";
  return `$${cost.toFixed(6)}`;
}

// Error text can quote a key, so hide anything that looks like one before printing.
function firstLineWithoutKeys(error: unknown): string {
  const message = (error as Error).message ?? String(error);
  const hidden = message.replace(/(sk|key)[-_][A-Za-z0-9_-]{8,}/g, "[key hidden]");
  return hidden.split("\n")[0];
}

let failedRoles = 0;
for (const role of ROLES) {
  const label = `${role.padEnd(6)} ${chosenProvider.padEnd(11)}`;
  try {
    const reply = await generateText({
      model: model(role),
      prompt: "Reply with the word ok.",
      maxOutputTokens: 16,
      maxRetries: 0,
    });
    const cost = costUsd(role, reply.usage);
    const passed = /ok/i.test(reply.text);
    if (!passed) failedRoles++;
    const verdict = passed ? "pass" : "fail";
    console.log(`${label} ${verdict}  ${describeCost(cost)}`);
  } catch (error) {
    failedRoles++;
    console.log(`${label} fail  ${firstLineWithoutKeys(error)}`);
  }
}
practiceModel?.stop();
console.log(
  failedRoles
    ? `${failedRoles} role(s) failed. See 00-orientation/troubleshooting.md.`
    : `Every role answers on ${chosenProvider}.`,
);
process.exit(failedRoles ? 1 : 0);
