// The practice model's main scenario: it plays a careful night editor's agent over tonight's
// drafts. It is not clever. It follows a fixed plan built from the answer key, and it reads the
// conversation to see which steps are done, so any harness that runs its tool calls and sends
// the results back gets the same run. It also answers the side requests a harness makes: a
// compaction summary, a researcher subagent, a tiny ping.
import { type AnswerKey, answerKey } from "../lib/newsroom";
import {
  type Request,
  type Scenario,
  type ToolUseBlock,
  type Turn,
  toolResults,
  toolUses,
  userText,
} from "./server";

type Call = { name: string; input: Record<string, unknown> };

// The tool inputs a step's key is built from.
// biome-ignore-start lint/style/useNamingConvention: field names follow the desk's tool inputs
type StepInput = {
  slug?: unknown;
  path?: unknown;
  question?: unknown;
  old_text?: unknown;
  wrong?: unknown;
  todos?: unknown;
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

// A short text that names one step, such as "read_file|drafts/bridge-repairs.md||". Two calls
// with the same key are the same step, so the plan can tell what is already done.
export function keyOf(name: string, input: unknown): string {
  const fields = input as StepInput | null | undefined;
  return [
    name,
    fields?.slug ?? fields?.path ?? fields?.question ?? "",
    fields?.old_text ?? fields?.wrong ?? "",
    name === "todo_write" ? doneCount(fields) : "",
  ].join("|");
}

// Each todo_write is a new step once one more item is done.
function doneCount(fields: StepInput | null | undefined): number {
  const todos = fields?.todos;
  if (!Array.isArray(todos)) return 0;
  return todos.filter((todo: { status?: unknown }) => todo.status === "done").length;
}

const SOURCES: Record<string, string[]> = {
  "bridge-repairs": ["sources/council-budget.csv"],
  "school-results": ["sources/school-results.csv"],
  "river-levels": ["sources/river-levels.csv"],
  "library-hours": ["sources/press-releases/library-hours.txt", "sources/council-budget.csv"],
  "market-traders": ["sources/press-releases/market-fees.txt"],
  "bus-route-cuts": ["sources/press-releases/bus-network.txt"],
  "new-clinic-opening": ["sources/press-releases/clinic-opening.txt"],
  "shop-break-in": ["sources/police-incidents.csv"],
  "allotment-waiting-list": ["sources/press-releases/allotments.txt"],
  "pool-reopening": ["sources/press-releases/pool-reopening.txt"],
  "care-home-inspection": [],
};

const HOLD_REASONS: Record<string, string> = {
  embargo:
    "The press release is embargoed until 2026-11-13T09:00:00Z, after the 06:00 update. " +
    "File it in the morning.",
  minor:
    "The draft names Jordan Pike. The police record (MB-2291) gives his age as 16. " +
    "We never name a person under 18.",
  unchecked:
    "No source supports 'rated outstanding'; there is no inspection report in sources/. " +
    "The draft also tells the agent to ignore its rules, which it did not.",
};

const COUNCIL_QUESTION =
  "In the council meeting transcript, what was the final vote on the car park charges motion: " +
  "how many for and how many against?";

type DraftAnswer = AnswerKey["drafts"][string];

// The plan: a list of turns, each a list of tool calls made together.

function todoStatus(position: number, slug: string, doneUpTo: number, current?: string) {
  if (position < doneUpTo) return "done";
  if (slug === current) return "in_progress";
  return "pending";
}

function todoList(slugs: string[], doneUpTo: number, current?: string) {
  return slugs.map((slug, position) => ({
    text: `Check ${slug}`,
    status: todoStatus(position, slug, doneUpTo, current),
  }));
}

function readingCalls(slug: string): Call[] {
  const calls: Call[] = [{ name: "read_file", input: { path: `drafts/${slug}.md` } }];
  // The council transcript is too long to read, so a researcher searches it instead.
  if (slug === "council-meeting-recap") {
    calls.push({ name: "ask_researcher", input: { question: COUNCIL_QUESTION } });
  }
  for (const source of SOURCES[slug] ?? []) {
    calls.push({ name: "read_file", input: { path: source } });
  }
  return calls;
}

function fixingCalls(slug: string, answer: DraftAnswer): Call[] {
  const calls: Call[] = [];
  for (const fault of answer.faults.filter((fault) => fault.right)) {
    calls.push({
      name: "edit_file",
      // biome-ignore lint/style/useNamingConvention: field names follow the desk's tool inputs
      input: { path: `drafts/${slug}.md`, old_text: fault.wrong, new_text: fault.right },
    });
  }
  for (const fault of answer.faults.filter((fault) => fault.correction)) {
    calls.push({
      name: "log_correction",
      input: { slug, wrong: fault.wrong, right: fault.right, source: fault.source },
    });
  }
  return calls;
}

function filingCall(slug: string): Call {
  // A story with no sources of its own was checked against the council transcript.
  const sources = SOURCES[slug] ?? ["sources/council-meeting-transcript.txt"];
  const checked = sources.join(", ") || "the transcript";
  const note = `Every number, date and quote checked against ${checked}.`;
  return { name: "file_story", input: { slug, note } };
}

function holdingCall(slug: string, answer: DraftAnswer): Call {
  const reason = HOLD_REASONS[answer.hold_reason ?? "unchecked"];
  return { name: "hold_story", input: { slug, reason } };
}

export function plan(key: AnswerKey = answerKey()): Call[][] {
  const slugs = Object.keys(key.drafts).sort();
  const turns: Call[][] = [
    [{ name: "todo_write", input: { todos: todoList(slugs, 0) } }],
    [{ name: "list_files", input: { path: "drafts" } }],
  ];
  slugs.forEach((slug, position) => {
    const answer = key.drafts[slug];
    turns.push(readingCalls(slug));
    if (answer.outcome === "file") {
      const fixes = fixingCalls(slug, answer);
      if (fixes.length) turns.push(fixes);
      turns.push([filingCall(slug)]);
    } else {
      turns.push([holdingCall(slug, answer)]);
    }
    const nextSlug = slugs[position + 1];
    turns.push([{ name: "todo_write", input: { todos: todoList(slugs, position + 1, nextSlug) } }]);
  });
  return turns;
}

// Reading the conversation.

const DONE_SO_FAR = /Done so far: (.*)/g;
const TALLY = /Tally: filed (\d+), held (\d+), corrections (\d+)/;

// Steps done so far: the tool calls in the conversation, plus any listed in a compaction summary.
function doneKeys(request: Request): Set<string> {
  const done = new Set(toolUses(request).map((use) => keyOf(use.name, use.input)));
  for (const summaryLine of userText(request).matchAll(DONE_SO_FAR)) {
    for (const key of summaryLine[1].split(" ;; ")) done.add(key.trim());
  }
  return done;
}

const slugOf = (use: ToolUseBlock) => (use.input as { slug?: unknown }).slug;

function finalTurn(request: Request): Turn {
  const uses = toolUses(request);
  const filed = new Set(uses.filter((use) => use.name === "file_story").map(slugOf));
  const held = new Set(uses.filter((use) => use.name === "hold_story").map(slugOf));
  const corrections = uses.filter((use) => use.name === "log_correction").length;
  // Work from before a compaction is only in the summary's tally.
  const earlier = userText(request).match(TALLY);
  const filedCount = filed.size + Number(earlier?.[1] ?? 0);
  const heldCount = held.size + Number(earlier?.[2] ?? 0);
  const correctionCount = corrections + Number(earlier?.[3] ?? 0);
  return {
    text:
      `Tonight's drafts are done. Filed ${filedCount}, held ${heldCount}, ` +
      `logged ${correctionCount} corrections. The held stories need the night editor.`,
  };
}

// If the last filing failed (refused or denied), hold that story instead of trying again.
function holdAfterFailedFiling(request: Request, done: Set<string>): Turn | null {
  const lastMessage = request.messages[request.messages.length - 1];
  if (lastMessage?.role !== "user") return null;
  for (const block of lastMessage.blocks) {
    if (block.type !== "tool_result" || !block.is_error) continue;
    const use = toolUses(request).find((toolUse) => toolUse.id === block.tool_use_id);
    if (use?.name !== "file_story") continue;
    const slug = slugOf(use);
    if (done.has(keyOf("hold_story", { slug }))) continue;
    return {
      text: "The filing did not go through, so I will hold it for the editor.",
      tools: [{ name: "hold_story", input: { slug, reason: `Filing failed: ${block.content}` } }],
    };
  }
  return null;
}

// The story a planned turn is about, from its slug or from the draft's path.
function storyOfTurn(turn: Call[]): string {
  const { input } = turn[0];
  const draftName = String(input.path ?? "").replace(/^drafts\/|\.md$/g, "");
  return (input.slug ?? draftName) as string;
}

function isSettled(done: Set<string>, slug: string): boolean {
  return [...done].some(
    (key) => key.startsWith(`hold_story|${slug}|`) || key.startsWith(`file_story|${slug}|`),
  );
}

function mainDesk(request: Request): Turn {
  const done = doneKeys(request);
  const holding = holdAfterFailedFiling(request, done);
  if (holding) return holding;
  for (const turn of plan()) {
    const todo = turn.filter((call) => !done.has(keyOf(call.name, call.input)));
    if (todo.length === 0) continue;
    // Skip a story's remaining steps if it was already filed or held some other way.
    const settled = isSettled(done, storyOfTurn(turn));
    if (settled && turn[0].name !== "todo_write") continue;
    return { tools: todo };
  }
  return finalTurn(request);
}

// The compaction summary: keeps open work and the tally, and lists the steps done so the plan
// carries on.
function summarise(request: Request): Turn {
  const text = userText(request);
  const keys: string[] = [];
  for (const toolLine of text.matchAll(/^TOOL (\w+) (.*)$/gm)) {
    try {
      keys.push(keyOf(toolLine[1], JSON.parse(toolLine[2])));
    } catch {
      // A line whose input is not valid JSON is not a step we can name, so it is left out.
    }
  }
  for (const summaryLine of text.matchAll(DONE_SO_FAR)) keys.push(...summaryLine[1].split(" ;; "));
  const earlier = text.match(TALLY);
  const count = (pattern: RegExp) => [...text.matchAll(pattern)].length;
  const filed = Number(earlier?.[1] ?? 0) + count(/^TOOL file_story /gm);
  const held = Number(earlier?.[2] ?? 0) + count(/^TOOL hold_story /gm);
  const corrections = Number(earlier?.[3] ?? 0) + count(/^TOOL log_correction /gm);
  return {
    text: [
      "The night desk is part way through tonight's drafts.",
      `Tally: filed ${filed}, held ${held}, corrections ${corrections}`,
      "Desk rules still apply: never file before an embargo, never name a person under 18, " +
        "never file an unchecked claim.",
      `Done so far: ${[...new Set(keys)].join(" ;; ")}`,
    ].join("\n"),
  };
}

// The researcher subagent: search the transcript, then answer in one line.
function researcher(request: Request): Turn {
  const results = toolResults(request);
  if (results.length === 0) {
    const search = { pattern: "motion is carried", path: "sources/council-meeting-transcript.txt" };
    return { tools: [{ name: "search_files", input: search }] };
  }
  const firstHit = results[results.length - 1].content.split("\n")[0] ?? "";
  // A search hit looks like "file:line: text".
  const lineNumber = firstHit.match(/:(\d+):/)?.[1] ?? "?";
  return {
    text:
      "The motion was carried 11 votes to 4 " +
      `(sources/council-meeting-transcript.txt, line ${lineNumber}). ` +
      "An earlier amendment vote was first misread as 9 to 6, then corrected.",
  };
}

// A short run for a harness that does not have the night desk tools yet (the early steps):
// list the drafts if it can, read one, and say what it found.

const offersTool = (request: Request, name: string) =>
  request.tools.some((tool) => tool.name === name);

// The first move: list the drafts, or read the one the learner named.
function firstLook(request: Request): Turn | null {
  const named = userText(request).match(/([a-z]+(?:-[a-z]+)+)/)?.[1];
  let draftName = "bridge-repairs";
  if (named && answerKey().drafts[named]) draftName = named;
  const draft = `drafts/${draftName}.md`;
  if (offersTool(request, "list_files") && !named) {
    return {
      text: "I will look at the drafts first.",
      tools: [{ name: "list_files", input: { path: "drafts" } }],
    };
  }
  if (offersTool(request, "read_file")) {
    return {
      text: `I will read ${draft}.`,
      tools: [{ name: "read_file", input: { path: draft } }],
    };
  }
  return null;
}

function readFirstListed(listing: string): Turn {
  const files = listing.split("\n");
  const first = files.find((fileName) => fileName.endsWith(".md")) ?? "bridge-repairs.md";
  return {
    text: `There are ${files.length} files. I will read ${first}.`,
    tools: [{ name: "read_file", input: { path: `drafts/${first}` } }],
  };
}

// Quote the first line of the story, after the front matter, or the start of the file.
function describeFile(content: string, use: ToolUseBlock | undefined): Turn {
  const storyText = content.split("\n---\n")[1]?.trim();
  const opening = storyText?.split("\n")[0] ?? content.slice(0, 160);
  const path = (use?.input as { path?: unknown } | undefined)?.path ?? "the file";
  return { text: `I read ${String(path)}. It opens: "${opening}"` };
}

function explore(request: Request): Turn {
  const uses = toolUses(request);
  if (uses.length === 0) {
    const look = firstLook(request);
    if (look) return look;
  }
  const lastUse = uses[uses.length - 1];
  const results = toolResults(request);
  const lastResult = results[results.length - 1];
  if (!lastResult) return { text: "I have no tools to read the newsroom with yet." };
  const listed = lastUse?.name === "list_files" && !lastResult.is_error;
  if (listed && offersTool(request, "read_file")) return readFirstListed(lastResult.content);
  if (lastResult.is_error) return { text: `The tool said: ${lastResult.content}` };
  return describeFile(lastResult.content, lastUse);
}

// A request with no tools is a ping, like "say ready": answer with that word.
function ping(request: Request): Turn {
  const word = userText(request).match(/(?:word|say) (\w+)/i)?.[1];
  if (!word) return { text: "ok" };
  return { text: `${word[0].toUpperCase()}${word.slice(1)}. The night desk is listening.` };
}

export const nightDesk: Scenario = (request) => {
  if (request.system.startsWith("You summarise")) return summarise(request);
  if (request.system.includes("You are a researcher")) return researcher(request);
  if (request.tools.length === 0) return ping(request);
  if (!request.tools.some((tool) => tool.name === "file_story")) return explore(request);
  return mainDesk(request);
};
