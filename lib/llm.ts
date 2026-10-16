// One small interface over the free LLM APIs. Plain fetch, no SDKs.
import { serverConfig, type ServerConfig } from "./server-config";

export type ChatMessage = { role: "system" | "user"; content: string };

export type CallOptions = {
  // Aborts the call (and any retry wait) when the caller's time budget runs out.
  signal?: AbortSignal;
  // Overrides the configured retry count. Failover sets 0 on all but the last provider.
  retries?: number;
};

export interface LlmProvider {
  name: "groq" | "gemini";
  // For a failover chain, the model(s) that actually answered so far.
  readonly model: string;
  // Returns the raw text of the reply. Asks the API for JSON output.
  completeJson(messages: ChatMessage[], opts?: CallOptions): Promise<string>;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LlmError";
  }
}

type Settings = Pick<
  ServerConfig,
  "LLM_TIMEOUT_MS" | "LLM_MAX_RETRIES" | "LLM_MAX_WAIT_MS" | "LLM_MAX_OUTPUT_TOKENS"
>;

// Every provider that has a key, Groq first.
export function getProviders(config: ServerConfig = serverConfig()): LlmProvider[] {
  const list: LlmProvider[] = [];
  if (config.GROQ_API_KEY) list.push(groq(config.GROQ_API_KEY, config.GROQ_MODEL, config.GROQ_BASE_URL, config));
  if (config.GEMINI_API_KEY) list.push(gemini(config.GEMINI_API_KEY, config.GEMINI_MODEL, config.GEMINI_BASE_URL, config));
  return list;
}

// The app fails over between providers. Evals pass { failover: false } (or `only`) so a
// score never mixes two models without saying so.
export function getProvider(
  config: ServerConfig = serverConfig(),
  opts: { failover?: boolean; only?: LlmProvider["name"] } = {},
): LlmProvider | null {
  const list = getProviders(config).filter((p) => !opts.only || p.name === opts.only);
  if (!list.length) return null;
  return opts.failover === false || list.length === 1 ? list[0] : withFailover(list);
}

// Tries each provider in order when one fails (Day 4: Groq's daily token limit ran out
// and the live site silently dropped to keywords while a Gemini key sat unused).
// Earlier providers get no retries: when there is a backup, switching is faster than
// waiting out a 429 or 503 (Day 5 review: the old retry budget could outlast Vercel's
// 60s limit before failover ever ran). `model` reports what actually answered.
export function withFailover(providers: LlmProvider[]): LlmProvider {
  const answered = new Set<LlmProvider>();
  return {
    get name() {
      return ([...answered].at(-1) ?? providers[0]).name;
    },
    get model() {
      return answered.size ? [...answered].map((p) => p.model).join(" + ") : providers[0].model;
    },
    async completeJson(messages, opts = {}) {
      let lastError: unknown;
      for (const [i, p] of providers.entries()) {
        const isLast = i === providers.length - 1;
        try {
          const text = await p.completeJson(messages, { ...opts, retries: isLast ? opts.retries : 0 });
          answered.add(p);
          return text;
        } catch (e) {
          if (!(e instanceof LlmError)) throw e;
          if (opts.signal?.aborted) throw e;
          lastError = e;
        }
      }
      throw lastError;
    },
  };
}

function groq(apiKey: string, model: string, baseUrl: string, settings: Settings): LlmProvider {
  return {
    name: "groq",
    model,
    async completeJson(messages, opts) {
      const res = (await post(`${baseUrl}/chat/completions`, settings, opts, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          messages,
          temperature: 0,
          max_completion_tokens: settings.LLM_MAX_OUTPUT_TOKENS,
          response_format: { type: "json_object" },
        },
      })) as { choices?: { message?: { content?: unknown } }[] };
      const text = res?.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new LlmError("Groq returned no message content.");
      return text;
    },
  };
}

