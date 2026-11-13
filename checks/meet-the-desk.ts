// meet-the-desk: after running the finished desk, the learner writes down which stories it held
// and why. The held stories come from the answer key, the same truth the CMS shows after
// bun run demo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { answerKey } from "../world/lib/newsroom";

const HEADINGS = ["## Held stories", "## Why each was held", "## One thing I want to understand"];

const notesFile = (folder: string) => join(folder, "first-look.md");

function notes(folder: string): string {
  if (!existsSync(notesFile(folder))) return "";
  return readFileSync(notesFile(folder), "utf8");
}

// The text under one heading, up to the next heading.
function section(folder: string, heading: string): string {
  const afterHeading = notes(folder).split(heading)[1];
  return afterHeading?.split(/\n## /)[0] ?? "";
}

// The slugs of the stories the answer key says end with this outcome.
function storiesThat(outcome: "file" | "hold"): string[] {
  const drafts = Object.entries(answerKey().drafts);
  const matching = drafts.filter(([, draft]) => draft.outcome === outcome);
  return matching.map(([slug]) => slug);
}
const held = () => storiesThat("hold");
const filed = () => storiesThat("file");

// How many real words a piece of text has, not counting markdown marks or the word TODO.
function wordCount(text: string): number {
  const plain = text.replace(/[#*`_-]/g, " ");
  const words = plain.split(/\s+/).filter((word) => word && !/^todo$/i.test(word));
  return words.length;
}

export default [
  {
    says: "first-look.md has the three headings",
    test: (folder) => HEADINGS.every((heading) => notes(folder).includes(heading)),
    tryNext: "Keep the three headings in first-look.md exactly as they are in the starter.",
  },
  {
    says: "Held stories names every story the desk held",
    test: (folder) => held().every((slug) => section(folder, "## Held stories").includes(slug)),
    tryNext: "Run bun run demo, open the CMS, and copy the slug of each story in the Held column.",
  },
  {
    says: "Held stories names no story the desk filed",
    test: (folder) => {
      const heldSection = section(folder, "## Held stories");
      return heldSection.trim().length > 0 && !filed().some((slug) => heldSection.includes(slug));
    },
    tryNext: "List only the Held column. A story in the Filed column went to the website.",
  },
  {
    says: "Why each was held gives a reason for each held story",
    test: (folder) => {
      const lines = section(folder, "## Why each was held").split("\n");
      return held().every((slug) =>
        lines.some((line) => line.includes(slug) && wordCount(line.replace(slug, "")) >= 4),
      );
    },
    tryNext:
      "Write one line per held story: its slug, then the rule it would break, in your own words.",
  },
  {
    says: "One thing I want to understand has a real question",
    test: (folder) => wordCount(section(folder, "## One thing I want to understand")) >= 5,
    tryNext:
      "Write one sentence about the run you cannot explain yet, such as why it read a file twice.",
  },
] satisfies Rule[];
