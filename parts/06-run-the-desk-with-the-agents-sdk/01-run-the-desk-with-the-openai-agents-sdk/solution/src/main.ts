// desk, the OpenAI Agents SDK version: the same night desk, with the SDK's loop instead of ours.
// You give the SDK an Agent with instructions and tools, then call run(). The SDK runs the tool
// loop. A filing that needs the night editor pauses for approval, and the desk refuses it.
// Run from the newsroom folder:
//   bun src/main.ts -p "check tonight's drafts"
// Exit codes: 0 the desk finished, 1 an error.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  tool,
} from "@openai/agents";
import OpenAi from "openai";
import { z } from "zod";
import { model, replayUrl } from "#models";

const promptFlag = process.argv.indexOf("-p");
const prompt = promptFlag >= 0 ? process.argv[promptFlag + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "check tonight\'s drafts"');
  process.exit(1);
}

// Only the practice model is reached from here. No call may leave the machine.
setTracingDisabled(true);
setOpenAIAPI("chat_completions");
// biome-ignore-start lint/style/useNamingConvention: the OpenAI client fixes this option name
setDefaultOpenAIClient(new OpenAi({ baseURL: `${replayUrl()}/v1`, apiKey: "practice" }));
// biome-ignore-end lint/style/useNamingConvention: back to our own names

const newsroom = process.cwd();
const cmsUrl = process.env.CMS_URL ?? "http://localhost:4020";
const runId = crypto.randomUUID().slice(0, 8);
const MAX_TURNS = 60;
const DENIED =
  "Error: denied. The night editor must approve this filing, so it was not filed. " +
  "Hold the story instead, with a reason.";

// A path inside the newsroom folder, or null when the path leaves it.
function insideNewsroom(path: string): string | null {
  const fullPath = resolve(newsroom, path);
  const fromRoot = relative(newsroom, fullPath);
  return fromRoot.startsWith("..") ? null : fullPath;
}

// --- Read-only tools ---

function listFolder(path: string): string {
  const folder = insideNewsroom(path);
  if (folder === null) return `Error: "${path}" is outside the newsroom folder. Try "drafts".`;
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return `Error: "${path}" is not a folder. Try list_files with path "." first.`;
  }
  return readdirSync(folder)
    .filter((name) => !name.startsWith("."))
    .sort()
    .join("\n");
}

function readText(path: string): string {
  const file = insideNewsroom(path);
  if (file === null) return `Error: "${path}" is outside the newsroom folder.`;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    return `Error: There is no file "${path}". Use list_files to see what is there.`;
  }
  return readFileSync(file, "utf8").slice(0, 20_000);
}

function filesUnder(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target)
    .map((name) => join(target, name))
    .filter((file) => statSync(file).isFile());
}

function matchingLines(file: string, wanted: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const found = lines.flatMap((line, index) => {
    if (!line.toLowerCase().includes(wanted)) return [];
    return [`${relative(newsroom, file)}:${index + 1}: ${line.slice(0, 400)}`];
  });
  return found;
}

function searchText(pattern: string, path: string): string {
  const target = insideNewsroom(path);
  if (target === null || !existsSync(target)) return `Error: There is no file or folder "${path}".`;
  const wanted = pattern.toLowerCase();
  const matches = filesUnder(target).flatMap((file) => matchingLines(file, wanted));
  if (matches.length === 0) return `No line contains "${pattern}". Try a shorter phrase.`;
  return matches.slice(0, 50).join("\n");
}

// --- Editing and the CMS ---

function editText(path: string, oldText: string, newText: string): string {
  const file = insideNewsroom(path);
  if (file === null || !existsSync(file)) return `Error: There is no file "${path}".`;
  const text = readFileSync(file, "utf8");
  const timesFound = text.split(oldText).length - 1;
  if (timesFound === 0)
    return `Error: old_text is not in "${path}". Copy it exactly from the file.`;
  if (timesFound > 1) {
    return `Error: old_text appears ${timesFound} times in "${path}". Add nearby words.`;
  }
  // A function as the replacement keeps "$" in the new text from being read as a pattern.
  writeFileSync(
    file,
    text.replace(oldText, () => newText),
  );
  return `- ${oldText}\n+ ${newText}`;
}

