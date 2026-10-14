import { describe, expect, it } from "vitest";
import { criticize, isOnlyPlaceholders, keepGrounded, parseCriticOutput, pickCriticProvider } from "@/lib/critic";
import { draftReplies, type DraftItem } from "@/lib/draft";
import type { LlmProvider } from "@/lib/llm";
import type { Prompt } from "@/lib/prompts";

const prompt: Prompt = { name: "critic", version: "v0", text: "test" };
const provider = (name: "groq" | "gemini", model: string, reply: string | Error): LlmProvider => ({
  name, model, completeJson: async () => { if (reply instanceof Error) throw reply; return reply; },
});
const checks = (...c: object[]) => JSON.stringify({ checks: c });

describe("parseCriticOutput", () => {
  it("keeps known kinds and drops unknown kinds and placeholder-only quotes", () => {
    const out = parseCriticOutput(checks({ id: "a", problems: [
      { kind: "money", quote: "90k" }, { kind: "vibes", quote: "x" }, { kind: "contact", quote: "[REFERRAL_EMAIL]" },
    ] }), ["a"]);
    expect(out.get("a")).toEqual([{ kind: "money", quote: "90k" }]);
  });

  it("fails when the reviewer skips a draft", () => {
    expect(() => parseCriticOutput(checks({ id: "a", problems: [] }), ["a", "b"])).toThrow(/skipped ids b/);
  });
});

describe("keepGrounded", () => {
  it("drops concerns whose quote isn't in the draft, tolerating quotes, dashes, case and a trailing period", () => {
    const reply = "Hi Sam, I’ll check the 4‑day week and come back. See you Friday.";
    const kept = keepGrounded([
      { kind: "date", quote: "see you friday." },
      { kind: "company_fact", quote: "4-day week" },
      { kind: "claims_action", quote: "I've reviewed it" },
    ], reply);
    expect(kept.map((c) => c.kind)).toEqual(["date", "company_fact"]);
  });
});

describe("isOnlyPlaceholders", () => {
  it.each([["[REFERRAL_EMAIL]", true], ["[A] [B]", true], ["send to [EMAIL]", false], ["", false]])("%j -> %s", (q, want) => {
    expect(isOnlyPlaceholders(q)).toBe(want);
  });
});

describe("pickCriticProvider", () => {
  const groq = provider("groq", "g-model", "{}");
  const gemini = provider("gemini", "gem-model", "{}");
  it("prefers a model that didn't write the drafts", () => {
    expect(pickCriticProvider(groq, [groq, gemini])?.model).toBe("gem-model");
    expect(pickCriticProvider(gemini, [groq, gemini])?.model).toBe("g-model");
  });
  it("falls back to the drafting model when the independent one fails", async () => {
    const down = provider("gemini", "gem-model", new (await import("@/lib/llm")).LlmError("busy", 503));
    const same = provider("groq", "g-model", checks());
    const p = pickCriticProvider(same, [same, down])!;
    await p.completeJson([]);
    expect(p.model).toBe("g-model");
  });

  it("falls back to the only model there is, or none", () => {
    expect(pickCriticProvider(groq, [groq])?.model).toBe("g-model");
    expect(pickCriticProvider(null, [])).toBeNull();
  });
});

describe("criticize", () => {
  it("returns grounded concerns per draft", async () => {
    const p = provider("gemini", "gem", checks({ id: "a", problems: [{ kind: "date", quote: "Friday" }, { kind: "money", quote: "100k" }] }));
    const out = await criticize([{ id: "a", reply: "See you Friday." }], p, prompt);
    expect(out.get("a")).toEqual([{ kind: "date", quote: "Friday" }]);
  });
});

describe("draftReplies with the reviewer", () => {
  const item: DraftItem = {
    message: { id: "a", from: "", subject: "", body: "Any update?" },
    classification: { id: "a", intent: "status_check", confidence: 0.9, flags: [], reason: "", method: "llm" },
  };
  const drafter = provider("groq", "g-model", JSON.stringify({ drafts: [{ id: "a", group: "status_check", reply: "We'll match your pay plus 10%." }] }));

  it("attaches the reviewer's concerns and names the reviewer model", async () => {
    const critic = provider("gemini", "gem-model", checks({ id: "a", problems: [{ kind: "money", quote: "match your pay plus 10%" }] }));
    const r = await draftReplies([item], "llm", { provider: drafter, prompt, critic });
    expect(r.drafts[0].concerns).toEqual([{ kind: "money", quote: "match your pay plus 10%" }]);
    expect(r.reviewerModel).toBe("gem-model");
  });

  it("still returns drafts, unchecked, with a warning when the reviewer fails", async () => {
    const r = await draftReplies([item], "llm", { provider: drafter, prompt, critic: provider("gemini", "gem", new Error("down")) });
    expect(r.drafts[0].concerns).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/AI review of drafts didn't run/);
  });

  it("doesn't review templates", async () => {
    const r = await draftReplies([item], "keyword", { critic: provider("gemini", "gem", checks()) });
    expect(r.drafts[0].concerns).toBeNull();
    expect(r.reviewerModel).toBeUndefined();
  });
});
