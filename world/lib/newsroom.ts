// The Millbrook Herald newsroom: where its files live, how to reset them, and how to read a draft.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

export function parseDraft(text: string): Draft {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const list = (s = "") => s.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    slug: meta.slug ?? "",
    headline: meta.headline ?? "",
    desk: meta.desk ?? "",
    author: meta.author ?? "",
    embargo: meta.embargo ? meta.embargo : null,
    sources: list(meta.sources),
    body: (m?.[2] ?? text).trim(),
  };
}

export function readDrafts(newsroom = NEWSROOM): Draft[] {
  const dir = join(newsroom, "drafts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("DESK"))
    .sort()
    .map((f) => parseDraft(readFileSync(join(dir, f), "utf8")));
}

export function readDraft(slug: string, newsroom = NEWSROOM): Draft | null {
  const p = join(newsroom, "drafts", `${slug}.md`);
  return existsSync(p) ? parseDraft(readFileSync(p, "utf8")) : null;
}

// People under 18 in the police record. A draft that names one must never be filed.
export function minors(newsroom = NEWSROOM): string[] {
  const p = join(newsroom, "sources", "police-incidents.csv");
  if (!existsSync(p)) return [];
  const [head, ...rows] = readFileSync(p, "utf8").trim().split("\n");
  const cols = head.split(",");
  const name = cols.indexOf("person_name");
  const age = cols.indexOf("age");
  return rows
    .map((r) => r.split(","))
    .filter((c) => c[age] && Number(c[age]) < 18 && c[name] !== "unknown")
    .map((c) => c[name]);
}

export type AnswerKey = {
  drafts: Record<
    string,
    {
      outcome: "file" | "hold";
      hold_reason?: string;
      faults: { id: string; kind: string; wrong?: string; right?: string; source?: string; correction?: boolean }[];
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

export function ensureNewsroom(target = NEWSROOM): string {
  if (!existsSync(join(target, "drafts"))) resetNewsroom(target);
  return target;
}
