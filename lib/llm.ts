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
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 25_000;
const MAX_RATE_LIMIT_RETRIES = 2;

type Env = Record<string, string | undefined>;

export function getProvider(env: Env = process.env): LlmProvider | null {
  if (env.GROQ_API_KEY) return groq(env.GROQ_API_KEY, env.GROQ_MODEL || DEFAULT_GROQ_MODEL);
  if (env.GEMINI_API_KEY) return gemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
  return null;
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

  // Free tiers rate-limit hard. Wait it out a couple of times before giving up.
  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt, 15_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return post(url, opts, attempt + 1);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new LlmError(`HTTP ${res.status}: ${detail}`, res.status);
  }
  return res.json();
}
