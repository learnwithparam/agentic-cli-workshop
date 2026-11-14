// point-desk-at-your-own-files: the capstone. The learner points desk at a folder of their own and
// hands in three files in my-desk/. This check reads those files and the folder they name. It never
// reads the course world: a folder inside this course is refused. It proves the shape of the rules
// and that the run left evidence about real files.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Rule } from "../scripts/verify";

const COURSE = join(import.meta.dir, "..");
const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean);

function readIn(folder: string, name: string): string {
  const path = join(folder, "my-desk", name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function sections(markdown: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const part of markdown.split(/^## /m).slice(1)) {
    const [heading, ...body] = part.split("\n");
    const name = heading.trim().toLowerCase();
    found[name] = body.join("\n").trim();
  }
  return found;
}

type Settings = { root?: string; permissions?: { allow?: string[]; deny?: string[] } };
function settingsOf(folder: string): Settings {
  try {
    return JSON.parse(readIn(folder, "desk.config.json"));
  } catch {
    return {};
  }
}

// The learner's own folder, as the config names it.
// Null when it is missing or inside the course.
function ownFolder(folder: string): string | null {
  const root = settingsOf(folder).root;
  if (typeof root !== "string") return null;
  const path = resolve(folder, "my-desk", root);
  const insideCourse = !relative(COURSE, path).startsWith("..");
  const isThisStep = path.startsWith(resolve(folder));
  const inCourseWorld = insideCourse && !isThisStep;
  if (inCourseWorld || !existsSync(path) || !statSync(path).isDirectory()) return null;
  return path;
}

function filesUnder(folder: string, base = folder): string[] {
  return readdirSync(folder).flatMap((entry) => {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) return filesUnder(path, base);
    return [relative(base, path)];
  });
}

export default [
  {
    says:
      "my-desk/desk.config.json names your own folder, " +
      "with at least 3 files, outside the course world",
    test: (folder) => {
      const own = ownFolder(folder);
      return own !== null && filesUnder(own).length >= 3;
    },
    tryNext:
      'Set "root" in my-desk/desk.config.json to the path of your own folder, ' +
      "such as ../my-project. " +
      "It must exist, hold 3 or more files, and not be a folder of this course.",
  },
  {
    says:
      "my-desk/desk.config.json denies at least one tool that changes things, " +
      "and allows reading",
    test: (folder) => {
      const permissions = settingsOf(folder).permissions ?? {};
      const changing = ["edit_file", "run_command", "file_story", "hold_story", "log_correction"];
      const denied = (permissions.deny ?? []).some((tool) => changing.includes(tool));
      return denied && (permissions.allow ?? []).includes("read_file");
    },
    tryNext:
      'Under "permissions" put read_file in "allow", and a tool that changes things, ' +
      'such as run_command, in "deny".',
  },
  {
    says:
      "my-desk/DESK.md has the three rule sections, each filled in, " +
      "and names real files of yours",
    test: (folder) => {
      const own = ownFolder(folder);
      const rules = readIn(folder, "DESK.md");
      const parts = sections(rules);
      const filled = ["what this folder is", "check before filing", "never do"].every(
        (heading) => wordsIn(parts[heading] ?? "").length >= 8 && !parts[heading].includes("TODO"),
      );
      if (!own || !filled) return false;
      const named = [...rules.matchAll(/`([^`\s]+\.\w+)`/g)].map((match) => match[1]);
      return named.filter((path) => existsSync(join(own, path))).length >= 2;
    },
    tryNext:
      "Fill each section with at least a sentence, and name two or more files from your folder " +
      "in backticks, such as `notes/trip-plan.md`. A rule about no real file cannot be checked.",
  },
  {
    says: "my-desk/evidence.md pastes a session line where desk read one of your files",
    test: (folder) => {
      const own = ownFolder(folder);
      const evidence = readIn(folder, "evidence.md");
      const block = evidence.match(/```json\n([\s\S]*?)\n```/)?.[1];
      if (!own || !block) return false;
      try {
        const line = JSON.parse(block);
        const call = (line.content as { type: string; input?: { path?: string } }[]).find(
          (part) => part.type === "tool-call",
        );
        const path = call?.input?.path;
        return line.role === "assistant" && typeof path === "string" && existsSync(join(own, path));
      } catch {
        return false;
      }
    },
    tryNext:
      "Open the newest file in .desk/sessions/, " +
      "copy one line where the assistant called read_file, " +
      "and paste it in a json block. Its path must be a file in your own folder.",
  },
  {
    says: "my-desk/evidence.md says in your own words what desk found, in at least 20 words",
    test: (folder) => {
      const found = sections(readIn(folder, "evidence.md"))["what it found"] ?? "";
      return wordsIn(found).length >= 20 && !found.includes("TODO");
    },
    tryNext:
      "Under What it found, write two or three sentences about what desk found or got wrong " +
      "in your files.",
  },
] satisfies Rule[];
