# Build Your Own Agentic CLI

In this course you build an agent CLI in TypeScript, starting from an empty file. An agent CLI is a program you
run in a terminal. It calls a model again and again, and it uses tools to do real work. Tools like Claude Code
work this way. The code around the model is called the harness. You build the harness, and then you test it on
the same planted mistakes as a real one.

Your agent is called `desk`. It works the night desk of the Millbrook Herald, a small local newspaper. Each night,
reporters leave drafts. Before a story goes on the website, someone must check every fact in it.

For example, the draft `world/seed/newsroom/drafts/bridge-repairs.md` says:

> Millbrook Council will spend £4.2m repairing the Mill Lane bridge

The source file `world/seed/newsroom/sources/council-budget.csv` has this row:

```text
1,highways,Mill Lane bridge repairs,420000,yes
```

The real figure is £420,000, not £4.2m. Your finished `desk` finds this mistake. It fixes the draft, logs a
correction, and files the story.

By the end, `desk` does all of this:

- It reads the night's drafts and checks every claim against the source files.
- It fixes what the sources prove wrong, and it logs a correction for each fix.
- It asks you before it files a story.
- It keeps its context clean while it works with a council transcript of 400,000 characters. The context is
  everything the model can see at one time.
- It hands research to a helper agent.
- It runs hooks. A hook is your own small script that runs at a set moment, such as before each tool call.
- It talks to an MCP server. MCP is a standard way to plug outside tools into an agent.
- It picks up where it stopped after a crash.
- It runs headless, which means with no person at the keyboard. It prints JSON that any script can read.

**Who it is for.** You are an engineer who uses a coding agent every day. You want to see the loop, the tools,
the permission gate and the context handling in code you wrote. Maybe you must build an agent CLI for your own
company, and you need to explain its design. You know TypeScript and the terminal. You do not need to have
called a model API before.

**What you leave with.** You can write the tool loop from memory. You can explain why an agent stopped. You can
put a gate in front of a risky tool, and you can cap the number of turns and the money spent. You can shrink a
long run and still keep the rule that matters. You can measure what a helper agent saves and what it costs. You
can run the whole thing headless, with exit codes and a score.

## Run the finished system

You do not need an API key. Every command and every check runs on the practice model. The practice model is a
small server on your own computer. It answers like a model API, gives the same answer every time, and costs
nothing.

```bash
bun install
```

Expect: `bun install` ends with no errors.

```bash
bun run world reset
```

Expect: `The newsroom is reset: 12 drafts waiting, and a council transcript of 400,331 characters.`

```bash
bun run demo
```

Expect: one line per tool call as the finished desk works, then `The CMS says: Filed 9, held 3, waiting 0. Corrections logged tonight: 7. Rule breaks: 0.`

![The finished desk in the terminal: its tool calls and the result](00-orientation/images/demo-run.png)

```bash
bun run world
```

Expect: `The Millbrook Herald CMS is running at http://localhost:4020 with 12 drafts in the newsroom.`

The CMS is the newspaper's website system. Open the address in your browser. You see the board that the run
left behind:

![The CMS after the run: nine stories filed, three held with reasons, seven corrections](images/finished-system.png)

```mermaid
flowchart LR
  subgraph World[The Millbrook Herald: world/]
    D[(newsroom/drafts: 12 drafts with planted faults)]
    S[(newsroom/sources: budget, police, schools, river, press releases, council transcript)]
    R[(DESK.md: the standing rules)]
    C[(CMS on :4020: filed, held, corrections)]
    W[(Wire server, MCP: part 4)]
  end
  subgraph You[What you build: desk]
    L[The loop] --> G[Permission gate]
    G --> T[Tools: read, search, edit, run, file, hold, correct]
    L --> X[Context: todo, rules, compaction, subagent]
    L --> O[Headless output, sessions, hooks]
  end
  M[Practice model or a live model via config/models.ts] <--> L
  T --> D
  T --> S
  T --> C
  L -.-> W
  C --> SC[bun run score: faults caught, false flags, rule breaks, cost]
```

## The parts

