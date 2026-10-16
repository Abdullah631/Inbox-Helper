import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INTENTS, INTENT_INFO } from "./intents";
import { serverConfig, type ServerConfig } from "./server-config";

// Prompts are files in /prompts named <name>.v<N>.md. Old versions are never
// edited, so any eval result can be traced back to the exact text that produced it.
const PROMPTS_DIR = join(process.cwd(), "prompts");

export type PromptName = "classify" | "draft" | "critic";
export type Prompt = { name: string; version: string; text: string };

// The version the app actually uses. The newest file is not automatically the best one:
// classify v2 scored the same as v1 on average but varied more between runs (see
// logs/day2.md). Changing one of these needs eval numbers behind it.
export const ACTIVE_PROMPTS: Record<PromptName, string> = { classify: "v1", draft: "v2", critic: "v2" };

const ENV_KEY: Record<PromptName, keyof ServerConfig> = {
  classify: "CLASSIFY_PROMPT_VERSION",
  draft: "DRAFT_PROMPT_VERSION",
  critic: "CRITIC_PROMPT_VERSION",
};

// The version in use: an env override if set, otherwise ACTIVE_PROMPTS.
export function activeVersion(name: PromptName, config: ServerConfig = serverConfig()): string {
  return (config[ENV_KEY[name]] as string | undefined) ?? ACTIVE_PROMPTS[name];
}

export function listVersions(name: string, dir = PROMPTS_DIR): string[] {
  const pattern = new RegExp(`^${name.replace(/[^a-z]/gi, "")}\\.(v\\d+)\\.md$`);
  return readdirSync(dir)
    .map((f) => f.match(pattern)?.[1])
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// Files never change while the server runs, so each prompt is read once.
const cache = new Map<string, Prompt>();

export function loadPrompt(name: string, version?: string, dir = PROMPTS_DIR): Prompt {
  const key = `${dir}|${name}|${version ?? "latest"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const versions = listVersions(name, dir);
  const v = version ?? versions.at(-1);
  if (!v || !versions.includes(v)) {
    throw new Error(`No prompt ${name}.${version ?? "v?"}.md (have: ${versions.join(", ") || "none"})`);
  }
  const prompt = { name, version: v, text: fillTemplate(readFileSync(join(dir, `${name}.${v}.md`), "utf8")) };
  cache.set(key, prompt);
  return prompt;
}

export function loadActivePrompt(name: PromptName): Prompt {
  return loadPrompt(name, activeVersion(name));
}

export function fillTemplate(raw: string): string {
  const intents = INTENTS.map((i) => `- ${i}: ${INTENT_INFO[i].description}`).join("\n");
  const filled = raw.replace(/\{\{\s*INTENTS\s*\}\}/g, intents);
  const leftover = filled.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`Prompt has an unknown placeholder ${leftover[0]}`);
  return filled;
}
