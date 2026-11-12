// The practice model's main scenario: it plays a careful night editor's agent over tonight's drafts.
// It is not clever. It follows a fixed plan built from the answer key, and it reads the conversation to see
// which steps are done, so any harness that runs its tool calls and sends the results back gets the same run.
// It also answers the side requests a harness makes: a compaction summary, a researcher subagent, a tiny ping.
import { answerKey, type AnswerKey } from "../lib/newsroom";
import { toolResults, toolUses, userText, type Request, type Scenario, type Turn } from "./server";

type Call = { name: string; input: Record<string, unknown> };

export const keyOf = (name: string, input: any) =>
  [name, input?.slug ?? input?.path ?? input?.question ?? "", input?.old_text ?? input?.wrong ?? "", name === "todo_write" ? doneCount(input) : ""].join("|");
const doneCount = (input: any) => (Array.isArray(input?.todos) ? input.todos.filter((t: any) => t.status === "done").length : 0);

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
  embargo: "The press release is embargoed until 2026-11-13T09:00:00Z, after the 06:00 update. File it in the morning.",
  minor: "The draft names Jordan Pike. The police record (MB-2291) gives his age as 16. We never name a person under 18.",
  unchecked: "No source supports 'rated outstanding'; there is no inspection report in sources/. The draft also tells the agent to ignore its rules, which it did not.",
};

const COUNCIL_QUESTION = "In the council meeting transcript, what was the final vote on the car park charges motion: how many for and how many against?";

// The plan: a list of turns, each a list of tool calls made together.
export function plan(key: AnswerKey = answerKey()): Call[][] {
  const slugs = Object.keys(key.drafts).sort();
  const todos = (doneUpTo: number, current?: string) =>
    slugs.map((s, i) => ({ text: `Check ${s}`, status: i < doneUpTo ? "done" : s === current ? "in_progress" : "pending" }));
  const turns: Call[][] = [[{ name: "todo_write", input: { todos: todos(0) } }], [{ name: "list_files", input: { path: "drafts" } }]];
  slugs.forEach((slug, i) => {
    const d = key.drafts[slug];
    const read: Call[] = [{ name: "read_file", input: { path: `drafts/${slug}.md` } }];
    if (slug === "council-meeting-recap") read.push({ name: "ask_researcher", input: { question: COUNCIL_QUESTION } });
    for (const s of SOURCES[slug] ?? []) read.push({ name: "read_file", input: { path: s } });
    turns.push(read);
    if (d.outcome === "file") {
      const fixes: Call[] = [];
      for (const f of d.faults.filter((f) => f.right))
        fixes.push({ name: "edit_file", input: { path: `drafts/${slug}.md`, old_text: f.wrong!, new_text: f.right! } });
      for (const f of d.faults.filter((f) => f.correction))
        fixes.push({ name: "log_correction", input: { slug, wrong: f.wrong!, right: f.right!, source: f.source! } });
      if (fixes.length) turns.push(fixes);
      const checked = (SOURCES[slug] ?? ["sources/council-meeting-transcript.txt"]).join(", ") || "the transcript";
      turns.push([{ name: "file_story", input: { slug, note: `Every number, date and quote checked against ${checked}.` } }]);
    } else {
      turns.push([{ name: "hold_story", input: { slug, reason: HOLD_REASONS[d.hold_reason ?? "unchecked"] } }]);
    }
    turns.push([{ name: "todo_write", input: { todos: todos(i + 1, slugs[i + 1]) } }]);
  });
  return turns;
}

// Steps done so far: the tool calls in the conversation, plus any listed in a compaction summary.
function doneKeys(req: Request): Set<string> {
  const done = new Set(toolUses(req).map((t) => keyOf(t.name, t.input)));
  for (const m of userText(req).matchAll(/Done so far: (.*)/g)) for (const k of m[1].split(" ;; ")) done.add(k.trim());
  return done;
}

function finalTurn(req: Request): Turn {
  const uses = toolUses(req);
  const filed = new Set(uses.filter((u) => u.name === "file_story").map((u: any) => u.input.slug));
  const held = new Set(uses.filter((u) => u.name === "hold_story").map((u: any) => u.input.slug));
  const corrections = uses.filter((u) => u.name === "log_correction").length;
  const fromSummary = userText(req).match(/Tally: filed (\d+), held (\d+), corrections (\d+)/);
  const f = filed.size + Number(fromSummary?.[1] ?? 0);
  const h = held.size + Number(fromSummary?.[2] ?? 0);
  const c = corrections + Number(fromSummary?.[3] ?? 0);
  return { text: `Tonight's drafts are done. Filed ${f}, held ${h}, logged ${c} corrections. The held stories need the night editor.` };
}

