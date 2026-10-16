// Shared setup for the scripts in this folder: loading .env.local, reading flags,
// and picking exactly one provider. Every script used to repeat this slightly
// differently (Day 5 review).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { getProvider, type LlmProvider } from "../lib/llm";
import { readServerConfig, type ServerConfig } from "../lib/server-config";

export const ROOT = join(__dirname, "..");

// Values already set in the shell win over .env.local, so a one-off override like
// GROQ_MODEL=openai/gpt-oss-20b npm run eval -- --llm works.
//
// Scripts aren't bound by Vercel's 60s limit, so by default they wait out per-minute
// rate limits for longer than the app does. Without this, a back-to-back eval run hit
// the per-minute limit and was (correctly) rejected as invalid on Day 5.
const SCRIPT_DEFAULTS = { LLM_MAX_WAIT_MS: "30000", LLM_MAX_RETRIES: "4", LLM_TIMEOUT_MS: "60000" };

export function loadConfig(): ServerConfig {
  const file = join(ROOT, ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
  return readServerConfig({ ...SCRIPT_DEFAULTS, ...process.env });
}

export function cliArgs<T extends NonNullable<ParseArgsConfig["options"]>>(options: T) {
  return parseArgs({ options, allowPositionals: true, strict: true });
}

// One provider per run so a score always belongs to one model. Evals never fail over.
export function singleProvider(config: ServerConfig, name?: string): LlmProvider {
  if (name !== undefined && name !== "groq" && name !== "gemini") throw new Error(`--provider must be groq or gemini, not "${name}"`);
  const provider = getProvider(config, { failover: false, only: name });
  if (!provider) throw new Error(`No API key for ${name ?? "any provider"} in .env.local`);
  return provider;
}

export function fail(e: unknown): never {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
