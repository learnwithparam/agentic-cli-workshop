// The Millbrook Herald newsroom: where its files live, how to reset them, and how to read a draft.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { councilTranscript } from "./transcript";

export const WORLD = join(import.meta.dir, "..");
export const SEED = join(WORLD, "seed", "newsroom");
export const ANSWER_KEY_PATH = join(WORLD, "seed", "answer-key.json");
// The live copy the agent works on. Git ignores it; `bun run world reset` makes it again.
export const NEWSROOM = join(WORLD, "newsroom");
export const STATE_DIR = join(WORLD, ".state");
export const CMS_STATE = join(STATE_DIR, "cms.json");

// The world's clock. The night desk runs before the website updates at 06:00.
export const WORLD_NOW = "2026-11-12T23:40:00Z";
export const PUBLISH_AT = "2026-11-13T06:00:00Z";

export type Draft = {
  slug: string;
  headline: string;
  desk: string;
  author: string;
  embargo: string | null;
  sources: string[];
  body: string;
};

// A draft is a Markdown file with a "front matter" block of `key: value` lines between two
// `---` lines, then the story text.
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function readFrontMatter(frontMatter: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of frontMatter.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    fields[key] = line.slice(colon + 1).trim();
  }
  return fields;
}

// Turns "[one, two]" into ["one", "two"].
function readList(text = ""): string[] {
  const withoutBrackets = text.replace(/^\[|\]$/g, "");
  const items = withoutBrackets.split(",").map((item) => item.trim());
  return items.filter(Boolean);
}

export function parseDraft(text: string): Draft {
  const parts = text.match(FRONT_MATTER);
  const fields = readFrontMatter(parts?.[1] ?? "");
  return {
    slug: fields.slug ?? "",
    headline: fields.headline ?? "",
    desk: fields.desk ?? "",
    author: fields.author ?? "",
    embargo: fields.embargo ? fields.embargo : null,
    sources: readList(fields.sources),
    body: (parts?.[2] ?? text).trim(),
  };
}

export function readDrafts(newsroom = NEWSROOM): Draft[] {
  const folder = join(newsroom, "drafts");
  if (!existsSync(folder)) return [];
  // A DESK file holds notes for the desk, not a story.
  const fileNames = readdirSync(folder).filter(
    (fileName) => fileName.endsWith(".md") && !fileName.startsWith("DESK"),
  );
  fileNames.sort();
  return fileNames.map((fileName) => parseDraft(readFileSync(join(folder, fileName), "utf8")));
}

export function readDraft(slug: string, newsroom = NEWSROOM): Draft | null {
  const draftPath = join(newsroom, "drafts", `${slug}.md`);
  if (!existsSync(draftPath)) return null;
  return parseDraft(readFileSync(draftPath, "utf8"));
}

// People under 18 in the police record. A draft that names one must never be filed.
export function minors(newsroom = NEWSROOM): string[] {
  const recordPath = join(newsroom, "sources", "police-incidents.csv");
  if (!existsSync(recordPath)) return [];
  const [headerLine, ...rows] = readFileSync(recordPath, "utf8").trim().split("\n");
  const columns = headerLine.split(",");
  const nameColumn = columns.indexOf("person_name");
  const ageColumn = columns.indexOf("age");
  const people = rows.map((row) => row.split(","));
  const children = people.filter(
    (cells) => cells[ageColumn] && Number(cells[ageColumn]) < 18 && cells[nameColumn] !== "unknown",
  );
  return children.map((cells) => cells[nameColumn]);
}

export type AnswerKey = {
  drafts: Record<
    string,
    {
      outcome: "file" | "hold";
      // biome-ignore-start lint/style/useNamingConvention: field names come from answer-key.json
      hold_reason?: string;
      // biome-ignore-end lint/style/useNamingConvention: back to our own names
      faults: {
        id: string;
        kind: string;
        wrong?: string;
        right?: string;
        source?: string;
        correction?: boolean;
      }[];
    }
  >;
};

export const answerKey = (): AnswerKey => JSON.parse(readFileSync(ANSWER_KEY_PATH, "utf8"));

// Make a fresh newsroom at `target` from the seed, with the long council transcript written in.
export function resetNewsroom(target = NEWSROOM): string {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(SEED, target, { recursive: true });
  writeFileSync(join(target, "sources", "council-meeting-transcript.txt"), councilTranscript());
  return target;
}

// Reset only when the newsroom is missing, so work already done tonight is kept.
export function ensureNewsroom(target = NEWSROOM): string {
  if (!existsSync(join(target, "drafts"))) resetNewsroom(target);
  return target;
}
