// Checks one line of stream-json output against contract.schema.json. It reads only the parts
// of JSON Schema the contract uses: const, enum, type, required and additionalProperties.
// The supervisor may move this file and the schema into checks/lib/.
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PropertyRule = { const?: unknown; enum?: unknown[]; type?: string };
type EventRule = {
  properties: Record<string, PropertyRule>;
  required: string[];
};

const schemaPath = join(import.meta.dir, "contract.schema.json");
const schema: { oneOf: EventRule[] } = JSON.parse(readFileSync(schemaPath, "utf8"));

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function fitsProperty(rule: PropertyRule, value: unknown): boolean {
  if ("const" in rule && value !== rule.const) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type && typeOf(value) !== rule.type) return false;
  return true;
}

function fitsRule(rule: EventRule, event: Record<string, unknown>): boolean {
  const allRequired = rule.required.every((field) => field in event);
  const noExtras = Object.keys(event).every((field) => field in rule.properties);
  if (!allRequired || !noExtras) return false;
  return Object.entries(rule.properties).every(
    ([field, propertyRule]) => !(field in event) || fitsProperty(propertyRule, event[field]),
  );
}

// The event in this line, or null when the line is not one event of the contract.
export function contractEvent(line: string): Record<string, unknown> | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeOf(event) !== "object") return null;
  const fields = event as Record<string, unknown>;
  const fits = schema.oneOf.some((rule) => fitsRule(rule, fields));
  return fits ? fields : null;
}

// Every non-empty line of stdout as an event, or null when any line breaks the contract.
export function contractEvents(stdout: string): Record<string, unknown>[] | null {
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  const events = lines.map(contractEvent);
  if (lines.length === 0 || events.some((event) => event === null)) return null;
  return events as Record<string, unknown>[];
}
