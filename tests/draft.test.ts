import { describe, expect, it, vi } from "vitest";
import { draftReplies, parseDraftOutput, renderDraftBatch, type DraftItem } from "@/lib/draft";
import { checkDraft } from "@/lib/guardrails";
import { INTENTS, type Intent } from "@/lib/intents";
import type { LlmProvider } from "@/lib/llm";
import type { Prompt } from "@/lib/prompts";
import type { Classification } from "@/lib/schema";
import { TEMPLATES } from "@/lib/templates";

const prompt: Prompt = { name: "draft", version: "v0", text: "test" };

function item(id: string, intent: Intent = "status_check", flags: Classification["flags"] = []): DraftItem {
  return {
    message: { id, from: "", subject: "", body: "Any update?" },
    classification: { id, intent, confidence: 0.9, flags, reason: "", method: "llm" },
  };
}

function provider(...replies: (string | Error)[]) {
  let calls = 0;
  const completeJson = vi.fn(async () => {
    const r = replies[Math.min(calls++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  });
  return { name: "groq" as const, model: "fake", completeJson } satisfies LlmProvider;
}

const out = (...drafts: object[]) => JSON.stringify({ drafts });
const d = (id: string, extra = {}) => ({ id, group_ok: true, suggested_group: null, reply: "Hi [NAME], thanks. [RECRUITER_NAME]", ...extra });

describe("templates", () => {
  it.each(INTENTS)("the %s template passes every guardrail", (intent) => {
    expect(checkDraft(TEMPLATES[intent])).toEqual([]);
  });
});

describe("parseDraftOutput", () => {
  it("accepts valid output", () => {
    const r = parseDraftOutput(out(d("a")), [item("a")]);
    expect(r.ok && r.value[0]).toEqual({ id: "a", reply: "Hi [NAME], thanks. [RECRUITER_NAME]", source: "llm", dispute: null });
  });

  it("records a dispute only when the model names a different group", () => {
    const disputed = parseDraftOutput(out(d("a", { group_ok: false, suggested_group: "withdrawal" })), [item("a", "scheduling")]);
    expect(disputed.ok && disputed.value[0].dispute).toEqual({ suggested: "withdrawal" });

    const sameGroup = parseDraftOutput(out(d("a", { group_ok: false, suggested_group: "scheduling" })), [item("a", "scheduling")]);
    expect(sameGroup.ok && sameGroup.value[0].dispute).toBeNull();

    const noSuggestion = parseDraftOutput(out(d("a", { group_ok: false })), [item("a")]);
    expect(noSuggestion.ok && noSuggestion.value[0].dispute).toBeNull();
  });

  it("disputes when a blind (v2) group differs from the classifier, and not when it matches", () => {
    const differs = parseDraftOutput(out({ id: "a", group: "withdrawal", reply: "x" }), [item("a", "scheduling")]);
    expect(differs.ok && differs.value[0].dispute).toEqual({ suggested: "withdrawal" });
    const same = parseDraftOutput(out({ id: "a", group: "scheduling", reply: "x" }), [item("a", "scheduling")]);
    expect(same.ok && same.value[0].dispute).toBeNull();
  });

  it("never disputes a message out of a group that needs a person", () => {
    const down = parseDraftOutput(out({ id: "a", group: "scheduling", reply: "x" }), [item("a", "offer_compensation")]);
    expect(down.ok && down.value[0].dispute).toBeNull();
    const up = parseDraftOutput(out({ id: "a", group: "withdrawal", reply: "x" }), [item("a", "scheduling")]);
    expect(up.ok && up.value[0].dispute).toEqual({ suggested: "withdrawal" });
  });

  it("treats an unknown suggested group as no dispute instead of failing", () => {
    const r = parseDraftOutput(out(d("a", { group_ok: false, suggested_group: "hiring" })), [item("a")]);
    expect(r.ok && r.value[0].dispute).toBeNull();
  });

  it("rejects bad JSON and missing ids", () => {
    expect(parseDraftOutput("hello", [item("a")]).ok).toBe(false);
    expect(parseDraftOutput(out(d("a")), [item("a"), item("b")])).toMatchObject({ ok: false, error: expect.stringMatching(/ids b/) });
  });
});

describe("draftReplies", () => {
  it("never sends injection attempts to the model", async () => {
    const p = provider(out(d("ok")));
    const r = await draftReplies([item("bad", "other", ["possible_injection", "needs_human"]), item("ok")], "llm", { provider: p, prompt });
    expect(r.drafts[0]).toMatchObject({ id: "bad", source: "none", reply: "" });
    expect(r.drafts[1].source).toBe("llm");
    const sent = (p.completeJson.mock.calls[0] as unknown as [{ content: string }[]])[0][1].content;
    expect(sent).not.toContain('"id": "bad"');
  });

  it("uses templates in keyword mode or without a provider", async () => {
    for (const r of [
      await draftReplies([item("a", "documents")], "keyword", { provider: provider("unused") }),
      await draftReplies([item("a", "documents")], "auto", { provider: null }),
    ]) {
      expect(r.method).toBe("template");
      expect(r.drafts[0]).toMatchObject({ source: "template", reply: TEMPLATES.documents });
    }
  });

  it("retries once, then falls back to templates with a warning", async () => {
    const r = await draftReplies([item("a")], "llm", { provider: provider("bad", "still bad"), prompt });
    expect(r.drafts[0].source).toBe("template");
    expect(r.warnings[0]).toMatch(/Used templates instead/);

    const ok = await draftReplies([item("a")], "llm", { provider: provider("bad", out(d("a"))), prompt });
    expect(ok.drafts[0].source).toBe("llm");
  });

  it("keeps input order across batches", async () => {
    const items = Array.from({ length: 13 }, (_, i) => item(`m${i}`));
    const p: LlmProvider = {
      name: "groq",
      model: "fake",
      completeJson: async (chat) => out(...[...chat[1].content.matchAll(/"id": "(m\d+)"/g)].map((x) => d(x[1])).reverse()),
    };
    const r = await draftReplies(items, "llm", { provider: p, prompt });
    expect(r.drafts.map((x) => x.id)).toEqual(items.map((i) => i.message.id));
  });
});

describe("renderDraftBatch", () => {
  it("shows the classifier's group only when asked (v1), and hides it for blind prompts", () => {
    expect(renderDraftBatch([item("a", "referral")], true)).toContain('"group": "referral"');
    expect(renderDraftBatch([item("a", "referral")], false)).not.toContain("referral");
  });
});
