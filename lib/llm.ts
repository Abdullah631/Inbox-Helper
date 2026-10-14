// One small interface over the free LLM APIs. Plain fetch, no SDKs.

export type ChatMessage = { role: "system" | "user"; content: string };

export interface LlmProvider {
  name: "groq" | "gemini";
  model: string;
  // Returns the raw text of the reply. Asks the API for JSON output.
  completeJson(messages: ChatMessage[]): Promise<string>;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
// Day 4: the Flash models returned 503 "high demand" after up to a minute on the free
// tier, while Flash-Lite answered in about a second. A slow backup is no backup.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 25_000;
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 20_000;

type Env = Record<string, string | undefined>;

// Every provider that has a key, Groq first.
export function getProviders(env: Env = process.env): LlmProvider[] {
  const list: LlmProvider[] = [];
  if (env.GROQ_API_KEY) list.push(groq(env.GROQ_API_KEY, env.GROQ_MODEL || DEFAULT_GROQ_MODEL));
  if (env.GEMINI_API_KEY) list.push(gemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL));
  return list;
}

// The app fails over between providers. Evals pass { failover: false } (or `only`) so a
// score never mixes two models without saying so.
export function getProvider(
  env: Env = process.env,
  opts: { failover?: boolean; only?: LlmProvider["name"] } = {},
): LlmProvider | null {
  const list = getProviders(env).filter((p) => !opts.only || p.name === opts.only);
  if (!list.length) return null;
  return opts.failover === false || list.length === 1 ? list[0] : withFailover(list);
}

// Tries each provider in order when one fails (Day 4: Groq's daily token limit ran out
// and the live site silently dropped to keywords while a Gemini key sat unused).
// `model` reports what actually answered, e.g. "openai/gpt-oss-120b + gemini-3.8-flash"
// if a run had to switch partway.
export function withFailover(providers: LlmProvider[]): LlmProvider {
  const used: string[] = [];
  return {
    name: providers[0].name,
    get model() {
      return used.length ? [...new Set(used)].join(" + ") : providers[0].model;
    },
    async completeJson(messages) {
      let lastError: unknown;
      for (const p of providers) {
        try {
          const text = await p.completeJson(messages);
          used.push(p.model);
          return text;
        } catch (e) {
          if (!(e instanceof LlmError)) throw e;
          lastError = e;
        }
      }
      throw lastError;
    },
  };
}

function groq(apiKey: string, model: string): LlmProvider {
  return {
    name: "groq",
    model,
    async completeJson(messages) {
      const res = (await post("https://api.groq.com/openai/v1/chat/completions", {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, messages, temperature: 0, response_format: { type: "json_object" } },
      })) as { choices?: { message?: { content?: unknown } }[] };
      const text = res?.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new LlmError("Groq returned no message content.");
      return text;
    },
  };
}

function gemini(apiKey: string, model: string): LlmProvider {
  return {
    name: "gemini",
    model,
    async completeJson(messages) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const user = messages.filter((m) => m.role === "user").map((m) => ({ role: "user", parts: [{ text: m.content }] }));
      const res = (await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        headers: { "x-goog-api-key": apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: user,
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        },
      })) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };
      const text = res?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new LlmError("Gemini returned no text.");
      return text;
    },
  };
}

async function post(url: string, opts: { headers: Record<string, string>; body: unknown }, attempt = 0): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new LlmError(`Request failed: ${(e as Error).message}`);
  }

  // Free tiers rate-limit hard (429) and get overloaded (503). Both are temporary,
  // so wait it out a couple of times before giving up.
  if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
    const body = await res.text().catch(() => "");
    const waitMs = retryDelayMs(res.headers.get("retry-after"), body, attempt);
    // null means the wait is longer than any request can last (a daily limit), so fail now.
    if (waitMs === null) throw new LlmError(`Rate limited for longer than a request can wait (${limitKind(body)}).`, 429);
    await new Promise((r) => setTimeout(r, waitMs));
    return post(url, opts, attempt + 1);
  }

  if (!res.ok) {
    // Keep provider error bodies out of messages; they can carry account details.
    const body = await res.text().catch(() => "");
    const reason = res.status === 429 ? limitKind(body) : res.status === 401 || res.status === 403 ? "key rejected" : "provider error";
    throw new LlmError(`HTTP ${res.status} (${reason})`, res.status);
  }
  return res.json();
}

// Groq's token limit is per minute, so a fixed 2s/4s backoff often isn't enough
// (Day 3: a batch failed after two quick retries). Prefer the server's own hint,
// from the header or from "try again in 1m22.5s" in the body, plus a little slack.
// Returns null when the server wants us to wait longer than MAX_WAIT_MS (Day 4: the
// daily token limit said "try again in 19m", and retrying was pointless).
export function retryDelayMs(retryAfterHeader: string | null, body: string, attempt: number): number | null {
  const header = Number(retryAfterHeader);
  const hinted = body.match(/try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
  const seconds = Number.isFinite(header) && header > 0
    ? header
    : hinted
      ? Number(hinted[1] ?? 0) * 3600 + Number(hinted[2] ?? 0) * 60 + Number(hinted[3])
      : 0;
  if (seconds * 1000 > MAX_WAIT_MS) return null;
  return seconds > 0 ? seconds * 1000 + 500 : Math.min(3000 * 2 ** attempt, MAX_WAIT_MS);
}

// Short, safe description for messages that reach the browser. Provider error bodies
// include things like the organization id, which the UI shouldn't show.
export function limitKind(body: string): string {
  if (/tokens per day|TPD|requests per day|RPD/i.test(body)) return "daily limit reached";
  if (/tokens per minute|TPM|requests per minute|RPM/i.test(body)) return "per-minute limit reached";
  return "rate limited";
}
