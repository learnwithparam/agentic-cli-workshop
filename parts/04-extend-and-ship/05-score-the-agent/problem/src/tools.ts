// The tools desk gives the model. Each tool has a schema the model reads and a runner desk
// executes. Every error says what to try next, because the model reads it and tries again.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { jsonSchema, tool } from "ai";
import { askResearcher } from "./researcher";
import { todoTool, writeTodos } from "./todos";

// The newsroom is the folder desk runs in. No tool reads or writes outside it.
const root = process.cwd();
const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";

// One id for this run. file_story sends it, so the CMS files a story once, even when the model
// asks twice.
const runId = crypto.randomUUID();

// Most tool inputs are a few named pieces of text. todo_write sends a list, so it has its own type.
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
  edit_file: tool({
    description:
      "Replace one piece of text in a file you have read. old_text must appear exactly once. " +
      "Returns a short diff.",
    inputSchema: strictSchema({
      path: "The file to change, such as drafts/river-levels.md",
      old_text: "The exact text to replace, copied from the file",
      new_text: "The text to put in its place",
    }),
  }),
  run_command: tool({
    description:
      "Run a shell command in the newsroom folder, such as awk over a CSV file. " +
      "It is stopped after 5 seconds. Long output is cut.",
    inputSchema: strictSchema({ command: "One shell command, such as wc -l sources/*.csv" }),
  }),
  file_story: tool({
    description: "File a checked story to the CMS for the 06:00 website update.",
    inputSchema: strictSchema({
      slug: "The story's slug, such as bridge-repairs",
      note: "The check note: the source file for each claim in the story",
    }),
  }),
  todo_write: todoTool,
  ask_researcher: tool({
    description:
      "Ask a helper with its own clean context to answer one question from the sources, " +
      "such as a vote in the long council transcript. Returns a short answer only.",
    inputSchema: strictSchema({ question: "One question, such as: what was the final vote?" }),
  }),
  // TODO: add log_correction { slug, wrong, right, source }. Its runner POSTs to
  //       /api/corrections on the CMS. Read the CMS API at the top of world/cms/server.ts.
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

// The text of each file as desk last read it, so edit_file can refuse a file it has not seen,
// or one that changed after it was read.
const textWhenRead = new Map<string, string>();

function readFile(input: ToolInput): string {
  const fullPath = pathInsideNewsroom(input.path);
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    throw new Error(`There is no file "${input.path}". Use list_files to see what is there.`);
  }
  const text = readFileSync(fullPath, "utf8");
  textWhenRead.set(fullPath, text);
  return text;
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

function editFile(input: ToolInput): string {
  const fullPath = pathInsideNewsroom(input.path);
  const lastRead = textWhenRead.get(fullPath);
  if (lastRead === undefined) {
    throw new Error(`Use read_file on "${input.path}" before you edit it.`);
  }
  const text = readFileSync(fullPath, "utf8");
  if (text !== lastRead) {
    throw new Error(`"${input.path}" changed since you read it. Use read_file to read it again.`);
  }
  const pieces = text.split(input.old_text);
  const timesFound = pieces.length - 1;
  if (timesFound === 0) {
    throw new Error(`old_text is not in "${input.path}". Use read_file and copy it exactly.`);
  }
  if (timesFound > 1) {
    throw new Error(
      `old_text is in "${input.path}" ${timesFound} times. Add nearby words so it is there once.`,
    );
  }
  const newText = pieces[0] + input.new_text + pieces[1];
  writeFileSync(fullPath, newText);
  textWhenRead.set(fullPath, newText);
  return `Edited ${input.path}\n- ${input.old_text}\n+ ${input.new_text}`;
}

const COMMAND_TIMEOUT_SECONDS = 5;
const LONGEST_OUTPUT = 20_000;

// Long output fills the model's context window and costs money, so keep the start and say how
// much is missing.
function cutLongOutput(output: string): string {
  if (output.length <= LONGEST_OUTPUT) return output;
  const cutCharacters = output.length - LONGEST_OUTPUT;
  return (
    `${output.slice(0, LONGEST_OUTPUT)}\n[cut: ${cutCharacters} more characters. ` +
    "Use a command that prints less, such as head or grep.]"
  );
}

// The command runs in the newsroom folder. That keeps paths short. It is not a sandbox.
function runCommand(input: ToolInput): string {
  const finished = Bun.spawnSync(["bash", "-c", input.command], {
    cwd: root,
    timeout: COMMAND_TIMEOUT_SECONDS * 1000,
  });
  if (finished.exitedDueToTimeout) {
    throw new Error(
      `The command ran for ${COMMAND_TIMEOUT_SECONDS} seconds and was stopped. ` +
        "Try a command that finishes faster.",
    );
  }
  const output = cutLongOutput(finished.stdout.toString() + finished.stderr.toString());
  if (finished.exitCode !== 0) {
    throw new Error(
      `The command failed with exit code ${finished.exitCode}. It printed:\n${output}`,
    );
  }
  return output || "The command printed nothing.";
}

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
const toolRunners: Record<string, (input: never) => string | Promise<string>> = {
  read_file: readFile,
  list_files: listFiles,
  search_files: searchFiles,
  edit_file: editFile,
  run_command: runCommand,
  file_story: fileStory,
  hold_story: holdStory,
  todo_write: writeTodos,
  ask_researcher: askResearcher,
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

// Add a tool that lives somewhere else, such as on an MCP server. The model sees it like the rest.
export function addTool(
  name: string,
  definition: unknown,
  runner: (input: never) => Promise<string>,
): void {
  (tools as Record<string, unknown>)[name] = definition;
  toolRunners[name] = runner;
}

// Run one tool call. A problem throws an Error; the loop sends its message back to the model.
export function runTool(toolName: string, input: unknown): string | Promise<string> {
  const runner = toolRunners[toolName];
  if (!runner) {
    const toolNames = Object.keys(toolRunners).join(", ");
    throw new Error(`There is no tool "${toolName}". Use one of: ${toolNames}.`);
  }
  // The schema already shaped the input for this tool's runner.
  return runner(input as never);
}
