// desk, first version: send one prompt to the model and print the reply.
// Run: bun src/main.ts -p "say ready"
import { generateText } from "ai";
import { model } from "#models";

const i = process.argv.indexOf("-p");
const prompt = i >= 0 ? process.argv[i + 1] : undefined;
if (!prompt) {
  console.log('Usage: bun src/main.ts -p "your prompt"');
  process.exit(1);
}

// TODO: send `prompt` to the model with generateText from "ai".
//       Ask config/models.ts for the role the main loop uses: model("smart").
// TODO: print the text of the reply.
void generateText;
void model;
console.log("TODO: call the model");