async function postToCms(path: string, body: object): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${cmsUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return `Error: The CMS at ${cmsUrl} did not answer. Ask the night editor to run bun run world.`;
  }
  const reply = (await response.json().catch(() => ({}))) as { error?: string; slug?: string };
  if (!response.ok) return `Error: ${reply.error ?? `The CMS answered ${response.status}.`}`;
  return JSON.stringify({ slug: reply.slug ?? path, status: "ok" });
}

// --- The hold rules: a story waits for the night editor when its files say so ---

// The value of one frontmatter field, such as embargo or sources.
function frontmatterField(draft: string, field: string): string {
  const line = draft.split("\n").find((text) => text.startsWith(`${field}:`));
  return (line ?? "").slice(field.length + 1).trim();
}

// A person under 18 in the police record, whose name the draft uses.
function namesMinorInPoliceRecord(draft: string): boolean {
  const recordFile = join(newsroom, "sources", "police-incidents.csv");
  if (!existsSync(recordFile)) return false;
  const rows = readFileSync(recordFile, "utf8").split("\n").slice(1);
  return rows.some((row) => {
    const [, , , personName = "", age = ""] = row.split(",");
    return personName !== "" && age !== "" && Number(age) < 18 && draft.includes(personName);
  });
}

// True when the draft has an embargo, names no source, or names a minor.
function needsEditorApproval(slug: string): boolean {
  const draftFile = insideNewsroom(join("drafts", `${slug}.md`));
  if (draftFile === null || !existsSync(draftFile)) return true;
  const draft = readFileSync(draftFile, "utf8");
  const sources = frontmatterField(draft, "sources");
  const hasEmbargo = frontmatterField(draft, "embargo") !== "";
  const hasNoSource = sources === "" || sources === "[]";
  return hasEmbargo || hasNoSource || namesMinorInPoliceRecord(draft);
}

// --- The tools the Agent gets ---

const listFilesTool = tool({
  name: "list_files",
  description: "List the files in a newsroom folder, such as drafts or sources.",
  parameters: z.object({ path: z.string() }),
  execute: ({ path }) => listFolder(path),
});

const readFileTool = tool({
  name: "read_file",
  description: "Read a text file from the newsroom. Long files are cut; search them instead.",
  parameters: z.object({ path: z.string() }),
  execute: ({ path }) => readText(path),
});

const searchFilesTool = tool({
  name: "search_files",
  description: "Find lines that contain some text in a file or folder.",
  parameters: z.object({ pattern: z.string(), path: z.string() }),
  execute: ({ pattern, path }) => searchText(pattern, path),
});

// biome-ignore-start lint/style/useNamingConvention: the model sees these field names
const editFileTool = tool({
  name: "edit_file",
  description: "Replace text in a draft. old_text must appear exactly once in the file.",
  parameters: z.object({
    path: z.string(),
    old_text: z.string().describe("Text that appears exactly once in the file"),
    new_text: z.string(),
  }),
  execute: ({ path, old_text, new_text }) => editText(path, old_text, new_text),
});
// biome-ignore-end lint/style/useNamingConvention: back to our own names

const fileStoryTool = tool({
  name: "file_story",
  description: "File a checked story to the CMS for the 06:00 website update. Needs a check note.",
  parameters: z.object({ slug: z.string(), note: z.string() }),
  needsApproval: async (_context, input) => needsEditorApproval(input.slug),
  execute: ({ slug, note }) =>
    // biome-ignore lint/style/useNamingConvention: the CMS reads this exact field name
    postToCms(`/api/stories/${slug}/file`, { note, idempotency_key: `${runId}:${slug}` }),
});

const holdStoryTool = tool({
  name: "hold_story",
  description: "Hold a story for the night editor, with a reason they can read.",
  parameters: z.object({ slug: z.string(), reason: z.string() }),
  execute: ({ slug, reason }) => postToCms(`/api/stories/${slug}/hold`, { reason }),
});

