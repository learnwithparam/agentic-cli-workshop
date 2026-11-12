// The tools desk gives the model. Each one has a schema the model reads and a runner desk
// executes. Paths are jailed to the newsroom folder. Errors say what to try next, because the
// model reads them.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";

type Todo = { text: string; status: "pending" | "in_progress" | "done" };

export type ToolContext = {
  root: string; // the newsroom folder; no tool reads or writes outside it
  cmsUrl: string;
  sessionId: string;
  // path -> when the file last changed as we read it, so an edit can refuse a file it has not seen
  readFiles: Map<string, number>;
  todos: Todo[];
  research?: (question: string) => Promise<string>;
};

// A mistake the model can fix. Its message goes back to the model as the tool result.
export class ToolError extends Error {}

// The full path of a newsroom file, or a ToolError if the path leaves the newsroom folder.
export function insideNewsroom(root: string, path: string): string {
  const fullPath = resolve(root, path);
  const pathFromRoot = relative(root, fullPath);
  const leavesRoot = pathFromRoot.startsWith("..") || resolve(pathFromRoot) === pathFromRoot;
  if (leavesRoot) {
    throw new ToolError(
      `"${path}" is outside the newsroom folder. Use a path like drafts/bridge-repairs.md.`,
    );
  }
  return fullPath;
}

// Long tool output fills the context window, so cut it and say how to find the rest.
const MAX_OUTPUT = 20_000;
function cutLongOutput(output: string): string {
  if (output.length <= MAX_OUTPUT) return output;
  const hiddenCharacters = output.length - MAX_OUTPUT;
  return (
    `${output.slice(0, MAX_OUTPUT)}\n[cut: ${hiddenCharacters} more characters. ` +
    "Use search_files to find the part you need.]"
  );
}

type CmsReply = { slug?: unknown; status?: unknown; error?: string };

async function postToCms(toolContext: ToolContext, path: string, body: unknown): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${toolContext.cmsUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ToolError(
      `The CMS at ${toolContext.cmsUrl} did not answer. Ask the night editor to run bun run world.`,
    );
  }
  const reply: CmsReply = await response.json().catch(() => ({}));
  if (!response.ok) throw new ToolError(reply.error ?? `The CMS answered ${response.status}.`);
  return JSON.stringify({ slug: reply.slug ?? body, status: reply.status ?? "ok" });
}

const todoStatus = z.enum(["pending", "in_progress", "done"]);
const todoSchema = z.object({ text: z.string(), status: todoStatus }).strict();

// biome-ignore-start lint/style/useNamingConvention: the model sees these tool and field names
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
    .object({
      slug: z.string(),
      reason: z.string().describe("Why the editor must look at it"),
    })
    .strict(),
  log_correction: z
    .object({
      slug: z.string(),
      wrong: z.string(),
      right: z.string(),
      source: z.string().describe("The file that proves it"),
    })
    .strict(),
  todo_write: z.object({ todos: z.array(todoSchema) }).strict(),
  ask_researcher: z
    .object({
      question: z.string().describe("One question a helper answers by searching the sources"),
    })
    .strict(),
};

export type ToolName = keyof typeof schemas;
type InputOf<Name extends ToolName> = z.infer<(typeof schemas)[Name]>;

const descriptions: Record<ToolName, string> = {
  list_files: "List the files in a newsroom folder.",
  read_file: "Read a text file from the newsroom. Long files are cut; search them instead.",
  search_files:
    "Find lines that contain some text in a file or folder. " +
    "Returns each match with its line number.",
  edit_file:
    "Replace text in a file you have read. old_text must appear exactly once. " +
    "Returns a short diff.",
  file_story: "File a checked story to the CMS for the 06:00 website update. Needs a check note.",
  hold_story: "Hold a story for the night editor, with a reason they can read.",
  log_correction: "Log a factual correction to the public corrections log.",
  todo_write:
    "Replace the todo list. Send the full list every time. At most one item is in_progress.",
  ask_researcher:
    "Ask a helper with its own clean context to answer one question from the sources. " +
    "Returns a short answer only.",
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

export function definitions(names: ToolName[]) {
  const namedTools = names.map((name) => [
    name,
    tool({ description: descriptions[name], inputSchema: schemas[name] as z.ZodType }),
  ]);
  return Object.fromEntries(namedTools);
}

function listFiles(input: InputOf<"list_files">, toolContext: ToolContext): string {
  const folder = insideNewsroom(toolContext.root, input.path);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new ToolError(`"${input.path}" is not a folder. Try list_files with path "." first.`);
  }
  const visibleFiles = readdirSync(folder).filter((file) => !file.startsWith("."));
  return visibleFiles.sort().join("\n");
}

function readFile(input: InputOf<"read_file">, toolContext: ToolContext): string {
  const file = insideNewsroom(toolContext.root, input.path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    throw new ToolError(`There is no file "${input.path}". Use list_files to see what is there.`);
  }
  // Remember when the file last changed, so edit_file can tell if it changed since.
  toolContext.readFiles.set(file, statSync(file).mtimeMs);
  return cutLongOutput(readFileSync(file, "utf8"));
}

