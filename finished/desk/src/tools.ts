// The tools desk gives the model. Each one has a schema the model reads and a runner desk executes.
// Paths are jailed to the newsroom folder. Errors say what to try next, because the model reads them.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";

export type ToolContext = {
  root: string; // the newsroom folder; no tool reads or writes outside it
  cmsUrl: string;
  sessionId: string;
  readFiles: Map<string, number>; // path -> mtime when read, so an edit can refuse a file it has not seen
  todos: { text: string; status: "pending" | "in_progress" | "done" }[];
  research?: (question: string) => Promise<string>;
};

export class ToolError extends Error {}

export function inside(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel.startsWith("..") || resolve(rel) === rel)
    throw new ToolError(
      `"${path}" is outside the newsroom folder. Use a path like drafts/bridge-repairs.md.`,
    );
  return full;
}

const MAX_OUTPUT = 20_000;
const cut = (s: string) =>
  s.length > MAX_OUTPUT
    ? `${s.slice(0, MAX_OUTPUT)}\n[cut: ${s.length - MAX_OUTPUT} more characters. Use search_files to find the part you need.]`
    : s;

async function cms(ctx: ToolContext, path: string, body: unknown): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${ctx.cmsUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ToolError(
      `The CMS at ${ctx.cmsUrl} did not answer. Ask the night editor to run bun run world.`,
    );
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ToolError(data.error ?? `The CMS answered ${res.status}.`);
  return JSON.stringify({ slug: data.slug ?? body, status: data.status ?? "ok" });
}

export const schemas = {
  list_files: z
    .object({
      path: z.string().describe("A folder inside the newsroom, such as drafts or sources"),
    })
    .strict(),
  read_file: z
    .object({
      path: z.string().describe("A file inside the newsroom, such as drafts/bridge-repairs.md"),
    })
    .strict(),
  search_files: z
    .object({
      pattern: z.string().describe("Text to find. Case does not matter."),
      path: z
        .string()
        .describe("A file or folder to search, such as sources/council-meeting-transcript.txt"),
    })
    .strict(),
  edit_file: z
    .object({
      path: z.string(),
      old_text: z.string().describe("Text that appears exactly once in the file"),
      new_text: z.string(),
    })
    .strict(),
  file_story: z
    .object({
      slug: z.string(),
      note: z.string().describe("The check note: the source for each claim in the story"),
    })
    .strict(),
  hold_story: z
    .object({ slug: z.string(), reason: z.string().describe("Why the editor must look at it") })
    .strict(),
  log_correction: z
    .object({
      slug: z.string(),
      wrong: z.string(),
      right: z.string(),
      source: z.string().describe("The file that proves it"),
    })
    .strict(),
  todo_write: z
    .object({
      todos: z.array(
        z.object({ text: z.string(), status: z.enum(["pending", "in_progress", "done"]) }).strict(),
      ),
    })
    .strict(),
  ask_researcher: z
    .object({
      question: z.string().describe("One question a helper answers by searching the sources"),
    })
    .strict(),
};

export type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  list_files: "List the files in a newsroom folder.",
  read_file: "Read a text file from the newsroom. Long files are cut; search them instead.",
  search_files:
    "Find lines that contain some text in a file or folder. Returns each match with its line number.",
  edit_file:
    "Replace text in a file you have read. old_text must appear exactly once. Returns a short diff.",
  file_story: "File a checked story to the CMS for the 06:00 website update. Needs a check note.",
  hold_story: "Hold a story for the night editor, with a reason they can read.",
  log_correction: "Log a factual correction to the public corrections log.",
  todo_write:
    "Replace the todo list. Send the full list every time. At most one item is in_progress.",
  ask_researcher:
    "Ask a helper with its own clean context to answer one question from the sources. Returns a short answer only.",
};

