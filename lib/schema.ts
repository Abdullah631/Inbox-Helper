import { z } from "zod";
import { CONCERN_KINDS } from "./concerns";
import { INTENTS } from "./intents";
import { MESSAGE_LIMITS, REQUEST_LIMITS } from "./limits";

export const IntentSchema = z.enum(INTENTS);

// auto: AI if a key is configured, otherwise keywords. llm: AI or an error. keyword: never AI.
export const ModeSchema = z.enum(["auto", "llm", "keyword"]);
export type Mode = z.infer<typeof ModeSchema>;

export const MessageSchema = z.object({
  id: z.string().trim().min(1).max(MESSAGE_LIMITS.idMax),
  from: z.string().max(MESSAGE_LIMITS.fromMax).default("unknown"),
  subject: z.string().max(MESSAGE_LIMITS.subjectMax).default(""),
  body: z
    .string()
    .min(1, "message body is empty")
    .max(MESSAGE_LIMITS.bodyMax, `message body is over ${MESSAGE_LIMITS.bodyMax.toLocaleString("en")} characters`),
});
export type Message = z.infer<typeof MessageSchema>;

export const LabeledMessageSchema = MessageSchema.extend({
  expected_intent: IntentSchema,
  // "ai-proposed" = generated label not yet checked by a person; "human" = checked.
  label_source: z.enum(["ai-proposed", "human"]),
  note: z.string().optional(),
});
export type LabeledMessage = z.infer<typeof LabeledMessageSchema>;

// intent_disputed is added after drafting, when the drafting model disagrees with the group.
export const FLAGS = ["possible_injection", "needs_human", "low_confidence", "intent_disputed"] as const;
export const FlagSchema = z.enum(FLAGS);
export type Flag = (typeof FLAGS)[number];

export const ClassificationSchema = z.object({
  id: z.string().max(MESSAGE_LIMITS.idMax),
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  flags: z.array(FlagSchema).max(FLAGS.length),
  reason: z.string().max(500),
  method: z.enum(["fallback", "llm"]),
});
export type Classification = z.infer<typeof ClassificationSchema>;

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const ClassifyRequestSchema = z.object({
  messages: z
    .array(MessageSchema)
    .min(1)
    .max(REQUEST_LIMITS.classifyMessagesMax)
    .refine((ms) => uniqueIds(ms.map((m) => m.id)), "message ids must be unique"),
  mode: ModeSchema.default("auto"),
});

export const ConcernSchema = z.object({ kind: z.enum(CONCERN_KINDS), quote: z.string() });

export const DraftSchema = z.object({
  id: z.string(),
  reply: z.string(),
  // "template": no LLM, or it failed. "none": flagged as a possible injection, so no
  // draft at all; a person writes the reply.
  source: z.enum(["llm", "template", "none"]),
  dispute: z.object({ suggested: IntentSchema }).nullable(),
  // From the AI reviewer (lib/critic.ts). null means the draft wasn't checked: no LLM,
  // the reviewer failed, or it isn't an AI draft.
  concerns: z.array(ConcernSchema).nullable().default(null),
});
export type Draft = z.infer<typeof DraftSchema>;

export const DraftRequestSchema = z.object({
  items: z
    .array(
      z
        .object({ message: MessageSchema, classification: ClassificationSchema })
        .refine((it) => it.message.id === it.classification.id, "classification id must match message id"),
    )
    .min(1)
    .max(REQUEST_LIMITS.draftItemsMax)
    .refine((items) => uniqueIds(items.map((it) => it.message.id)), "message ids must be unique"),
  mode: ModeSchema.default("auto"),
});

// What the API routes return. The browser validates every response against these, so a
// proxy error page or a changed server can't put malformed data into the review state.
export const ClassifyResponseSchema = z.object({
  classifications: z.array(ClassificationSchema),
  method: z.enum(["llm", "keyword"]),
  provider: z.string().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  warnings: z.array(z.string()),
});
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

export const DraftResponseSchema = z.object({
  drafts: z.array(DraftSchema),
  method: z.enum(["llm", "template"]),
  model: z.string().optional(),
  reviewerModel: z.string().optional(),
  promptVersion: z.string().optional(),
  warnings: z.array(z.string()),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;

export const ConfigResponseSchema = z.object({ llmAvailable: z.boolean() });
