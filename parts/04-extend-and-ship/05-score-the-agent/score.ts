// bun run score [folder]: run a desk over tonight's 12 drafts on the practice model, then score
// it from the CMS, never from what the agent says. The folder holds src/main.ts; it is this
// step's problem/ folder when you name none.
// It prints JSON: faults caught out of 13, which ones it missed, false flags, rule breaks,
// turns and cost. The answer key is world/seed/answer-key.json.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { answeredRuns } from "../../../checks/helpers/answered-runs";
import { contractEvents } from "../../../checks/helpers/contract";
import type { Run } from "../../../checks/lib/harness";
import { ruleBreaks } from "../../../world/cms/server";
import { answerKey } from "../../../world/lib/newsroom";
import { nightDesk } from "../../../world/practice-model/night-desk";

type Fault = ReturnType<typeof answerKey>["drafts"][string]["faults"][number];

export type Score = {
  caught: number;
  faults: number;
  missed: string[];
  // biome-ignore-start lint/style/useNamingConvention: the score's JSON fields
  false_flags: string[];
  rule_breaks: number;
  cost_usd: number;
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
  turns: number;
};

// desk may change the newsroom tonight without asking: nobody is at the terminal.
const NIGHT_CONFIG = {
  permissions: { allow: ["edit_file", "file_story", "hold_story", "log_correction"] },
};

// A fault is caught when the CMS shows the right outcome: a held story for a fault that must
// hold, or the right text filed and, for a factual fix, a correction logged.
function isCaught(run: Run, slug: string, fault: Fault): boolean {
  const state = run.world.cms.state();
  const story = state.stories[slug];
  if (!fault.right) return story.status === "held";
  const filedText = story.filed_text ?? "";
  const fixed = story.status === "filed" && filedText.includes(fault.right);
  if (!fault.correction) return fixed && !filedText.includes(fault.wrong ?? "");
  const logged = state.corrections.some(
    (entry) => entry.slug === slug && entry.wrong === fault.wrong,
  );
  return fixed && logged;
}

// The faults the run missed, and the clean stories it held for no reason.
function missesOf(run: Run) {
  const missed: string[] = [];
  const falseFlags: string[] = [];
  let faults = 0;
  for (const [slug, answer] of Object.entries(answerKey().drafts)) {
    const status = run.world.cms.state().stories[slug].status;
    if (answer.outcome === "file" && status === "held") falseFlags.push(slug);
    faults += answer.faults.length;
    const missedHere = answer.faults.filter((fault) => !isCaught(run, slug, fault));
    missed.push(...missedHere.map((fault) => fault.id));
  }
  return { missed, falseFlags, faults };
}

export function scoreOf(run: Run): Score {
  const { missed, falseFlags, faults } = missesOf(run);
  const result = contractEvents(run.stdout)?.at(-1) ?? {};
  const breaks = ruleBreaks(run.world.cms.state(), run.world.newsroom).length;
  return {
    caught: faults - missed.length,
    faults,
    missed,
    // biome-ignore-start lint/style/useNamingConvention: the score's JSON fields
    false_flags: falseFlags,
    rule_breaks: breaks,
    cost_usd: Number(result.cost_usd ?? 0),
    // biome-ignore-end lint/style/useNamingConvention: back to our own names
    turns: Number(result.turns ?? 0),
  };
}

// Three runs of the whole night, cached per folder, like every check.
export function nightRuns(folder: string) {
  return answeredRuns(folder, "score-the-agent", {
    args: ["-p", "Check tonight's drafts.", "--output-format", "stream-json", "--max-turns", "80"],
    setup: (world) => {
      writeFileSync(join(world.newsroom, "desk.config.json"), JSON.stringify(NIGHT_CONFIG));
    },
    scenario: () => nightDesk,
    timeoutMs: 60_000,
  });
}

if (import.meta.main) {
  const named = process.argv[2];
  const folder = resolve(named ?? join(import.meta.dir, "problem"));
  const [firstRun] = await nightRuns(folder);
  console.log(JSON.stringify(scoreOf(firstRun), null, 2));
  process.exit(0);
}
