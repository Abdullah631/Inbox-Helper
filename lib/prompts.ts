import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INTENTS, INTENT_INFO } from "./intents";

// Prompts are files in /prompts named <name>.v<N>.md. Old versions are never
// edited, so any eval result can be traced back to the exact text that produced it.
const PROMPTS_DIR = join(process.cwd(), "prompts");

export type Prompt = { name: string; version: string; text: string };

// The version the app actually uses. The newest file is not automatically the best one:
// classify v2 scored the same as v1 on average but varied more between runs (see logs/day2.md).
export const ACTIVE_PROMPTS = { classify: "v1" } as const;

export function listVersions(name: string, dir = PROMPTS_DIR): string[] {
  return readdirSync(dir)
    .map((f) => f.match(new RegExp(`^${name}\\.(v\\d+)\\.md$`))?.[1])
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function loadPrompt(name: string, version?: string, dir = PROMPTS_DIR): Prompt {
  const versions = listVersions(name, dir);
  const v = version ?? versions.at(-1);
  if (!v || !versions.includes(v)) {
    throw new Error(`No prompt ${name}.${version ?? "v?"}.md (have: ${versions.join(", ") || "none"})`);
  }
  const raw = readFileSync(join(dir, `${name}.${v}.md`), "utf8");
  return { name, version: v, text: fillTemplate(raw) };
}

export function fillTemplate(raw: string): string {
  const intents = INTENTS.map((i) => `- ${i}: ${INTENT_INFO[i].description}`).join("\n");
  return raw.replaceAll("{{INTENTS}}", intents);
}
