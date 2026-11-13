// Reads the repo layout once. Every other script asks this file where things are.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

export type Step = {
  name: string; // verb-the-thing, also the command argument
  dir: string;
  part: string;
  meta: { minutes: number; screen: boolean; solution: boolean };
};
export type Part = { name: string; dir: string; steps: Step[] };

// What a step.toml may hold. Every field is optional, so a missing file reads as empty.
type StepSettings = { minutes?: unknown; screen?: unknown; solution?: unknown };

function subfolders(folder: string): string[] {
  if (!existsSync(folder)) return [];
  const entries = readdirSync(folder);
  const folders = entries.filter((entry) => statSync(join(folder, entry)).isDirectory());
  return folders.sort();
}

// Folders keep an order prefix for sorting only. Learners never type it.
export const bareName = (folder: string) => folder.replace(/^\d+-/, "");

function readStepSettings(stepFolder: string): StepSettings {
  const settingsPath = join(stepFolder, "step.toml");
  if (!existsSync(settingsPath)) return {};
  return Bun.TOML.parse(readFileSync(settingsPath, "utf8")) as StepSettings;
}

function readStep(stepFolder: string, folderName: string, partName: string): Step {
  const settings = readStepSettings(stepFolder);
  return {
    name: bareName(folderName),
    dir: stepFolder,
    part: partName,
    meta: {
      minutes: Number(settings.minutes ?? 0),
      screen: Boolean(settings.screen),
      solution: Boolean(settings.solution),
    },
  };
}

// The orientation is the first part when it holds a step (a folder with step.toml).
function orientation(): Part[] {
  const dir = join(ROOT, "00-orientation");
  const stepFolders = subfolders(dir).filter((folderName) =>
    existsSync(join(dir, folderName, "step.toml")),
  );
  const steps = stepFolders.map((folderName) =>
    readStep(join(dir, folderName), folderName, "orientation"),
  );
  return steps.length ? [{ name: "orientation", dir, steps }] : [];
}

function readPart(partsFolder: string, partFolderName: string): Part {
  const dir = join(partsFolder, partFolderName);
  const partName = bareName(partFolderName);
  const steps = subfolders(dir).map((stepFolderName) =>
    readStep(join(dir, stepFolderName), stepFolderName, partName),
  );
  return { name: partName, dir, steps };
}

export function parts(): Part[] {
  const partsFolder = join(ROOT, "parts");
  const numberedParts = subfolders(partsFolder).map((partFolderName) =>
    readPart(partsFolder, partFolderName),
  );
  return [...orientation(), ...numberedParts];
}

export const allSteps = () => parts().flatMap((part) => part.steps);

export function findStep(name: string): Step | undefined {
  return allSteps().find((step) => step.name === name);
}
