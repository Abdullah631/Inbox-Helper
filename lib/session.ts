// Saving and restoring review work in the browser. A saved session is checked fully
// before use: on Day 5 the review found that a session with a missing field crashed the
// page on every load, with no way out short of clearing site data.
import { z } from "zod";
import { CLIENT_LIMITS } from "./limits";
import type { State } from "./review-state";
import { ClassificationSchema, DraftSchema, MessageSchema } from "./schema";

const ReviewStateSchema = z.object({
  draft: DraftSchema,
  text: z.string(),
  original: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  acknowledged: z.boolean().default(false),
});

const RunInfoSchema = z.object({
  method: z.enum(["llm", "keyword"]),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  seconds: z.number(),
  reviewer: z.string().optional(),
});

const SessionSchema = z.object({
  savedAt: z.string(),
  messages: z.array(MessageSchema).min(1),
  classes: z.record(z.string(), ClassificationSchema),
  reviews: z.record(z.string(), ReviewStateSchema),
  run: RunInfoSchema,
});

export type SavedSession = z.infer<typeof SessionSchema>;

export function serializeSession(state: State, now: Date = new Date()): string | null {
  if (!state.run || !state.messages.length) return null;
  const { messages, classes, reviews, run } = state;
  return JSON.stringify({ savedAt: now.toISOString(), messages, classes, reviews, run });
}

// Returns null (and the caller deletes the saved copy) for anything unusable: bad JSON,
// the wrong shape, older than the TTL, or internally inconsistent.
export function parseSession(raw: string | null, now: number = Date.now(), ttlMs: number = CLIENT_LIMITS.sessionTtlMs): SavedSession | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = SessionSchema.safeParse(json);
  if (!parsed.success) return null;
  const s = parsed.data;

  const saved = Date.parse(s.savedAt);
  if (!Number.isFinite(saved) || now - saved > ttlMs) return null;

  const ids = new Set(s.messages.map((m) => m.id));
  if (ids.size !== s.messages.length) return null;
  if (s.messages.some((m) => !s.classes[m.id] || s.classes[m.id].id !== m.id)) return null;
  if (Object.keys(s.reviews).some((id) => !ids.has(id) || s.reviews[id].draft.id !== id)) return null;
  return s;
}
