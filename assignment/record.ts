// bun assignment/record.ts: run the finished desk headless over tonight's 12 drafts on the practice
// model, then save what the CMS holds to assignment/recorded.json. The promptfoo provider replays
// that file, so the eval needs no key and no running desk. Run this again if the desk changes.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { nightRuns, scoreOf } from "../parts/04-extend-and-ship/05-score-the-agent/score";
import { answerKey } from "../world/lib/newsroom";

const [firstRun] = await nightRuns(join(import.meta.dir, "..", "finished", "desk"));
const state = firstRun.world.cms.state();
const score = scoreOf(firstRun);
const draftsWithMisses = Object.entries(answerKey().drafts).filter(([, answer]) =>
  answer.faults.some((fault) => score.missed.includes(fault.id)),
);

const drafts: Record<string, unknown> = {};
for (const [slug, story] of Object.entries(state.stories)) {
  const corrections = state.corrections.filter((entry) => entry.slug === slug);
  drafts[slug] = {
    status: story.status,
    filedText: story.filed_text ?? "",
    corrections: corrections.map((entry) => entry.wrong),
  };
}
const handBuilt = {
  caught: score.caught,
  faults: score.faults,
  draftsClean: Object.keys(drafts).length - draftsWithMisses.length,
};
const recordedPath = join(import.meta.dir, "recorded.json");
writeFileSync(recordedPath, `${JSON.stringify({ handBuilt, drafts }, null, 2)}\n`);
const draftCount = Object.keys(drafts).length;
const scoreText = `${score.caught}/${score.faults}`;
console.log(`Recorded ${draftCount} drafts. Hand-built score: ${scoreText}.`);
firstRun.world.cleanup();
process.exit(0);
