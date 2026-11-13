# Assignment: score your desk with promptfoo

This is optional in the live session. It is expected as homework. No Docker container is needed.

## The task

Redo your hand-built scorer with promptfoo, the eval runner that teams run. Your desk's night run is saved in
`recorded.json`, so you need no key. `provider.mjs` already replays it.

1. Edit `promptfooconfig.yaml`. It has one task. Add one task for each of the 12 drafts in
   `world/seed/answer-key.json`.
2. Write `caught.mjs`, one assertion that follows the rule in `score.ts`.
3. Write `CHOICE.md`: in five sentences, say when you would pick Inspect AI instead.
4. Run the check:

```bash
bun run assignment
```

Expect: `PASS` or `FAIL` for each Done-when line below, and `assignment/result.json` written.

Push your work on a branch named `assignment`, and submit its URL. The grader runs the same check.

## Done when

- promptfoo reports 0.125.1.
- Every course task has at least one assertion.
- The run exits zero when the desk passes the bar you set. Its pass count matches the hand-built score.

`result.json` holds one `pass` or `fail` for each line and the promptfoo version it found.

## Rubric

A person reads these three lines. There are no points.

- The assertions match the hand-built scorer in `score.ts`.
- `CHOICE.md` names when Inspect AI is the better pick.
- Each assertion would fail if desk did the wrong thing.