function gemini(apiKey: string, model: string, baseUrl: string, settings: Settings): LlmProvider {
  return {
    name: "gemini",
    model,
    async completeJson(messages, opts) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const user = messages.filter((m) => m.role === "user").map((m) => ({ role: "user", parts: [{ text: m.content }] }));
      const res = (await post(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, settings, opts, {
        headers: { "x-goog-api-key": apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: user,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: settings.LLM_MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
          },
        },
      })) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };
      const text = res?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new LlmError("Gemini returned no text.");
      return text;
    },
  };
}

async function post(
  url: string,
  settings: Settings,
  opts: CallOptions = {},
  req: { headers: Record<string, string>; body: unknown },
  attempt = 0,
): Promise<unknown> {
  const retries = opts.retries ?? settings.LLM_MAX_RETRIES;
  const timeout = AbortSignal.timeout(settings.LLM_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...req.headers },
      body: JSON.stringify(req.body),
      signal,
    });
  } catch {
    const reason = opts.signal?.aborted ? "request time budget used up" : timeout.aborted ? "timed out" : "network error";
    throw new LlmError(`Request failed (${reason}).`);
  }

  // Free tiers rate-limit hard (429) and get overloaded (503). Both are temporary.
  if (res.status === 429 || res.status === 503) {
    const body = await res.text().catch(() => "");
    const kind = res.status === 503 ? "provider overloaded" : limitKind(body);
    if (attempt >= retries) throw new LlmError(`HTTP ${res.status} (${kind})`, res.status);
    const waitMs = retryDelayMs(res.headers.get("retry-after"), body, attempt, settings.LLM_MAX_WAIT_MS);
    // null means the wait is longer than any request can last (a daily limit), so fail now.
    if (waitMs === null) throw new LlmError(`Rate limited for longer than a request can wait (${kind}).`, res.status);
    await sleep(waitMs, opts.signal);
    return post(url, settings, opts, req, attempt + 1);
  }

  if (!res.ok) {
    // Keep provider error bodies out of messages; they can carry account details.
    await res.text().catch(() => "");
    const reason = res.status === 401 || res.status === 403 ? "key rejected" : "provider error";
    throw new LlmError(`HTTP ${res.status} (${reason})`, res.status);
  }

  // A 200 with a broken body is still a provider failure, so failover can try the next one.
  try {
    return await res.json();
  } catch {
    throw new LlmError("Provider sent a response that isn't JSON.", res.status);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError("Request failed (request time budget used up)."));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new LlmError("Request failed (request time budget used up)."));
      },
      { once: true },
    );
  });
}

// Prefer the server's own hint, from the Retry-After header (seconds or an HTTP date)
// or from "try again in 1m22.5s" / "try again in 19m" in the body, plus a little slack.
// Returns null when the wait would be longer than maxWaitMs: on Day 4 the daily token
// limit said "try again in 19m" and retrying was pointless.
export function retryDelayMs(
  retryAfterHeader: string | null,
  body: string,
  attempt: number,
  maxWaitMs = 10_000,
): number | null {
  let seconds = 0;
  if (retryAfterHeader) {
    const asNumber = Number(retryAfterHeader);
    const asDate = Date.parse(retryAfterHeader);
    if (Number.isFinite(asNumber) && asNumber > 0) seconds = asNumber;
    else if (Number.isFinite(asDate)) seconds = Math.max(0, (asDate - Date.now()) / 1000);
  }
  if (!seconds) {
    const hint = body.match(/try again in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i)?.[1] ?? "";
    const part = (unit: string) => Number(hint.match(new RegExp(`([\\d.]+)${unit}`))?.[1] ?? 0);
    seconds = part("h") * 3600 + part("m") * 60 + part("s");
  }
  const ms = seconds > 0 ? seconds * 1000 + 500 : 2000 * 2 ** attempt;
  return ms > maxWaitMs ? (seconds > 0 ? null : maxWaitMs) : ms;
}

// Short, safe description for messages that reach the browser. Provider error bodies
// include things like the organization id, which the UI shouldn't show.
export function limitKind(body: string): string {
  if (/tokens per day|TPD|requests per day|RPD/i.test(body)) return "daily limit reached";
  if (/tokens per minute|TPM|requests per minute|RPM/i.test(body)) return "per-minute limit reached";
  return "rate limited";
}