export function definitions(names: ToolName[]) {
  return Object.fromEntries(
    names.map((n) => [n, tool({ description: descriptions[n], inputSchema: schemas[n] as any })]),
  );
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  if (!(name in schemas))
    throw new ToolError(
      `There is no tool "${name}". Use one of: ${Object.keys(schemas).join(", ")}.`,
    );
  const parsed = schemas[name as ToolName].safeParse(input);
  if (!parsed.success)
    throw new ToolError(
      `The input for ${name} is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}.`,
    );
  const a: any = parsed.data;
  switch (name as ToolName) {
    case "list_files": {
      const dir = inside(ctx.root, a.path);
      if (!existsSync(dir) || !statSync(dir).isDirectory())
        throw new ToolError(`"${a.path}" is not a folder. Try list_files with path "." first.`);
      return readdirSync(dir)
        .filter((f) => !f.startsWith("."))
        .sort()
        .join("\n");
    }
    case "read_file": {
      const p = inside(ctx.root, a.path);
      if (!existsSync(p) || statSync(p).isDirectory())
        throw new ToolError(`There is no file "${a.path}". Use list_files to see what is there.`);
      ctx.readFiles.set(p, statSync(p).mtimeMs);
      return cut(readFileSync(p, "utf8"));
    }
    case "search_files": {
      const p = inside(ctx.root, a.path);
      if (!existsSync(p)) throw new ToolError(`There is no file or folder "${a.path}".`);
      const files = statSync(p).isDirectory()
        ? readdirSync(p)
            .map((f) => join(p, f))
            .filter((f) => statSync(f).isFile())
        : [p];
      const needle = a.pattern.toLowerCase();
      const hits: string[] = [];
      for (const f of files)
        readFileSync(f, "utf8")
          .split("\n")
          .forEach(
            (line, i) =>
              line.toLowerCase().includes(needle) &&
              hits.push(`${relative(ctx.root, f)}:${i + 1}: ${line.slice(0, 400)}`),
          );
      return hits.length
        ? cut(hits.slice(0, 50).join("\n"))
        : `No line contains "${a.pattern}". Try a shorter phrase.`;
    }
    case "edit_file": {
      const p = inside(ctx.root, a.path);
      if (!ctx.readFiles.has(p))
        throw new ToolError(`Read "${a.path}" with read_file before you edit it.`);
      if (statSync(p).mtimeMs !== ctx.readFiles.get(p))
        throw new ToolError(`"${a.path}" changed since you read it. Read it again.`);
      const text = readFileSync(p, "utf8");
      const n = text.split(a.old_text).length - 1;
      if (n === 0)
        throw new ToolError(`old_text is not in "${a.path}". Copy it exactly from the file.`);
      if (n > 1)
        throw new ToolError(
          `old_text appears ${n} times in "${a.path}". Add nearby words so it appears once.`,
        );
      writeFileSync(p, text.replace(a.old_text, a.new_text));
      ctx.readFiles.set(p, statSync(p).mtimeMs);
      return `- ${a.old_text}\n+ ${a.new_text}`;
    }
    case "file_story":
      return cms(ctx, `/api/stories/${a.slug}/file`, {
        note: a.note,
        idempotency_key: `${ctx.sessionId}:${a.slug}`,
      });
    case "hold_story":
      return cms(ctx, `/api/stories/${a.slug}/hold`, { reason: a.reason });
    case "log_correction":
      return cms(ctx, "/api/corrections", a);
    case "todo_write": {
      if (a.todos.filter((t: any) => t.status === "in_progress").length > 1)
        throw new ToolError("Only one item can be in_progress. Mark the others pending or done.");
      ctx.todos = a.todos;
      const done = a.todos.filter((t: any) => t.status === "done").length;
      return `Todo list saved: ${done} of ${a.todos.length} done.`;
    }
    case "ask_researcher": {
      if (!ctx.research)
        throw new ToolError("A helper cannot ask another helper. Answer with what you found.");
      return ctx.research(a.question);
    }
  }
}

// What desk asks before running a tool. Reads change nothing; the rest change the newsroom or the CMS.
export const READ_ONLY: ToolName[] = [
  "list_files",
  "read_file",
  "search_files",
  "todo_write",
  "ask_researcher",
];
export const EDITS: ToolName[] = ["edit_file"];
