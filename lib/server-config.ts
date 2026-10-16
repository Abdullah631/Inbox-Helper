import { z } from "zod";

// Server-side settings, read from environment variables and validated once.
// Every value is optional and has a working default, so a fresh clone runs with
// no .env at all (keyword mode). A bad value (for example LLM_TIMEOUT_MS=abc) fails
// loudly at startup instead of silently behaving oddly.
//
// Never import this from a client component: it reads secrets. ESLint enforces that
// (see eslint.config.mjs).

// Vercel and .env files often set a variable to an empty string; treat that as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.default(fallback as never));

const promptVersion = z.string().regex(/^v\d+$/, "must look like v1, v2, ...");

const EnvSchema = z.object({
  GROQ_API_KEY: optional(z.string()),
  GROQ_MODEL: withDefault(z.string(), "openai/gpt-oss-120b"),
  GROQ_BASE_URL: withDefault(z.url(), "https://api.groq.com/openai/v1"),

  GEMINI_API_KEY: optional(z.string()),
  // Day 4: the Flash models returned 503 "high demand" after up to a minute on the
  // free tier, while Flash-Lite answered in about a second and was as accurate.
  GEMINI_MODEL: withDefault(z.string(), "gemini-3.5-flash-lite"),
  GEMINI_BASE_URL: withDefault(z.url(), "https://generativelanguage.googleapis.com/v1beta"),

  LLM_TIMEOUT_MS: withDefault(z.coerce.number().int().min(1_000).max(60_000), 25_000),
  // Retries only happen on the last provider in the chain; earlier ones fail over at once.
  LLM_MAX_RETRIES: withDefault(z.coerce.number().int().min(0).max(5), 2),
  LLM_MAX_WAIT_MS: withDefault(z.coerce.number().int().min(0).max(30_000), 10_000),
  // Cap on output per call. gpt-oss is a reasoning model and counts its reasoning here.
  LLM_MAX_OUTPUT_TOKENS: withDefault(z.coerce.number().int().min(256).max(32_000), 4_096),
  // Total time one API request may spend on model calls, kept under Vercel's 60s limit.
  REQUEST_BUDGET_MS: withDefault(z.coerce.number().int().min(5_000).max(58_000), 50_000),

  // Rate limits are counted in messages, not requests, so a big request costs more.
  // One 60-message inbox costs 120 (sort + draft) in AI mode.
  AI_RATE_LIMIT_PER_MIN: withDefault(z.coerce.number().int().min(1), 150),
  KEYWORD_RATE_LIMIT_PER_MIN: withDefault(z.coerce.number().int().min(1), 1_000),

  // Extra origins allowed to call the API, comma separated (the app's own origin is
  // always allowed). Leave empty in production.
  ALLOWED_ORIGINS: withDefault(z.string(), ""),

  CLASSIFY_PROMPT_VERSION: optional(promptVersion),
  DRAFT_PROMPT_VERSION: optional(promptVersion),
  CRITIC_PROMPT_VERSION: optional(promptVersion),
});

export type ServerConfig = z.infer<typeof EnvSchema>;
type Env = Record<string, string | undefined>;

export function readServerConfig(env: Env = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${problems}`);
  }
  return parsed.data;
}

let cached: ServerConfig | undefined;

// The config for this process. Tests and scripts that need different values call
// readServerConfig(env) directly instead.
export function serverConfig(): ServerConfig {
  cached ??= readServerConfig();
  return cached;
}