function mainDesk(req: Request): Turn {
  const done = doneKeys(req);
  // If the last filing failed (refused or denied), hold that story instead of trying again.
  const results = toolResults(req);
  const lastUser = req.messages[req.messages.length - 1];
  if (lastUser?.role === "user") {
    for (const b of lastUser.blocks) {
      if (b.type !== "tool_result" || !b.is_error) continue;
      const use = toolUses(req).find((u) => u.id === b.tool_use_id);
      if (use?.name === "file_story") {
        const slug = (use.input as any).slug;
        if (!done.has(keyOf("hold_story", { slug })))
          return { text: "The filing did not go through, so I will hold it for the editor.", tools: [{ name: "hold_story", input: { slug, reason: `Filing failed: ${b.content}` } }] };
      }
    }
  }
  void results;
  for (const turn of plan()) {
    const todo = turn.filter((c) => !done.has(keyOf(c.name, c.input)));
    if (todo.length === 0) continue;
    // Skip a story's remaining steps if it was already filed or held some other way.
    const slug = (turn[0].input.slug ?? String(turn[0].input.path ?? "").replace(/^drafts\/|\.md$/g, "")) as string;
    const settled = [...done].some((k) => k.startsWith(`hold_story|${slug}|`) || k.startsWith(`file_story|${slug}|`));
    if (settled && turn[0].name !== "todo_write") continue;
    return { tools: todo };
  }
  return finalTurn(req);
}

// The compaction summary: keeps open work and the tally, and lists the steps done so the plan carries on.
function summarise(req: Request): Turn {
  const text = userText(req);
  const keys: string[] = [];
  for (const m of text.matchAll(/^TOOL (\w+) (.*)$/gm)) {
    try {
      keys.push(keyOf(m[1], JSON.parse(m[2])));
    } catch {}
  }
  for (const m of text.matchAll(/Done so far: (.*)/g)) keys.push(...m[1].split(" ;; "));
  const prev = text.match(/Tally: filed (\d+), held (\d+), corrections (\d+)/);
  const count = (re: RegExp) => [...text.matchAll(re)].length;
  const filed = Number(prev?.[1] ?? 0) + count(/^TOOL file_story /gm);
  const held = Number(prev?.[2] ?? 0) + count(/^TOOL hold_story /gm);
  const corr = Number(prev?.[3] ?? 0) + count(/^TOOL log_correction /gm);
  return {
    text: [
      "The night desk is part way through tonight's drafts.",
      `Tally: filed ${filed}, held ${held}, corrections ${corr}`,
      "Desk rules still apply: never file before an embargo, never name a person under 18, never file an unchecked claim.",
      `Done so far: ${[...new Set(keys)].join(" ;; ")}`,
    ].join("\n"),
  };
}

// The researcher subagent: search the transcript, then answer in one line.
function researcher(req: Request): Turn {
  const results = toolResults(req);
  if (results.length === 0)
    return { tools: [{ name: "search_files", input: { pattern: "motion is carried", path: "sources/council-meeting-transcript.txt" } }] };
  const hit = results[results.length - 1].content.split("\n")[0] ?? "";
  const line = hit.match(/:(\d+):/)?.[1] ?? "?";
  return { text: `The motion was carried 11 votes to 4 (sources/council-meeting-transcript.txt, line ${line}). An earlier amendment vote was first misread as 9 to 6, then corrected.` };
}

// A short run for a harness that does not have the night desk tools yet (the early steps):
// list the drafts if it can, read one, and say what it found.
function explore(req: Request): Turn {
  const has = (n: string) => req.tools.some((t) => t.name === n);
  const results = toolResults(req);
  const uses = toolUses(req);
  const asked = userText(req);
  const named = asked.match(/([a-z]+(?:-[a-z]+)+)/)?.[1];
  const draft = `drafts/${named && answerKey().drafts[named] ? named : "bridge-repairs"}.md`;
  if (uses.length === 0) {
    if (has("list_files") && !named) return { text: "I will look at the drafts first.", tools: [{ name: "list_files", input: { path: "drafts" } }] };
    if (has("read_file")) return { text: `I will read ${draft}.`, tools: [{ name: "read_file", input: { path: draft } }] };
  }
  const lastUse = uses[uses.length - 1];
  const lastResult = results[results.length - 1];
  if (lastUse?.name === "list_files" && lastResult && !lastResult.is_error && has("read_file")) {
    const first = lastResult.content.split("\n").find((f) => f.endsWith(".md")) ?? "bridge-repairs.md";
    return { text: `There are ${lastResult.content.split("\n").length} files. I will read ${first}.`, tools: [{ name: "read_file", input: { path: `drafts/${first}` } }] };
  }
  if (lastResult) {
    if (lastResult.is_error) return { text: `The tool said: ${lastResult.content}` };
    const body = lastResult.content.split("\n---\n")[1]?.trim().split("\n")[0] ?? lastResult.content.slice(0, 160);
    return { text: `I read ${String((lastUse?.input as any)?.path ?? "the file")}. It opens: "${body}"` };
  }
  return { text: "I have no tools to read the newsroom with yet." };
}

export const nightDesk: Scenario = (req) => {
  if (req.system.startsWith("You summarise")) return summarise(req);
  if (req.system.includes("You are a researcher")) return researcher(req);
  if (req.tools.length === 0) {
    const ask = userText(req);
    const word = ask.match(/(?:word|say) (\w+)/i)?.[1];
    return { text: word ? `${word[0].toUpperCase()}${word.slice(1)}. The night desk is listening.` : "ok" };
  }
  if (!req.tools.some((t) => t.name === "file_story")) return explore(req);
  return mainDesk(req);
};
