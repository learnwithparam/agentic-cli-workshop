// The todo list: desk's plan for the night. The model sends the full list on every call, so
// the list desk keeps is always the newest one. A list that stops changing is a sign the model
// lost its plan, so desk reminds it.
import { jsonSchema, tool } from "ai";

type Status = "pending" | "in_progress" | "done";
type Todo = { text: string; status: Status };

// How each status looks on screen.
// biome-ignore lint/style/useNamingConvention: the statuses are the model's own words
const MARKS: Record<Status, string> = { pending: "[ ]", in_progress: "[>]", done: "[x]" };

export const todoTool = tool({
  description:
    "Replace the todo list. Send the full list every time. At most one item is in_progress.",
  inputSchema: jsonSchema<{ todos: Todo[] }>({
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "Every item, such as { text: 'Check bridge-repairs', status: 'pending' }",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "One job, such as Check river-levels" },
            status: { type: "string", enum: ["pending", "in_progress", "done"] },
          },
          required: ["text", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  }),
});

let todos: Todo[] = [];

export function writeTodos(input: { todos: Todo[] }): string {
  todos = input.todos;
  const lines = todos.map((todo) => `    ${MARKS[todo.status]} ${todo.text}`);
  console.log(lines.join("\n"));
  const done = todos.filter((todo) => todo.status === "done").length;
  return `Todo list saved: ${done} of ${todos.length} done.`;
}

// The items still to do, one per line. Compaction puts them back after the summary.
export function openTodos(): string {
  const open = todos.filter((todo) => todo.status !== "done");
  return open.map((todo) => `${MARKS[todo.status]} ${todo.text}`).join("\n");
}

const TURNS_BEFORE_REMINDER = 3;
let turnsSinceUpdate = 0;

// Called once per turn with the tool names the model used. Returns a reminder after 3 turns
// with no todo_write, or null.
export function reminderAfterTurn(toolNames: string[]): string | null {
  if (toolNames.includes("todo_write")) {
    turnsSinceUpdate = 0;
    return null;
  }
  turnsSinceUpdate++;
  if (turnsSinceUpdate < TURNS_BEFORE_REMINDER) return null;
  turnsSinceUpdate = 0;
  return (
    `<reminder>The todo list has not changed for ${TURNS_BEFORE_REMINDER} turns. ` +
    `If your plan moved on, send the full list again with todo_write. Open items:\n` +
    `${openTodos() || "none"}</reminder>`
  );
}
