// The only file that names a model. Code asks for a role, never an id:
//   smart  the main agent loop (hard reasoning, tool use)
//   fast   cheap calls: subagents, summaries for compaction
//   judge  grading in the scorer
// The provider comes from one setting, LLM_PROVIDER:
//   replay      the default: the practice model in world/practice-model, no key, no cost, same answer every run
//   anthropic   needs ANTHROPIC_API_KEY
//   openrouter  needs OPENROUTER_API_KEY
//   openai      needs OPENAI_API_KEY
//   ollama      a local model; set OLLAMA_MODEL to the model you pulled
// Keys live in a git-ignored .env file (see .env.example). Bun loads it on its own.
// Ids and prices were read from the providers' own pages on the day this repo was built; recheck before a live run.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

// Keep compatibility notices out of the learner's terminal.
(globalThis as any).AI_SDK_LOG_WARNINGS = false;

export type Role = "fast" | "smart" | "judge";
export type Provider = "replay" | "anthropic" | "openrouter" | "openai" | "ollama";
export const ROLES: Role[] = ["fast", "smart", "judge"];
export const PROVIDERS: Provider[] = ["replay", "anthropic", "openrouter", "openai", "ollama"];

const IDS: Record<Provider, Record<Role, string>> = {
  // The practice model answers to these names; a check reads them to see which role a call used.
  replay: { fast: "practice-fast", smart: "practice-smart", judge: "practice-judge" },
  anthropic: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", judge: "claude-haiku-5-5" },
  openrouter: {
    fast: "nvidia/nemotron-3.5-lightning",
    smart: "anthropic/claude-sonnet-5.5",
    judge: "anthropic/claude-haiku-5.5",
  },
  openai: { fast: "gpt-6-luna", smart: "gpt-6-luna-pro", judge: "gpt-6-luna" },
  ollama: {
    fast: process.env.OLLAMA_MODEL ?? "",
    smart: process.env.OLLAMA_MODEL ?? "",
    judge: process.env.OLLAMA_MODEL ?? "",
  },
};

// USD per million tokens, input and output. Anthropic: platform.claude.com/docs/en/about-claude/pricing.
// OpenRouter fast: briefs/MODELS.md. The practice model is priced like the anthropic row for the same role,
// so a practice run shows what the same tokens would cost live. null means unknown: cost prints as unknown.
const PRICES: Record<Provider, Record<Role, [number, number] | null>> = {
  replay: { fast: [0.1, 0.5], smart: [2, 10], judge: [0.1, 0.5] },
  anthropic: { fast: [0.1, 0.5], smart: [2, 10], judge: [0.1, 0.5] },
  openrouter: { fast: [0.07, 0.2], smart: [2, 10], judge: [0.1, 0.5] },
  openai: { fast: null, smart: null, judge: null },
  ollama: { fast: [0, 0], smart: [0, 0], judge: [0, 0] },
};

const KEYS: Partial<Record<Provider, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function provider(): Provider {
  const p = (process.env.LLM_PROVIDER ?? "replay").trim().toLowerCase() as Provider;
  if (!PROVIDERS.includes(p))
    throw new Error(`LLM_PROVIDER is "${p}". Use one of: ${PROVIDERS.join(", ")}.`);
  return p;
}

// Where the practice model listens. Checks and the demo start their own and set REPLAY_URL.
export const replayUrl = () => process.env.REPLAY_URL ?? "http://localhost:4010";

export function keyName(p: Provider = provider()): string | undefined {
  return KEYS[p];
}

// The model for a role on the chosen provider.
export function model(role: Role): LanguageModel {
  const p = provider();
  const id = IDS[p][role];
  const key = KEYS[p];
  if (key && !process.env[key])
    throw new Error(
      `LLM_PROVIDER is ${p} but ${key} is not set. Add it to .env, or unset LLM_PROVIDER to use the practice model.`,
    );
  switch (p) {
    case "replay":
      return createAnthropic({ baseURL: `${replayUrl()}/v1`, apiKey: "practice" })(id);
    case "anthropic":
      return createAnthropic({ baseURL: process.env.ANTHROPIC_BASE_URL })(id);
    case "openrouter":
      return createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL,
      })(id);
    case "openai":
      return createOpenAI({ baseURL: process.env.OPENAI_BASE_URL })(id);
    case "ollama":
      if (!id)
        throw new Error(
          "LLM_PROVIDER is ollama but OLLAMA_MODEL is not set. Set it to a model you pulled.",
        );
      return createOpenAI({
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      }).chat(id);
  }
}

// The same thing as a property per role: models.smart, models.fast, models.judge.
export const models = {
  get fast() {
    return model("fast");
  },
  get smart() {
    return model("smart");
  },
  get judge() {
    return model("judge");
  },
};

// What a call cost, from its token counts. Returns null when the price is unknown.
export function costUsd(
  role: Role,
  usage: { inputTokens?: number; outputTokens?: number },
): number | null {
  const price = PRICES[provider()][role];
  if (!price) return null;
  return ((usage.inputTokens ?? 0) * price[0] + (usage.outputTokens ?? 0) * price[1]) / 1_000_000;
}

export function priceOf(role: Role): { inputPerMillion: number; outputPerMillion: number } | null {
  const price = PRICES[provider()][role];
  return price ? { inputPerMillion: price[0], outputPerMillion: price[1] } : null;
}
