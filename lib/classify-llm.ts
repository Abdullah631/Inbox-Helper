import { z } from "zod";
import { classifyFallback, keywordIntent } from "./fallback";
import { computeFlags, looksLikeInjection } from "./flags";
import { BATCH_SIZES, PROMPT_BODY_CHARS } from "./limits";
import type { CallOptions, LlmProvider } from "./llm";
import { checkIds, completeValidated, dataBlock, parseJsonLoose, safeErrorMessage, type Parsed } from "./llm-json";
import type { Prompt } from "./prompts";
import { IntentSchema, type Classification, type Message } from "./schema";

export const BATCH_SIZE = BATCH_SIZES.classify;

const LlmOutputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      intent: IntentSchema,
      // Asked for from prompt v2 on. Making the model name a second choice was meant to
      // pull its confidence down on ambiguous messages. Not used beyond that.
      runner_up: IntentSchema.optional().catch(undefined),
      confidence: z.coerce.number().min(0).max(1),
      // Some models send "true" as a string. Anything else is treated as false, and the
      // code-side detector still runs, so this can only add a flag.
      injection: z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform((v) => v === true || v === "true").default(false),
      reason: z.string().max(500).default(""),
    }),
  ),
});

export type LlmRunResult = { classifications: Classification[]; warnings: string[] };

// Messages that look like they're trying to instruct the model are classified one at a
// time, so they can't influence the other messages in a shared prompt (Day 5 review).
export function planBatches(messages: Message[], size: number = BATCH_SIZE): Message[][] {
  const suspicious = messages.filter((m) => looksLikeInjection(m));
  const normal = messages.filter((m) => !looksLikeInjection(m));
  const batches: Message[][] = [];
  for (let i = 0; i < normal.length; i += size) batches.push(normal.slice(i, i + size));
  for (const m of suspicious) batches.push([m]);
  return batches;
}

export async function classifyWithLlm(
  messages: Message[],
  provider: LlmProvider,
  prompt: Prompt,
  opts: CallOptions = {},
): Promise<LlmRunResult> {
  const warnings: string[] = [];
  const byId = new Map<string, Classification>();
  for (const batch of planBatches(messages)) {
    let results: Classification[];
    try {
      results = await classifyBatch(batch, provider, prompt, opts);
    } catch (e) {
      // One bad batch shouldn't sink the whole inbox. Those messages fall back to
      // keywords and the UI shows which method was used for each one.
      warnings.push(`${batch.length} message${batch.length === 1 ? "" : "s"}: ${safeErrorMessage(e)} Used keywords instead.`);
      results = batch.map(classifyFallback);
    }
    for (const c of results) byId.set(c.id, c);
  }
  return { classifications: messages.map((m) => byId.get(m.id)!), warnings };
}

function classifyBatch(batch: Message[], provider: LlmProvider, prompt: Prompt, opts: CallOptions): Promise<Classification[]> {
  return completeValidated(provider, prompt.text, renderBatch(batch), (raw) => parseOutput(raw, batch), opts);
}

// Messages go in as JSON inside a tag so the boundary between our instructions and
// candidate text is explicit. This alone doesn't stop injection; code-side flags do.
export function renderBatch(batch: Message[]): string {
  const data = batch.map((m) => ({ id: m.id, subject: m.subject, body: m.body.slice(0, PROMPT_BODY_CHARS) }));
  return `Classify these ${batch.length} messages.\n${dataBlock("messages", data)}`;
}

export function parseOutput(raw: string, batch: Message[]): Parsed<Classification[]> {
  const json = parseJsonLoose(raw);
  if (!json.ok) return json;

  const out = LlmOutputSchema.safeParse(json.value);
  if (!out.success) {
    const issue = out.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }

  const idProblem = checkIds(out.data.results.map((r) => r.id), batch.map((m) => m.id));
  if (idProblem) return { ok: false, error: idProblem };

  const byId = new Map(out.data.results.map((r) => [r.id, r]));
  return {
    ok: true,
    value: batch.map((m) => {
      const r = byId.get(m.id)!;
      const confidence = Number(r.confidence.toFixed(2));
      return {
        id: m.id,
        intent: r.intent,
        confidence,
        flags: computeFlags(m, r.intent, confidence, r.injection, keywordIntent(m).intent),
        reason: r.reason || "No reason given.",
        method: "llm" as const,
      };
    }),
  };
}
