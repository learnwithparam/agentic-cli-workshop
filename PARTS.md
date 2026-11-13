# Parts

Every part of the course, its steps, their minutes, and what each step's check reads. A part session builds one
part from this file alone. Orientation and `run-the-loop` are built; the rest are skeletons with a README.

## How a part is built

Copy the shape of `parts/01-run-the-loop/`. For each step:

- `NN-<step-name>/step.toml` with `minutes`, `screen`, `solution`.
- `problem/README.md` with The problem, Your challenge, Done when, If you get stuck, Words you will use, and a
  Mermaid diagram or `../images/expected.png`. Under 600 words.
- `problem/src/main.ts`: the previous step's `solution/src/main.ts` with the new part removed and marked `TODO`.
  The first step of a part starts from the last solution of the part before it.
- `solution/src/main.ts`: the sample answer. `wrong/<mistake>/src/main.ts`: at least one common mistake.
- `checks/<step-name>.ts`: rules built on `checks/lib/harness.ts`. A rule starts the learner's
  `src/main.ts` with `runs(dir, name, { args, scenario, setup, env })`. Each call is three fresh runs in a fresh
  newsroom copy with its own CMS and practice model, cached per folder and name. Judge requests the practice
  model recorded, the CMS state (`run.world.cms.state()`), files in `run.world.newsroom`, and exit codes. Never
  judge the model's own words about its work. Pass `keep: true` to read the world after the run, then call
  `run.world.cleanup()`.
- Plant fresh values per run (`plant(world, path, line)`, `world.nonce`) so a hard-coded answer cannot pass.
- `bun run check` proves each check fails on `problem/` and every `wrong/`, and passes on `solution/`.
- Add each new failure line (`says`) to `00-orientation/troubleshooting.md`; `bun test` fails until you do.
- A step with something on screen sets `screen = true` and ships `images/expected.png`. Add its capture to
  `images/shots.mjs`.

The practice model (`world/practice-model/server.ts`) answers the Anthropic Messages shape and the OpenAI chat
completions shape, plain or streamed. A scenario is a function from the recorded request to the next turn:
`{ text, tools: [{ name, input }], usage, chunkDelayMs, status, error }`. `world/practice-model/night-desk.ts` is the
full-run scenario; it plans from `world/seed/answer-key.json` and reads the conversation to see what is done, so
it works with any harness that runs its tools. The finished desk in `finished/desk/` is the reference for every
part: `bun run demo` must keep printing `Filed 9, held 3, waiting 0. Corrections logged tonight: 7. Rule breaks: 0.`

## orientation

Folder: `00-orientation/`. 15 minutes.

| Step            | Min | The check reads                                                                                                                                                                   |
| --------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meet-the-desk` | 15  | `first-look.md`: three headings; every held slug from the answer key under Held stories and none of the filed ones; a reason line per held slug; a question of five words or more |

## run-the-loop (built)

Folder: `parts/01-run-the-loop/`. 85 minutes, 15 of them the deeper step.

| Step                      | Min | The check reads                                                                                                                                                                                                |
| ------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call-the-model`          | 10  | One recorded request: the prompt as the user message, role `practice-smart`, no `temperature`; stdout has the fresh reply; exit 0                                                                              |
| `read-a-draft`            | 15  | Request 1 offers `read_file` with a string `path` in its schema; request 2 carries a tool result paired by id with a planted line; a path outside the newsroom comes back `is_error` without the secret        |
| `close-the-loop`          | 20  | Exactly 4 requests; request 3 has two results paired with two calls; request 4 has an error result; every call in the last request has exactly one result                                                      |
| `cap-the-loop`            | 10  | `--max-turns 5` gives 5 requests and exit 3 with `error_max_turns`; `--max-budget-usd 0.05` gives 2 requests and exit 3 with `error_max_budget`; a `$` cost within one cent of the price in `config/models.ts` |
| `stream-the-reply`        | 15  | `stream: true` on every request; the first and last piece of the reply reach stdout at least 400 ms apart; the reply printed once; the tool result still sent                                                  |
| `swap-the-model` (deeper) | 15  | With `LLM_PROVIDER=openrouter` pointed at the practice model every request is in the chat completions shape and the run finishes; no provider import or model name in `src/`; the default still works          |

## touch-the-world-safely

Folder: `parts/02-touch-the-world-safely/`. 85 minutes. The CLI grows `--permission-mode` and reads `desk.config.json`.