| Part                                                                                | You build                                                 | Steps                                                                                                                    | Minutes |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| [Start here](00-orientation/README.md)                                              | Meet the newsroom and the finished desk                   | `meet-the-desk`                                                                                                          | 15      |
| [Run the loop](parts/01-run-the-loop/README.md)                                     | Call, tools, the loop, caps, streaming, any provider      | `call-the-model`, `read-a-draft`, `close-the-loop`, `cap-the-loop`, `stream-the-reply`, `swap-the-model`                 | 85      |
| [Touch the world safely](parts/02-touch-the-world-safely/README.md)                 | Tool design, safe edits, commands, the permission gate    | `shape-the-tools`, `edit-drafts-safely`, `run-commands`, `ask-before-acting`                                             | 85      |
| [Keep the context clean](parts/03-keep-the-context-clean/README.md)                 | Todo list, desk rules, trimming, compaction, a subagent   | `plan-with-a-todo-list`, `load-the-desk-rules`, `trim-old-results`, `compact-the-conversation`, `delegate-to-a-subagent` | 90      |
| [Extend and ship](parts/04-extend-and-ship/README.md)                               | Hooks, an MCP client, sessions, headless runs, a score    | `add-hooks`, `connect-a-wire-server`, `resume-a-session`, `run-headless`, `score-the-agent`                              | 95      |
| [Do it with the tools teams run](parts/05-do-it-with-the-tools-teams-run/README.md) | Redo the scorer with promptfoo, the eval runner teams use | `score-with-promptfoo`                                                                                                   | 25      |

Two steps go deeper: `swap-the-model` and `trim-old-results`. You can skip them the first time through. A
third deeper step, `rebuild-on-the-agent-sdk`, is not in the repo yet. Each step says what you will make. Each
step also has one command that checks your work: `bun run verify <step-name>`. The file
[schedules.toml](schedules.toml) shows how to fit the parts into one long session or into several shorter ones.

## The project

At the end, you put four things in your own public repo:

1. Your `desk` code. `bun run verify` passes every step on the practice model.
2. A file called `scorecard.md`. It is a table of what `bun run score` prints for your desk: the faults caught
   out of 13, the false flags, the rules broken, the turns and the cost. A second column shows a real harness
   (`claude -p`) on the same drafts.
3. A screen recording of one run, shorter than two minutes. It shows the todo list, a permission prompt before
   a filing, the compaction notice and the result line.
4. A file called `notes/failures.md`. It lists the faults your desk missed and why. It quotes the session file.

A script grades each item with a yes or no question. You find the questions in part four.

## Read before you start

1. [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works): the words for the loop, tools, sessions, compaction and permission modes.
2. [Tutorial: build a tool-using agent](https://platform.claude.com/docs/en/agents-and-tools/tool-use/build-a-tool-using-agent), the first two rings: one tool call, then the loop.
3. [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): the reason part three exists.

## How the course works

| Command                            | What it does                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run doctor`                   | Checks Bun, the model setting and the ports, in plain sentences                                                                         |
| `bun run world`                    | Starts the CMS on http://localhost:4020; `bun run world reset` starts the night again; `bun run world status` prints what the CMS holds |
| `bun run demo`                     | Runs the finished desk on the practice model                                                                                            |
| `bun run try <step-name> -p "..."` | Runs your desk for one step by hand, in the newsroom, against the practice model                                                        |
| `bun run verify <step-name>`       | Checks your work on one step, then shows your progress                                                                                  |
| `bun run verify part <part-name>`  | Checks every step in a part                                                                                                             |
| `bun run models`                   | One tiny call per model role on the chosen provider: pass or fail, and the cost                                                         |
| `bun run check`                    | The repo standard and every check (CI runs this)                                                                                        |

You work in the `problem/` folder of each step. The `solution/` folder next to it holds a sample answer. Compare
your work with it after your check passes. The rules that every course repo follows are in
[STANDARD.md](STANDARD.md).

## Use a live model

Nothing in the course needs a live model. If you want to try desk on a real model, follow these steps:

1. Copy `.env.example` to `.env`.
2. Set `LLM_PROVIDER` to `anthropic`, `openrouter` or `openai`.
3. Add the key for that provider.

Git ignores the `.env` file, so your key stays out of the repo. Never type a key on the command line.

```bash
bun run models
```

Expect: one line per role (`fast`, `smart`, `judge`) with `pass` and a cost, then `Every role answers on replay.` (or the provider you set).

The code never asks for a model by name. It asks `config/models.ts` for a role:

- `smart` runs the main loop.
- `fast` runs helper agents and summaries.
- `judge` grades the work.

`config/models.ts` is the only file that names a model.
