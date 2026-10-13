import { z } from "zod";
import { SENSITIVE_INTENTS } from "./intents";
import { getProvider, type ChatMessage, type LlmProvider } from "./llm";
import { ACTIVE_PROMPTS, loadPrompt, type Prompt } from "./prompts";
import { IntentSchema, type Classification, type Draft, type Message } from "./schema";
import { TEMPLATES } from "./templates";
import type { Mode } from "./classify";

export const DRAFT_BATCH_SIZE = 10;
const MAX_BODY_CHARS = 2000;

export type DraftItem = { message: Message; classification: Classification };

export type DraftResult = {
  drafts: Draft[];
  method: "llm" | "template";
  model?: string;
  promptVersion?: string;
  warnings: string[];
};

const OutputSchema = z.object({
  drafts: z.array(
    z.object({
      id: z.string(),
      // v1 is shown the classifier's group and asked if it fits (group_ok, suggested_group).
      // From v2 the group is hidden and the model names its own ("group"), because v1
      // just agreed with whatever it was shown.
      group_ok: z.boolean().default(true),
      suggested_group: IntentSchema.nullable().optional().catch(null),
      group: IntentSchema.optional().catch(undefined),
      reply: z.string(),
    }),
  ),
});

type Deps = { provider?: LlmProvider | null; prompt?: Prompt };

export async function draftReplies(items: DraftItem[], mode: Mode, deps: Deps = {}): Promise<DraftResult> {
  const provider = deps.provider === undefined ? getProvider() : deps.provider;
  const useLlm = mode !== "keyword" && Boolean(provider);
  const drafts = new Map<string, Draft>();
  const warnings: string[] = [];

  // Injection attempts never go back to the model. A person writes that reply.
  const toDraft: DraftItem[] = [];
  for (const item of items) {
    if (item.classification.flags.includes("possible_injection")) {
      drafts.set(item.message.id, { id: item.message.id, reply: "", source: "none", dispute: null });
    } else if (!useLlm) {
      drafts.set(item.message.id, templateDraft(item));
    } else {
      toDraft.push(item);
    }
  }

  let prompt: Prompt | undefined;
  if (useLlm && toDraft.length) {
    prompt = deps.prompt ?? loadPrompt("draft", process.env.DRAFT_PROMPT_VERSION || ACTIVE_PROMPTS.draft);
    for (let i = 0; i < toDraft.length; i += DRAFT_BATCH_SIZE) {
      const batch = toDraft.slice(i, i + DRAFT_BATCH_SIZE);
      try {
        for (const d of await draftBatch(batch, provider!, prompt)) drafts.set(d.id, d);
      } catch (e) {
        warnings.push(`Drafts for ${batch.length} messages: ${(e as Error).message} Used templates instead.`);
        for (const item of batch) drafts.set(item.message.id, templateDraft(item));
      }
    }
  }

  return {
    drafts: items.map((i) => drafts.get(i.message.id)!),
    method: useLlm ? "llm" : "template",
    model: useLlm ? provider!.model : undefined,
    promptVersion: prompt?.version,
    warnings,
  };
}

export function templateDraft(item: DraftItem): Draft {
  return { id: item.message.id, reply: TEMPLATES[item.classification.intent], source: "template", dispute: null };
}

async function draftBatch(batch: DraftItem[], provider: LlmProvider, prompt: Prompt): Promise<Draft[]> {
  const chat: ChatMessage[] = [
    { role: "system", content: prompt.text },
    { role: "user", content: renderDraftBatch(batch, prompt.version === "v1") },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) chat.push({ role: "user", content: `Your last reply was invalid: ${lastError}. Reply again with valid JSON only.` });
    const parsed = parseDraftOutput(await provider.completeJson(chat), batch);
    if (parsed.ok) return parsed.value;
    lastError = parsed.error;
  }
  throw new Error(`Model output invalid twice (${lastError}).`);
}

export function renderDraftBatch(batch: DraftItem[], showGroup: boolean): string {
  const data = batch.map(({ message: m, classification: c }) => ({
    id: m.id,
    ...(showGroup ? { group: c.intent } : {}),
    subject: m.subject,
    body: m.body.slice(0, MAX_BODY_CHARS),
  }));
  return `Write a reply draft for each of these ${batch.length} messages.\n<messages>\n${JSON.stringify(data, null, 2)}\n</messages>`;
}

type Parsed = { ok: true; value: Draft[] } | { ok: false; error: string };

export function parseDraftOutput(raw: string, batch: DraftItem[]): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const out = OutputSchema.safeParse(json);
  if (!out.success) {
    const issue = out.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }

  const byId = new Map(out.data.drafts.map((d) => [d.id, d]));
  const missing = batch.filter((b) => !byId.has(b.message.id)).map((b) => b.message.id);
  if (missing.length) return { ok: false, error: `missing drafts for ids ${missing.join(", ")}` };

  return {
    ok: true,
    value: batch.map(({ message, classification }) => {
      const d = byId.get(message.id)!;
      const suggested = d.group ?? (d.group_ok ? undefined : d.suggested_group ?? undefined);
      // A dispute may never pull a message out of a group that needs a person (found on
      // Day 3: m53 asks about salary and a reschedule, and the drafting step suggested
      // Scheduling, which would have dropped the needs_human flag).
      const unsafe = SENSITIVE_INTENTS.has(classification.intent) && suggested && !SENSITIVE_INTENTS.has(suggested);
      return {
        id: message.id,
        reply: d.reply.trim(),
        source: "llm" as const,
        dispute: suggested && suggested !== classification.intent && !unsafe ? { suggested } : null,
      };
    }),
  };
}
