// bun capstone/check.ts <folder>: judges your own desk folder.
import { runCapstoneCheck } from "../checks/helpers/capstone";
import { rules } from "./rules";

runCapstoneCheck(rules);