function filesToSearch(fileOrFolder: string): string[] {
  if (!statSync(fileOrFolder).isDirectory()) return [fileOrFolder];
  const paths = readdirSync(fileOrFolder).map((name) => join(fileOrFolder, name));
  return paths.filter((path) => statSync(path).isFile());
}

function searchFiles(input: InputOf<"search_files">, toolContext: ToolContext): string {
  const fileOrFolder = insideNewsroom(toolContext.root, input.path);
  if (!existsSync(fileOrFolder)) throw new ToolError(`There is no file or folder "${input.path}".`);
  const wanted = input.pattern.toLowerCase();
  const matches: string[] = [];
  for (const file of filesToSearch(fileOrFolder)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(wanted)) continue;
      matches.push(`${relative(toolContext.root, file)}:${i + 1}: ${lines[i].slice(0, 400)}`);
    }
  }
  if (matches.length === 0) return `No line contains "${input.pattern}". Try a shorter phrase.`;
  return cutLongOutput(matches.slice(0, 50).join("\n"));
}

function editFile(input: InputOf<"edit_file">, toolContext: ToolContext): string {
  const file = insideNewsroom(toolContext.root, input.path);
  if (!toolContext.readFiles.has(file)) {
    throw new ToolError(`Read "${input.path}" with read_file before you edit it.`);
  }
  if (statSync(file).mtimeMs !== toolContext.readFiles.get(file)) {
    throw new ToolError(`"${input.path}" changed since you read it. Read it again.`);
  }
  const text = readFileSync(file, "utf8");
  const timesFound = text.split(input.old_text).length - 1;
  if (timesFound === 0) {
    throw new ToolError(`old_text is not in "${input.path}". Copy it exactly from the file.`);
  }
  if (timesFound > 1) {
    throw new ToolError(
      `old_text appears ${timesFound} times in "${input.path}". ` +
        "Add nearby words so it appears once.",
    );
  }
  writeFileSync(file, text.replace(input.old_text, input.new_text));
  toolContext.readFiles.set(file, statSync(file).mtimeMs);
  return `- ${input.old_text}\n+ ${input.new_text}`;
}

function fileStory(input: InputOf<"file_story">, toolContext: ToolContext): Promise<string> {
  // The same session filing the same story twice must not file it twice.
  const idempotencyKey = `${toolContext.sessionId}:${input.slug}`;
  // biome-ignore-start lint/style/useNamingConvention: the CMS reads this exact field name
  const body = { note: input.note, idempotency_key: idempotencyKey };
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
  return postToCms(toolContext, `/api/stories/${input.slug}/file`, body);
}

function holdStory(input: InputOf<"hold_story">, toolContext: ToolContext): Promise<string> {
  return postToCms(toolContext, `/api/stories/${input.slug}/hold`, { reason: input.reason });
}

function logCorrection(
  input: InputOf<"log_correction">,
  toolContext: ToolContext,
): Promise<string> {
  return postToCms(toolContext, "/api/corrections", input);
}

function writeTodos(input: InputOf<"todo_write">, toolContext: ToolContext): string {
  const inProgress = input.todos.filter((todo) => todo.status === "in_progress");
  if (inProgress.length > 1) {
    throw new ToolError("Only one item can be in_progress. Mark the others pending or done.");
  }
  toolContext.todos = input.todos;
  const done = input.todos.filter((todo) => todo.status === "done").length;
  return `Todo list saved: ${done} of ${input.todos.length} done.`;
}

function askResearcher(
  input: InputOf<"ask_researcher">,
  toolContext: ToolContext,
): Promise<string> {
  // Only the main desk has a researcher; a helper's context leaves it out.
  if (!toolContext.research) {
    throw new ToolError("A helper cannot ask another helper. Answer with what you found.");
  }
  return toolContext.research(input.question);
}

type ToolRunner = (input: never, toolContext: ToolContext) => string | Promise<string>;

// biome-ignore-start lint/style/useNamingConvention: the model sees these tool names
const runners: Record<ToolName, ToolRunner> = {
  list_files: listFiles,
  read_file: readFile,
  search_files: searchFiles,
  edit_file: editFile,
  file_story: fileStory,
  hold_story: holdStory,
  log_correction: logCorrection,
  todo_write: writeTodos,
  ask_researcher: askResearcher,
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  const descriptions = issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
  return descriptions.join("; ");
}

// Check the model's input against the tool's schema, then run the tool.
export async function runTool(
  name: string,
  input: unknown,
  toolContext: ToolContext,
): Promise<string> {
  if (!(name in schemas)) {
    const toolNames = Object.keys(schemas).join(", ");
    throw new ToolError(`There is no tool "${name}". Use one of: ${toolNames}.`);
  }
  const toolName = name as ToolName;
  const parsed = schemas[toolName].safeParse(input);
  if (!parsed.success) {
    const issues = describeIssues(parsed.error.issues);
    throw new ToolError(`The input for ${name} is not valid: ${issues}.`);
  }
  // The schema just checked the input, so it fits this tool's runner.
  return runners[toolName](parsed.data as never, toolContext);
}

// What desk asks before running a tool. Reads change nothing; the rest change the newsroom
// or the CMS.
export const READ_ONLY: ToolName[] = [
  "list_files",
  "read_file",
  "search_files",
  "todo_write",
  "ask_researcher",
];
export const EDITS: ToolName[] = ["edit_file"];
