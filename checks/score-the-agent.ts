// score-the-agent: the scorer runs your desk over all 12 drafts on the practice model and reads
// the CMS. Your desk must catch every planted fault with no false flag and no rule break, and
// notes/failures.md must explain each fault the starter missed, with a line from a session file.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nightRuns, scoreOf } from "../parts/04-extend-and-ship/05-score-the-agent/score";
import type { Rule } from "../scripts/verify";
import { every } from "./lib/harness";

// The faults the starter misses: every factual fix whose correction it cannot log.
const STARTER_MISSES = [
  "bridge-figure",
  "school-base",
  "river-date",
  "market-quote",
  "bus-route",
  "council-vote",
  "pool-date",
];

// Each "## " heading of the notes, with the text under it.
function sectionsOf(notes: string): { heading: string; body: string }[] {
  const parts = notes.split(/^## /m).slice(1);
  return parts.map((part) => {
    const [heading, ...body] = part.split("\n");
    return { heading, body: body.join("\n") };
  });
}

function readNotes(folder: string): string {
  const notesPath = join(folder, "notes", "failures.md");
  return existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "";
}

export default [
  {
    says: "On the practice model, your desk catches all 13 planted faults",
    test: (folder) => every(nightRuns(folder), (desk) => scoreOf(desk).caught === 13),
    tryNext:
      "Run bun run score and read the missed ids. Each one names what desk could not do. " +
      "A factual fix needs a log_correction call that reaches the CMS.",
  },
  {
    says: "It holds no clean story and breaks no rule",
    test: (folder) =>
      every(nightRuns(folder), (desk) => {
        const score = scoreOf(desk);
        return score.false_flags.length === 0 && score.rule_breaks === 0 && score.turns > 0;
      }),
    tryNext:
      "Read false_flags and rule_breaks in the score. A clean story must be filed, " +
      "and an embargoed or unchecked one must be held.",
  },
  {
    says: "notes/failures.md has a heading and a session line for each fault the starter missed",
    test: (folder) => {
      const sections = sectionsOf(readNotes(folder));
      return STARTER_MISSES.every((faultId) =>
        sections.some(
          (section) => section.heading.includes(faultId) && section.body.includes('"role":'),
        ),
      );
    },
    tryNext:
      "Add a ## heading with each missed id from bun run score. Under it, paste the line from " +
      ".desk/sessions/<id>.jsonl that shows the miss, in a json code block.",
  },
] satisfies Rule[];
