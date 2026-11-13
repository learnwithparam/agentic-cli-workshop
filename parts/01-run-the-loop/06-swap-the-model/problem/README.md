# Swap the model

## The problem

A provider is a company or server that runs models behind an API. The Herald's owners want a price from a
second provider before they sign a contract. But a teammate tied desk to one provider to try a feature. They
also typed the model's name into the code. Now nobody can run desk anywhere else without changing the loop.
And each place that names a provider or a model is one more place to forget when prices or models change.

```mermaid
flowchart LR
  L[desk loop] -->|"model('smart')"| C[config/models.ts]
  C -->|LLM_PROVIDER unset| R[Practice model]
  C -->|LLM_PROVIDER=anthropic| A[Anthropic]
  C -->|LLM_PROVIDER=openrouter| O[OpenRouter]
  C -->|LLM_PROVIDER=openai| P[OpenAI]
```

## Your challenge

Open `src/main.ts`. It imports a provider package. It builds a model with a name typed into the code.
For example, the starter has these two lines:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
const smartModel = anthropic("practice-smart");
```

1. Delete the provider import and the model name.
2. Import `model` and `costUsd` from `"#models"` and call `model("smart")`.
3. Run the same desk on a second provider. You change one setting, not the code. The check sends requests in
   OpenRouter's shape to the practice model, so it needs no key. Start the practice model in one terminal:

```bash
bun run practice-model
```

Expect: `The practice model is running at http://localhost:4010.` Leave it running. Then type this in a second
terminal:

```bash
LLM_PROVIDER=openrouter OPENROUTER_API_KEY=practice OPENROUTER_BASE_URL=http://localhost:4010/v1 bun run try swap-the-model -p "what does the library-hours draft say?"
```

Expect: `I read drafts/library-hours.md. It opens: ...` once desk asks `config/models.ts` for its model.

## Done when

- With `LLM_PROVIDER=openrouter` every call goes out in OpenRouter's shape and the run finishes.
- On the second provider the tool result still goes back, paired with its call.
- No file in `src/` imports a provider package or names a model.
- With no setting, desk still runs on the practice model.

```bash
bun run verify swap-the-model
```

Expect: `Done. All 4 rules pass.`

## If you get stuck

| What you see                                                                                       | Fix                                                                                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `FAIL With LLM_PROVIDER=openrouter every call goes out in OpenRouter's shape and the run finishes` | `model("smart")` from `"#models"` reads `LLM_PROVIDER`. A provider you build yourself does not. |
| `FAIL On the second provider the tool result still goes back, paired with its call`                | Keep the loop as it was; only the source of the model changes.                                  |
| `FAIL No file in src imports a provider package or names a model`                                  | Search `src/` for `@ai-sdk/`, `@openrouter/` and `practice-` and remove them.                   |
| `FAIL With no setting it still runs on the practice model`                                         | Unset `LLM_PROVIDER` in your terminal, or leave it empty in `.env`.                             |

## Words you will use

- **Provider**: a company or server that runs models behind an API: Anthropic, OpenRouter, OpenAI, a local Ollama.
- **Provider package**: the AI SDK adapter that speaks one provider's request shape.
- **Request shape**: how a provider wants the prompt, tools and results laid out. The AI SDK converts for you.
