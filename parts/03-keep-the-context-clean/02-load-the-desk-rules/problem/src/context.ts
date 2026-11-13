// What goes into the model's context window. For now, the system prompt with the desk rules.

const BASE_PROMPT =
  "You are desk, the night desk agent of the Millbrook Herald, a regional daily newspaper. " +
  "Check the drafts in drafts/ against the files in sources/. Keep a todo list with todo_write.";

// TODO: add the standing rules after BASE_PROMPT: DESK.md, then drafts/DESK.md when it exists.
//       Read them from the newsroom folder on every run, and wrap each one in
//       <desk-rules file="DESK.md"> ... </desk-rules> so the model knows where it came from.
export function systemPrompt(): string {
  return BASE_PROMPT;
}
