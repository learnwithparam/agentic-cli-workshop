// The finished desk, run on the practice model in a fresh world, leaves the CMS in the state the README promises.
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
    env: { DESK_CONFIG: CONFIG },
    scenario: () => nightDesk,
    timeoutMs: 60_000,
    keep: true,
  });
  try {
    expect(run.code).toBe(0);
    const s = summary(run.world.cms.state(), run.world.newsroom, 2);
    expect(s).toMatchObject({ filed: 9, held: 3, waiting: 0, corrections: 7, rule_breaks: [] });
    // The fixes landed in the drafts on disk.
    const draft = readFileSync(
      join(run.world.newsroom, "drafts", "council-meeting-recap.md"),
      "utf8",
    );
    expect(draft).toContain("voted 11 to 4");
    // Every stdout line is one JSON event, and the run compacted and used the researcher on the fast role.
    const events = run.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events[0].type).toBe("init");
    expect(events.at(-1)).toMatchObject({ type: "result", subtype: "success" });
    expect(events.some((e) => e.type === "compact")).toBe(true);
    expect(
      run.requests.some((q) => q.model === "practice-fast" && q.system.includes("researcher")),
    ).toBe(true);
    expect(
      run.requests
        .filter((q) => q.system.startsWith("You are desk"))
        .every((q) => q.model === "practice-smart"),
    ).toBe(true);
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
    expect(run.world.cms.state().log.filter((l) => l.answer === "filed")).toHaveLength(0);
  } finally {
    run.world.cleanup();
  }
}, 90_000);
