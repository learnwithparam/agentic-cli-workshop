// Reads the repo layout once. Every other script asks this file where things are.
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

export type Step = {
  name: string; // verb-the-thing, also the command argument
  dir: string;
  part: string;
  meta: { minutes: number; screen: boolean; solution: boolean };
};
export type Part = { name: string; dir: string; steps: Step[] };

const dirs = (p: string) =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()).sort() : [];

// Folders keep an order prefix for sorting only. Learners never type it.
export const bareName = (folder: string) => folder.replace(/^\d+-/, "");

function readStep(sdir: string, folder: string, part: string): Step {
  const metaPath = join(sdir, "step.toml");
  const raw = existsSync(metaPath) ? (Bun.TOML.parse(readFileSync(metaPath, "utf8")) as any) : {};
  return {
    name: bareName(folder),
    dir: sdir,
    part,
    meta: { minutes: Number(raw.minutes ?? 0), screen: Boolean(raw.screen), solution: Boolean(raw.solution) },
  };
}

// The orientation is the first part when it holds a step (a folder with step.toml).
function orientation(): Part[] {
  const dir = join(ROOT, "00-orientation");
  const steps = dirs(dir)
    .filter((s) => existsSync(join(dir, s, "step.toml")))
    .map((s) => readStep(join(dir, s), s, "orientation"));
  return steps.length ? [{ name: "orientation", dir, steps }] : [];
}

export function parts(): Part[] {
  const root = join(ROOT, "parts");
  return [
    ...orientation(),
    ...dirs(root).map((p) => {
      const dir = join(root, p);
      const steps = dirs(dir).map((s) => readStep(join(dir, s), s, bareName(p)));
      return { name: bareName(p), dir, steps };
    }),
  ];
}

export const allSteps = () => parts().flatMap((p) => p.steps);

export function findStep(name: string): Step | undefined {
  return allSteps().find((s) => s.name === name);
}
