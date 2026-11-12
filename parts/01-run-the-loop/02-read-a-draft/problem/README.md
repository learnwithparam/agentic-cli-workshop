# Read a draft

## The problem

desk can talk, but it cannot see the newsroom. Ask it what the bridge draft says and it guesses. A model never
reads a file itself: it asks your program to run a tool, and your program sends the result back. If the result
is not paired with the call that asked for it, the model API refuses the request. If the tool reads any path it
is given, the model can read files that were never meant for it.

```mermaid
sequenceDiagram
  participant desk
  participant Model as Practice model
  participant Files as Newsroom files
  desk->>Model: prompt + the read_file tool and its schema
  Model-->>desk: tool call read_file {path} with an id
  desk->>Files: read the file, inside the newsroom only
  desk->>Model: tool result with the same id, and the text
  Model-->>desk: the answer
```

## Your challenge

In `src/main.ts`:

1. Describe a `read_file` tool: a description and a JSON schema with one required string, `path`.
2. Write `readFile(path)`. Resolve the path against the newsroom folder. Refuse it if it leaves the folder, and
   say so in words the model can read. Say so too when the file does not exist.
3. If the model asked for tools, add one message with role `tool` that holds a `tool-result` for each call,
   with the call's `toolCallId`. A good read is `{ type: "text", value }`; a problem is `{ type: "error-text", value }`.
4. Call the model again with the longer message list and print its answer.

```bash
bun run try read-a-draft -p "what does the bridge-repairs draft say?"
```

Expect: `I read drafts/bridge-repairs.md. It opens: "Millbrook Council will spend ...` once the tool works.

## Done when

- The first request offers `read_file` with a schema that needs a string `path`.
- The second request carries the file's text as a tool result paired with the call's id.
- desk prints the model's final answer.
- A path outside the newsroom comes back as an error, and that file is never read.

```bash
bun run verify read-a-draft
```

Expect: `Done. All 4 rules pass.`

## If you get stuck

| What you see | Fix |
|---|---|
| `FAIL The first request offers a read_file tool whose schema needs a string path` | Put `read_file: tool({ description, inputSchema: jsonSchema({...}) })` in `tools` and list `path` in `required`. |
| `FAIL The second request sends the file text back as a tool result paired with the call's id` | Send a `tool` message, not a user message. Copy `call.toolCallId` and `call.toolName` into each result. |
| `FAIL It prints the model's final answer` | Print the second call's text. The first call's text is often empty when it asks for a tool. |
| `FAIL A path outside the newsroom comes back as an error, and the file is not read` | `relative(root, resolve(root, path))` starts with `..` for a path that escapes. Return an error for it. |

## Words you will use

- **Tool**: a function your program runs when the model asks. The model sees only its name, description and schema.
- **Schema**: a JSON description of a tool's input, so the model knows what to send.
- **Tool call id**: the label on each call. The result must carry the same id so the model can match them.
- **Path jail**: a check that every path stays inside one folder.
