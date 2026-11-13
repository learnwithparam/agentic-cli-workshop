// The researcher: a helper agent, also called a subagent. It answers one question with its own
// fresh context, only the read-only tools, the cheap fast role and a cap of 6 turns. desk sees
// its short answer, never the files it read.

export const MAX_TURNS = 6;
export const LONGEST_ANSWER = 2_000;
export const READ_ONLY_TOOLS = ["read_file", "list_files", "search_files"];
export const RESEARCHER_RULES =
  "You are a researcher for the Millbrook Herald night desk. Answer one question from the " +
  "files in sources/. Search long files instead of reading them. Reply in a few sentences " +
  "and name the file you used.";

// What the researchers cost in this run. main.ts adds it to the total it prints.
export const researcherCost = 0;

// TODO: askResearcher. Start a fresh messages list with only the question. Loop at most
//       MAX_TURNS times: generateText with model("fast"), RESEARCHER_RULES and only the
//       read-only tools (never ask_researcher). Add each call's cost to researcherCost. Run
//       the read-only tool calls and send the results back. When the model answers with no
//       tool call, return its text, cut to LONGEST_ANSWER characters.
export function askResearcher(_input: { question: string }): Promise<string> {
  throw new Error("The researcher is not written yet.");
}
