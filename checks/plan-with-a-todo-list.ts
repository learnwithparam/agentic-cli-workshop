// plan-with-a-todo-list: todo_write keeps the plan, refuses two items in progress, shows the
// list, and desk reminds the model when the list goes stale.
import type { Rule } from "../scripts/verify";
import type { Request } from "../world/practice-model/server";
import { answeredRuns, playTurns } from "./helpers/answered-runs";
import { every, type Run, toolResults, type World } from "./lib/harness";

const todo = (text: string, status: string) => ({ text, status });

function todoTurns(world: World) {
  const twoInProgress = [
    todo("Check bridge-repairs", "in_progress"),
    todo("Check river-levels", "in_progress"),
  ];
  const goodList = [
    todo(`Check bridge-repairs ${world.nonce}`, "in_progress"),
    todo(`Check river-levels ${world.nonce}`, "pending"),
    todo("Check library-hours", "done"),
  ];
  const read = (slug: string) => ({ name: "read_file", input: { path: `drafts/${slug}.md` } });
  return [
    { name: "todo_write", input: { todos: twoInProgress } },
    { name: "todo_write", input: { todos: goodList } },
    read("bridge-repairs"),
    read("river-levels"),
    read("library-hours"),
  ];
}

const planning = (folder: string) =>
  answeredRuns(folder, "plan-with-a-todo-list", {
    args: ["-p", "Plan tonight's drafts, then check them."],
    scenario: (world) => playTurns(todoTurns(world).map((call) => [call])),
  });

// The text desk added to a request after the tool results: the reminder, if there is one.
function addedText(request: Request | undefined): string {
  const last = request?.messages[request.messages.length - 1];
  if (last?.role !== "user") return "";
  const texts = last.blocks.filter((block) => block.type === "text");
  return texts.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

// The result of the nth tool call (counting from 0), read from the last request.
function nthResult(desk: Run, position: number) {
  const last = desk.requests[desk.requests.length - 1];
  return last ? toolResults(last)[position] : undefined;
}

const offersTodoWrite = (desk: Run) =>
  desk.requests[0]?.tools.some((tool) => tool.name === "todo_write") === true;

export default [
  {
    says: "A list with two items in progress comes back as an error",
    test: (folder) =>
      every(
        planning(folder),
        (desk) => offersTodoWrite(desk) && nthResult(desk, 0)?.is_error === true,
      ),
    tryNext:
      "In writeTodos, count the items with status in_progress. " +
      "At 2 or more, throw an Error that says to mark the others pending or done.",
  },
  {
    says: "A good list is saved, and the terminal shows every item",
    test: (folder) =>
      every(planning(folder), (desk) => {
        const saved = nthResult(desk, 1)?.is_error === false;
        const shown = ["bridge-repairs", "river-levels"].every((slug) =>
          desk.stdout.includes(`Check ${slug} ${desk.world.nonce}`),
        );
        return offersTodoWrite(desk) && saved && shown && desk.stdout.includes("library-hours");
      }),
    tryNext:
      "Print each item on its own line with its mark from MARKS, such as [>] for in_progress.",
  },
  {
    says: "After 3 turns with no todo_write, the next request has a reminder with the open items",
    test: (folder) =>
      every(planning(folder), (desk) => {
        const reminder = addedText(desk.requests[5]);
        const namesTool = reminder.includes("todo_write");
        return namesTool && reminder.includes(`Check river-levels ${desk.world.nonce}`);
      }),
    tryNext:
      "Count turns with no todo_write in reminderAfterTurn. At 3, return a reminder that names " +
      'todo_write and lists openTodos(). main.ts pushes it as a "user" message.',
  },
  {
    says: "No reminder comes before the list has gone 3 turns without a change",
    test: (folder) =>
      every(planning(folder), (desk) => {
        const early = desk.requests.slice(1, 5);
        return early.length === 4 && early.every((request) => addedText(request) === "");
      }),
    tryNext: "Start counting again at 0 after every todo_write, and after each reminder.",
  },
] satisfies Rule[];
