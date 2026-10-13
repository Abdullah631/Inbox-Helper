import { z } from "zod";
import { classifyFallback } from "./fallback";
import { computeFlags } from "./flags";
import type { ChatMessage, LlmProvider } from "./llm";
import type { Prompt } from "./prompts";
import { IntentSchema, type Classification, type Message } from "./schema";

export const BATCH_SIZE = 10;
const MAX_BODY_CHARS = 2000;

const LlmOutputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      intent: IntentSchema,
      // Asked for from prompt v2 on. Making the model name a second choice is meant to
      // pull its confidence down on ambiguous messages. Not used beyond that yet.
      runner_up: IntentSchema.optional().catch(undefined),
      confidence: z.coerce.number().min(0).max(1),
      injection: z.boolean().default(false),
      reason: z.string().default(""),
    }),
  ),
});

export type LlmRunResult = { classifications: Classification[]; warnings: string[] };

export async function classifyWithLlm(messages: Message[], provider: LlmProvider, prompt: Prompt): Promise<LlmRunResult> {
  const classifications: Classification[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      classifications.push(...(await classifyBatch(batch, provider, prompt)));
    } catch (e) {
      // One bad batch shouldn't sink the whole inbox. Those messages fall back to
      // keywords and the UI shows which method was used for each one.
      warnings.push(`Messages ${i + 1}-${i + batch.length}: ${(e as Error).message} Used keywords instead.`);
      classifications.push(...batch.map(classifyFallback));
    }
  }
  return { classifications, warnings };
}

async function classifyBatch(batch: Message[], provider: LlmProvider, prompt: Prompt): Promise<Classification[]> {
  const chat: ChatMessage[] = [
    { role: "system", content: prompt.text },
    { role: "user", content: renderBatch(batch) },
  ];

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      chat.push({ role: "user", content: `Your last reply was invalid: ${lastError}. Reply again with valid JSON only.` });
    }
    const raw = await provider.completeJson(chat);
    const parsed = parseOutput(raw, batch);
    if (parsed.ok) return parsed.value;
    lastError = parsed.error;
  }
  throw new Error(`Model output invalid twice (${lastError}).`);
}

// Messages go in as JSON inside a tag so the boundary between our instructions
// and candidate text is explicit. This alone doesn't stop injection; flags do.
export function renderBatch(batch: Message[]): string {
  const data = batch.map((m) => ({ id: m.id, subject: m.subject, body: m.body.slice(0, MAX_BODY_CHARS) }));
  return `Classify these ${batch.length} messages.\n<messages>\n${JSON.stringify(data, null, 2)}\n</messages>`;
}

type Parsed = { ok: true; value: Classification[] } | { ok: false; error: string };

export function parseOutput(raw: string, batch: Message[]): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, error: "not valid JSON" };
  }

  const out = LlmOutputSchema.safeParse(json);
  if (!out.success) {
    const issue = out.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }

  const byId = new Map(out.data.results.map((r) => [r.id, r]));
  const missing = batch.filter((m) => !byId.has(m.id)).map((m) => m.id);
  if (missing.length) return { ok: false, error: `missing results for ids ${missing.join(", ")}` };

  return {
    ok: true,
    value: batch.map((m) => {
      const r = byId.get(m.id)!;
      const confidence = Number(r.confidence.toFixed(2));
      return {
        id: m.id,
        intent: r.intent,
        confidence,
        flags: computeFlags(m, r.intent, confidence, r.injection),
        reason: r.reason || "No reason given.",
        method: "llm" as const,
      };
    }),
  };
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
