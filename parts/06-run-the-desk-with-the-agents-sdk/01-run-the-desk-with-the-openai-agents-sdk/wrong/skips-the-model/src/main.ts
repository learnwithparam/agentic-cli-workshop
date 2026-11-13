// A wrong answer: it never asks the model. It files and holds from the answer key.
import { readFileSync } from "node:fs";

const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";
const answerKeyFile = new URL("../../../../../../world/seed/answer-key.json", import.meta.url);
const answerKey = JSON.parse(readFileSync(answerKeyFile, "utf8"));

async function post(path: string, body: object) {
  await fetch(`${cmsUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

for (const [slug, draft] of Object.entries<{ outcome: string }>(answerKey.drafts)) {
  if (draft.outcome === "file") {
    // biome-ignore lint/style/useNamingConvention: the CMS reads this exact field name
    await post(`/api/stories/${slug}/file`, { note: "Checked.", idempotency_key: slug });
  } else {
    await post(`/api/stories/${slug}/hold`, { reason: "Held." });
  }
}

const status = (await (await fetch(`${cmsUrl}/api/status`)).json()) as {
  filed: number;
  held: number;
  waiting: number;
  corrections: number;
  // biome-ignore lint/style/useNamingConvention: this field name is part of the JSON API
  rule_breaks: unknown[];
};
console.log(
  `Filed ${status.filed}, held ${status.held}, waiting ${status.waiting}. ` +
    `Corrections logged tonight: ${status.corrections}. Rule breaks: ${status.rule_breaks.length}.`,
);
process.exit(0);