const logCorrectionTool = tool({
  name: "log_correction",
  description: "Log a factual correction to the public corrections log.",
  parameters: z.object({
    slug: z.string(),
    wrong: z.string(),
    right: z.string(),
    source: z.string(),
  }),
  execute: (correction) => postToCms("/api/corrections", correction),
});

const todoWriteTool = tool({
  name: "todo_write",
  description: "Replace the todo list. Send the full list every time.",
  parameters: z.object({
    todos: z.array(
      z.object({
        text: z.string(),
        status: z.enum(["pending", "in_progress", "done"]),
      }),
    ),
  }),
  execute: ({ todos }) => {
    const done = todos.filter((todo) => todo.status === "done").length;
    return `Todo list saved: ${done} of ${todos.length} done.`;
  },
});

// --- The researcher: a second Agent with its own clean context, read-only tools ---

const deskModel = model("smart").modelId;

const researcher = new Agent({
  name: "Researcher",
  model: deskModel,
  instructions:
    "You are a researcher for the Millbrook Herald night desk. " +
    "Answer one question from the files in sources/. Search, do not read whole long files. " +
    "Reply with a short answer that cites the file and line.",
  tools: [listFilesTool, readFileTool, searchFilesTool],
});

const askResearcherTool = tool({
  name: "ask_researcher",
  description: "Ask a helper with its own clean context to answer one question from the sources.",
  parameters: z.object({ question: z.string() }),
  execute: async ({ question }) => {
    const answer = await run(researcher, question, { maxTurns: 8 });
    return String(answer.finalOutput ?? "The researcher found no answer.").slice(0, 2000);
  },
});

// --- The desk Agent: instructions from the desk's rule files, plus the tools ---

function deskInstructions(): string {
  const lines = [
    "You are desk, the night desk agent of the Millbrook Herald, a regional daily newspaper.",
    "Check every draft in drafts/ against the files in sources/. Fix what the sources prove",
    "wrong, log a correction for each factual fix, apply house style, then file each clean",
    "story or hold it with a reason. Use the tools. Keep a todo list. When every draft is",
    "filed or held, reply with one short summary and no tool call.",
  ];
  for (const rulesFile of ["DESK.md", join("drafts", "DESK.md")]) {
    const rulesPath = join(newsroom, rulesFile);
    if (!existsSync(rulesPath)) continue;
    const rules = readFileSync(rulesPath, "utf8").trim();
    lines.push(`\n<desk-rules file="${rulesFile}">\n${rules}\n</desk-rules>`);
  }
  return lines.join("\n");
}

const desk = new Agent({
  name: "Desk",
  model: deskModel,
  instructions: deskInstructions(),
  tools: [
    listFilesTool,
    readFileTool,
    searchFilesTool,
    editFileTool,
    fileStoryTool,
    holdStoryTool,
    logCorrectionTool,
    todoWriteTool,
    askResearcherTool,
  ],
});

// --- The run: pause at each filing that needs the editor, and refuse it ---

async function runDesk(input: string) {
  let result = await run(desk, input, { maxTurns: MAX_TURNS });
  while (result.interruptions.length > 0) {
    for (const interruption of result.interruptions) {
      result.state.reject(interruption, { message: DENIED });
    }
    result = await run(desk, result.state, { maxTurns: MAX_TURNS });
  }
  return result;
}

// The CMS keeps the count. Print the same line the finished desk prints.
async function statusLine(): Promise<string> {
  const response = await fetch(`${cmsUrl}/api/status`);
  const counts = (await response.json()) as {
    filed: number;
    held: number;
    waiting: number;
    corrections: number;
    // biome-ignore lint/style/useNamingConvention: this field name is part of the JSON API
    rule_breaks: unknown[];
  };
  return (
    `Filed ${counts.filed}, held ${counts.held}, waiting ${counts.waiting}. ` +
    `Corrections logged tonight: ${counts.corrections}. ` +
    `Rule breaks: ${counts.rule_breaks.length}.`
  );
}

try {
  const result = await runDesk(prompt);
  console.log(String(result.finalOutput ?? "").trim());
  console.log(await statusLine());
  process.exit(0);
} catch (error) {
  console.log(`desk stopped with an error: ${(error as Error).message}`);
  process.exit(1);
}
