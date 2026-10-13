import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTENTS } from "@/lib/intents";
import { getProvider, LlmError } from "@/lib/llm";
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
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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
