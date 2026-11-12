// swap-the-model: the same desk runs on a second provider by changing one setting, with no code change.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { every, runs, toolResults, type World } from "./lib/harness";

const scenario = (w: World) => (req: any) =>
  toolResults(req).length === 0
    ? { tools: [{ name: "read_file", input: { path: "drafts/library-hours.md" } }] }
    : { text: `Swapped ${w.nonce}. The library draft matches its press release.` };

// The second provider: OpenRouter's request shape, pointed at the practice model, with a dummy key.
const onOpenRouter = (dir: string) =>
  runs(dir, "openrouter", {
    args: ["-p", "Check the library draft."],
    env: (_w, url) => ({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "practice", OPENROUTER_BASE_URL: `${url}/v1` }),
    scenario,
  });
const onReplay = (dir: string) => runs(dir, "replay", { args: ["-p", "Check the library draft."], scenario });

function sources(dir: string): string {
  const src = join(dir, "src");
  if (!existsSync(src)) return "";
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (/\.(ts|js|mjs)$/.test(f.name)) out.push(readFileSync(join(d, f.name), "utf8"));
    }
  };
  walk(src);
  return out.join("\n");
}

export default [
  {
    says: "With LLM_PROVIDER=openrouter every call goes out in OpenRouter's shape and the run finishes",
    test: (d) => every(onOpenRouter(d), (r) => r.code === 0 && r.requests.length === 2 && r.requests.every((q) => q.api === "openai") && r.stdout.includes(`Swapped ${r.world.nonce}`)),
    tryNext: 'Import model from "#models" and call model("smart"). It reads LLM_PROVIDER, so the code does not change.',
  },
  {
    says: "On the second provider the tool result still goes back, paired with its call",
    test: (d) => every(onOpenRouter(d), (r) => toolResults(r.requests[1]).length === 1 && !toolResults(r.requests[1])[0].is_error),
    tryNext: "Keep the loop as it was. Only the place the model comes from changes.",
  },
  {
    says: "No file in src imports a provider package or names a model",
    test: (d) => {
      const code = sources(d);
      return code.length > 0 && !/@ai-sdk\/(anthropic|openai)|@openrouter\//.test(code) && !/["'`]practice-(smart|fast|judge)["'`]/.test(code);
    },
    tryNext: "Delete the provider import and the model name. config/models.ts is the only file that names either.",
  },
  {
    says: "With no setting it still runs on the practice model",
    test: (d) => every(onReplay(d), (r) => r.code === 0 && r.requests.every((q) => q.api === "anthropic") && r.stdout.includes(`Swapped ${r.world.nonce}`)),
    tryNext: "Leave LLM_PROVIDER unset for the default. config/models.ts treats that as replay.",
  },
] satisfies Rule[];
