// meet-the-desk: after running the finished desk, the learner writes down which stories it held and why.
// The held stories come from the answer key, the same truth the CMS shows after bun run demo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { answerKey } from "../world/lib/newsroom";

const HEADINGS = ["## Held stories", "## Why each was held", "## One thing I want to understand"];
const file = (d: string) => join(d, "first-look.md");
const text = (d: string) => (existsSync(file(d)) ? readFileSync(file(d), "utf8") : "");
const section = (d: string, heading: string) => text(d).split(heading)[1]?.split(/\n## /)[0] ?? "";
const drafts = () => Object.entries(answerKey().drafts);
const held = () =>
  drafts()
    .filter(([, v]) => v.outcome === "hold")
    .map(([k]) => k);
const filed = () =>
  drafts()
    .filter(([, v]) => v.outcome === "file")
    .map(([k]) => k);
const words = (s: string) =>
  s
    .replace(/[#*`_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^todo$/i.test(w)).length;

export default [
  {
    says: "first-look.md has the three headings",
    test: (d) => HEADINGS.every((h) => text(d).includes(h)),
    tryNext: "Keep the three headings in first-look.md exactly as they are in the starter.",
  },
  {
    says: "Held stories names every story the desk held",
    test: (d) => held().every((slug) => section(d, "## Held stories").includes(slug)),
    tryNext: "Run bun run demo, open the CMS, and copy the slug of each story in the Held column.",
  },
  {
    says: "Held stories names no story the desk filed",
    test: (d) =>
      section(d, "## Held stories").trim().length > 0 &&
      !filed().some((slug) => section(d, "## Held stories").includes(slug)),
    tryNext: "List only the Held column. A story in the Filed column went to the website.",
  },
  {
    says: "Why each was held gives a reason for each held story",
    test: (d) => {
      const lines = section(d, "## Why each was held").split("\n");
      return held().every((slug) =>
        lines.some((l) => l.includes(slug) && words(l.replace(slug, "")) >= 4),
      );
    },
    tryNext:
      "Write one line per held story: its slug, then the rule it would break, in your own words.",
  },
  {
    says: "One thing I want to understand has a real question",
    test: (d) => words(section(d, "## One thing I want to understand")) >= 5,
    tryNext:
      "Write one sentence about the run you cannot explain yet, such as why it read a file twice.",
  },
] satisfies Rule[];
