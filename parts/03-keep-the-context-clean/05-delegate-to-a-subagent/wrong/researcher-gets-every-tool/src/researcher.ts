// The researcher: a helper agent, also called a subagent. It answers one question with its own
// fresh context, only the read-only tools, the cheap fast role and a cap of 6 turns. desk sees
// its short answer, never the files it read.
import { generateText, type ModelMessage } from "ai";
import { costUsd, model } from "#models";
import { runTool, tools } from "./tools";

const MAX_TURNS = 6;
const LONGEST_ANSWER = 2_000;
const READ_ONLY_TOOLS = ["read_file", "list_files", "search_files"];
const RESEARCHER_RULES =
  "You are a researcher for the Millbrook Herald night desk. Answer one question from the " +
  "files in sources/. Search long files instead of reading them. Reply in a few sentences " +
  "and name the file you used.";

// What the researchers cost in this run. main.ts adds it to the total it prints.
export let researcherCost = 0;

type ToolCall = { toolCallId: string; toolName: string; input: unknown };

async function resultFor(call: ToolCall) {
  let output: { type: "text" | "error-text"; value: string };
  try {
    if (!READ_ONLY_TOOLS.includes(call.toolName)) throw new Error("The researcher only reads.");
    output = { type: "text", value: await runTool(call.toolName, call.input) };
  } catch (error) {
    output = { type: "error-text", value: (error as Error).message };
  }
  return {
    type: "tool-result" as const,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output,
  };
}

export async function askResearcher(input: { question: string }): Promise<string> {
  // A fresh context: the question and nothing else from desk's conversation.
  const messages: ModelMessage[] = [{ role: "user", content: input.question }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const reply = await generateText({
      model: model("fast"),
      instructions: RESEARCHER_RULES,
      messages,
      tools,
    });
    researcherCost += costUsd("fast", reply.usage) ?? 0;
    messages.push(...reply.response.messages);
    if (reply.toolCalls.length === 0) return reply.text.slice(0, LONGEST_ANSWER);
    const results = [];
    for (const call of reply.toolCalls) results.push(await resultFor(call));
    messages.push({ role: "tool", content: results });
  }
  return `The researcher stopped after ${MAX_TURNS} turns with no answer. Ask a smaller question.`;
}
