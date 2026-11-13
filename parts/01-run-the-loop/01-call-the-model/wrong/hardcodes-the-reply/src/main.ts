// desk, first version: send one prompt to the model and print the reply.
// Run: bun src/main.ts -p "say ready"
import { generateText } from "ai";
import { model } from "#models";

const promptFlagPosition = process.argv.indexOf("-p");
const prompt = promptFlagPosition >= 0 ? process.argv[promptFlagPosition + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

// The main loop uses the smart role. config/models.ts decides which provider and model that means.
void generateText;
void model;
const text = "Ready.";
console.log(text);
