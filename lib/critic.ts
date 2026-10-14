import { z } from "zod";
import { getProviders, withFailover, type LlmProvider } from "./llm";
import { ACTIVE_PROMPTS, loadPrompt, type Prompt } from "./prompts";

// A second model reads every AI draft and lists risks by meaning, not by pattern.
// Added on Day 4 after regex guardrails caught only 2 of 13 new red-team attacks.
// Its concerns are a soft block: the reviewer can approve after ticking that they
// checked them. The regex guardrails stay a hard block.

export const CONCERN_KINDS = ["money", "offer", "decision", "date", "claims_action", "company_fact", "contact", "ai"] as const;
export type ConcernKind = (typeof CONCERN_KINDS)[number];
export type Concern = { kind: ConcernKind; quote: string };

export const CRITIC_BATCH_SIZE = 15;

export function isOnlyPlaceholders(quote: string): boolean {
  return quote.trim() !== "" && !/[a-z0-9]/i.test(quote.replace(/\[[A-Z0-9_ ]+\]/g, ""));
}

const OutputSchema = z.object({
  checks: z.array(
    z.object({
      id: z.string(),
      problems: z
        .array(z.object({ kind: z.string(), quote: z.string().default("") }))
        .default([])
        // Drop kinds we didn't ask for instead of failing the whole batch, and concerns
        // that only quote a [PLACEHOLDER] (v1 flagged [REFERRAL_EMAIL] as a real email).
        .transform((ps) =>
          ps.filter(
            (p): p is Concern =>
              (CONCERN_KINDS as readonly string[]).includes(p.kind) && !isOnlyPlaceholders(p.quote),
          ),
        ),
    }),
  ),
});

// Prefer a different provider from the one that wrote the drafts. On Day 3 the same
// model checking its own work just repeated its mistakes.
// If the independent model is down, the same model still reviews: a weaker check beats
// none, and the UI names whichever model actually answered.
export function pickCriticProvider(drafter: LlmProvider | null, all: LlmProvider[] = getProviders()): LlmProvider | null {
  if (!all.length) return null;
  const draftedBy = drafter?.model ?? "";
  const ordered = [...all.filter((p) => !draftedBy.includes(p.model)), ...all.filter((p) => draftedBy.includes(p.model))];
  return ordered.length > 1 ? withFailover(ordered) : ordered[0];
}

export async function criticize(
  drafts: { id: string; reply: string }[],
  provider: LlmProvider,
  prompt: Prompt = loadPrompt("critic", ACTIVE_PROMPTS.critic),
): Promise<Map<string, Concern[]>> {
  const out = new Map<string, Concern[]>();
  for (let i = 0; i < drafts.length; i += CRITIC_BATCH_SIZE) {
    const batch = drafts.slice(i, i + CRITIC_BATCH_SIZE);
    const user = `Check these ${batch.length} drafts.\n<drafts>\n${JSON.stringify(batch, null, 2)}\n</drafts>`;
    const raw = await provider.completeJson([
      { role: "system", content: prompt.text },
      { role: "user", content: user },
    ]);
    const parsed = parseCriticOutput(raw, batch.map((b) => b.id));
    for (const d of batch) out.set(d.id, keepGrounded(parsed.get(d.id)!, d.reply));
  }
  return out;
}

// Day 4: critic v1 quoted "I've reviewed it" for a draft that never said that. A concern
// whose quote isn't in the draft is dropped, so the reviewer can't invent evidence.
export function keepGrounded(concerns: Concern[], reply: string): Concern[] {
  const norm = (t: string) => t.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").toLowerCase().trim();
  const text = norm(reply);
  return concerns.filter((c) => !c.quote.trim() || text.includes(norm(c.quote).replace(/[.!?]+$/, "")));
}

export function parseCriticOutput(raw: string, ids: string[]): Map<string, Concern[]> {
  const json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  const data = OutputSchema.parse(json);
  const byId = new Map(data.checks.map((c) => [c.id, c.problems]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`critic skipped ids ${missing.join(", ")}`);
  return new Map(ids.map((id) => [id, byId.get(id)!]));
}
