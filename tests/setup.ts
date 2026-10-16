import { afterEach, beforeEach, vi } from "vitest";

// Tests must never reach a real API or depend on keys in the developer's shell. The
// Day 5 QA review found that with GROQ_API_KEY set, three draft tests quietly made
// real calls (and would have spent tokens with a real key).
for (const key of Object.keys(process.env)) {
  if (/^(GROQ|GEMINI)_|_PROMPT_VERSION$/.test(key)) delete process.env[key];
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      throw new Error(`Unexpected network call in a test: ${String(url)}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