| Step                 | Min | The check reads                                                                                                                                                                                             |
| -------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape-the-tools`    | 15  | Each tool schema sets `additionalProperties: false`; the error text for a list of planted bad calls names what to try next; the CMS log shows two identical `file_story` calls filed once (idempotency key) |
| `edit-drafts-safely` | 25  | The draft on disk after a planted fix: one line changed, the rest byte for byte the same; error results for 0 matches, 2 matches, a file not read first, a file changed since it was read                   |
| `run-commands`       | 15  | A planted `sleep 60` returns `is_error` within the timeout; output over 20,000 characters is cut with a note; the model's `awk` sum over `sources/school-results.csv` comes back correct                    |
| `ask-before-acting`  | 30  | With the prompt answered "n" (stdin), the CMS is unchanged and the result says denied; a `deny` rule beats an `allow`; `plan` mode leaves files and CMS untouched; `never-ask` denies every prompt          |

## keep-the-context-clean

Folder: `parts/03-keep-the-context-clean/`. 90 minutes, 15 of them the deeper step.

| Step                        | Min | The check reads                                                                                                                                                                                                                                                                                            |
| --------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan-with-a-todo-list`     | 15  | An error result for two items in progress; a reminder text in the request after 3 turns with no `todo_write`                                                                                                                                                                                               |
| `load-the-desk-rules`       | 10  | The recorded system prompt holds `DESK.md` then `drafts/DESK.md`; an edit to `DESK.md` between runs shows in the next request                                                                                                                                                                              |
| `trim-old-results` (deeper) | 15  | Request size on a 30-turn script falls by at least 50%; every call in every request still has its result                                                                                                                                                                                                   |
| `compact-the-conversation`  | 25  | On the council transcript script, the first request after the threshold is under the target and starts with a summary; the summary request used `practice-fast`; the rule "never name a person under 18" and the open todo items are still in the request; the saved transcript has every original message |
| `delegate-to-a-subagent`    | 25  | The parent's request after `ask_researcher` grows by under 2,000 characters; the child's requests use `practice-fast`, offer no `edit_file` or `file_story`, and stop at the child's turn cap; the reported cost includes the child                                                                        |

## extend-and-ship

Folder: `parts/04-extend-and-ship/`. 125 minutes, 30 of them the deeper step. This part also builds
`world/wire/` (an MCP server over stdio with `@modelcontextprotocol/server`, tools `search_wire` and
`get_wire_story`, a call log) and `world/hooks/embargo-check.ts`, and adds hooks and the MCP client to the
finished desk.

| Step                                | Min | The check reads                                                                                                                                                                                                           |
| ----------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add-hooks`                         | 20  | The CMS after the model tries to file `new-clinic-opening` (no filing, the hook's reason in the tool result); the audit JSONL has one line per call; a hook that sleeps is killed after 10 seconds and the call is denied |
| `connect-a-wire-server`             | 20  | The recorded request lists `wire__search_wire` and `wire__get_wire_story`; the wire server's call log; an error result, not a crash, when the server is killed                                                            |
| `resume-a-session`                  | 15  | After SIGTERM at turn 5 and `--resume <id>`, the first request's history equals the saved session; the CMS after the resumed run equals an uninterrupted one; no story filed twice                                        |
| `run-headless`                      | 15  | Every stdout line of `--output-format stream-json` validates against `checks/lib/contract.schema.json`; exit codes 0, 1, 3 and 4 on planted runs; no prompt with no TTY                                                   |
| `score-the-agent`                   | 25  | `bun run score` JSON against `world/seed/answer-key.json` on the practice model; `notes/failures.md` names each missed fault with a quoted session line                                                                   |
| `rebuild-on-the-agent-sdk` (deeper) | 30  | `desk-sdk/` passes the same headless contract and score; `notes/sdk-compare.md` has `What the SDK did for me`, `What I lost`, `Lines of code`, `Cost on the eval`                                                         |

## The contract every part builds toward

```
desk -p "<prompt>" [--output-format text|json|stream-json] [--permission-mode ask|accept-edits|plan|never-ask]
     [--max-turns N] [--max-budget-usd X] [--resume ID | --continue] [--cwd PATH]
```

`stream-json` prints one JSON object per line: `init {session_id, tools}`, `text {text}`,
`tool_call {id, name, input}`, `tool_result {id, is_error, content}`, `permission {tool, decision, reason}`,
`compact {before_tokens, after_tokens}`, `result {subtype, turns, cost_usd, session_id}`. Result subtypes:
`success`, `error_max_turns`, `error_max_budget`, `error_permission`, `error`. Exit codes: 0 success, 1 error,
3 a cap, 4 a permission denied in `never-ask` mode. `finished/desk/src/main.ts` follows it today.
