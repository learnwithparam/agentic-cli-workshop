// The tools desk gives the model. Each tool has a schema the model reads and a runner desk
// executes. Every error says what to try next, because the model reads it and tries again.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { jsonSchema, tool } from "ai";

// The newsroom is the folder desk runs in. No tool reads or writes outside it.
const root = process.cwd();
const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";

// One id for this run. file_story sends it, so the CMS files a story once, even when the model
// asks twice.
const runId = crypto.randomUUID();

// Every tool input is a few named pieces of text.
type ToolInput = Record<string, string>;

// A schema the model must follow exactly: every field is required, and no other field is allowed.
function strictSchema(fields: Record<string, string>) {
  const properties: Record<string, { type: "string"; description: string }> = {};
  for (const [name, description] of Object.entries(fields)) {
    properties[name] = { type: "string", description };
  }
  return jsonSchema<ToolInput>({
    type: "object",
    properties,
    required: Object.keys(fields),
    additionalProperties: false,
  });
}

// biome-ignore-start lint/style/useNamingConvention: the model calls each tool by this exact name
export const tools = {
  read_file: tool({
    description: "Read a text file from the newsroom.",
    inputSchema: strictSchema({ path: "A file in the newsroom, such as drafts/bridge-repairs.md" }),
  }),
  list_files: tool({
    description: "List the files in a newsroom folder.",
    inputSchema: strictSchema({ path: "A folder in the newsroom, such as drafts or sources" }),
  }),
  search_files: tool({
    description:
      "Find the lines that contain some text, in one file or in every file of a folder. " +
      "Each match shows its file and line number.",
    inputSchema: strictSchema({
      pattern: "The text to find, such as Brook Bridge. Case does not matter.",
      path: "A file or folder in the newsroom, such as sources",
    }),
  }),
  // TODO: add edit_file { path, old_text, new_text }, with a description that says old_text
  //       must appear exactly once in a file the model has read.
  file_story: tool({
    description: "File a checked story to the CMS for the 06:00 website update.",
    inputSchema: strictSchema({
      slug: "The story's slug, such as bridge-repairs",
      note: "The check note: the source file for each claim in the story",
    }),
  }),
  hold_story: tool({
    description: "Hold a story for the night editor, with a reason they can read.",
    inputSchema: strictSchema({
      slug: "The story's slug, such as new-clinic-opening",
      reason: "Why the night editor must look at it",
    }),
  }),
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

function pathInsideNewsroom(path: string): string {
  const fullPath = resolve(root, path);
  if (relative(root, fullPath).startsWith("..")) {
    throw new Error(`"${path}" is outside the newsroom. Use a path like drafts/bridge-repairs.md.`);
  }
  return fullPath;
}

// TODO: keep the text of each file as desk reads it, in a Map from the full path to the text.

function readFile(input: ToolInput): string {
  const fullPath = pathInsideNewsroom(input.path);
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    throw new Error(`There is no file "${input.path}". Use list_files to see what is there.`);
  }
  return readFileSync(fullPath, "utf8");
}

function listFiles(input: ToolInput): string {
  const fullPath = pathInsideNewsroom(input.path);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    throw new Error(
      `"${input.path}" is not a folder. Use read_file for a file, ` +
        'or list_files with path "." to see the folders.',
    );
  }
  const fileNames = readdirSync(fullPath);
  return fileNames.sort().join("\n");
}

// A folder is searched file by file. Subfolders are skipped.
function filesToSearch(fullPath: string): string[] {
  if (!statSync(fullPath).isDirectory()) return [fullPath];
  const paths = readdirSync(fullPath).map((fileName) => join(fullPath, fileName));
  return paths.filter((path) => statSync(path).isFile());
}

function searchFiles(input: ToolInput): string {
  const fullPath = pathInsideNewsroom(input.path);
  if (!existsSync(fullPath)) {
    throw new Error(
      `There is no file or folder "${input.path}". Use list_files with path "." to see them.`,
    );
  }
  const wanted = input.pattern.toLowerCase();
  const matches: string[] = [];
  for (const file of filesToSearch(fullPath)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(wanted)) {
        matches.push(`${relative(root, file)}:${index + 1}: ${line}`);
      }
    });
  }
  if (matches.length === 0) return `No line contains "${input.pattern}". Try a shorter text.`;
  return matches.slice(0, 50).join("\n");
}

// TODO: editFile. Refuse, with an error that says what to do next, when:
//         - desk has not read the file in this run
//         - the file changed on disk since desk read it
//         - old_text is not in the file, or is in it more than once
//       Otherwise replace that one piece, save the file and the new text, and return a short
//       diff: "- old text" and "+ new text".

// Send a change to the CMS. The CMS answers with JSON, and with { error } when it says no.
async function postToCms(path: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(`${cmsUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `The CMS at ${cmsUrl} did not answer. Ask the night editor to run bun run world.`,
    );
  }
  const reply = await response.json();
  return { status: response.status, reply };
}

async function changeStory(slug: string, action: "file" | "hold", body: unknown) {
  const { status, reply } = await postToCms(`/api/stories/${slug}/${action}`, body);
  if (status === 404) {
    throw new Error(`There is no story "${slug}". Use list_files with path "drafts" to see them.`);
  }
  if (status >= 400) throw new Error(reply.error);
  return `${slug} is now ${reply.status}.`;
}

function fileStory(input: ToolInput): Promise<string> {
  // The same key for the same story in this run, so a second identical filing changes nothing.
  // biome-ignore lint/style/useNamingConvention: the CMS reads this exact field name
  const body = { note: input.note, idempotency_key: `${runId}:${input.slug}` };
  return changeStory(input.slug, "file", body);
}

function holdStory(input: ToolInput): Promise<string> {
  return changeStory(input.slug, "hold", { reason: input.reason });
}

// biome-ignore-start lint/style/useNamingConvention: the model calls each tool by this exact name
const toolRunners: Record<string, (input: ToolInput) => string | Promise<string>> = {
  read_file: readFile,
  list_files: listFiles,
  search_files: searchFiles,
  file_story: fileStory,
  hold_story: holdStory,
  // TODO: edit_file
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

// Run one tool call. A problem throws an Error; the loop sends its message back to the model.
export function runTool(toolName: string, input: unknown): string | Promise<string> {
  const runner = toolRunners[toolName];
  if (!runner) {
    const toolNames = Object.keys(toolRunners).join(", ");
    throw new Error(`There is no tool "${toolName}". Use one of: ${toolNames}.`);
  }
  return runner(input as ToolInput);
}
