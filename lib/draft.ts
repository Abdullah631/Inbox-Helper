import { z } from "zod";
import { criticize, pickCriticProvider } from "./critic";
import { looksLikeInjection } from "./flags";
import { SENSITIVE_INTENTS } from "./intents";
import { BATCH_SIZES, DRAFT_REPLY_CHARS_MAX, PROMPT_BODY_CHARS } from "./limits";
import { getProvider, getProviders, type CallOptions, type LlmProvider } from "./llm";
import { checkIds, completeValidated, dataBlock, inBatches, parseJsonLoose, safeErrorMessage, type Parsed } from "./llm-json";
import { loadActivePrompt, type Prompt } from "./prompts";
import { IntentSchema, type Classification, type Draft, type Message, type Mode } from "./schema";
import { TEMPLATES } from "./templates";

export const DRAFT_BATCH_SIZE = BATCH_SIZES.draft;

// draft v1 was shown the classifier's group and agreed with it every time (Day 3).
// From v2 the group is hidden and the model names its own. Old prompt files are never
// edited, so the versions that expect to see the group are listed here.
const PROMPTS_THAT_SEE_THE_GROUP = new Set(["v1"]);

export type DraftItem = { message: Message; classification: Classification };

export type DraftResult = {
  drafts: Draft[];
  method: "llm" | "template";
  model?: string;
  reviewerModel?: string;
  promptVersion?: string;
  warnings: string[];
};

const OutputSchema = z.object({
  drafts: z.array(
    z.object({
      id: z.string(),
      group_ok: z.boolean().default(true),
      suggested_group: IntentSchema.nullable().optional().catch(null),
      group: IntentSchema.optional().catch(undefined),
      reply: z.string().max(DRAFT_REPLY_CHARS_MAX),
    }),
  ),
});

// critic: null turns the AI reviewer off (tests, and evals that measure drafting alone).
type Deps = { provider?: LlmProvider | null; prompt?: Prompt; critic?: LlmProvider | null; signal?: AbortSignal };

const noDraft = (id: string): Draft => ({ id, reply: "", source: "none", dispute: null, concerns: null });

export function templateDraft(item: DraftItem): Draft {
  return { id: item.message.id, reply: TEMPLATES[item.classification.intent], source: "template", dispute: null, concerns: null };
}

export async function draftReplies(items: DraftItem[], mode: Mode, deps: Deps = {}): Promise<DraftResult> {
  const provider = deps.provider === undefined ? getProvider() : deps.provider;
  const useLlm = mode !== "keyword" && Boolean(provider);
  const opts: CallOptions = { signal: deps.signal };
  const drafts = new Map<string, Draft>();
  const warnings: string[] = [];

  // Injection attempts never go to the model. A person writes that reply. Checked
  // here as well as trusting the flag, because the API is public and a caller can
  // send a classification without it (Day 5 review).
  const toDraft: DraftItem[] = [];
  for (const item of items) {
    const id = item.message.id;
    if (item.classification.flags.includes("possible_injection") || looksLikeInjection(item.message)) drafts.set(id, noDraft(id));
    else if (!useLlm) drafts.set(id, templateDraft(item));
    else toDraft.push(item);
  }

  let prompt: Prompt | undefined;
  if (useLlm && toDraft.length) {
    const p = deps.prompt ?? loadActivePrompt("draft");
    prompt = p;
    const written = await inBatches(
      toDraft,
      DRAFT_BATCH_SIZE,
      (batch) => draftBatch(batch, provider!, p, opts),
      (batch, _i, e) => {
        warnings.push(`Drafts for ${batch.length} messages: ${safeErrorMessage(e)} Used templates instead.`);
        return batch.map(templateDraft);
      },
    );
    for (const d of written) drafts.set(d.id, d);
  }

  // A second model reads the AI drafts. If it fails, drafts still go out, marked unchecked.
  let reviewerModel: string | undefined;
  const llmDrafts = [...drafts.values()].filter((d) => d.source === "llm");
  const critic = deps.critic === undefined ? pickCriticProvider(provider, getProviders()) : deps.critic;
  if (critic && llmDrafts.length) {
    const review = await criticize(llmDrafts.map((d) => ({ id: d.id, reply: d.reply })), critic, undefined, opts);
    for (const d of llmDrafts) drafts.set(d.id, { ...d, concerns: review.concerns.get(d.id) ?? null });
    warnings.push(...review.warnings);
    if ([...review.concerns.values()].some((c) => c !== null)) reviewerModel = critic.model;
  }

  const anyLlm = llmDrafts.length > 0;
  return {
    reviewerModel,
    drafts: items.map((i) => drafts.get(i.message.id)!),
    method: useLlm ? "llm" : "template",
    model: !useLlm ? undefined : anyLlm ? provider!.model : "no model answered",
    promptVersion: prompt?.version,
    warnings,
  };
}

function draftBatch(batch: DraftItem[], provider: LlmProvider, prompt: Prompt, opts: CallOptions): Promise<Draft[]> {
  const user = renderDraftBatch(batch, PROMPTS_THAT_SEE_THE_GROUP.has(prompt.version));
  return completeValidated(provider, prompt.text, user, (raw) => parseDraftOutput(raw, batch), opts);
}

export function renderDraftBatch(batch: DraftItem[], showGroup: boolean): string {
  const data = batch.map(({ message: m, classification: c }) => ({
    id: m.id,
    ...(showGroup ? { group: c.intent } : {}),
    subject: m.subject,
    body: m.body.slice(0, PROMPT_BODY_CHARS),
  }));
  return `Write a reply draft for each of these ${batch.length} messages.\n${dataBlock("messages", data)}`;
}

export function parseDraftOutput(raw: string, batch: DraftItem[]): Parsed<Draft[]> {
  const json = parseJsonLoose(raw);
  if (!json.ok) return json;
  const out = OutputSchema.safeParse(json.value);
  if (!out.success) {
    const issue = out.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const idProblem = checkIds(out.data.drafts.map((d) => d.id), batch.map((b) => b.message.id));
  if (idProblem) return { ok: false, error: idProblem };

  const byId = new Map(out.data.drafts.map((d) => [d.id, d]));
  return {
    ok: true,
    value: batch.map(({ message, classification }) => {
      const d = byId.get(message.id)!;
      const suggested = d.group ?? (d.group_ok ? undefined : d.suggested_group ?? undefined);
      // A dispute may never pull a message out of a group that needs a person (Day 3:
      // m53 asks about salary and a reschedule, and the drafting step suggested
      // Scheduling, which would have dropped the needs_human flag).
      const unsafe = SENSITIVE_INTENTS.has(classification.intent) && suggested !== undefined && !SENSITIVE_INTENTS.has(suggested);
      return {
        id: message.id,
        reply: d.reply.trim(),
        source: "llm" as const,
        dispute: suggested && suggested !== classification.intent && !unsafe ? { suggested } : null,
        concerns: null,
      };
    }),
  };
}
