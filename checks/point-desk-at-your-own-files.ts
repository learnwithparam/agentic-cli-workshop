// The step check runs the capstone rules on the my-desk folder in the step.
import { join } from "node:path";
import { rules } from "../capstone/rules";
import type { Rule } from "../scripts/verify";

export default rules.map((rule) => ({
  says: rule.says,
  tryNext: rule.tryNext,
  test: (folder: string) => rule.test(join(folder, "my-desk")),
})) satisfies Rule[];
