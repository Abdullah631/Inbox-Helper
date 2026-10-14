import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTENTS } from "@/lib/intents";
import { getProvider, LlmError, retryDelayMs, withFailover, type LlmProvider } from "@/lib/llm";
import { ACTIVE_PROMPTS, listVersions, loadPrompt } from "@/lib/prompts";

describe("getProvider", () => {
  it("prefers Groq, then Gemini, else null", () => {
    expect(getProvider({ GROQ_API_KEY: "k", GEMINI_API_KEY: "g" })?.name).toBe("groq");
    expect(getProvider({ GEMINI_API_KEY: "g" })?.name).toBe("gemini");
    expect(getProvider({})).toBeNull();
  });

  it("uses the model from env when set", () => {
    expect(getProvider({ GROQ_API_KEY: "k", GROQ_MODEL: "some-model" })?.model).toBe("some-model");
  });
});

describe("failover", () => {
  const fake = (name: "groq" | "gemini", model: string, result: string | Error): LlmProvider => ({
    name, model, completeJson: async () => { if (result instanceof Error) throw result; return result; },
  });

  it("uses the next provider when one fails with a provider error, and reports what answered", async () => {
    const p = withFailover([fake("groq", "g-model", new LlmError("HTTP 429 (daily limit reached)", 429)), fake("gemini", "gem-model", "{}")]);
    await expect(p.completeJson([])).resolves.toBe("{}");
    expect(p.model).toBe("gem-model");
  });

  it("names both models when a run switched partway", async () => {
    let calls = 0;
    const flaky: LlmProvider = { name: "groq", model: "g-model", completeJson: async () => { if (calls++ > 0) throw new LlmError("x", 429); return "{}"; } };
    const p = withFailover([flaky, fake("gemini", "gem-model", "{}")]);
    await p.completeJson([]);
    await p.completeJson([]);
    expect(p.model).toBe("g-model + gem-model");
  });

  it("throws the last error when every provider fails, and doesn't swallow code bugs", async () => {
    const p = withFailover([fake("groq", "a", new LlmError("first", 429)), fake("gemini", "b", new LlmError("second", 503))]);
    await expect(p.completeJson([])).rejects.toThrow("second");
    const bug = withFailover([fake("groq", "a", new TypeError("oops")), fake("gemini", "b", "{}")]);
    await expect(bug.completeJson([])).rejects.toThrow("oops");
  });

  it("is only used when asked: evals get a single provider", () => {
    const env = { GROQ_API_KEY: "k", GEMINI_API_KEY: "g" };
    expect(getProvider(env, { failover: false })?.model).toBe("openai/gpt-oss-120b");
    expect(getProvider(env, { only: "gemini" })?.name).toBe("gemini");
  });
});

describe("Groq provider over HTTP", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a JSON-mode request with the key and returns the content", async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"results":[]}' } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const text = await getProvider({ GROQ_API_KEY: "secret" })!.completeJson([{ role: "user", content: "hi" }]);
    expect(text).toBe('{"results":[]}');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/api\.groq\.com/);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toMatchObject({ temperature: 0, response_format: { type: "json_object" } });
  });

  it("retries on 429 using retry-after, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getProvider({ GROQ_API_KEY: "k" })!.completeJson([]);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries a 503 (model overloaded) the same way", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getProvider({ GROQ_API_KEY: "k" })!.completeJson([]);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBe("{}");
    vi.useRealTimers();
  });

  it("waits as long as the server asks, from the header or the error text, within a cap", () => {
    expect(retryDelayMs("4", "", 0)).toBe(4500);
    expect(retryDelayMs(null, "Please try again in 1.5s. Need more tokens?", 0)).toBe(2000);
    expect(retryDelayMs(null, "", 0)).toBe(3000);
    expect(retryDelayMs(null, "", 1)).toBe(6000);
    expect(retryDelayMs(null, "Please try again in 12.25s.", 0)).toBe(12750);
  });

  it("gives up instead of waiting when the server asks for longer than a request can last", () => {
    expect(retryDelayMs("120", "", 0)).toBeNull();
    expect(retryDelayMs(null, "on tokens per day (TPD): Limit 200000. Please try again in 1m22.512s.", 0)).toBeNull();
    expect(retryDelayMs(null, "Please try again in 19m0.912s.", 0)).toBeNull();
  });

  it("does not put the provider's error body (account ids) into the error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"Rate limit in organization `org_secret123` on tokens per day (TPD). Please try again in 19m0.9s."}}', { status: 429 })));
    const err = await getProvider({ GROQ_API_KEY: "k" })!.completeJson([]).catch((e) => e);
    expect(err.message).not.toContain("org_secret123");
    expect(err.message).toMatch(/daily limit/);
  });

  it("throws an LlmError with the status on other HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad key", { status: 401 })));
    const err = await getProvider({ GROQ_API_KEY: "k" })!.completeJson([]).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(401);
  });
});

describe("prompts", () => {
  it("loads the latest version by default and fills in every intent", () => {
    const p = loadPrompt("classify");
    expect(p.version).toBe(listVersions("classify").at(-1));
    for (const intent of INTENTS) expect(p.text).toContain(`- ${intent}:`);
    expect(p.text).not.toContain("{{");
  });

  it("has an active version that exists on disk", () => {
    expect(listVersions("classify")).toContain(ACTIVE_PROMPTS.classify);
  });

  it("sorts versions numerically and errors on unknown ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-"));
    for (const v of ["v1", "v2", "v10"]) writeFileSync(join(dir, `classify.${v}.md`), v);
    expect(listVersions("classify", dir)).toEqual(["v1", "v2", "v10"]);
    expect(loadPrompt("classify", undefined, dir).version).toBe("v10");
    expect(() => loadPrompt("classify", "v9", dir)).toThrow(/have: v1, v2, v10/);
  });
});
