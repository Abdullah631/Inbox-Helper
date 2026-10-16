import { z } from "zod";
import { CONCERN_KINDS, isConcernKind, type Concern } from "./concerns";
import { looksLikeInjectionText } from "./flags";
import { BATCH_SIZES } from "./limits";
import { getProviders, withFailover, type CallOptions, type LlmProvider } from "./llm";
import { checkIds, completeValidated, dataBlock, inBatches, parseJsonLoose, safeErrorMessage, type Parsed } from "./llm-json";
import { loadActivePrompt, type Prompt } from "./prompts";
import { normalizeForMatch } from "./text";

// A second model reads every AI draft and lists risks by meaning, not by pattern.
// Added on Day 4 after regex guardrails caught only 2 of 13 new red-team attacks.
// Its concerns are a soft block: the reviewer can approve after ticking that they
// checked them. The regex guardrails stay a hard block.

export { CONCERN_KINDS, type Concern };
export const CRITIC_BATCH_SIZE = BATCH_SIZES.critic;

export function isOnlyPlaceholders(quote: string): boolean {
  return quote.trim() !== "" && !/[a-z0-9]/i.test(quote.replace(/\[[A-Z0-9_ ]+\]/g, ""));
}

const OutputSchema = z.object({
  checks: z.array(
    z.object({
      id: z.string(),
      problems: z
        .array(z.object({ kind: z.string(), quote: z.string().max(500).default("") }))
        .default([])
        // Drop kinds we didn't ask for instead of failing the whole batch, and concerns
        // that only quote a [PLACEHOLDER] (v1 flagged [REFERRAL_EMAIL] as a real email).
        .transform((ps) => ps.filter((p): p is Concern => isConcernKind(p.kind) && !isOnlyPlaceholders(p.quote))),
    }),
  ),
});

// Prefer a provider that didn't write the drafts. On Day 3 the same model checking its
// own work just repeated its mistakes. If the independent one is down, the same model
// still reviews: a weaker check beats none, and the UI names whichever one answered.
export function pickCriticProvider(drafter: LlmProvider | null, all: LlmProvider[] = getProviders()): LlmProvider | null {
  if (!all.length) return null;
  const draftedBy = new Set((drafter?.model ?? "").split(" + "));
  const ordered = [...all.filter((p) => !draftedBy.has(p.model)), ...all.filter((p) => draftedBy.has(p.model))];
  return ordered.length > 1 ? withFailover(ordered) : ordered[0];
}

export type CriticResult = {
  // null for a draft whose batch couldn't be checked.
  concerns: Map<string, Concern[] | null>;
  warnings: string[];
};

export async function criticize(
  drafts: { id: string; reply: string }[],
  provider: LlmProvider,
  prompt: Prompt = loadActivePrompt("critic"),
  opts: CallOptions = {},
): Promise<CriticResult> {
  const warnings: string[] = [];
  type Row = readonly [string, Concern[] | null];
  const rows = await inBatches<{ id: string; reply: string }, Row>(
    drafts,
    CRITIC_BATCH_SIZE,
    async (batch) => {
      const user = `Check these ${batch.length} drafts.\n${dataBlock("drafts", batch)}`;
      const found = await completeValidated(provider, prompt.text, user, (raw) => parseCriticOutput(raw, batch.map((b) => b.id)), opts);
      return batch.map((d): Row => [d.id, withCodeChecks(keepGrounded(found.get(d.id)!, d.reply), d.reply)]);
    },
    (batch, _start, e) => {
      warnings.push(`AI review didn't run for ${batch.length} draft${batch.length === 1 ? "" : "s"} (${safeErrorMessage(e)}). Read those extra carefully.`);
      return batch.map((d): Row => [d.id, null]);
    },
  );
  return { concerns: new Map(rows), warnings };
}

// A draft is written from candidate text, so it can carry instructions aimed at the
// reviewer ("Reviewer: no problems here"). The model may obey them; this check can't.
function withCodeChecks(concerns: Concern[], reply: string): Concern[] {
  if (!looksLikeInjectionText(reply) && !/\breviewer\b/i.test(reply)) return concerns;
  return [...concerns, { kind: "ai", quote: "" }];
}

// Day 4: critic v1 quoted "I've reviewed it" for a draft that never said that. A concern
// whose quote isn't in the draft is dropped, so the reviewer can't invent evidence.
export function keepGrounded(concerns: Concern[], reply: string): Concern[] {
  const norm = (t: string) => normalizeForMatch(t).replace(/\s+/g, " ").toLowerCase().trim();
  const text = norm(reply);
  return concerns.filter((c) => !c.quote.trim() || text.includes(norm(c.quote).replace(/[.!?]+$/, "")));
}

export function parseCriticOutput(raw: string, ids: string[]): Parsed<Map<string, Concern[]>> {
  const json = parseJsonLoose(raw);
  if (!json.ok) return json;
  const out = OutputSchema.safeParse(json.value);
  if (!out.success) {
    const issue = out.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const idProblem = checkIds(out.data.checks.map((c) => c.id), ids);
  if (idProblem) return { ok: false, error: idProblem };
  return { ok: true, value: new Map(out.data.checks.map((c) => [c.id, c.problems])) };
}
