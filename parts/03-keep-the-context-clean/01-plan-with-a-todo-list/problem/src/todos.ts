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

// TODO: refuse a list with two items in_progress: throw an Error that says what to do.
//       Otherwise save the list, print it with MARKS (one item per line), and return how many
//       items are done.
export function writeTodos(input: { todos: Todo[] }): string {
  todos = input.todos;
  return "Todo list saved.";
}

// The items still to do, one per line. Compaction puts them back after the summary.
export function openTodos(): string {
  const open = todos.filter((todo) => todo.status !== "done");
  return open.map((todo) => `${MARKS[todo.status]} ${todo.text}`).join("\n");
}

// TODO: count the turns since the last todo_write. After 3 turns with none, return a reminder
//       that names todo_write and lists openTodos(), and start counting again. Else return null.
export function reminderAfterTurn(_toolNames: string[]): string | null {
  return null;
}
