// What desk prints. Every part of a run is an event. --output-format picks how events print:
//   text         lines for a person at a terminal
//   json         nothing until the end, then one JSON object: the result
//   stream-json  one JSON object per line, as each event happens, for a program to read
// The event names and fields are the contract in checks/helpers/contract.schema.json. A script
// that reads them works with any harness that keeps the contract.

// biome-ignore-start lint/style/useNamingConvention: the output contract fixes these names
export type Event =
  | { type: "init"; session_id: string; tools: string[] }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; is_error: boolean; content: string }
  | { type: "permission"; tool: string; decision: "allow" | "deny"; reason: string }
  | { type: "compact"; before_tokens: number; after_tokens: number }
  | { type: "result"; subtype: Subtype; turns: number; cost_usd: number; session_id: string };
// biome-ignore-end lint/style/useNamingConvention: back to our own names

export type Subtype =
  | "success"
  | "error_max_turns"
  | "error_max_budget"
  | "error_permission"
  | "error";

export type Format = "text" | "json" | "stream-json";
export const FORMATS: Format[] = ["text", "json", "stream-json"];

// The exit code a script reads to tell how the run ended.
// TODO: 1 for "error", 4 for "error_permission", 3 for a cap.
export function exitCodeFor(subtype: Subtype): number {
  if (subtype === "success") return 0;
  return 3;
}

// One call in a line. An edit shows its diff, and a todo list shows how far along it is.
function describeCall(name: string, input: unknown): string {
  const fields = input as Record<string, string>;
  const firstLine = `  > ${name} ${fields.path ?? fields.slug ?? fields.command ?? ""}`;
  if (name !== "edit_file") return firstLine;
  return `${firstLine}\n    - ${fields.old_text}\n    + ${fields.new_text}`;
}

let midLine = false;

// The line a person sees for an event, or null when it prints nothing.
function lineFor(event: Event): string | null {
  if (event.type === "init") return `desk session ${event.session_id}`;
  if (event.type === "tool_call") return describeCall(event.name, event.input);
  if (event.type === "tool_result" && event.is_error) {
    return `    error: ${event.content.split("\n")[0]}`;
  }
  if (event.type === "compact") {
    const sizes = `about ${event.before_tokens} tokens down to ${event.after_tokens}`;
    return `  ~ compacted the conversation: ${sizes}`;
  }
  if (event.type !== "result") return null;
  const cost = `$${event.cost_usd.toFixed(4)}`;
  if (event.subtype === "success") return `Done. ${event.turns} turns, ${cost}.`;
  return `Stopped: ${event.subtype} after ${event.turns} turns, ${cost}.`;
}

function printText(event: Event): void {
  if (event.type === "text") {
    process.stdout.write(event.text);
    midLine = !event.text.endsWith("\n");
    return;
  }
  const line = lineFor(event);
  if (line === null) return;
  // The model's words may stop in the middle of a line. Start the next line fresh.
  if (midLine) process.stdout.write("\n");
  midLine = false;
  console.log(line);
}

// TODO: read --output-format. For stream-json, print every event as one JSON line. For json,
//       print only the result event, as one JSON line. For text, print as now.
export function emit(event: Event): void {
  printText(event);
}
