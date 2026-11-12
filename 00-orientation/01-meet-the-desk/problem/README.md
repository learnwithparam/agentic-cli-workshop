# Meet the desk

## The problem

It is late on the Millbrook Herald night desk. Twelve drafts must be checked before the website updates. Last
month the Herald printed four corrections, two of them for numbers nobody checked. The night editor will not
trust an agent they cannot read. Before you build one, watch the finished one work and write down what it
refused to publish, and why.

![The CMS after the finished desk ran: filed and held stories with reasons](../images/expected.png)

## Your challenge

1. Run `bun run world` in one terminal and `bun run demo` in another.
2. Open http://localhost:4020. Read the Held column and the reason on each card.
3. Open `first-look.md` in this folder and fill in its three sections:
   - **Held stories**: the slug of each held story, one per line.
   - **Why each was held**: one line per held story: its slug, then the rule it would break, in your words.
   - **One thing I want to understand**: one question about the run you cannot answer yet.

`world/newsroom/DESK.md` has the rules desk follows. `bun run demo --output-format stream-json` shows every
event of the run as one JSON line, if you want to look closer.

## Done when

- `first-look.md` has the three headings.
- Held stories names every story the desk held, and none it filed.
- Why each was held gives a reason for each held story.
- One thing I want to understand has a real question.

```bash
bun run verify meet-the-desk
```

Expect: `Done. All 5 rules pass.` and a `Progress:` line.

## If you get stuck

| What you see | Fix |
|---|---|
| `FAIL first-look.md has the three headings` | Keep the headings from the starter exactly, including `##`. |
| `FAIL Held stories names every story the desk held` | Copy the slug from each card in the Held column, such as `shop-break-in`. |
| `FAIL Held stories names no story the desk filed` | A story in the Filed column went to the website. Leave it out. |
| `FAIL Why each was held gives a reason for each held story` | Put the slug and a reason of four words or more on the same line. |
| `FAIL One thing I want to understand has a real question` | Replace `TODO` with a sentence of five words or more. |

## Words you will use

- **Agent CLI**: a program you run in a terminal that calls a model in a loop and uses tools to do work.
- **Harness**: everything around the model: the loop, the tools, the permission gate, the context handling.
- **System of record**: the place whose state counts. Here, the CMS.
- **Slug**: a story's short name, such as `bridge-repairs`.
- **Embargo**: a time before which a story must not be published.
