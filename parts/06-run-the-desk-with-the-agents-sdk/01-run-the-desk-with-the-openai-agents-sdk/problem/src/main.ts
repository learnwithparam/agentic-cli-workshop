// desk, the OpenAI Agents SDK version: the starter. The desk loop is not built yet.
// Build the Agent, its tools and the approval rule, then call run() with the prompt.
const promptFlag = process.argv.indexOf("-p");
const prompt = promptFlag >= 0 ? process.argv[promptFlag + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "check tonight\'s drafts"');
  process.exit(1);
}

// TODO: create the Agent with the desk's instructions and the tools from the step's README.
// TODO: call run() with the prompt, and refuse each filing that needs the night editor.
console.log(
  "TODO: the desk loop is not built yet. Build the Agent and call run(), then try again.",
);
process.exit(1);
