// A promptfoo provider. It replays the night that desk ran headless on the practice model,
// saved by assignment/record.ts, so the eval needs no key. The prompt is a draft slug and the
// output is what the CMS holds for that draft.
import { readFileSync } from "node:fs";

const recordedPath = new URL("./recorded.json", import.meta.url);

export default class RecordedDesk {
  id() {
    return "recorded-desk";
  }

  async callApi(slug) {
    const recorded = JSON.parse(readFileSync(recordedPath, "utf8"));
    const draft = recorded.drafts[slug.trim()];
    if (!draft) return { error: `The recording has no draft called ${slug}` };
    return { output: JSON.stringify(draft) };
  }
}
