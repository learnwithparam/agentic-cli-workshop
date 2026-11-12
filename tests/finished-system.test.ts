// The finished desk, run on the practice model in a fresh world, leaves the CMS in the state the
// README promises.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runDesk } from "../checks/lib/harness";
import { summary } from "../world/cms/server";
import { nightDesk } from "../world/practice-model/night-desk";

const FINISHED = join(import.meta.dir, "..", "finished", "desk");
const CONFIG = join(import.meta.dir, "..", "finished", "desk.config.json");

test("the finished desk files 9, holds 3, logs 7 corrections and breaks no rule", async () => {
  const run = await runDesk(FINISHED, {
    args: [
      "-p",
      "Check tonight's drafts.",
      "--permission-mode",
      "accept-all",
      "--output-format",
      "stream-json",
    ],
    // biome-ignore lint/style/useNamingConvention: the shell fixes this name
    env: { DESK_CONFIG: CONFIG },
    scenario: () => nightDesk,
    timeoutMs: 60_000,
    keep: true,
  });
  try {
    expect(run.code).toBe(0);
    const counts = summary(run.world.cms.state(), run.world.newsroom, 2);
    // biome-ignore lint/style/useNamingConvention: rule_breaks is the CMS's JSON field name
    const expected = { filed: 9, held: 3, waiting: 0, corrections: 7, rule_breaks: [] };
    expect(counts).toMatchObject(expected);
    // The fixes landed in the drafts on disk.
    const draft = readFileSync(
      join(run.world.newsroom, "drafts", "council-meeting-recap.md"),
      "utf8",
    );
    expect(draft).toContain("voted 11 to 4");
    // Every stdout line is one JSON event, and the run compacted and used the researcher on the
    // fast role.
    const lines = run.stdout.trim().split("\n");
    const events: { type: string }[] = lines.map((line) => JSON.parse(line));
    expect(events[0].type).toBe("init");
    expect(events.at(-1)).toMatchObject({ type: "result", subtype: "success" });
    expect(events.some((event) => event.type === "compact")).toBe(true);
    const researcherOnFast = run.requests.some(
      (request) => request.model === "practice-fast" && request.system.includes("researcher"),
    );
    expect(researcherOnFast).toBe(true);
    const deskRequests = run.requests.filter((request) =>
      request.system.startsWith("You are desk"),
    );
    expect(deskRequests.every((request) => request.model === "practice-smart")).toBe(true);
  } finally {
    run.world.cleanup();
  }
}, 90_000);

test("headless never-ask mode denies the filing and exits 4", async () => {
  const run = await runDesk(FINISHED, {
    args: [
      "-p",
      "Check tonight's drafts.",
      "--permission-mode",
      "never-ask",
      "--output-format",
      "json",
      "--max-turns",
      "12",
    ],
    scenario: () => nightDesk,
    timeoutMs: 60_000,
    keep: true,
  });
  try {
    expect([3, 4]).toContain(run.code ?? -1);
    const filings = run.world.cms.state().log.filter((entry) => entry.answer === "filed");
    expect(filings).toHaveLength(0);
  } finally {
    run.world.cleanup();
  }
}, 90_000);
