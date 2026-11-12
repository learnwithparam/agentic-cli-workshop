// swap-the-model: the same desk runs on a second provider by changing one setting, with no code
// change.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "../scripts/verify";
import { every, type Request, runs, toolResults, type World } from "./lib/harness";

const scenario = (world: World) => (request: Request) => {
  if (toolResults(request).length > 0) {
    return { text: `Swapped ${world.nonce}. The library draft matches its press release.` };
  }
  return { tools: [{ name: "read_file", input: { path: "drafts/library-hours.md" } }] };
};

// The second provider: OpenRouter's request shape, pointed at the practice model, with a dummy
// key.
const onOpenRouter = (folder: string) =>
  runs(folder, "openrouter", {
    args: ["-p", "Check the library draft."],
    env: (_world, modelUrl) => ({
      // biome-ignore-start lint/style/useNamingConvention: the shell fixes these names
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "practice",
      OPENROUTER_BASE_URL: `${modelUrl}/v1`,
      // biome-ignore-end lint/style/useNamingConvention: back to our own names
    }),
    scenario,
  });
const onReplay = (folder: string) =>
  runs(folder, "replay", { args: ["-p", "Check the library draft."], scenario });

// Add the text of every code file under this folder, and its subfolders, to the list.
function collectCode(folder: string, found: string[]) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) collectCode(path, found);
    else if (/\.(ts|js|mjs)$/.test(entry.name)) found.push(readFileSync(path, "utf8"));
  }
}

// All the learner's code in src, joined into one text.
function sources(folder: string): string {
  const sourceFolder = join(folder, "src");
  if (!existsSync(sourceFolder)) return "";
  const found: string[] = [];
  collectCode(sourceFolder, found);
  return found.join("\n");
}

export default [
  {
    says:
      "With LLM_PROVIDER=openrouter every call goes out in OpenRouter's shape " +
      "and the run finishes",
    test: (folder) =>
      every(
        onOpenRouter(folder),
        (desk) =>
          desk.code === 0 &&
          desk.requests.length === 2 &&
          desk.requests.every((request) => request.api === "openai") &&
          desk.stdout.includes(`Swapped ${desk.world.nonce}`),
      ),
    tryNext:
      'Import model from "#models" and call model("smart"). ' +
      "It reads LLM_PROVIDER, so the code does not change.",
  },
  {
    says: "On the second provider the tool result still goes back, paired with its call",
    test: (folder) =>
      every(onOpenRouter(folder), (desk) => {
        const results = toolResults(desk.requests[1]);
        return results.length === 1 && !results[0].is_error;
      }),
    tryNext: "Keep the loop as it was. Only the place the model comes from changes.",
  },
  {
    says: "No file in src imports a provider package or names a model",
    test: (folder) => {
      const code = sources(folder);
      return (
        code.length > 0 &&
        !/@ai-sdk\/(anthropic|openai)|@openrouter\//.test(code) &&
        !/["'`]practice-(smart|fast|judge)["'`]/.test(code)
      );
    },
    tryNext:
      "Delete the provider import and the model name. " +
      "config/models.ts is the only file that names either.",
  },
  {
    says: "With no setting it still runs on the practice model",
    test: (folder) =>
      every(
        onReplay(folder),
        (desk) =>
          desk.code === 0 &&
          desk.requests.every((request) => request.api === "anthropic") &&
          desk.stdout.includes(`Swapped ${desk.world.nonce}`),
      ),
    tryNext: "Leave LLM_PROVIDER unset for the default. config/models.ts treats that as replay.",
  },
] satisfies Rule[];
