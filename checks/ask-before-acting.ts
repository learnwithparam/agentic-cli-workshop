// ask-before-acting: every tool call passes the permission gate. The checks type the night
// editor's answers into stdin, then read the CMS and the files, never what the model says.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { type AnsweredOptions, answeredRuns, playTurns, resultOf } from "./helpers/answered-runs";
import { every, type Run, type World } from "./lib/harness";

const RIVER = "drafts/river-levels.md";
const NOTE = "Checked against the sources.";

const readRiver = { name: "read_file", input: { path: RIVER } };
const fixRiver = {
  name: "edit_file",
  // biome-ignore lint/style/useNamingConvention: field names follow the edit_file tool
  input: { path: RIVER, old_text: "on the ninth", new_text: "on the tenth" },
};
const fileStory = (slug: string) => ({ name: "file_story", input: { slug, note: NOTE } });
const createFile = { name: "run_command", input: { command: "touch planned.txt" } };

type Gated = {
  name: string;
  mode?: string;
  answers: string;
  calls: { name: string; input: unknown }[];
};

function gatedRuns(folder: string, gated: Gated, setup?: (world: World) => void) {
  const args = ["-p", "Check tonight's drafts."];
  if (gated.mode) args.push("--permission-mode", gated.mode);
  const options: AnsweredOptions = {
    args,
    answers: gated.answers,
    setup,
    // One call per turn, so each prompt reads the next answer.
    scenario: () => playTurns(gated.calls.map((call) => [call])),
  };
  return answeredRuns(folder, gated.name, options);
}

const answeredNo = (folder: string) =>
  gatedRuns(folder, {
    name: "no",
    answers: "n\n",
    calls: [readRiver, fileStory("bridge-repairs")],
  });
const answeredYesThenAlways = (folder: string) =>
  gatedRuns(folder, {
    name: "yes-then-always",
    answers: "y\na\n",
    calls: [fileStory("bridge-repairs"), fileStory("river-levels"), fileStory("library-hours")],
  });
const denyAndAllow = (folder: string) =>
  gatedRuns(
    folder,
    { name: "deny-and-allow", answers: "y\n", calls: [fileStory("bridge-repairs")] },
    (world) => {
      const permissions = { allow: ["file_story"], deny: ["file_story"] };
      writeFileSync(join(world.newsroom, "desk.config.json"), JSON.stringify({ permissions }));
    },
  );
const planMode = (folder: string) =>
  gatedRuns(folder, {
    name: "plan",
    mode: "plan",
    answers: "y\ny\ny\n",
    calls: [readRiver, fixRiver, fileStory("river-levels"), createFile],
  });
const neverAsk = (folder: string) =>
  gatedRuns(folder, {
    name: "never-ask",
    mode: "never-ask",
    answers: "y\ny\n",
    calls: [readRiver, fixRiver, fileStory("river-levels")],
  });
const acceptEdits = (folder: string) =>
  gatedRuns(folder, {
    name: "accept-edits",
    mode: "accept-edits",
    answers: "",
    calls: [readRiver, fixRiver, fileStory("river-levels")],
  });

const filingsOf = (desk: Run) =>
  desk.world.cms.state().log.filter((line) => line.path.endsWith("/file"));
const statusOf = (desk: Run, slug: string) => desk.world.cms.state().stories[slug]?.status;
const riverNow = (desk: Run) => readFileSync(join(desk.world.newsroom, RIVER), "utf8");
const riverWasFixed = (desk: Run) => riverNow(desk).includes("on the tenth");

function resultFor(desk: Run, call: { name: string; input: unknown }) {
  const wanted = JSON.stringify(call.input);
  return resultOf(desk, call.name, (input) => JSON.stringify(input) === wanted);
}

const readWorked = (desk: Run) => resultFor(desk, readRiver)?.is_error === false;

export default [
  {
    says: "Answered n, the CMS is unchanged and the model hears the call was denied",
    test: (folder) =>
      every(answeredNo(folder), (desk) => {
        const result = resultFor(desk, fileStory("bridge-repairs"));
        const toldDenied = result?.is_error === true && /denied|said no/i.test(result.content);
        return toldDenied && filingsOf(desk).length === 0;
      }),
    tryNext:
      "Ask with prompt() before file_story runs. Anything but y or a is a no: " +
      'throw an Error that starts with "Denied:" and do not call the tool.',
  },
  {
    says: "Read-only tools run without a prompt",
    test: (folder) => every(answeredNo(folder), readWorked),
    tryNext:
      "Allow read_file, list_files and search_files before you ask. " +
      "A gate that asks about everything teaches people to say yes.",
  },
  {
    says: "y files the story once, and a covers later calls to the same tool",
    test: (folder) =>
      every(answeredYesThenAlways(folder), (desk) => {
        const slugs = ["bridge-repairs", "river-levels", "library-hours"];
        return slugs.every((slug) => statusOf(desk, slug) === "filed");
      }),
    tryNext:
      "On a, add the tool name to a Set and allow it from then on, until the run ends. " +
      "On y, allow this one call only.",
  },
  {
    says: "A deny rule in desk.config.json beats an allow rule for the same tool",
    test: (folder) => every(denyAndAllow(folder), (desk) => filingsOf(desk).length === 0),
    tryNext: "Check the deny list first, before plan mode, the allow list or the prompt.",
  },
  {
    says: "Plan mode leaves the files and the CMS untouched, and reads still work",
    test: (folder) =>
      every(planMode(folder), (desk) => {
        const nothingChanged = !riverWasFixed(desk) && filingsOf(desk).length === 0;
        const noNewFile = !existsSync(join(desk.world.newsroom, "planned.txt"));
        return nothingChanged && noNewFile && readWorked(desk);
      }),
    tryNext:
      "Right after the deny rules: in plan mode, deny every tool that is not read-only, " +
      "without asking.",
  },
  {
    says: "never-ask mode denies every call that would prompt",
    test: (folder) =>
      every(neverAsk(folder), (desk) => {
        const nothingChanged = !riverWasFixed(desk) && filingsOf(desk).length === 0;
        return nothingChanged && readWorked(desk);
      }),
    tryNext:
      "Just before you would ask: in never-ask mode, deny instead. " +
      "A run with nobody at the terminal must never wait for an answer.",
  },
  {
    says: "accept-edits mode runs edit_file but still asks before filing",
    test: (folder) =>
      every(acceptEdits(folder), (desk) => riverWasFixed(desk) && filingsOf(desk).length === 0),
    tryNext: "In accept-edits mode, allow edit_file without asking. Every other change still asks.",
  },
] satisfies Rule[];
