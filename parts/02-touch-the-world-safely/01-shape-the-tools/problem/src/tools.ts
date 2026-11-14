// The tools desk gives the model. Each tool has a schema the model reads and a runner desk
// executes. These two come from Run the loop. This step adds three more and better errors.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { jsonSchema, tool } from "ai";

// The newsroom is the folder desk runs in. No tool reads or writes outside it.
const root = process.cwd();

// Every tool input is a few named pieces of text.
type ToolInput = Record<string, string>;

// Both tools take one input, a path. The example helps the model pick a sensible one.
function pathSchema(example: string) {
  return jsonSchema<ToolInput>({
    type: "object",
    properties: {
      path: {
        type: "string",
        description: `A path inside the newsroom folder, such as ${example}`,
      },
    },
    required: ["path"],
    additionalProperties: false,
  });
}

// TODO: add search_files { pattern, path }, file_story { slug, note } and
//       hold_story { slug, reason }. Give each a description and a schema with every field
//       required and additionalProperties: false.
// biome-ignore-start lint/style/useNamingConvention: the model calls each tool by this exact name
export const tools = {
  read_file: tool({
    description: "Read a text file from the newsroom.",
    inputSchema: pathSchema("drafts/bridge-repairs.md"),
  }),
  list_files: tool({
    description: "List the files in a newsroom folder.",
    inputSchema: pathSchema("drafts"),
  }),
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

function pathInsideNewsroom(path: string): string {
  const fullPath = resolve(root, path);
  if (relative(root, fullPath).startsWith("..")) {
    throw new Error(`"${path}" is outside the newsroom folder.`);
  }
  return fullPath;
}

function readFile(input: ToolInput): string {
  const fullPath = pathInsideNewsroom(input.path);
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    throw new Error(`There is no file "${input.path}". Use list_files to see what is there.`);
  }
  return readFileSync(fullPath, "utf8");
}

// TODO: when the path is not a folder, throw an error that names the tool to use next.
function listFiles(input: ToolInput): string {
  const fileNames = readdirSync(pathInsideNewsroom(input.path));
  return fileNames.sort().join("\n");
}

// TODO: searchFiles. Look in one file, or in every file of a folder. Return each matching line
//       as "path:line number: text". A missing path is an error that names a tool to try.
// TODO: fileStory and holdStory. POST to the CMS at process.env.CMS_URL:
//         /api/stories/<slug>/file  with { note, idempotency_key }
//         /api/stories/<slug>/hold  with { reason }
//       Make one id per run with crypto.randomUUID(). The key is that id plus the slug, so the
//       same filing sent twice files once. A 404 means there is no such story: say which tool
//       shows the slugs.

// biome-ignore-start lint/style/useNamingConvention: the model calls each tool by this exact name
const toolRunners: Record<string, (input: ToolInput) => string | Promise<string>> = {
  read_file: readFile,
  list_files: listFiles,
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
