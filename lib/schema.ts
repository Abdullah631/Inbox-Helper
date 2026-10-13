import { z } from "zod";
import { INTENTS } from "./intents";

export const IntentSchema = z.enum(INTENTS);

export const MessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().default("unknown"),
  subject: z.string().default(""),
  body: z.string().min(1, "message body is empty"),
});
export type Message = z.infer<typeof MessageSchema>;

export const LabeledMessageSchema = MessageSchema.extend({
  expected_intent: IntentSchema,
  // "ai-proposed" = generated label not yet checked by a human; "human" = verified.
  label_source: z.enum(["ai-proposed", "human"]),
  note: z.string().optional(),
});
export type LabeledMessage = z.infer<typeof LabeledMessageSchema>;

// intent_disputed is added after drafting, when the drafting model disagrees with the group.
export const FLAGS = ["possible_injection", "needs_human", "low_confidence", "intent_disputed"] as const;
export type Flag = (typeof FLAGS)[number];

export const ClassificationSchema = z.object({
  id: z.string(),
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  flags: z.array(z.enum(FLAGS)),
  reason: z.string(),
  method: z.enum(["fallback", "llm"]),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ClassifyRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(50),
  mode: z.enum(["auto", "llm", "keyword"]).default("auto"),
});

export const DraftSchema = z.object({
  id: z.string(),
  reply: z.string(),
  // "template" when there was no LLM, it failed, or the message was an injection attempt.
  source: z.enum(["llm", "template", "none"]),
  dispute: z.object({ suggested: IntentSchema }).nullable(),
});
export type Draft = z.infer<typeof DraftSchema>;

export const DraftRequestSchema = z.object({
  items: z
    .array(z.object({ message: MessageSchema, classification: ClassificationSchema }))
    .min(1)
    .max(20),
  mode: z.enum(["auto", "llm", "keyword"]).default("auto"),
});
