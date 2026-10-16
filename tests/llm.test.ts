import { describe, expect, it, vi } from "vitest";
import { getProvider, getProviders, LlmError, retryDelayMs, withFailover, type LlmProvider } from "@/lib/llm";
import { readServerConfig } from "@/lib/server-config";

const cfg = (env: Record<string, string> = {}) => readServerConfig({ LLM_MAX_RETRIES: "2", LLM_MAX_WAIT_MS: "10000", ...env });
const groqOnly = () => getProvider(cfg({ GROQ_API_KEY: "secret" }))!;
const okGroq = (content: string) => Response.json({ choices: [{ message: { content } }] });
const mockFetch = (...responses: (Response | Error)[]) => {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("provider selection", () => {
  it("prefers Groq, then Gemini, else null", () => {
    expect(getProvider(cfg({ GROQ_API_KEY: "k", GEMINI_API_KEY: "g" }))?.name).toBe("groq");
    expect(getProvider(cfg({ GEMINI_API_KEY: "g" }))?.name).toBe("gemini");
    expect(getProvider(cfg())).toBeNull();
  });

  it("uses models from config, and treats empty env values as unset", () => {
    expect(getProvider(cfg({ GROQ_API_KEY: "k", GROQ_MODEL: "some-model" }))?.model).toBe("some-model");
    expect(getProvider(cfg({ GROQ_API_KEY: "k", GROQ_MODEL: "" }))?.model).toBe("openai/gpt-oss-120b");
    expect(getProvider(cfg({ GROQ_API_KEY: "" }))).toBeNull();
  });

  it("gives evals a single provider and the app a failover chain", () => {
    const both = cfg({ GROQ_API_KEY: "k", GEMINI_API_KEY: "g" });
    expect(getProvider(both, { failover: false })?.model).toBe("openai/gpt-oss-120b");
    expect(getProvider(both, { only: "gemini" })?.name).toBe("gemini");
    expect(getProviders(both)).toHaveLength(2);
  });
});

describe("Groq over HTTP", () => {
  it("sends a JSON-mode request with the key, a token cap and temperature 0", async () => {
    const fetchMock = mockFetch(okGroq('{"results":[]}'));
    await expect(groqOnly().completeJson([{ role: "user", content: "hi" }])).resolves.toBe('{"results":[]}');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toMatchObject({
      temperature: 0,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
    });
  });

  it("retries a 429 using retry-after, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(new Response("slow down", { status: 429, headers: { "retry-after": "1" } }), okGroq("{}"));
    const pending = groqOnly().completeJson([]);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured number of retries, with the status", async () => {
    vi.useFakeTimers();
    mockFetch(...[0, 1, 2].map(() => new Response("busy", { status: 503 })));
    const pending = groqOnly().completeJson([]).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await pending;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/overloaded/);
  });

  it("fails at once on a daily limit instead of waiting 19 minutes", async () => {
    const fetchMock = mockFetch(new Response("tokens per day (TPD). Please try again in 19m0.9s.", { status: 429 }));
    const err = await groqOnly().completeJson([]).catch((e) => e);
    expect(err.message).toMatch(/longer than a request can wait \(daily limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps provider error bodies (account ids) out of the message", async () => {
    mockFetch(new Response("Rate limit in organization `org_secret123` on tokens per day (TPD). Please try again in 19m0.9s.", { status: 429 }));
    const err = await groqOnly().completeJson([]).catch((e) => e);
    expect(err.message).not.toContain("org_secret123");
    mockFetch(new Response("org_secret123 invalid key", { status: 401 }));
    const keyErr = await groqOnly().completeJson([]).catch((e) => e);
    expect(keyErr).toMatchObject({ status: 401, message: "HTTP 401 (key rejected)" });
  });

  it("turns a 200 with a body that isn't JSON into an LlmError, so failover can run", async () => {
    mockFetch(new Response("<html>gateway</html>", { status: 200 }));
    await expect(groqOnly().completeJson([])).rejects.toBeInstanceOf(LlmError);
  });

  it("turns network errors into an LlmError without leaking details", async () => {
    mockFetch(new TypeError("getaddrinfo ENOTFOUND internal-host"));
    const err = await groqOnly().completeJson([]).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toBe("Request failed (network error).");
  });

  it("stops when the caller's time budget runs out, including during a retry wait", async () => {
    vi.useFakeTimers();
    mockFetch(new Response("slow down", { status: 429, headers: { "retry-after": "5" } }));
    const budget = new AbortController();
    const pending = groqOnly().completeJson([], { signal: budget.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    budget.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toMatch(/time budget/);
  });
});

describe("Gemini over HTTP", () => {
  it("sends the system prompt, key header, JSON mode and token cap", async () => {
    const fetchMock = mockFetch(Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
    const p = getProvider(cfg({ GEMINI_API_KEY: "gk", GEMINI_MODEL: "m-1" }))!;
    await expect(p.completeJson([{ role: "system", content: "sys" }, { role: "user", content: "u" }])).resolves.toBe("{}");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk");
    expect(JSON.parse(init.body as string)).toMatchObject({
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [{ text: "u" }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 4096 },
    });
  });

  it("throws an LlmError when Gemini returns no text", async () => {
    mockFetch(Response.json({ candidates: [] }));
    await expect(getProvider(cfg({ GEMINI_API_KEY: "g" }))!.completeJson([])).rejects.toThrow("Gemini returned no text.");
  });
});

describe("retryDelayMs", () => {
  it("follows the server's hint from the header or the error text", () => {
    expect(retryDelayMs("4", "", 0)).toBe(4500);
    expect(retryDelayMs(null, "Please try again in 1.5s. Need more tokens?", 0)).toBe(2000);
    expect(retryDelayMs(null, "Please try again in 1m2s", 0, 70_000)).toBe(62_500);
  });

  it("backs off exponentially without a hint, capped at the max wait", () => {
    expect(retryDelayMs(null, "", 0)).toBe(2000);
    expect(retryDelayMs(null, "", 1)).toBe(4000);
    expect(retryDelayMs(null, "", 5, 10_000)).toBe(10_000);
  });

  it("reads an HTTP-date Retry-After", () => {
    const inFiveSeconds = new Date(Date.now() + 5_000).toUTCString();
    expect(retryDelayMs(inFiveSeconds, "", 0)).toBeGreaterThan(3_000);
  });

  it("returns null when the hint is longer than the max wait, in any format", () => {
    expect(retryDelayMs("120", "", 0)).toBeNull();
    expect(retryDelayMs(null, "Please try again in 1m22.512s.", 0)).toBeNull();
    expect(retryDelayMs(null, "Please try again in 19m.", 0)).toBeNull();
    expect(retryDelayMs(null, "Please try again in 2h", 0)).toBeNull();
    expect(retryDelayMs(null, "Please try again in 10s", 0, 10_000)).toBeNull();
  });
});

describe("withFailover", () => {
  const fake = (name: "groq" | "gemini", model: string, result: string | Error): LlmProvider & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      name, model, calls,
      completeJson: async (_m, opts) => {
        calls.push(opts);
        if (result instanceof Error) throw result;
        return result;
      },
    };
  };

  it("moves to the next provider on a provider error, and reports what answered", async () => {
    const p = withFailover([fake("groq", "g", new LlmError("HTTP 429", 429)), fake("gemini", "gem", "{}")]);
    await expect(p.completeJson([])).resolves.toBe("{}");
    expect(p.model).toBe("gem");
    expect(p.name).toBe("gemini");
  });

  it("gives earlier providers no retries, so failover isn't delayed", async () => {
    const first = fake("groq", "g", new LlmError("busy", 503));
    const last = fake("gemini", "gem", "{}");
    await withFailover([first, last]).completeJson([]);
    expect(first.calls[0]).toMatchObject({ retries: 0 });
    expect(last.calls[0]).toMatchObject({ retries: undefined });
  });

  it("names both models when a run switched partway", async () => {
    let calls = 0;
    const flaky: LlmProvider = { name: "groq", model: "g", completeJson: async () => { if (calls++ > 0) throw new LlmError("x", 429); return "{}"; } };
    const p = withFailover([flaky, fake("gemini", "gem", "{}")]);
    await p.completeJson([]);
    await p.completeJson([]);
    expect(p.model).toBe("g + gem");
  });

  it("throws the last error when all fail, and doesn't hide code bugs", async () => {
    await expect(withFailover([fake("groq", "a", new LlmError("first", 429)), fake("gemini", "b", new LlmError("second", 503))]).completeJson([]))
      .rejects.toThrow("second");
    await expect(withFailover([fake("groq", "a", new TypeError("oops")), fake("gemini", "b", "{}")]).completeJson([]))
      .rejects.toThrow("oops");
  });

  it("doesn't try the backup once the time budget is gone", async () => {
    const budget = new AbortController();
    budget.abort();
    const backup = fake("gemini", "b", "{}");
    await expect(withFailover([fake("groq", "a", new LlmError("timeout")), backup]).completeJson([], { signal: budget.signal })).rejects.toThrow();
    expect(backup.calls).toHaveLength(0);
  });
});
