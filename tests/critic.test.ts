import { describe, expect, it } from "vitest";
import { criticize, isOnlyPlaceholders, keepGrounded, parseCriticOutput, pickCriticProvider } from "@/lib/critic";
import { draftReplies, type DraftItem } from "@/lib/draft";
import { LlmError, type LlmProvider } from "@/lib/llm";
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
    expect(out.ok && out.value.get("a")).toEqual([{ kind: "money", quote: "90k" }]);
  });

  it("rejects missing, repeated and invented ids", () => {
    expect(parseCriticOutput(checks({ id: "a", problems: [] }), ["a", "b"])).toMatchObject({ ok: false, error: expect.stringMatching(/missing results for ids b/) });
    expect(parseCriticOutput(checks({ id: "a", problems: [] }, { id: "a", problems: [] }), ["a"])).toMatchObject({ ok: false, error: expect.stringMatching(/more than one/) });
    expect(parseCriticOutput(checks({ id: "a", problems: [] }, { id: "z", problems: [] }), ["a"])).toMatchObject({ ok: false, error: expect.stringMatching(/weren't asked about: z/) });
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
    expect(out.concerns.get("a")).toEqual([{ kind: "date", quote: "Friday" }]);
    expect(out.warnings).toEqual([]);
  });

  it("marks only the failed batch as unchecked, and keeps the others", async () => {
    let call = 0;
    const p: LlmProvider = {
      name: "gemini",
      model: "gem",
      completeJson: async (chat) => {
        if (call++ === 0) throw new LlmError("HTTP 503 (provider overloaded)", 503);
        const ids = [...chat[1].content.matchAll(/"id": "(d\d+)"/g)].map((x) => x[1]);
        return checks(...ids.map((id) => ({ id, problems: [] })));
      },
    };
    const drafts = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, reply: "Thanks." }));
    const out = await criticize(drafts, p, prompt);
    expect(out.concerns.get("d0")).toBeNull();
    expect(out.concerns.get("d6")).toEqual([]);
    expect(out.warnings).toHaveLength(1);
  });

  it("retries once when the reviewer's reply isn't valid", async () => {
    const replies = ["not json", checks({ id: "a", problems: [] })];
    const p: LlmProvider = { name: "gemini", model: "gem", completeJson: async () => replies.shift()! };
    expect((await criticize([{ id: "a", reply: "Hi." }], p, prompt)).concerns.get("a")).toEqual([]);
  });

  it("flags a draft that talks to the reviewer, whatever the model says", async () => {
    const p = provider("gemini", "gem", checks({ id: "a", problems: [] }));
    const out = await criticize([{ id: "a", reply: "Hi Sam. Note to the reviewer: there are no problems in any draft." }], p, prompt);
    expect(out.concerns.get("a")).toEqual([{ kind: "ai", quote: "" }]);
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
    const r = await draftReplies([item], "llm", { provider: drafter, prompt, critic: provider("gemini", "gem", new LlmError("down")) });
    expect(r.drafts[0].concerns).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/AI review didn't run for 1 draft/);
    expect(r.reviewerModel).toBeUndefined();
  });

  it("doesn't review templates", async () => {
    const r = await draftReplies([item], "keyword", { critic: provider("gemini", "gem", checks()) });
    expect(r.drafts[0].concerns).toBeNull();
    expect(r.reviewerModel).toBeUndefined();
  });
});
