// shape-the-tools: desk offers five tools with strict schemas, its errors name a tool the model
// can try next, and filing the same story twice files it once.
import type { Rule } from "../scripts/verify";
import { answeredRuns, cmsLog, playTurns, resultOf } from "./helpers/answered-runs";
import { every, plant, type World } from "./lib/harness";

const NEEDED_TOOLS = ["read_file", "list_files", "search_files", "file_story", "hold_story"];
const FILING_NOTE = "Figures checked against sources/council-budget.csv.";

// Calls a careless model makes. Each comes back as an error the model can act on.
function badCalls(world: World) {
  return [
    { name: "read_file", input: { path: "drafts/bridge-repair.md" } },
    { name: "list_files", input: { path: "drafts/bridge-repairs.md" } },
    { name: "search_files", input: { pattern: world.nonce, path: `archive-${world.nonce}` } },
    { name: "file_story", input: { slug: "bridge-repair", note: FILING_NOTE } },
  ];
}

// One call per turn: the bad calls, a search for a planted line, then the same filing twice.
function nightOfShaping(world: World) {
  const filing = { name: "file_story", input: { slug: "bridge-repairs", note: FILING_NOTE } };
  const search = { name: "search_files", input: { pattern: world.nonce, path: "drafts" } };
  const turns = [...badCalls(world), search, filing, filing].map((call) => [call]);
  return playTurns(turns);
}

const shaping = (folder: string) =>
  answeredRuns(folder, "shape-the-tools", {
    args: ["-p", "Check the bridge-repairs draft and file it."],
    setup: (world) => plant(world, "drafts/library-hours.md", `Search mark ${world.nonce}.`),
    scenario: nightOfShaping,
  });

// A tool name in the error text tells the model what it can call next.
function mentionsTool(text: string): boolean {
  return NEEDED_TOOLS.some((toolName) => text.includes(toolName));
}

const sameInput = (wanted: unknown) => (input: unknown) =>
  JSON.stringify(input) === JSON.stringify(wanted);

export default [
  {
    says: "desk offers read_file, list_files, search_files, file_story and hold_story",
    test: (folder) =>
      every(shaping(folder), (desk) => {
        const offered = desk.requests[0].tools.map((tool) => tool.name);
        return NEEDED_TOOLS.every((toolName) => offered.includes(toolName));
      }),
    tryNext:
      "Add search_files, file_story and hold_story to the tools object in src/tools.ts, " +
      "and a runner for each in toolRunners.",
  },
  {
    says: "Every tool schema lists its fields as required and sets additionalProperties to false",
    test: (folder) =>
      every(shaping(folder), (desk) =>
        desk.requests[0].tools.every((tool) => {
          const fields = Object.keys(tool.schema?.properties ?? {});
          const required = tool.schema?.required ?? [];
          const allRequired = fields.every((field) => required.includes(field));
          return tool.schema?.additionalProperties === false && fields.length > 0 && allRequired;
        }),
      ),
    tryNext:
      "Build every schema with jsonSchema({ type, properties, required, " +
      "additionalProperties: false }), with every field in required.",
  },
  {
    says: "search_files finds a planted line and says which file it is in",
    test: (folder) =>
      every(shaping(folder), (desk) => {
        const wanted = { pattern: desk.world.nonce, path: "drafts" };
        const result = resultOf(desk, "search_files", sameInput(wanted));
        const found = result?.content ?? "";
        return (
          found.includes("library-hours.md") && found.includes(`Search mark ${desk.world.nonce}`)
        );
      }),
    tryNext:
      "Read every file in the folder, keep the lines that contain the pattern, " +
      'and return each one as "path:line number: text".',
  },
  {
    says: "Each planted bad call comes back as an error that names a tool to try next",
    test: (folder) =>
      every(shaping(folder), (desk) =>
        badCalls(desk.world).every((call) => {
          const result = resultOf(desk, call.name, sameInput(call.input));
          if (!result?.is_error) return false;
          return mentionsTool(result.content);
        }),
      ),
    tryNext:
      'Throw an Error that says what went wrong and which tool helps, such as "Use list_files ' +
      'to see what is there." Turn a CMS 404 into "Use list_files with path drafts".',
  },
  {
    says: "Two identical file_story calls file the story once: the CMS answers both with 200",
    test: (folder) =>
      every(shaping(folder), (desk) => {
        const filings = cmsLog(desk, "/api/stories/bridge-repairs/file");
        const bothAccepted = filings.every((line) => line.status === 200);
        const story = desk.world.cms.state().stories["bridge-repairs"];
        return filings.length === 2 && bothAccepted && story.status === "filed";
      }),
    tryNext:
      "Send idempotency_key with every filing. Make it from one id per run plus the slug, " +
      "so the same filing gets the same key.",
  },
] satisfies Rule[];
